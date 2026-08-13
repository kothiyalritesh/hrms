-- The protected v2 check-in RPC calculates distance as double precision while
-- the legacy mutation function accepts numeric. PostgreSQL does not resolve
-- that call implicitly, so provide the exact private overload used by v2 and
-- keep the authoritative mutation idempotent and transaction-bound.

create or replace function public.rpc_attendance_checkin(
  p_user_id uuid,
  p_office_id uuid,
  p_checkin_location jsonb,
  p_distance double precision,
  p_source text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now timestamptz := clock_timestamp();
  v_attendance public.attendance_logs%rowtype;
  v_office public.offices%rowtype;
  v_lat double precision;
  v_lon double precision;
  v_source text := upper(coalesce(nullif(btrim(p_source), ''), 'APP'));
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED',
      'message', 'A valid session is required.');
  end if;
  if p_user_id is distinct from v_uid then
    return jsonb_build_object('success', false, 'error', 'USER_ID_MISMATCH',
      'message', 'You cannot create attendance for another employee.');
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = v_uid and profile.is_active
      and profile.office_id = p_office_id
  ) then
    return jsonb_build_object('success', false, 'error', 'OFFICE_NOT_ASSIGNED',
      'message', 'Attendance can only be marked for your assigned office.');
  end if;

  select * into v_office from public.offices
  where id = p_office_id and coalesce(is_active, true);
  if not found then
    return jsonb_build_object('success', false, 'error', 'OFFICE_LOCATION_UNAVAILABLE',
      'message', 'Your assigned office is inactive or unavailable.');
  end if;

  begin
    v_lat := (p_checkin_location->>'latitude')::double precision;
    v_lon := (p_checkin_location->>'longitude')::double precision;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'INVALID_GPS',
      'message', 'A valid precise GPS reading is required.');
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || v_today::text, 0)
  );
  select * into v_attendance from public.attendance_logs
  where user_id = v_uid and date = v_today
  order by created_at desc limit 1 for update;

  if found and v_attendance.checkin_time is not null then
    return jsonb_build_object(
      'success', true, 'existing', true, 'id', v_attendance.id,
      'attendance_id', v_attendance.id,
      'checkin_time', v_attendance.checkin_time,
      'status', v_attendance.status,
      'attendance_state', v_attendance.attendance_state,
      'server_now', v_now,
      'message', 'Already checked in today.'
    );
  end if;

  if found then
    update public.attendance_logs set
      attendance_type = coalesce(attendance_type, 'OFFICE'),
      office_id = p_office_id,
      checkin_location = p_checkin_location,
      distance_from_office = round(p_distance)::integer,
      checkin_latitude = v_lat,
      checkin_longitude = v_lon,
      checkin_location_id = p_office_id,
      checkin_location_name = v_office.name,
      checkin_distance_meters = round(p_distance)::integer,
      checkin_source = v_source,
      status = 'CHECKED_IN',
      attendance_state = 'WORKING',
      attendance_status = coalesce(attendance_status, 'PRESENT'),
      day_status = coalesce(day_status, 'P'),
      checkin_time = v_now,
      updated_at = v_now
    where id = v_attendance.id
    returning * into v_attendance;
  else
    insert into public.attendance_logs(
      user_id, date, attendance_type, office_id, checkin_location,
      distance_from_office, checkin_latitude, checkin_longitude,
      checkin_location_id, checkin_location_name, checkin_distance_meters,
      checkin_source, status, attendance_state, attendance_status, day_status,
      checkin_time
    ) values (
      v_uid, v_today, 'OFFICE', p_office_id, p_checkin_location,
      round(p_distance)::integer, v_lat, v_lon,
      p_office_id, v_office.name, round(p_distance)::integer,
      v_source, 'CHECKED_IN', 'WORKING', 'PRESENT', 'P', v_now
    ) returning * into v_attendance;
  end if;

  begin
    insert into public.attendance_audit_logs(
      attendance_id, user_id, action, old_status, new_status, reason, source
    ) values (
      v_attendance.id, v_uid, 'CHECK_IN', null, 'CHECKED_IN',
      'Checked in at ' || coalesce(v_office.name, 'office'), v_source
    );
    insert into public.hrms_audit_events(
      actor_user_id, target_user_id, action, entity_type, entity_id,
      new_values, source
    ) values (
      v_uid, v_uid, 'MANUAL_APP_CHECKIN', 'attendance', v_attendance.id,
      jsonb_build_object('checkin_time', v_now, 'office_id', p_office_id,
        'distance_metres', p_distance), v_source
    );
  exception when others then
    null;
  end;

  begin
    insert into public.notifications(user_id, title, message, type, event_key)
    values(v_uid, 'Attendance check-in successful',
      'Your attendance was recorded at ' || v_office.name,
      'attendance_checkin', 'attendance-checkin:' || v_attendance.id)
    on conflict(event_key) where event_key is not null do nothing;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'success', true, 'existing', false, 'id', v_attendance.id,
    'attendance_id', v_attendance.id, 'checkin_time', v_attendance.checkin_time,
    'status', v_attendance.status, 'attendance_state', v_attendance.attendance_state,
    'server_now', v_now, 'message', 'Check-in successful.'
  );
exception
  when unique_violation then
    select * into v_attendance from public.attendance_logs
    where user_id = v_uid and date = v_today limit 1;
    return jsonb_build_object(
      'success', true, 'existing', true, 'id', v_attendance.id,
      'attendance_id', v_attendance.id, 'checkin_time', v_attendance.checkin_time,
      'status', v_attendance.status, 'attendance_state', v_attendance.attendance_state,
      'server_now', clock_timestamp(), 'message', 'Already checked in today.'
    );
  when others then
    return jsonb_build_object('success', false, 'error', sqlstate,
      'message', 'Check-in failed: ' || sqlerrm);
end $$;

revoke all on function public.rpc_attendance_checkin(uuid,uuid,jsonb,double precision,text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
