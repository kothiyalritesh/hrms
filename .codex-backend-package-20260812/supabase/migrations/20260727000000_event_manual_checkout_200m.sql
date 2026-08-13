-- Event attendance remains open after check-in and is completed only by an
-- explicit, geofenced event checkout from the employee.

alter table public.events
  alter column checkin_radius_m set default 200;

alter table public.event_checkins
  add column if not exists checkout_time timestamptz,
  add column if not exists checkout_location jsonb,
  add column if not exists checkout_distance_metres integer;

create index if not exists event_checkins_open_user_idx
  on public.event_checkins(user_id, event_id)
  where checkout_time is null;

update public.events
set checkin_radius_m = 200
where event_date = date '2026-07-26'
  and lower(title) in (
    'cp & channel partner event',
    'cp and channel partner event'
  );

create or replace function public.sync_event_checkin_to_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_attendance public.attendance_logs%rowtype;
  v_latitude double precision;
  v_longitude double precision;
begin
  select * into v_event
  from public.events
  where id = new.event_id;
  if not found then return new; end if;

  begin
    v_latitude := (new.checkin_location->>'latitude')::double precision;
    v_longitude := (new.checkin_location->>'longitude')::double precision;
  exception when others then
    v_latitude := null;
    v_longitude := null;
  end;

  select * into v_attendance
  from public.attendance_logs
  where user_id = new.user_id
    and date = v_event.event_date
  for update;

  if found then
    update public.attendance_logs
    set attendance_status = 'PRESENT',
        day_status = 'P',
        is_off_day_work = true,
        notes = trim(concat_ws(
          ' ',
          nullif(notes, ''),
          'Event attendance: ' || v_event.title || '.'
        )),
        updated_at = now()
    where id = v_attendance.id;
    return new;
  end if;

  insert into public.attendance_logs(
    user_id,
    date,
    attendance_type,
    attendance_status,
    day_status,
    is_off_day_work,
    checkin_time,
    checkin_source,
    checkin_status,
    checkin_location,
    checkin_latitude,
    checkin_longitude,
    checkin_location_name,
    checkin_distance_meters,
    status,
    auto_checkout,
    auto_checkout_reason,
    notes
  ) values (
    new.user_id,
    v_event.event_date,
    'EVENT',
    'PRESENT',
    'P',
    true,
    new.checkin_time,
    'EVENT',
    'EVENT',
    new.checkin_location,
    v_latitude,
    v_longitude,
    v_event.address,
    new.distance_metres,
    'CHECKED_IN',
    false,
    null,
    'Event attendance: ' || v_event.title || '.'
  );

  return new;
end $$;

create or replace function public.sync_event_checkout_to_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_attendance public.attendance_logs%rowtype;
  v_latitude double precision;
  v_longitude double precision;
  v_work_hours numeric;
begin
  if new.checkout_time is null
     or new.checkout_time is not distinct from old.checkout_time then
    return new;
  end if;

  select * into v_event
  from public.events
  where id = new.event_id;
  if not found then return new; end if;

  select * into v_attendance
  from public.attendance_logs
  where user_id = new.user_id
    and date = v_event.event_date
  for update;
  if not found or v_attendance.checkout_time is not null then return new; end if;

  begin
    v_latitude := (new.checkout_location->>'latitude')::double precision;
    v_longitude := (new.checkout_location->>'longitude')::double precision;
  exception when others then
    v_latitude := null;
    v_longitude := null;
  end;

  v_work_hours := greatest(
    0,
    round(
      (extract(epoch from (new.checkout_time - v_attendance.checkin_time)) /
        3600)::numeric,
      2
    )
  );

  insert into public.attendance_audit_logs(
    attendance_id,
    user_id,
    action,
    old_status,
    new_status,
    old_checkout_at,
    new_checkout_at,
    reason,
    source
  ) values (
    v_attendance.id,
    new.user_id,
    'CHECKOUT_MANUAL',
    v_attendance.status,
    'CHECKED_OUT',
    null,
    new.checkout_time,
    'Employee checked out while leaving event: ' || v_event.title,
    'APP'
  );

  update public.attendance_logs
  set checkout_time = new.checkout_time,
      checkout_source = 'EVENT',
      checkout_location = new.checkout_location,
      checkout_latitude = v_latitude,
      checkout_longitude = v_longitude,
      checkout_location_name = v_event.address,
      checkout_distance_meters = new.checkout_distance_metres,
      status = 'CHECKED_OUT',
      auto_checkout = false,
      auto_checkout_reason = null,
      work_hours = v_work_hours,
      updated_at = now()
  where id = v_attendance.id;

  update public.tracking_sessions
  set status = 'STOPPED',
      stopped_at = new.checkout_time,
      stop_reason = 'EVENT_CHECKOUT',
      native_task_active = false,
      updated_at = now()
  where attendance_log_id = v_attendance.id
    and status = 'ACTIVE';

  return new;
end $$;

drop trigger if exists sync_event_checkout_to_attendance_trg
  on public.event_checkins;
create trigger sync_event_checkout_to_attendance_trg
after update of checkout_time on public.event_checkins
for each row execute function public.sync_event_checkout_to_attendance();

create or replace function public.rpc_event_check_out(
  p_event_id uuid,
  p_user_id uuid,
  p_latitude double precision,
  p_longitude double precision
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_checkin public.event_checkins%rowtype;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_distance integer;
  v_checkout_time timestamptz := now();
begin
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180
     or (p_latitude = 0 and p_longitude = 0) then
    return jsonb_build_object(
      'success', false,
      'message', 'A valid GPS location is required for event check-out.'
    );
  end if;

  select * into v_event
  from public.events
  where id = p_event_id;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Event not found.');
  end if;

  if v_event.event_date <> v_today then
    return jsonb_build_object(
      'success', false,
      'message', 'Event check-out is available only on the event date.'
    );
  end if;

  select * into v_checkin
  from public.event_checkins
  where event_id = p_event_id
    and user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'Check in to the event before checking out.'
    );
  end if;

  if v_checkin.checkout_time is not null then
    return jsonb_build_object(
      'success', true,
      'already_checked_out', true,
      'checkout_time', v_checkin.checkout_time,
      'distance_metres', v_checkin.checkout_distance_metres,
      'message', 'You are already checked out from this event.'
    );
  end if;

  v_distance := round(public.event_distance_metres(
    v_event.latitude,
    v_event.longitude,
    p_latitude,
    p_longitude
  ));

  if v_distance > v_event.checkin_radius_m then
    return jsonb_build_object(
      'success', false,
      'distance_metres', v_distance,
      'message', 'You are ' || v_distance || 'm from the event. Check out before leaving the ' ||
        v_event.checkin_radius_m || 'm event area.'
    );
  end if;

  update public.event_checkins
  set checkout_time = v_checkout_time,
      checkout_location = jsonb_build_object(
        'latitude', p_latitude,
        'longitude', p_longitude
      ),
      checkout_distance_metres = v_distance
  where id = v_checkin.id;

  return jsonb_build_object(
    'success', true,
    'already_checked_out', false,
    'checkout_time', v_checkout_time,
    'distance_metres', v_distance,
    'message', 'Event check-out completed.'
  );
exception when others then
  return jsonb_build_object(
    'success', false,
    'message', 'Event check-out failed: ' || sqlerrm
  );
end $$;

revoke all on function public.rpc_event_check_out(
  uuid, uuid, double precision, double precision
) from public;
grant execute on function public.rpc_event_check_out(
  uuid, uuid, double precision, double precision
) to anon, authenticated;

notify pgrst, 'reload schema';
