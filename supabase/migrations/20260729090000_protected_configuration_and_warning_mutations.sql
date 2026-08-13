-- Fixed, allow-listed administration endpoints for configuration and warning
-- data. Browser roles lose direct mutation privileges after the RPCs exist.

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
begin
  perform public.require_profile_admin();

  if v_entity = 'ATTENDANCE_POLICY' and v_action = 'UPDATE' then
    if p_id is null then raise exception 'POLICY_ID_REQUIRED'; end if;
    if (p_values->>'min_work_duration_minutes')::integer not between 0 and 1440
       or (p_values->>'undo_checkout_minutes')::integer not between 0 and 60
       or p_values->>'earliest_checkout_time' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
       or p_values->>'auto_close_time' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'INVALID_ATTENDANCE_POLICY';
    end if;
    update public.attendance_policies
    set min_work_duration_minutes = (p_values->>'min_work_duration_minutes')::integer,
        earliest_checkout_time = p_values->>'earliest_checkout_time',
        auto_close_time = p_values->>'auto_close_time',
        allow_night_shift = (p_values->>'allow_night_shift')::boolean,
        require_early_checkout_reason =
          (p_values->>'require_early_checkout_reason')::boolean,
        undo_checkout_minutes = (p_values->>'undo_checkout_minutes')::integer,
        updated_at = now()
    where id = p_id;
  elsif v_entity = 'OFFICE' and v_action = 'CREATE' then
    v_radius := coalesce((p_values->>'attendance_radius')::integer, 100);
    if nullif(btrim(p_values->>'name'), '') is null
       or nullif(btrim(p_values->>'address'), '') is null
       or v_radius not between 10 and 1000 then
      raise exception 'INVALID_OFFICE';
    end if;
    insert into public.offices(
      name, address, latitude, longitude, attendance_radius, is_active
    ) values (
      btrim(p_values->>'name'),
      btrim(p_values->>'address'),
      nullif(p_values->>'latitude', '')::double precision,
      nullif(p_values->>'longitude', '')::double precision,
      v_radius,
      true
    ) returning id into v_id;
  elsif v_entity = 'OFFICE' and v_action = 'SET_ACTIVE' then
    update public.offices set is_active = (p_values->>'is_active')::boolean
    where id = p_id;
  elsif v_entity = 'OFFICE' and v_action = 'SET_RADIUS' then
    v_radius := (p_values->>'attendance_radius')::integer;
    if v_radius not between 10 and 1000 then raise exception 'INVALID_RADIUS'; end if;
    update public.offices set attendance_radius = v_radius where id = p_id;
  elsif v_entity = 'HOLIDAY' and v_action = 'CREATE' then
    insert into public.holiday_calendar(
      holiday_date, name, office_id, is_optional, created_by
    ) values (
      (p_values->>'holiday_date')::date,
      btrim(p_values->>'name'),
      nullif(p_values->>'office_id', '')::uuid,
      coalesce((p_values->>'is_optional')::boolean, false),
      auth.uid()
    ) returning id into v_id;
  elsif v_entity = 'HOLIDAY' and v_action = 'DELETE' then
    delete from public.holiday_calendar where id = p_id;
  elsif v_entity = 'WEEKLY_OFF' and v_action = 'CREATE' then
    insert into public.weekly_off_rules(
      office_id, weekday, week_of_month, is_active
    ) values (
      (p_values->>'office_id')::uuid,
      (p_values->>'weekday')::integer,
      nullif(p_values->>'week_of_month', '')::integer,
      true
    ) returning id into v_id;
  elsif v_entity = 'WEEKLY_OFF' and v_action = 'DEACTIVATE' then
    update public.weekly_off_rules set is_active = false where id = p_id;
  else
    raise exception 'UNSUPPORTED_CONFIGURATION_ACTION';
  end if;

  if v_id is null or not found then raise exception 'CONFIGURATION_ROW_NOT_FOUND'; end if;
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.rpc_admin_save_transit_warning(
  p_warning_id uuid default null,
  p_values jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid := p_warning_id;
begin
  perform public.require_profile_admin();
  if p_warning_id is not null then
    update public.transit_warnings
    set status = case when p_values->>'status' = 'dismissed' then 'dismissed' else status end,
        dismissed_by = case when p_values->>'status' = 'dismissed' then auth.uid() else dismissed_by end,
        dismissed_at = case when p_values->>'status' = 'dismissed' then now() else dismissed_at end,
        dismiss_note = case when p_values->>'status' = 'dismissed'
          then left(coalesce(p_values->>'dismiss_note', 'Verified by HR'), 500)
          else dismiss_note end
    where id = p_warning_id;
    if not found then raise exception 'WARNING_NOT_FOUND'; end if;
  else
    if p_values->>'warning_type' not in
      ('transit_overdue', 'transit_from_checkin', 'suspicious_activity') then
      raise exception 'INVALID_WARNING_TYPE';
    end if;
    insert into public.transit_warnings(
      user_id, date, warning_type, field_visit_id, location_name,
      destination_address, created_at_time, expected_arrival,
      overdue_by_minutes, origin_coords, distance_km, duration_minutes,
      status, dismissed_by, dismissed_at, dismiss_note
    ) values (
      (p_values->>'user_id')::uuid,
      coalesce((p_values->>'date')::date, (now() at time zone 'Asia/Kolkata')::date),
      p_values->>'warning_type',
      nullif(p_values->>'field_visit_id', '')::uuid,
      nullif(p_values->>'location_name', ''),
      nullif(p_values->>'destination_address', ''),
      nullif(p_values->>'created_at_time', ''),
      nullif(p_values->>'expected_arrival', ''),
      round(nullif(p_values->>'overdue_by_minutes', '')::numeric)::integer,
      p_values->'origin_coords',
      nullif(p_values->>'distance_km', '')::numeric,
      nullif(p_values->>'duration_minutes', '')::integer,
      case when p_values->>'status' = 'dismissed' then 'dismissed' else 'active' end,
      case when p_values->>'status' = 'dismissed' then auth.uid() else null end,
      case when p_values->>'status' = 'dismissed' then now() else null end,
      case when p_values->>'status' = 'dismissed'
        then left(coalesce(p_values->>'dismiss_note', 'Verified by HR'), 500)
        else null end
    ) returning id into v_id;
  end if;
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.rpc_record_checkin_attempt(p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_status text := lower(p_values->>'status');
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if v_status not in ('success', 'blocked', 'failed') then
    raise exception 'INVALID_ATTEMPT_STATUS';
  end if;
  insert into public.checkin_attempts(
    user_id, attempted_at, latitude, longitude, nearest_office_name,
    nearest_office_distance_m, status, failure_reason
  ) values (
    auth.uid(), now(),
    nullif(p_values->>'latitude', '')::double precision,
    nullif(p_values->>'longitude', '')::double precision,
    nullif(p_values->>'nearest_office_name', ''),
    nullif(p_values->>'nearest_office_distance_m', '')::double precision,
    v_status,
    left(nullif(p_values->>'failure_reason', ''), 500)
  ) returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

revoke all on function public.rpc_admin_mutate_configuration(text, text, uuid, jsonb)
  from public, anon;
grant execute on function public.rpc_admin_mutate_configuration(text, text, uuid, jsonb)
  to authenticated;
revoke all on function public.rpc_admin_save_transit_warning(uuid, jsonb)
  from public, anon;
grant execute on function public.rpc_admin_save_transit_warning(uuid, jsonb)
  to authenticated;
revoke all on function public.rpc_record_checkin_attempt(jsonb)
  from public, anon;
grant execute on function public.rpc_record_checkin_attempt(jsonb)
  to authenticated;

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.transit_warnings'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) ilike '%warning_type%'
  loop
    execute format('alter table public.transit_warnings drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.transit_warnings add constraint transit_warnings_type_ck
  check (warning_type in (
    'transit_overdue', 'transit_from_checkin', 'suspicious_activity'
  ));

revoke insert, update, delete on table public.attendance_logs,
  public.attendance_policies, public.offices, public.holiday_calendar,
  public.weekly_off_rules, public.transit_warnings, public.checkin_attempts
  from anon, authenticated;

notify pgrst, 'reload schema';
