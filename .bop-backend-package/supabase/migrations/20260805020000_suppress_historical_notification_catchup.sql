-- Do not notify current users about stale field-visit rows that pre-date the
-- unified notification rollout. No push tokens existed when these rows were
-- briefly queued, so deleting them cannot retract a delivered phone alert.

delete from public.notifications notification
where notification.type='field_visit_overdue'
  and notification.event_key like 'field-visit-overdue:%'
  and exists(
    select 1 from public.field_visits visit
    where visit.id=notification.field_visit_id
      and visit.date<(now() at time zone 'Asia/Kolkata')::date
  );

update public.field_visits
set overdue_notified_at=coalesce(overdue_notified_at,now())
where date<(now() at time zone 'Asia/Kolkata')::date
  and status in ('PENDING','IN_TRANSIT');

drop trigger if exists notify_field_visit_workflow_trg on public.field_visits;
create trigger notify_field_visit_workflow_trg
after insert or update of verification_status,tracking_started_at,status
on public.field_visits for each row
when (new.date >= ((current_timestamp at time zone 'Asia/Kolkata')::date))
execute function public.notify_field_visit_workflow();

alter function public.process_hrms_notification_schedules()
  rename to process_hrms_notification_schedules_v1;

create function public.process_hrms_notification_schedules()
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_result jsonb;
begin
  -- Mark historical visits as reconciled before running the original rule set.
  -- Same-day ETA deadlines remain eligible for an overdue notification.
  update public.field_visits
  set overdue_notified_at=coalesce(overdue_notified_at,now())
  where date<(now() at time zone 'Asia/Kolkata')::date
    and status in ('PENDING','IN_TRANSIT');
  v_result:=public.process_hrms_notification_schedules_v1();
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
    'historical_field_visit_catchup_suppressed',true
  );
end $$;

revoke all on function public.process_hrms_notification_schedules_v1()
  from public,anon,authenticated;
grant execute on function public.process_hrms_notification_schedules_v1() to service_role;
revoke all on function public.process_hrms_notification_schedules()
  from public,anon,authenticated;
grant execute on function public.process_hrms_notification_schedules() to service_role;

create or replace function public.rpc_get_release_contract()
returns jsonb language sql stable security definer set search_path=public,pg_temp
as $$ select jsonb_build_object(
  'backend_schema_version','20260805020000',
  'attendance_timezone','Asia/Kolkata',
  'field_visit_origin_contract','origin_lat|origin_lon|origin_name',
  'notification_contract','outbox_v1|missing_checkout_1835_ist|workflow_push_v1'
) $$;
revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract() to anon,authenticated,service_role;

notify pgrst, 'reload schema';
