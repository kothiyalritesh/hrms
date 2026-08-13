-- Unified HRMS inbox + Android push outbox.
-- Server-side triggers make notification creation independent of whether the
-- website or Android application is currently open.

alter table public.notifications
  add column if not exists deep_link text,
  add column if not exists category_id text,
  add column if not exists action_label text,
  add column if not exists push_data jsonb not null default '{}'::jsonb;

create table if not exists public.notification_push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null unique,
  title text not null,
  body text not null,
  event_type text not null,
  channel_id text not null,
  category_id text,
  action_label text,
  deep_link text not null,
  data jsonb not null default '{}'::jsonb,
  sound text not null default 'default',
  priority text not null default 'high',
  status text not null default 'PENDING'
    check (status in ('PENDING','SENDING','SENT','DELIVERED','FAILED','WAITING_TOKEN','EXPIRED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 days'),
  last_error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_push_outbox_dispatch_idx
  on public.notification_push_outbox(status, next_attempt_at, created_at)
  where status in ('PENDING','FAILED','WAITING_TOKEN','SENT');
create index if not exists notification_push_outbox_recipient_idx
  on public.notification_push_outbox(recipient_user_id, created_at desc);

create table if not exists public.notification_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_push_outbox(id) on delete cascade,
  push_token_id uuid not null references public.device_push_tokens(id) on delete cascade,
  provider_ticket_id text,
  status text not null default 'PENDING'
    check (status in ('PENDING','SENT','DELIVERED','FAILED')),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(outbox_id, push_token_id)
);

create index if not exists notification_push_deliveries_receipt_idx
  on public.notification_push_deliveries(status, updated_at)
  where status = 'SENT' and provider_ticket_id is not null;

alter table public.notification_push_outbox enable row level security;
alter table public.notification_push_deliveries enable row level security;
revoke all on public.notification_push_outbox,
  public.notification_push_deliveries from public, anon, authenticated;
grant all on public.notification_push_outbox,
  public.notification_push_deliveries to service_role;

create or replace function public.enqueue_hrms_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text,
  p_event_key text,
  p_deep_link text default '/HRMS/notifications',
  p_field_visit_id uuid default null,
  p_event_id uuid default null,
  p_data jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_user_id is null or nullif(btrim(p_event_key), '') is null then
    return null;
  end if;
  insert into public.notifications(
    user_id, title, message, type, event_key, field_visit_id, event_id,
    deep_link, push_data, read
  ) values (
    p_user_id, left(coalesce(p_title, 'HRMS notification'), 255),
    coalesce(p_message, ''), coalesce(nullif(p_type, ''), 'announcement'),
    left(p_event_key, 500), p_field_visit_id, p_event_id,
    coalesce(nullif(p_deep_link, ''), '/HRMS/notifications'),
    coalesce(p_data, '{}'::jsonb), false
  )
  on conflict(event_key) where event_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.notifications where event_key = p_event_key;
  end if;
  return v_id;
end;
$$;

