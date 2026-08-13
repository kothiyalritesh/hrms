-- All employee field-visit state transitions go through this ownership-checked
-- RPC. Direct browser INSERT/UPDATE/DELETE privileges are removed below.

create or replace function public.rpc_mutate_own_field_visit(
  p_action text,
  p_visit_id uuid default null,
  p_values jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_row public.field_visits%rowtype;
  v_lat double precision := nullif(p_values->>'latitude', '')::double precision;
  v_lon double precision := nullif(p_values->>'longitude', '')::double precision;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if v_action not in ('CREATE', 'CHECK_IN', 'CHECK_OUT', 'MARK_MISSED') then
    raise exception 'INVALID_FIELD_VISIT_ACTION';
  end if;

  if v_action = 'CREATE' then
    if nullif(btrim(p_values->>'location_name'), '') is null then
      raise exception 'LOCATION_NAME_REQUIRED';
    end if;
    if coalesce(p_values->>'visit_type', '') not in
      ('site', 'meeting', 'office', 'others') then
      raise exception 'INVALID_VISIT_TYPE';
    end if;

    insert into public.field_visits(
      user_id, visit_type, location_name, status, date, activity_log_id,
      predefined_site_id, location_address, destination_coords,
      checkin_radius_m, meeting_type, contact_name, contact_phone,
      company_name, project_name, notes, origin_lat, origin_lon, origin_name
    ) values (
      v_user_id,
      p_values->>'visit_type',
      btrim(p_values->>'location_name'),
      'PENDING',
      v_today,
      nullif(p_values->>'activity_log_id', '')::uuid,
      nullif(p_values->>'predefined_site_id', '')::uuid,
      nullif(btrim(p_values->>'location_address'), ''),
      p_values->'destination_coords',
      nullif(p_values->>'checkin_radius_m', '')::integer,
      nullif(p_values->>'meeting_type', ''),
      nullif(btrim(p_values->>'contact_name'), ''),
      nullif(btrim(p_values->>'contact_phone'), ''),
      nullif(btrim(p_values->>'company_name'), ''),
      nullif(btrim(p_values->>'project_name'), ''),
      nullif(btrim(p_values->>'notes'), ''),
      nullif(p_values->>'origin_lat', '')::double precision,
      nullif(p_values->>'origin_lon', '')::double precision,
      nullif(btrim(p_values->>'origin_name'), '')
    )
    returning * into v_row;
  else
    if p_visit_id is null then raise exception 'VISIT_ID_REQUIRED'; end if;
    select * into v_row
    from public.field_visits
    where id = p_visit_id and user_id = v_user_id
    for update;
    if not found then raise exception 'FIELD_VISIT_NOT_FOUND'; end if;

    if v_action in ('CHECK_IN', 'CHECK_OUT') and (
      v_lat is null or v_lon is null or
      v_lat < -90 or v_lat > 90 or v_lon < -180 or v_lon > 180 or
      (v_lat = 0 and v_lon = 0)
    ) then
      raise exception 'VALID_LOCATION_REQUIRED';
    end if;

    if v_action = 'CHECK_IN' then
      if v_row.date <> v_today or v_row.status not in ('PENDING', 'IN_TRANSIT')
         or v_row.predefined_site_id is not null then
        raise exception 'FIELD_VISIT_CHECKIN_NOT_ALLOWED';
      end if;
      update public.field_visits
      set checkin_time = now(),
          checkin_location = jsonb_build_object('latitude', v_lat, 'longitude', v_lon),
          status = 'CHECKED_IN',
          journey_status = 'SITE_CHECKED_IN'
      where id = p_visit_id
      returning * into v_row;
    elsif v_action = 'CHECK_OUT' then
      if v_row.status <> 'CHECKED_IN' or v_row.checkout_time is not null then
        raise exception 'FIELD_VISIT_CHECKOUT_NOT_ALLOWED';
      end if;
      update public.field_visits
      set checkout_time = now(),
          checkout_location = jsonb_build_object('latitude', v_lat, 'longitude', v_lon),
          checkout_notes = nullif(btrim(p_values->>'notes'), ''),
          checkout_office_id = nullif(p_values->>'nearest_office_id', '')::uuid,
          status = 'COMPLETED',
          journey_status = 'COMPLETED'
      where id = p_visit_id
      returning * into v_row;
    else
      if v_row.status not in ('PENDING', 'IN_TRANSIT') then
        raise exception 'FIELD_VISIT_MISSED_NOT_ALLOWED';
      end if;
      update public.field_visits
      set status = 'MISSED', journey_status = 'CANCELLED'
      where id = p_visit_id
      returning * into v_row;
    end if;
  end if;

  return jsonb_build_object('success', true, 'visit', to_jsonb(v_row));
end;
$$;

revoke all on function public.rpc_mutate_own_field_visit(text, uuid, jsonb)
  from public, anon;
grant execute on function public.rpc_mutate_own_field_visit(text, uuid, jsonb)
  to authenticated;

revoke insert, update, delete on table public.field_visits
  from anon, authenticated;

notify pgrst, 'reload schema';
