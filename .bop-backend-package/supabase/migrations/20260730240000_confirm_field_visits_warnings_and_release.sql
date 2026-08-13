-- Confirm field-visit mutations, calculate tracking warnings from server policy,
-- and publish the complete frontend/Edge Function compatibility contract.

drop function if exists public.check_in_field_visit_at_selected_site(
  uuid, double precision, double precision, double precision,
  timestamptz, text, boolean
);

create function public.check_in_field_visit_at_selected_site(
  p_visit_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_metres double precision,
  p_captured_at timestamptz,
  p_location_provider text,
  p_mocked_location boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_visit public.field_visits%rowtype;
  v_site public.predefined_sites%rowtype;
  v_distance double precision;
  v_checkin_time timestamptz;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;

  select * into v_visit
  from public.field_visits
  where id = p_visit_id
    and user_id = v_uid
    and status = 'PENDING'
  for update;
  if not found or v_visit.predefined_site_id is null then
    raise exception 'FIELD_VISIT_NOT_FOUND';
  end if;

  select * into v_site
  from public.predefined_sites
  where id = v_visit.predefined_site_id and is_active = true;
  if not found then raise exception 'SELECTED_SITE_NOT_ACTIVE'; end if;

  if p_latitude is null or p_longitude is null
     or p_latitude = 0 or p_longitude = 0
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception 'INVALID_COORDINATES';
  end if;
  if p_accuracy_metres is null
     or p_accuracy_metres < 0
     or p_accuracy_metres > 100 then
    raise exception 'GPS_ACCURACY_NOT_ACCEPTABLE';
  end if;
  if p_captured_at < now() - interval '60 seconds'
     or p_captured_at > now() + interval '10 seconds' then
    raise exception 'STALE_LOCATION_EVIDENCE';
  end if;
  if coalesce(p_mocked_location, false) then
    raise exception 'MOCK_LOCATION_DETECTED';
  end if;

  v_distance := public.field_visit_distance_metres(
    v_site.latitude, v_site.longitude, p_latitude, p_longitude
  );
  if v_site.checkin_radius_m is null or v_site.checkin_radius_m < 10 then
    raise exception 'SELECTED_SITE_RADIUS_NOT_CONFIGURED';
  end if;
  if v_distance + p_accuracy_metres > v_site.checkin_radius_m then
    raise exception 'OUTSIDE_SELECTED_SITE_RADIUS';
  end if;

  update public.field_visits
  set
    checkin_time = now(),
    checkin_location = jsonb_build_object(
      'latitude', p_latitude,
      'longitude', p_longitude,
      'accuracy', p_accuracy_metres,
      'captured_at', p_captured_at,
      'provider', left(coalesce(p_location_provider, 'unknown'), 80)
    ),
    status = 'CHECKED_IN',
    journey_status = 'SITE_CHECKED_IN'
  where id = p_visit_id
  returning checkin_time into v_checkin_time;

  return jsonb_build_object(
    'success', true,
    'visit_id', p_visit_id,
    'status', 'CHECKED_IN',
    'checkin_time', v_checkin_time,
    'distance_metres', v_distance
  );
end;
$$;

revoke all on function public.check_in_field_visit_at_selected_site(
  uuid, double precision, double precision, double precision,
  timestamptz, text, boolean
) from public, anon;
grant execute on function public.check_in_field_visit_at_selected_site(
  uuid, double precision, double precision, double precision,
  timestamptz, text, boolean
) to authenticated;

alter table public.attendance_logs
  add column if not exists is_late boolean;

create or replace function public.set_authoritative_attendance_late_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_late_time time;
begin
  if new.checkin_time is null then
    new.is_late := false;
    return new;
  end if;

  select policy.late_checkin_time
  into v_late_time
  from public.profiles profile
  join public.attendance_policies policy
    on policy.office_id = coalesce(new.office_id, profile.office_id)
   and coalesce(policy.is_active, true)
   and lower(coalesce(policy.role, 'all')) in (
     lower(coalesce(profile.role, '')),
     'all'
   )
  where profile.id = new.user_id
  order by
    case when lower(coalesce(policy.role, 'all')) =
      lower(coalesce(profile.role, '')) then 0 else 1 end
  limit 1;

  new.is_late := case
    when v_late_time is null then null
    else (new.checkin_time at time zone 'Asia/Kolkata')::time >= v_late_time
  end;
  return new;
end;
$$;

drop trigger if exists attendance_authoritative_late_status
  on public.attendance_logs;
create trigger attendance_authoritative_late_status
before insert or update of checkin_time, office_id, user_id
on public.attendance_logs
for each row execute function public.set_authoritative_attendance_late_status();

with classified as (
  select distinct on (attendance.id)
    attendance.id,
    (attendance.checkin_time at time zone 'Asia/Kolkata')::time >=
      policy.late_checkin_time as is_late
  from public.attendance_logs attendance
  join public.profiles profile on profile.id = attendance.user_id
  join public.attendance_policies policy
    on policy.office_id = coalesce(attendance.office_id, profile.office_id)
   and coalesce(policy.is_active, true)
   and lower(coalesce(policy.role, 'all')) in (
     lower(coalesce(profile.role, '')),
     'all'
   )
  where attendance.checkin_time is not null
  order by
    attendance.id,
    case when lower(coalesce(policy.role, 'all')) =
      lower(coalesce(profile.role, '')) then 0 else 1 end
)
update public.attendance_logs attendance
set is_late = classified.is_late
from classified
where attendance.id = classified.id
  and attendance.is_late is distinct from classified.is_late;

create table if not exists public.tracking_warning_policy (
  singleton boolean primary key default true check (singleton),
  stale_after_minutes integer not null
    check (stale_after_minutes between 1 and 120),
  warn_when_ping_missing boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.tracking_warning_policy(
  singleton, stale_after_minutes, warn_when_ping_missing
)
values (true, 15, true)
on conflict (singleton) do nothing;

alter table public.tracking_warning_policy enable row level security;
revoke all on table public.tracking_warning_policy
  from public, anon, authenticated;
grant all on table public.tracking_warning_policy to service_role;

create or replace function public.rpc_recalculate_attendance_warnings()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_policy public.tracking_warning_policy%rowtype;
  v_row record;
  v_warning boolean;
  v_radius double precision;
  v_distance double precision;
  v_evaluated integer := 0;
  v_updated integer := 0;
begin
  if v_actor is null or not public.is_hrms_admin(v_actor) then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;

  select * into v_policy
  from public.tracking_warning_policy
  where singleton = true;
  if not found then raise exception 'TRACKING_WARNING_POLICY_NOT_CONFIGURED'; end if;

  for v_row in
    select
      attendance.id,
      attendance.warning,
      office.latitude as office_latitude,
      office.longitude as office_longitude,
      coalesce(
        office.allowed_radius_meters,
        office.attendance_radius
      )::double precision as configured_radius,
      ping.latitude as ping_latitude,
      ping.longitude as ping_longitude,
      ping.accuracy as ping_accuracy,
      ping.gps_available,
      ping.recorded_at
    from public.attendance_logs attendance
    left join public.offices office on office.id = attendance.office_id
    left join lateral (
      select tracking.latitude, tracking.longitude, tracking.accuracy,
             tracking.gps_available, tracking.recorded_at
      from public.location_tracking tracking
      where tracking.user_id = attendance.user_id
        and tracking.date = v_today
      order by tracking.recorded_at desc
      limit 1
    ) ping on true
    where attendance.date = v_today
      and attendance.status = 'CHECKED_IN'
      and attendance.checkin_time is not null
  loop
    v_evaluated := v_evaluated + 1;
    v_warning := false;
    v_radius := v_row.configured_radius;

    if v_row.recorded_at is null then
      v_warning := v_policy.warn_when_ping_missing;
    elsif coalesce(v_row.gps_available, false) = false then
      v_warning := true;
    elsif v_row.recorded_at <
      now() - make_interval(mins => v_policy.stale_after_minutes) then
      v_warning := true;
    elsif v_radius is null or v_radius < 10 or v_radius > 1000
       or v_row.office_latitude is null or v_row.office_longitude is null
       or v_row.ping_latitude is null or v_row.ping_longitude is null then
      v_warning := true;
    else
      v_distance := public.tracking_distance_metres(
        v_row.office_latitude,
        v_row.office_longitude,
        v_row.ping_latitude,
        v_row.ping_longitude
      );
      v_warning :=
        v_distance + greatest(coalesce(v_row.ping_accuracy, 0), 0) > v_radius;
    end if;

    if v_warning is distinct from coalesce(v_row.warning, false) then
      update public.attendance_logs
      set warning = v_warning, updated_at = now()
      where id = v_row.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'business_date', v_today,
    'evaluated_count', v_evaluated,
    'updated_count', v_updated,
    'stale_after_minutes', v_policy.stale_after_minutes
  );
end;
$$;

revoke all on function public.rpc_recalculate_attendance_warnings()
  from public, anon;
grant execute on function public.rpc_recalculate_attendance_warnings()
  to authenticated;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260730240000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260731.1',
      'otp-auth', '20260731.1',
      'field-visit-evidence-upload', '20260731.1',
      'smartoffice-proxy', '20260731.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
