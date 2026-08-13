-- Live tracking, managed sites, calendar precedence and TV occupancy repair.

create index if not exists location_alerts_active_feed_idx
  on public.location_alerts(escalation_level desc, created_at desc, id)
  where resolved = false;

create index if not exists predefined_sites_project_label_ci_idx
  on public.predefined_sites(lower(btrim(project_name)), lower(btrim(site_label)));

create or replace function public.effective_canonical_attendance_status(
  p_stored_status text,
  p_official_first_in timestamptz,
  p_official_last_out timestamptz,
  p_has_field_visit boolean,
  p_is_late boolean
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    -- Actual attendance evidence is authoritative even on a leave, holiday or
    -- weekly-off day. This restores the established HRMS precedence.
    when p_official_first_in is not null and p_official_last_out is not null
      then 'CHECKED_OUT'
    when p_official_first_in is not null and coalesce(p_has_field_visit, false)
      then 'FIELD_VISIT'
    when p_official_first_in is not null and coalesce(p_is_late, false)
      then 'LATE'
    when p_official_first_in is not null then 'PRESENT'
    else coalesce(p_stored_status, 'NO_DATA')
  end
$$;

create or replace function public.rpc_admin_attendance_daily_v3(
  p_start date,
  p_end date,
  p_offset integer default 0,
  p_limit integer default 500
)
returns setof public.v_attendance_daily_canonical
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_profile_admin();
  if p_start is null or p_end is null or p_end < p_start
     or p_end - p_start > 366 or p_limit not between 1 and 1000
     or p_offset < 0
     or p_end > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'INVALID_ATTENDANCE_REPORT_RANGE';
  end if;

  return query
  select normalized.*
  from public.v_attendance_daily_canonical row_data
  cross join lateral jsonb_populate_record(
    null::public.v_attendance_daily_canonical,
    to_jsonb(row_data) || jsonb_build_object(
      'attendance_status',
      public.effective_canonical_attendance_status(
        row_data.attendance_status,
        row_data.official_first_in,
        row_data.official_last_out,
        row_data.has_field_visit,
        row_data.is_late
      )
    )
  ) normalized
  where row_data.work_date between p_start and p_end
  order by row_data.work_date desc,
    row_data.employee_number nulls last,
    row_data.user_id
  offset p_offset limit p_limit;
end
$$;

create or replace function public.rpc_my_attendance_daily_v3(
  p_start date,
  p_end date
)
returns setof public.v_attendance_daily_canonical
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select normalized.*
  from public.v_attendance_daily_canonical row_data
  cross join lateral jsonb_populate_record(
    null::public.v_attendance_daily_canonical,
    to_jsonb(row_data) || jsonb_build_object(
      'attendance_status',
      public.effective_canonical_attendance_status(
        row_data.attendance_status,
        row_data.official_first_in,
        row_data.official_last_out,
        row_data.has_field_visit,
        row_data.is_late
      )
    )
  ) normalized
  where row_data.user_id = auth.uid()
    and row_data.work_date between p_start and p_end
  order by row_data.work_date desc
  limit 367
$$;

create or replace function public.rpc_admin_mutate_configuration(
  p_entity text,
  p_action text,
  p_id uuid default null,
  p_values jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity text := upper(btrim(coalesce(p_entity, '')));
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_id uuid := p_id;
  v_radius integer;
  v_office_id uuid := nullif(p_values->>'office_id', '')::uuid;
  v_team_id uuid := nullif(p_values->>'team_id', '')::uuid;
  v_user_id uuid := nullif(p_values->>'user_id', '')::uuid;
  v_week_of_month integer := nullif(p_values->>'week_of_month', '')::integer;
begin
  perform public.require_profile_admin();

  if v_entity = 'ATTENDANCE_POLICY' and v_action = 'UPDATE' then
    if p_id is null then raise exception 'POLICY_ID_REQUIRED'; end if;
    if (p_values->>'min_work_duration_minutes')::integer not between 0 and 1440
      or (p_values->>'undo_checkout_minutes')::integer not between 0 and 60
      or p_values->>'earliest_checkout_time' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
      or p_values->>'auto_close_time' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    then raise exception 'INVALID_ATTENDANCE_POLICY'; end if;
    update public.attendance_policies set
      min_work_duration_minutes = (p_values->>'min_work_duration_minutes')::integer,
      earliest_checkout_time = p_values->>'earliest_checkout_time',
      auto_close_time = p_values->>'auto_close_time',
      allow_night_shift = (p_values->>'allow_night_shift')::boolean,
      require_early_checkout_reason = (p_values->>'require_early_checkout_reason')::boolean,
      undo_checkout_minutes = (p_values->>'undo_checkout_minutes')::integer,
      allow_field_visit_checkout = coalesce(
        (p_values->>'allow_field_visit_checkout')::boolean,
        allow_field_visit_checkout
      ),
      updated_at = now()
    where id = p_id;

  elsif v_entity = 'OFFICE' and v_action = 'CREATE' then
    v_radius := coalesce((p_values->>'attendance_radius')::integer, 100);
    if nullif(btrim(p_values->>'name'), '') is null
      or nullif(btrim(p_values->>'address'), '') is null
      or nullif(p_values->>'latitude', '')::double precision not between -90 and 90
      or nullif(p_values->>'longitude', '')::double precision not between -180 and 180
      or v_radius not between 10 and 1000
    then raise exception 'INVALID_OFFICE'; end if;
    insert into public.offices(
      name, address, latitude, longitude, attendance_radius, is_active
    ) values (
      btrim(p_values->>'name'), btrim(p_values->>'address'),
      (p_values->>'latitude')::double precision,
      (p_values->>'longitude')::double precision,
      v_radius, true
    ) returning id into v_id;

  elsif v_entity = 'OFFICE' and v_action = 'SET_ACTIVE' then
    if (p_values->>'is_active')::boolean and not exists(
      select 1 from public.attendance_policies policy
      where policy.office_id = p_id and policy.is_active
    ) then raise exception 'ACTIVE_OFFICE_REQUIRES_ATTENDANCE_POLICY'; end if;
    update public.offices
      set is_active = (p_values->>'is_active')::boolean where id = p_id;

  elsif v_entity = 'OFFICE' and v_action = 'SET_RADIUS' then
    v_radius := (p_values->>'attendance_radius')::integer;
    if v_radius not between 10 and 1000 then raise exception 'INVALID_RADIUS'; end if;
    update public.offices set attendance_radius = v_radius where id = p_id;

  elsif v_entity = 'SITE' and v_action = 'CREATE' then
    v_radius := coalesce((p_values->>'checkin_radius_m')::integer, 100);
    if nullif(btrim(p_values->>'project_name'), '') is null
      or nullif(btrim(p_values->>'site_label'), '') is null
      or nullif(p_values->>'latitude', '')::double precision not between -90 and 90
      or nullif(p_values->>'longitude', '')::double precision not between -180 and 180
      or v_radius not between 10 and 5000
      or lower(coalesce(p_values->>'site_type', 'site')) not in ('site', 'office', 'meeting')
    then raise exception 'INVALID_SITE'; end if;
    insert into public.predefined_sites(
      project_name, site_label, address, latitude, longitude,
      checkin_radius_m, site_type, is_active
    ) values (
      btrim(p_values->>'project_name'), btrim(p_values->>'site_label'),
      nullif(btrim(p_values->>'address'), ''),
      (p_values->>'latitude')::double precision,
      (p_values->>'longitude')::double precision,
      v_radius, lower(coalesce(p_values->>'site_type', 'site')), true
    ) returning id into v_id;

  elsif v_entity = 'SITE' and v_action = 'SET_ACTIVE' then
    update public.predefined_sites
      set is_active = (p_values->>'is_active')::boolean where id = p_id;

  elsif v_entity = 'SITE' and v_action = 'SET_RADIUS' then
    v_radius := (p_values->>'checkin_radius_m')::integer;
    if v_radius not between 10 and 5000 then raise exception 'INVALID_SITE_RADIUS'; end if;
    update public.predefined_sites set checkin_radius_m = v_radius where id = p_id;

  elsif v_entity = 'HOLIDAY' and v_action = 'CREATE' then
    if num_nonnulls(v_office_id, v_team_id, v_user_id) > 1
      then raise exception 'CONFLICTING_CALENDAR_SCOPE'; end if;
    if nullif(btrim(p_values->>'name'), '') is null
      then raise exception 'HOLIDAY_NAME_REQUIRED'; end if;
    insert into public.holiday_calendar(
      holiday_date, name, office_id, team_id, user_id,
      is_optional, is_active, created_by
    ) values (
      (p_values->>'holiday_date')::date, btrim(p_values->>'name'),
      v_office_id, v_team_id, v_user_id,
      coalesce((p_values->>'is_optional')::boolean, false), true, auth.uid()
    ) returning id into v_id;

  elsif v_entity = 'HOLIDAY' and v_action = 'DELETE' then
    delete from public.holiday_calendar where id = p_id;

  elsif v_entity = 'WEEKLY_OFF' and v_action = 'CREATE' then
    if num_nonnulls(v_office_id, v_team_id, v_user_id) > 1
      then raise exception 'CONFLICTING_CALENDAR_SCOPE'; end if;
    if (p_values->>'weekday')::integer not between 0 and 6
      or (v_week_of_month is not null and v_week_of_month not between 1 and 5)
      or (
        nullif(p_values->>'valid_to', '')::date is not null
        and nullif(p_values->>'valid_to', '')::date
          < coalesce(nullif(p_values->>'valid_from', '')::date,
              (now() at time zone 'Asia/Kolkata')::date)
      )
    then raise exception 'INVALID_WEEKLY_OFF_RULE'; end if;

    -- Re-activate an identical historical rule instead of colliding with its
    -- unique key after the administrator previously deactivated it.
    update public.weekly_off_rules set
      is_active = true,
      valid_from = coalesce(
        nullif(p_values->>'valid_from', '')::date,
        (now() at time zone 'Asia/Kolkata')::date
      ),
      valid_to = nullif(p_values->>'valid_to', '')::date,
      created_by = auth.uid()
    where office_id is not distinct from v_office_id
      and team_id is not distinct from v_team_id
      and user_id is not distinct from v_user_id
      and weekday = (p_values->>'weekday')::integer
      and week_of_month is not distinct from v_week_of_month
    returning id into v_id;

    if not found then
      insert into public.weekly_off_rules(
        office_id, team_id, user_id, weekday, week_of_month,
        valid_from, valid_to, is_active, created_by
      ) values (
        v_office_id, v_team_id, v_user_id,
        (p_values->>'weekday')::integer, v_week_of_month,
        coalesce(
          nullif(p_values->>'valid_from', '')::date,
          (now() at time zone 'Asia/Kolkata')::date
        ),
        nullif(p_values->>'valid_to', '')::date,
        true, auth.uid()
      ) returning id into v_id;
    end if;

  elsif v_entity = 'WEEKLY_OFF' and v_action = 'DEACTIVATE' then
    update public.weekly_off_rules set is_active = false where id = p_id;

  else
    raise exception 'UNSUPPORTED_CONFIGURATION_ACTION';
  end if;

  if v_id is null or not found then
    raise exception 'CONFIGURATION_ROW_NOT_FOUND';
  end if;

  insert into public.hrms_audit_events(
    actor_user_id, target_user_id, action, entity_type,
    entity_id, new_values, source
  ) values (
    auth.uid(), null, 'CONFIGURATION_' || v_action, lower(v_entity),
    v_id, jsonb_build_object('values', p_values), 'HRMS_ADMIN'
  );

  return jsonb_build_object('success', true, 'id', v_id);
end
$$;

revoke all on function public.effective_canonical_attendance_status(
  text, timestamptz, timestamptz, boolean, boolean
) from public, anon;
revoke all on function public.rpc_admin_attendance_daily_v3(
  date, date, integer, integer
) from public, anon;
revoke all on function public.rpc_my_attendance_daily_v3(date, date)
  from public, anon;
revoke all on function public.rpc_admin_mutate_configuration(
  text, text, uuid, jsonb
) from public, anon;
grant execute on function public.rpc_admin_attendance_daily_v3(
  date, date, integer, integer
) to authenticated;
grant execute on function public.rpc_my_attendance_daily_v3(date, date)
  to authenticated;
grant execute on function public.rpc_admin_mutate_configuration(
  text, text, uuid, jsonb
) to authenticated;
grant select on public.predefined_sites to authenticated;

notify pgrst, 'reload schema';
