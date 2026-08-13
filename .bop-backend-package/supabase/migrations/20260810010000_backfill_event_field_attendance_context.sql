-- Backfill display/context metadata for existing verified event and field
-- attendance. Never change first-in, checkout, biometric evidence, or balances.

update public.event_checkins checkin
set arrival_status=case
      when checkin.checkin_time<=((event.event_date+event.start_time) at time zone 'Asia/Kolkata')+
        make_interval(mins=>event.event_late_grace_minutes) then 'ON_TIME' else 'LATE' end,
    late_minutes=case
      when checkin.checkin_time<=((event.event_date+event.start_time) at time zone 'Asia/Kolkata')+
        make_interval(mins=>event.event_late_grace_minutes) then 0
      else greatest(0,floor(extract(epoch from (checkin.checkin_time-
        (((event.event_date+event.start_time) at time zone 'Asia/Kolkata')+
          make_interval(mins=>event.event_late_grace_minutes))))/60)::integer) end
from public.events event
where event.id=checkin.event_id
  and checkin.checkin_time is not null
  and (checkin.arrival_status is null or checkin.late_minutes is null);

with event_context as (
  select distinct on (checkin.user_id,event.event_date)
    checkin.user_id,event.event_date attendance_date,event.id event_id,
    event.title,event.address,checkin.checkin_time
  from public.event_checkins checkin
  join public.events event on event.id=checkin.event_id
  where checkin.checkin_time is not null
  order by checkin.user_id,event.event_date,checkin.checkin_time desc,checkin.id
)
update public.attendance_logs attendance
set attendance_context='EVENT',event_id=context.event_id,
    context_location_name=coalesce(context.address,context.title),
    context_started_at=context.checkin_time,updated_at=now()
from event_context context
where attendance.user_id=context.user_id and attendance.date=context.attendance_date
  and attendance.attendance_context is null;

with field_context as (
  select distinct on (visit.user_id,visit.date)
    visit.user_id,visit.date attendance_date,visit.id field_visit_id,
    coalesce(visit.project_name,visit.location_name) context_name,visit.checkin_time
  from public.field_visits visit
  where visit.checkin_time is not null
    and coalesce(visit.verification_status,'PENDING')<>'REJECTED'
  order by visit.user_id,visit.date,visit.checkin_time desc,visit.id
)
update public.attendance_logs attendance
set attendance_context='FIELD_VISIT',field_visit_id=context.field_visit_id,
    context_location_name=context.context_name,context_started_at=context.checkin_time,
    updated_at=now()
from field_context context
where attendance.user_id=context.user_id and attendance.date=context.attendance_date
  and attendance.attendance_context is null;

insert into public.hrms_migration_report(migration_key,entity_type,entity_id,status,detail)
select '20260810010000','ATTENDANCE_CONTEXT','SUMMARY','BACKFILLED',jsonb_build_object(
  'event_context_rows',(select count(*) from public.attendance_logs where attendance_context='EVENT'),
  'field_visit_context_rows',(select count(*) from public.attendance_logs where attendance_context='FIELD_VISIT'),
  'event_arrival_status_rows',(select count(*) from public.event_checkins where arrival_status is not null),
  'historical_times_preserved',true,'balances_changed',false)
on conflict(migration_key,entity_type,entity_id) do nothing;

notify pgrst, 'reload schema';
