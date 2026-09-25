-- ============================================================
-- Fix: Lucknow office continuous loading on check-in
--
-- Root causes fixed:
-- 1. rpc_attendance_checkin_v3 used SELECT INTO STRICT which throws
--    if the attendance row is not yet visible after v2 commit under
--    DB load (race condition) — replaced with safe retry loop.
-- 2. get_attendance_policy returned 0 rows when attendance_policies
--    had no role='all' row for an office — now falls back to safe
--    defaults so getAllowedOffices never throws.
-- 3. Lucknow office coords, radius, and attendance_policy row
--    ensured via upsert.
-- ============================================================

-- ── 1. Fix rpc_attendance_checkin_v3: remove STRICT fetch ──────────────────

create or replace function public.rpc_attendance_checkin_v3(
  p_office_id uuid,
  p_location  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid             uuid := auth.uid();
  v_result          jsonb;
  v_attendance      public.attendance_logs%rowtype;
  v_profile         public.profiles%rowtype;
  v_office          public.offices%rowtype;
  v_site            public.predefined_sites%rowtype;
  v_site_distance   double precision;
  v_office_distance double precision;
  v_lat             double precision;
  v_lon             double precision;
  v_accuracy        double precision;
  v_visit_id        uuid;
  v_today           date := (now() at time zone 'Asia/Kolkata')::date;
  v_retry           integer := 0;
begin
  -- Step 1: run core v2 check-in (idempotent, advisory-locked)
  v_result := public.rpc_attendance_checkin_v2(p_office_id, p_location);
  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  v_lat      := (p_location->>'latitude')::double precision;
  v_lon      := (p_location->>'longitude')::double precision;
  v_accuracy := greatest(0, coalesce((p_location->>'accuracy')::double precision, 0));

  -- Step 2: safe fetch with retry (replaces SELECT INTO STRICT which threw
  -- an exception when the row was not yet visible under DB load — this was
  -- the primary cause of the Lucknow "4-5 attempts" loading loop).
  loop
    select * into v_attendance
    from public.attendance_logs
    where user_id        = v_uid
      and date           = v_today
      and checkin_time is not null
    order by checkin_time
    limit 1;

    exit when found;
    v_retry := v_retry + 1;
    exit when v_retry >= 3;
    perform pg_sleep(0.1);  -- 100ms back-off per retry
  end loop;

  -- If still not found after retries, return success without side-effects.
  -- The check-in itself already committed — do not fail the whole call.
  if not found then
    return v_result || jsonb_build_object(
      'side_effects_committed',      false,
      'side_effects_skipped_reason', 'attendance_row_not_yet_visible'
    );
  end if;

  -- Step 3: fetch profile and office (non-strict, bail gracefully)
  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    return v_result || jsonb_build_object(
      'attendance_id',          v_attendance.id,
      'side_effects_committed', true
    );
  end if;

  select * into v_office from public.offices where id = p_office_id;
  if not found then
    return v_result || jsonb_build_object(
      'attendance_id',          v_attendance.id,
      'side_effects_committed', true
    );
  end if;

  -- Step 4: manager distance warning (non-fatal, wrapped in exception block)
  begin
    v_office_distance := public.field_visit_distance_metres(
      v_office.latitude, v_office.longitude, v_lat, v_lon
    );
    if v_profile.reports_to is not null and v_office_distance > 50 then
      insert into public.notifications(user_id, title, message, type)
      select
        v_profile.reports_to,
        'Attendance Warning',
        format('%s checked in %s m away from %s',
          v_profile.name, round(v_office_distance), v_office.name),
        'attendance_warning'
      where not exists (
        select 1 from public.notifications n
        where n.user_id  = v_profile.reports_to
          and n.type     = 'attendance_warning'
          and n.message  = format('%s checked in %s m away from %s',
                             v_profile.name, round(v_office_distance), v_office.name)
          and n.created_at >= (
            date_trunc('day', now() at time zone 'Asia/Kolkata')
            at time zone 'Asia/Kolkata'
          )
      );
    end if;
  exception when others then null;
  end;

  -- Step 5: auto-detect nearest predefined site (non-fatal)
  begin
    select site.* into v_site
    from public.predefined_sites site
    where site.is_active
      and site.latitude         is not null
      and site.longitude        is not null
      and site.checkin_radius_m is not null
      and public.field_visit_distance_metres(
            site.latitude, site.longitude, v_lat, v_lon
          ) + v_accuracy <= site.checkin_radius_m
    order by public.field_visit_distance_metres(
               site.latitude, site.longitude, v_lat, v_lon
             ), site.id
    limit 1;

    if found then
      v_site_distance := public.field_visit_distance_metres(
        v_site.latitude, v_site.longitude, v_lat, v_lon
      );
      insert into public.field_visits(
        user_id, predefined_site_id, visit_type, location_name,
        location_address, destination_coords, checkin_radius_m, project_name,
        notes, checkin_time, checkin_location, status, date, journey_status,
        auto_attendance_id
      ) values (
        v_uid, v_site.id, 'site', v_site.site_label,
        v_site.address,
        jsonb_build_object('latitude', v_site.latitude, 'longitude', v_site.longitude),
        v_site.checkin_radius_m, v_site.project_name,
        format('Auto-detected during attendance check-in · %s m from site',
               round(v_site_distance)),
        v_attendance.checkin_time,
        jsonb_build_object(
          'latitude',    v_lat,
          'longitude',   v_lon,
          'accuracy',    v_accuracy,
          'captured_at', coalesce(p_location->>'capturedAt', p_location->>'captured_at'),
          'provider',    'attendance-checkin'
        ),
        'CHECKED_IN', v_attendance.date, 'SITE_CHECKED_IN', v_attendance.id
      )
      on conflict (auto_attendance_id) where auto_attendance_id is not null
      do update set auto_attendance_id = excluded.auto_attendance_id
      returning id into v_visit_id;
    end if;
  exception when others then null;
  end;

  return v_result || jsonb_build_object(
    'attendance_id',                  v_attendance.id,
    'automatic_site_visit_id',        v_visit_id,
    'automatic_site_name',
      case when v_visit_id is null then null else v_site.site_label end,
    'automatic_site_distance_metres', v_site_distance,
    'side_effects_committed',         true
  );
end;
$$;

revoke all on function public.rpc_attendance_checkin_v3(uuid, jsonb)
  from public, anon;
grant execute on function public.rpc_attendance_checkin_v3(uuid, jsonb)
  to authenticated;


-- ── 2. Fix get_attendance_policy: safe default when no policy row exists ───

create or replace function public.get_attendance_policy(p_user_id uuid)
returns table(
  min_work_duration_minutes     integer,
  earliest_checkout_time        text,
  auto_close_time               text,
  allow_night_shift             boolean,
  require_early_checkout_reason boolean,
  undo_checkout_minutes         integer,
  office_id                     uuid,
  office_name                   text,
  late_checkin_time             text,
  checkin_reminder_time         text,
  checkout_reminder_time        text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;

  if p_user_id <> v_actor and not exists (
    select 1 from public.profiles target
    where target.id = p_user_id and target.is_active = true
      and (
        target.reports_to = v_actor
        or exists (
          select 1 from public.profiles actor
          where actor.id = v_actor and actor.is_active = true
            and upper(coalesce(actor.role, '')) in
              ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
        )
      )
  ) then
    raise exception 'POLICY_ACCESS_DENIED';
  end if;

  -- Primary: role-matched or role='all' policy row
  return query
  select
    ap.min_work_duration_minutes,
    ap.earliest_checkout_time,
    ap.auto_close_time,
    ap.allow_night_shift,
    ap.require_early_checkout_reason,
    ap.undo_checkout_minutes,
    o.id,
    o.name,
    to_char(ap.late_checkin_time,      'HH24:MI'),
    to_char(ap.checkin_reminder_time,  'HH24:MI'),
    to_char(ap.checkout_reminder_time, 'HH24:MI')
  from public.profiles p
  join public.offices o on o.id = p.office_id and o.is_active = true
  join public.attendance_policies ap
    on ap.office_id = p.office_id
   and coalesce(ap.is_active, true)
   and lower(coalesce(ap.role, 'all')) in (lower(coalesce(p.role, '')), 'all')
  where p.id = p_user_id and p.is_active = true
  order by
    case when lower(coalesce(ap.role, 'all')) =
              lower(coalesce(p.role, '')) then 0 else 1 end
  limit 1;

  -- Fallback: return office with safe defaults if no policy row exists
  -- This prevents getAllowedOffices from throwing for Lucknow employees
  if not found then
    return query
    select
      480,
      '09:00'::text,
      '23:59'::text,
      false,
      false,
      5,
      o.id,
      o.name,
      '10:30'::text,
      '09:00'::text,
      '18:00'::text
    from public.profiles p
    join public.offices o on o.id = p.office_id and o.is_active = true
    where p.id = p_user_id and p.is_active = true
    limit 1;
  end if;
end;
$$;

revoke all on function public.get_attendance_policy(uuid) from public, anon;
grant execute on function public.get_attendance_policy(uuid) to authenticated;


-- ── 3. Ensure Lucknow office has correct coords, radius, and policy row ────

insert into public.offices (
  name, latitude, longitude, attendance_radius, allowed_radius_meters, is_active
)
values (
  'Lucknow Office', 26.865333350879812, 80.9983684941455, 300, 300, true
)
on conflict (name) do update
  set latitude              = excluded.latitude,
      longitude             = excluded.longitude,
      attendance_radius     = excluded.attendance_radius,
      allowed_radius_meters = excluded.allowed_radius_meters,
      is_active             = true;

insert into public.attendance_policies (
  office_id, role, is_active,
  min_work_duration_minutes, earliest_checkout_time, auto_close_time,
  allow_night_shift, require_early_checkout_reason, undo_checkout_minutes,
  late_checkin_time, checkin_reminder_time, checkout_reminder_time
)
select
  o.id, 'all', true,
  480, '09:00', '23:59',
  false, false, 5,
  '10:30', '09:00', '18:00'
from public.offices o
where o.name = 'Lucknow Office'
  and not exists (
    select 1 from public.attendance_policies ap
    where ap.office_id = o.id and coalesce(ap.is_active, true)
  );

notify pgrst, 'reload schema';
