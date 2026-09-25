-- Allows employees to check in from any active office by removing the assigned office constraint

create or replace function public.rpc_attendance_checkin_v2(
  p_office_id uuid,
  p_location jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_office public.offices%rowtype;
  v_lat double precision;
  v_lon double precision;
  v_accuracy double precision;
  v_radius double precision;
  v_distance double precision;
  v_captured_at timestamptz;
  v_result jsonb;
  v_checkin_time timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object(
      'success', false, 'error', 'AUTHENTICATION_REQUIRED',
      'message', 'A valid session is required.'
    );
  end if;

  if not exists (select 1 from public.profiles where id = v_uid and is_active = true) then
    return jsonb_build_object(
      'success', false, 'error', 'USER_INACTIVE',
      'message', 'Your account is inactive.'
    );
  end if;

  select * into v_office
  from public.offices
  where id = p_office_id and coalesce(is_active, true);
  if not found or v_office.latitude is null or v_office.longitude is null then
    return jsonb_build_object(
      'success', false, 'error', 'OFFICE_LOCATION_UNAVAILABLE',
      'message', 'The requested office location is unavailable or inactive.'
    );
  end if;

  v_radius := coalesce(
    v_office.allowed_radius_meters,
    v_office.attendance_radius
  );
  if v_radius is null or v_radius < 10 or v_radius > 1000 then
    return jsonb_build_object(
      'success', false, 'error', 'OFFICE_RADIUS_NOT_CONFIGURED',
      'message', 'Attendance radius is not configured for this office. Contact HR.'
    );
  end if;

  begin
    v_lat := (p_location->>'latitude')::double precision;
    v_lon := (p_location->>'longitude')::double precision;
    v_accuracy := greatest(0, (p_location->>'accuracy')::double precision);
    v_captured_at := coalesce(
      (p_location->>'capturedAt')::timestamptz,
      (p_location->>'captured_at')::timestamptz,
      now()
    );
  exception when others then
    return jsonb_build_object(
      'success', false, 'error', 'INVALID_GPS',
      'message', 'A valid precise GPS reading is required.'
    );
  end;

  if v_lat = 0 or v_lon = 0 or
     v_lat not between -90 and 90 or v_lon not between -180 and 180 or
     v_accuracy > 100 or
     lower(coalesce(p_location->>'mocked', 'false')) = 'true' or
     v_captured_at < now() - interval '60 seconds' or
     v_captured_at > now() + interval '10 seconds' then
    return jsonb_build_object(
      'success', false, 'error', 'GPS_NOT_TRUSTED',
      'message', 'The GPS reading is inaccurate, stale, invalid, or mocked.'
    );
  end if;

  v_distance := public.field_visit_distance_metres(
    v_office.latitude, v_office.longitude, v_lat, v_lon
  );
  if v_distance + v_accuracy > v_radius then
    return jsonb_build_object(
      'success', false, 'error', 'OUTSIDE_OFFICE_RADIUS',
      'message', format(
        'Your verified distance (%s m including GPS uncertainty) exceeds the %s m office radius.',
        ceil(v_distance + v_accuracy), ceil(v_radius)
      ),
      'distance_metres', v_distance,
      'accuracy_metres', v_accuracy,
      'allowed_radius_metres', v_radius
    );
  end if;

  v_result := public.rpc_attendance_checkin(
    v_uid, p_office_id, p_location, v_distance, 'APP'
  );
  if coalesce((v_result->>'success')::boolean, false) then
    select checkin_time
    into v_checkin_time
    from public.attendance_logs
    where user_id = v_uid
      and date = (now() at time zone 'Asia/Kolkata')::date
      and checkin_time is not null
    order by checkin_time
    limit 1;
    v_result := v_result || jsonb_build_object(
      'checkin_time', v_checkin_time,
      'server_now', now()
    );
  end if;
  return v_result;
end;
$$;

revoke all on function public.rpc_attendance_checkin_v2(uuid, jsonb)
  from public, anon;
grant execute on function public.rpc_attendance_checkin_v2(uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';