revoke all on function public.enqueue_hrms_notification(
  uuid,text,text,text,text,text,uuid,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.enqueue_hrms_notification(
  uuid,text,text,text,text,text,uuid,uuid,jsonb
) to service_role;

create or replace function public.queue_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text := lower(coalesce(new.type, 'announcement'));
  v_channel text;
  v_category text;
  v_action text;
  v_link text;
  v_key text;
begin
  v_channel := case
    when v_type like 'attendance%' or v_type like 'biometric%' then 'hrms_attendance'
    when v_type like 'field_visit%' or v_type in ('journey','journey_update') then 'hrms_field_visits'
    when v_type like 'leave%' or v_type like 'regularization%' then 'hrms_leave'
    when v_type like 'task%' then 'hrms_tasks'
    when v_type in ('event_announcement','holiday','policy','emergency','comp_off_credited','hr_announcement') then 'hrms_announcements'
    else 'hrms_manager_updates'
  end;
  v_category := coalesce(new.category_id, case
    when v_type = 'attendance_missing_checkout' then 'hrms_attendance_actions'
    when v_type like 'field_visit%' or v_type in ('journey','journey_update') then 'hrms_visit_actions'
    when v_type like 'leave%' or v_type like 'regularization%' then 'hrms_leave_actions'
    when v_type like 'task%' then 'hrms_task_actions'
    when v_type in ('event_announcement','holiday','policy','emergency','comp_off_credited','hr_announcement') then 'hrms_announcement_actions'
    else null
  end);
  v_action := coalesce(new.action_label, case
    when v_type = 'attendance_missing_checkout' then 'Open Checkout'
    when v_type like 'field_visit%' or v_type in ('journey','journey_update') then 'Open Visit'
    when v_type like 'leave%' then 'Open Leave'
    when v_type like 'regularization%' then 'Open Request'
    when v_type like 'task%' then 'Open Task'
    else 'Open HRMS'
  end);
  v_link := coalesce(new.deep_link, case
    when v_type like 'attendance%' or v_type like 'biometric%' then '/HRMS/attendance'
    when new.field_visit_id is not null then '/HRMS/field-visits/' || new.field_visit_id
    when v_type like 'leave%' then '/HRMS/leave'
    when v_type like 'regularization%' then '/HRMS/admin/regularization'
    when v_type like 'task%' then '/HRMS/tasks'
    when v_type = 'event_announcement' and new.event_id is not null then '/HRMS/tasks/' || new.event_id
    else '/HRMS/notifications'
  end);
  v_key := coalesce(new.event_key, 'notification:' || new.id);

  insert into public.notification_push_outbox(
    notification_id, recipient_user_id, event_key, title, body, event_type,
    channel_id, category_id, action_label, deep_link, data, sound, priority,
    expires_at
  ) values (
    new.id, new.user_id, v_key, coalesce(new.title, 'HRMS notification'),
    coalesce(new.message, ''), v_type, v_channel, v_category, v_action, v_link,
    coalesce(new.push_data, '{}'::jsonb) || jsonb_build_object(
      'type', v_type, 'deepLink', v_link, 'notificationId', new.id,
      'actionLabel', v_action
    ) || case when new.field_visit_id is not null
      then jsonb_build_object('fieldVisitId', new.field_visit_id) else '{}'::jsonb end
      || case when new.event_id is not null
      then jsonb_build_object('eventId', new.event_id) else '{}'::jsonb end,
    'default', 'high',
    case when v_type in ('attendance_missing_checkout','task_due_soon','task_overdue')
      then now() + interval '1 day' else now() + interval '3 days' end
  ) on conflict(event_key) do nothing;
  return new;
exception when others then
  raise warning 'Unable to queue push for notification %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists queue_notification_push_trg on public.notifications;
create trigger queue_notification_push_trg
after insert on public.notifications
for each row execute function public.queue_notification_push();

create or replace function public.notification_manager_for(p_user_id uuid)
returns uuid
language sql stable security definer set search_path=public,pg_temp
as $$
  select coalesce(
    (select coalesce(profile.reports_to, profile.reporting_manager_id)
       from public.profiles profile where profile.id = p_user_id),
    (select fallback.id from public.profiles fallback
       where coalesce(fallback.is_active,true)=true
         and upper(coalesce(fallback.role,'')) in ('HR','HRD','ADMIN','SYSTEM_ADMIN')
       order by case upper(coalesce(fallback.role,'')) when 'HR' then 1 when 'HRD' then 2 else 3 end,
         fallback.id limit 1)
  )
$$;

revoke all on function public.notification_manager_for(uuid)
  from public, anon, authenticated;
grant execute on function public.notification_manager_for(uuid) to service_role;

create or replace function public.notify_leave_workflow()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_manager uuid; v_name text;
begin
  select public.notification_manager_for(new.user_id), coalesce(name, full_name, 'Employee')
    into v_manager, v_name from public.profiles where id=new.user_id;
  if tg_op='INSERT' and lower(coalesce(new.status,'pending'))='pending' then
    perform public.enqueue_hrms_notification(v_manager, 'New leave request',
      v_name || ' requested ' || coalesce(new.leave_type,'leave') || ' from ' || new.start_date || ' to ' || new.end_date || '.',
      'leave_request_new', 'leave-new:'||new.id||':'||v_manager,
      '/HRMS/admin/leaves', null, null, jsonb_build_object('leaveRequestId',new.id));
  elsif tg_op='UPDATE' and new.status is distinct from old.status
    and lower(new.status) in ('approved','rejected') then
    perform public.enqueue_hrms_notification(new.user_id,
      case when lower(new.status)='approved' then 'Leave approved' else 'Leave rejected' end,
      'Your '||coalesce(new.leave_type,'leave')||' request for '||new.start_date||' to '||new.end_date||' was '||lower(new.status)||'.',
      'leave_'||lower(new.status), 'leave-result:'||new.id||':'||lower(new.status),
      '/HRMS/leave', null, null, jsonb_build_object('leaveRequestId',new.id,'status',new.status));
  end if;
  return new;
end $$;

drop trigger if exists notify_leave_workflow_trg on public.leave_requests;
create trigger notify_leave_workflow_trg after insert or update of status
on public.leave_requests for each row execute function public.notify_leave_workflow();

create or replace function public.notify_regularization_workflow()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_manager uuid; v_name text;
begin
  select public.notification_manager_for(new.user_id), coalesce(name,full_name,'Employee')
    into v_manager,v_name from public.profiles where id=new.user_id;
  if tg_op='INSERT' and new.status='PENDING' then
    perform public.enqueue_hrms_notification(v_manager,'New attendance regularization',
      v_name||' submitted a '||replace(lower(new.request_type),'_',' ')||' request.',
      'regularization_new','regularization-new:'||new.id||':'||v_manager,
      '/HRMS/admin/regularization',null,null,jsonb_build_object('regularizationId',new.id));
  elsif tg_op='UPDATE' and new.status is distinct from old.status
    and new.status in ('APPROVED','REJECTED') then
    perform public.enqueue_hrms_notification(new.user_id,
      'Regularization '||lower(new.status),
      'Your attendance regularization request was '||lower(new.status)||'.',
      'regularization_'||lower(new.status),'regularization-result:'||new.id||':'||lower(new.status),
      '/HRMS/attendance',null,null,jsonb_build_object('regularizationId',new.id,'status',new.status));
  end if;
  return new;
end $$;

drop trigger if exists notify_regularization_workflow_trg on public.attendance_regularization_requests;
create trigger notify_regularization_workflow_trg after insert or update of status
on public.attendance_regularization_requests for each row execute function public.notify_regularization_workflow();

create or replace function public.notify_task_workflow()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  if tg_op='INSERT' and new.assigned_to is not null then
    perform public.enqueue_hrms_notification(new.assigned_to,'New task assigned',new.title,
      'task_assigned','task-assigned:'||new.id||':'||new.assigned_to,
      '/HRMS/tasks',null,null,jsonb_build_object('taskId',new.id));
  elsif tg_op='UPDATE' then
    if new.assigned_to is distinct from old.assigned_to then
      if new.assigned_to is not null then
        perform public.enqueue_hrms_notification(new.assigned_to,'Task reassigned to you',new.title,
          'task_reassigned','task-reassigned-new:'||new.id||':'||new.assigned_to,
          '/HRMS/tasks',null,null,jsonb_build_object('taskId',new.id));
      end if;
      if old.assigned_to is not null then
        perform public.enqueue_hrms_notification(old.assigned_to,'Task reassigned',new.title||' is no longer assigned to you.',
          'task_reassigned','task-reassigned-old:'||new.id||':'||old.assigned_to,
          '/HRMS/tasks',null,null,jsonb_build_object('taskId',new.id));
      end if;
    end if;
    if lower(coalesce(new.status,''))='completed'
      and lower(coalesce(old.status,''))<>'completed' then
      perform public.enqueue_hrms_notification(coalesce(new.assigned_by,new.assigned_to),
        'Task completed',new.title,'task_completed',
        'task-completed:'||new.id||':'||coalesce(new.assigned_by,new.assigned_to),
        '/HRMS/tasks',null,null,jsonb_build_object('taskId',new.id));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists notify_task_workflow_trg on public.tasks;
create trigger notify_task_workflow_trg after insert or update of assigned_to,status
on public.tasks for each row execute function public.notify_task_workflow();

create or replace function public.notify_field_visit_workflow()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_manager uuid; v_name text; v_location text;
begin
  select public.notification_manager_for(new.user_id),coalesce(name,full_name,'Employee')
    into v_manager,v_name from public.profiles where id=new.user_id;
  v_location:=coalesce(nullif(new.project_name,''),nullif(new.location_name,''),'destination');
  if tg_op='INSERT' then
    perform public.enqueue_hrms_notification(new.user_id,'Field visit scheduled',
      'Your visit to '||v_location||' is ready.','field_visit_assigned',
      'field-visit-assigned:'||new.id,'/HRMS/field-visits/'||new.id,new.id,null,
      jsonb_build_object('fieldVisitId',new.id));
    perform public.enqueue_hrms_notification(v_manager,'Field visit approval requested',
      v_name||' created a field visit for '||v_location||'.','field_visit_approval_requested',
      'field-visit-approval:'||new.id||':'||v_manager,'/HRMS/admin/field-visits',new.id,null,
      jsonb_build_object('fieldVisitId',new.id));
  else
    if new.verification_status is distinct from old.verification_status
      and new.verification_status in ('APPROVED','REJECTED','NEEDS_INFORMATION') then
      perform public.enqueue_hrms_notification(new.user_id,
        'Field visit '||replace(lower(new.verification_status),'_',' '),
        'The review for '||v_location||' is '||replace(lower(new.verification_status),'_',' ')||'.',
        'field_visit_'||lower(new.verification_status),
        'field-visit-review:'||new.id||':'||new.verification_status,
        '/HRMS/field-visits/'||new.id,new.id,null,jsonb_build_object('fieldVisitId',new.id));
    end if;
    if new.tracking_started_at is not null and old.tracking_started_at is null then
      perform public.enqueue_hrms_notification(v_manager,'Employee started journey',
        v_name||' started travelling to '||v_location||'.','field_visit_started',
        'field-visit-started:'||new.id||':'||v_manager,'/HRMS/admin/field-visits',new.id,null,
        jsonb_build_object('fieldVisitId',new.id));
    end if;
    if new.status is distinct from old.status and new.status='CHECKED_IN' then
      perform public.enqueue_hrms_notification(new.user_id,'Field visit check-in confirmed',
        'You checked in at '||v_location||'.','field_visit_checkin',
        'field-visit-checkin:'||new.id,'/HRMS/field-visits/'||new.id,new.id,null,
        jsonb_build_object('fieldVisitId',new.id));
      perform public.enqueue_hrms_notification(v_manager,'Employee arrived',
        v_name||' checked in at '||v_location||'.','field_visit_arrived_manager',
        'field-visit-manager-arrived:'||new.id||':'||v_manager,'/HRMS/admin/field-visits',new.id,null,
        jsonb_build_object('fieldVisitId',new.id));
    end if;
    if new.status is distinct from old.status and new.status='COMPLETED' then
      perform public.enqueue_hrms_notification(new.user_id,'Field visit completed',
        'Your checkout from '||v_location||' is confirmed.','field_visit_checkout',
        'field-visit-checkout:'||new.id,'/HRMS/field-visits/'||new.id,new.id,null,
        jsonb_build_object('fieldVisitId',new.id));
    end if;
    if new.status is distinct from old.status and new.status='MISSED' then
      perform public.enqueue_hrms_notification(new.user_id,'Field visit marked missed',
        'The visit to '||v_location||' was marked missed.','field_visit_missed',
        'field-visit-missed:'||new.id||':'||new.user_id,'/HRMS/field-visits/'||new.id,new.id,null,
        jsonb_build_object('fieldVisitId',new.id));
      perform public.enqueue_hrms_notification(v_manager,'Employee missed field visit',
        v_name||' missed the visit to '||v_location||'.','field_visit_missed',
        'field-visit-missed:'||new.id||':'||v_manager,'/HRMS/admin/field-visits',new.id,null,
        jsonb_build_object('fieldVisitId',new.id));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists notify_field_visit_workflow_trg on public.field_visits;
create trigger notify_field_visit_workflow_trg
after insert or update of verification_status,tracking_started_at,status
on public.field_visits for each row
when (new.date >= ((current_timestamp at time zone 'Asia/Kolkata')::date))
execute function public.notify_field_visit_workflow();

create or replace function public.notify_manager_from_journey_event()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_manager uuid;v_name text;v_location text;v_title text;v_message text;
begin
  if new.field_visit_id is null or new.event_type not in ('ENTERED_1KM','ENTERED_500M','ARRIVED') then return new;end if;
  select public.notification_manager_for(new.user_id),coalesce(name,full_name,'Employee')
    into v_manager,v_name from public.profiles where id=new.user_id;
  select coalesce(nullif(project_name,''),nullif(location_name,''),'destination')
    into v_location from public.field_visits where id=new.field_visit_id;
  v_title:=case when new.event_type='ARRIVED' then 'Employee arrived' else 'Employee approaching destination' end;
  v_message:=v_name||case new.event_type when 'ENTERED_1KM' then ' is approximately 1 km from '
    when 'ENTERED_500M' then ' is approximately 500 metres from ' else ' arrived at ' end||v_location||'.';
  perform public.enqueue_hrms_notification(v_manager,v_title,v_message,'journey_update',
    'journey-event:'||new.id||':'||v_manager,'/HRMS/admin/field-visits',new.field_visit_id,null,
    jsonb_build_object('journeyEventId',new.id,'fieldVisitId',new.field_visit_id,'eventType',new.event_type));
  return new;
end $$;

create or replace function public.notify_event_updated()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare recipient record;v_key_suffix text;
begin
  if to_jsonb(new)-'created_at' is not distinct from to_jsonb(old)-'created_at' then return new;end if;
  v_key_suffix:=md5((to_jsonb(new)-'created_at')::text);
  for recipient in select id from public.profiles where coalesce(is_active,true)=true loop
    insert into public.event_announcements(event_id,user_id,announced_at,acknowledged_at)
      values(new.id,recipient.id,now(),null)
      on conflict(event_id,user_id) do update set announced_at=excluded.announced_at,acknowledged_at=null;
    perform public.enqueue_hrms_notification(recipient.id,'HRMS Event Updated: '||new.title,
      new.event_date||' | '||left(new.start_time::text,5)||'-'||left(new.end_time::text,5)||' | '||new.address,
      'event_announcement','event-updated:'||new.id||':'||v_key_suffix||':'||recipient.id,
      '/HRMS/tasks/'||new.id,null,new.id,jsonb_build_object('eventId',new.id));
  end loop;
  return new;
end $$;

drop trigger if exists notify_event_updated_trg on public.events;
create trigger notify_event_updated_trg after update on public.events
for each row execute function public.notify_event_updated();

-- The unified outbox replaces the older event-only sender and prevents a
-- duplicate phone notification for newly created events.
drop trigger if exists request_event_push_trg on public.events;

create or replace function public.notify_holiday_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare recipient record;v_kind text;v_hash text;
begin
  v_kind:=case when tg_op='INSERT' then 'announced' else 'updated' end;
  v_hash:=md5(to_jsonb(new)::text);
  for recipient in
    select id from public.profiles
    where coalesce(is_active,true)=true and (new.office_id is null or office_id=new.office_id)
  loop
    perform public.enqueue_hrms_notification(recipient.id,'Holiday '||v_kind||': '||new.name,
      'Holiday date: '||new.holiday_date||case when new.is_optional then ' (optional)' else '' end,
      'holiday','holiday:'||new.id||':'||v_hash||':'||recipient.id,
      '/HRMS/leave',null,null,jsonb_build_object('holidayId',new.id,'holidayDate',new.holiday_date));
  end loop;
  return new;
end $$;

drop trigger if exists notify_holiday_change_trg on public.holiday_calendar;
create trigger notify_holiday_change_trg after insert or update on public.holiday_calendar
for each row execute function public.notify_holiday_change();

create or replace function public.process_hrms_notification_schedules()
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_now_ist timestamp := now() at time zone 'Asia/Kolkata';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  row_data record;v_manager uuid;v_count integer:=0;
begin
  -- Catch up any time after 18:35 IST, while the stable event key guarantees
  -- exactly one notification per employee and attendance date.
  if v_now_ist::time >= time '18:35:00' then
    for row_data in
      select attendance.user_id,attendance.date,min(attendance.checkin_time) checkin_time
      from public.attendance_logs attendance join public.profiles profile on profile.id=attendance.user_id
      where attendance.date=v_today and attendance.checkin_time is not null
        and attendance.checkout_time is null and attendance.deleted_at is null
        and coalesce(profile.is_active,true)=true
      group by attendance.user_id,attendance.date
    loop
      perform public.enqueue_hrms_notification(row_data.user_id,'Checkout missing',
        'You checked in today but have not checked out. Tap Open Checkout to complete attendance.',
        'attendance_missing_checkout','attendance-missing-checkout:'||row_data.user_id||':'||row_data.date,
        '/HRMS/attendance',null,null,jsonb_build_object('attendanceDate',row_data.date,'action','OPEN_CHECKOUT'));
      v_count:=v_count+1;
    end loop;
  end if;

  for row_data in select * from public.tasks
    where lower(coalesce(status,'')) in ('pending','in_progress') and due_date is not null
  loop
    if row_data.due_date=v_today+1 then
      perform public.enqueue_hrms_notification(row_data.assigned_to,'Task due soon',
        row_data.title||' is due tomorrow.','task_due_soon','task-due-soon:'||row_data.id,
        '/HRMS/tasks',null,null,jsonb_build_object('taskId',row_data.id));
    elsif row_data.due_date<v_today then
      perform public.enqueue_hrms_notification(row_data.assigned_to,'Task overdue',
        row_data.title||' was due on '||row_data.due_date||'.','task_overdue','task-overdue:'||row_data.id,
        '/HRMS/tasks',null,null,jsonb_build_object('taskId',row_data.id));
    end if;
  end loop;

  for row_data in select leave_request.*,coalesce(profile.name,profile.full_name,'Employee') employee_name
    from public.leave_requests leave_request join public.profiles profile on profile.id=leave_request.user_id
    where lower(coalesce(leave_request.status,''))='pending'
      and coalesce(leave_request.applied_on,leave_request.created_at at time zone 'Asia/Kolkata')<now()-interval '24 hours'
  loop
    v_manager:=public.notification_manager_for(row_data.user_id);
    perform public.enqueue_hrms_notification(v_manager,'Leave request pending',
      row_data.employee_name||'''s leave request is waiting for review.','leave_pending_reminder',
      'leave-pending-reminder:'||row_data.id||':'||v_manager,'/HRMS/admin/leaves',null,null,
      jsonb_build_object('leaveRequestId',row_data.id));
  end loop;

  for row_data in select request.*,coalesce(profile.name,profile.full_name,'Employee') employee_name
    from public.attendance_regularization_requests request join public.profiles profile on profile.id=request.user_id
    where request.status='PENDING' and request.created_at<now()-interval '24 hours'
  loop
    v_manager:=public.notification_manager_for(row_data.user_id);
    perform public.enqueue_hrms_notification(v_manager,'Regularization request pending',
      row_data.employee_name||'''s attendance request is waiting for review.','regularization_pending_reminder',
      'regularization-pending-reminder:'||row_data.id||':'||v_manager,
      '/HRMS/admin/regularization',null,null,jsonb_build_object('regularizationId',row_data.id));
  end loop;

  for row_data in select visit.*,coalesce(profile.name,profile.full_name,'Employee') employee_name
    from public.field_visits visit join public.profiles profile on profile.id=visit.user_id
    where visit.status in ('PENDING','IN_TRANSIT') and visit.overdue_notified_at is null
      and visit.date=v_today and visit.eta_deadline_at is not null and visit.eta_deadline_at<now()
  loop
    v_manager:=public.notification_manager_for(row_data.user_id);
    perform public.enqueue_hrms_notification(row_data.user_id,'Field visit overdue',
      'Your visit to '||coalesce(row_data.project_name,row_data.location_name,'destination')||' is overdue.',
      'field_visit_overdue','field-visit-overdue:'||row_data.id||':'||row_data.user_id,
      '/HRMS/field-visits/'||row_data.id,row_data.id,null,jsonb_build_object('fieldVisitId',row_data.id));
    perform public.enqueue_hrms_notification(v_manager,'Employee field visit overdue',
      row_data.employee_name||'''s visit to '||coalesce(row_data.project_name,row_data.location_name,'destination')||' is overdue.',
      'field_visit_overdue','field-visit-overdue:'||row_data.id||':'||v_manager,
      '/HRMS/admin/field-visits',row_data.id,null,jsonb_build_object('fieldVisitId',row_data.id));
    update public.field_visits set overdue_notified_at=now() where id=row_data.id;
  end loop;
  return jsonb_build_object('success',true,'checked_at',now(),'missing_checkout_candidates',v_count);
end $$;

revoke all on function public.process_hrms_notification_schedules()
  from public,anon,authenticated;
grant execute on function public.process_hrms_notification_schedules() to service_role;

do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='hrms-notification-rules-every-minute';
    perform cron.schedule('hrms-notification-rules-every-minute','* * * * *',
      $job$select public.process_hrms_notification_schedules()$job$);
  end if;
exception when insufficient_privilege then
  raise notice 'Schedule hrms-notification-rules-every-minute from the Supabase Cron dashboard.';
end $$;

-- Invoke the dispatcher every minute using the existing Vault-backed project
-- key. The endpoint accepts no recipient/message input and can process only
-- server-created outbox rows.
do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron')
    and exists(select 1 from vault.decrypted_secrets where name='SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON') then
    perform cron.unschedule(jobid) from cron.job where jobname='hrms-push-dispatch-every-minute';
    perform cron.schedule('hrms-push-dispatch-every-minute','* * * * *',format(
      $job$select net.http_post(
        url:='https://jidbrwpzfpbursihtvpg.supabase.co/functions/v1/notification-dispatch',
        headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||%L,'apikey',%L),
        body:='{"source":"pg_cron"}'::jsonb,timeout_milliseconds:=50000
      )$job$,
      (select decrypted_secret from vault.decrypted_secrets where name='SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON' limit 1),
      (select decrypted_secret from vault.decrypted_secrets where name='SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON' limit 1)
    ));
  else
    raise notice 'SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON must be provisioned before scheduling push dispatch.';
  end if;
exception when insufficient_privilege then
  raise notice 'Schedule hrms-push-dispatch-every-minute from the Supabase Cron dashboard.';
end $$;

create or replace function public.rpc_get_release_contract()
returns jsonb language sql stable security definer set search_path=public,pg_temp
as $$ select jsonb_build_object(
  'backend_schema_version','20260805010000',
  'attendance_timezone','Asia/Kolkata',
  'field_visit_origin_contract','origin_lat|origin_lon|origin_name',
  'notification_contract','outbox_v1|missing_checkout_1835_ist|workflow_push_v1'
) $$;
revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract() to anon,authenticated,service_role;

notify pgrst, 'reload schema';
