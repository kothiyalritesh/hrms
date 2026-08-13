-- A successful event check-in is also a completed HRMS attendance record.
-- Existing office/biometric attendance is preserved and only marked present.

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
    'Event attendance: ' || v_event.title || '.'
  )
  returning * into v_attendance;

  -- Event attendance does not require a second checkout action. Record the
  -- protected audit first, then complete the attendance at the check-in time.
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
    'CHECKOUT_AUTO',
    'CHECKED_IN',
    'CHECKED_OUT',
    null,
    new.checkin_time,
    'Event attendance auto-completed',
    'SYSTEM'
  );

  perform set_config('app.authorized_attendance_checkout', 'DAY_END', true);
  update public.attendance_logs
  set checkout_time = new.checkin_time,
      checkout_source = 'SYSTEM',
      checkout_location = new.checkin_location,
      checkout_latitude = v_latitude,
      checkout_longitude = v_longitude,
      checkout_location_name = v_event.address,
      checkout_distance_meters = new.distance_metres,
      status = 'CHECKED_OUT',
      auto_checkout = true,
      auto_checkout_reason = 'Event attendance auto-completed',
      work_hours = 0,
      updated_at = now()
  where id = v_attendance.id;

  return new;
end $$;

drop trigger if exists sync_event_checkin_to_attendance_trg
  on public.event_checkins;
create trigger sync_event_checkin_to_attendance_trg
after insert on public.event_checkins
for each row execute function public.sync_event_checkin_to_attendance();

-- CP / Channel Partner event at Gaur Sarovar on Sunday, 26 July 2026.
do $$
declare
  v_event_id uuid;
begin
  select id into v_event_id
  from public.events
  where event_date = date '2026-07-26'
    and lower(title) in (
      'cp & channel partner event',
      'cp and channel partner event'
    )
  order by created_at
  limit 1;

  if v_event_id is null then
    insert into public.events(
      title,
      description,
      event_date,
      start_time,
      end_time,
      address,
      latitude,
      longitude,
      checkin_radius_m,
      comp_off_enabled,
      comp_off_team,
      comp_off_days
    ) values (
      'CP & Channel Partner Event',
      'Channel partner event at Gaur Sarovar. Employees attending can check in from the venue at any time on the event date through HRMS.',
      date '2026-07-26',
      time '10:00',
      time '19:00',
      'Gaur Sarovar, Greater Noida',
      28.610171094507933,
      77.42443956722464,
      150,
      true,
      'MARKETING',
      1
    )
    returning id into v_event_id;
  else
    update public.events
    set description = 'Channel partner event at Gaur Sarovar. Employees attending can check in from the venue at any time on the event date through HRMS.',
        start_time = time '10:00',
        end_time = time '19:00',
        address = 'Gaur Sarovar, Greater Noida',
        latitude = 28.610171094507933,
        longitude = 77.42443956722464,
        checkin_radius_m = 150,
        comp_off_enabled = true,
        comp_off_team = 'MARKETING',
        comp_off_days = 1
    where id = v_event_id;
  end if;

  perform public.announce_event_to_active_employees(v_event_id);
end $$;
