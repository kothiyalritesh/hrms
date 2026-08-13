-- Field/event attendance contexts, targeted event audiences, auditable event
-- comp-off, and live-state notification suppression.
-- All business-date decisions use Asia/Kolkata. Existing attendance rows and
-- biometric first-in timestamps are never replaced by later context arrivals.

-- ---------------------------------------------------------------------------
-- Attendance context links (one daily row remains authoritative)
-- ---------------------------------------------------------------------------
alter table public.attendance_logs
  add column if not exists attendance_context text,
  add column if not exists field_visit_id uuid references public.field_visits(id) on delete set null,
  add column if not exists event_id uuid references public.events(id) on delete set null,
  add column if not exists context_location_name text,
  add column if not exists context_started_at timestamptz;

create index if not exists attendance_logs_field_visit_idx
  on public.attendance_logs(field_visit_id) where field_visit_id is not null;
create index if not exists attendance_logs_event_idx
  on public.attendance_logs(event_id) where event_id is not null;
create unique index if not exists attendance_logs_user_business_date_uidx
  on public.attendance_logs(user_id,date);

alter table public.attendance_logs drop constraint if exists attendance_logs_state_ck;
alter table public.attendance_logs add constraint attendance_logs_state_ck
  check(attendance_state in ('NOT_CHECKED_IN','WORKING','ON_FIELD_VISIT','AT_EVENT','CHECKED_OUT')) not valid;

-- ---------------------------------------------------------------------------
-- Proper event audience and participant model
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists audience_scope text not null default 'LEGACY_ALL',
  add column if not exists event_late_grace_minutes integer not null default 10,
  add column if not exists idempotency_key uuid;

alter table public.events drop constraint if exists events_status_check;
alter table public.events add constraint events_status_check
  check(status in ('ACTIVE','CANCELLED','COMPLETED')) not valid;
alter table public.events drop constraint if exists events_audience_scope_check;
alter table public.events add constraint events_audience_scope_check
  check(audience_scope in ('LEGACY_ALL','ALL_EMPLOYEES','SELECTED')) not valid;
alter table public.events drop constraint if exists events_late_grace_check;
alter table public.events add constraint events_late_grace_check
  check(event_late_grace_minutes between 0 and 240) not valid;
create unique index if not exists events_creator_idempotency_uq
  on public.events(created_by,idempotency_key) where idempotency_key is not null;

create table if not exists public.event_team_assignments (
  event_id uuid not null references public.events(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  primary key(event_id,team_id)
);

create table if not exists public.event_department_assignments (
  event_id uuid not null references public.events(id) on delete cascade,
  department_name text not null,
  department_key text generated always as (lower(btrim(department_name))) stored,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  primary key(event_id,department_key)
);

create table if not exists public.event_employee_assignments (
  event_id uuid not null references public.events(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  primary key(event_id,employee_id)
);

create table if not exists public.event_participants (
  event_id uuid not null references public.events(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  assignment_sources text[] not null default '{}'::text[],
  assigned_at timestamptz not null default now(),
  primary key(event_id,employee_id)
);
create index if not exists event_participants_employee_idx
  on public.event_participants(employee_id,event_id);

-- Preserve the audience of historical/live legacy events exactly as it was
-- announced. This backfill does not generate any new notifications.
insert into public.event_participants(event_id,employee_id,assignment_sources,assigned_at)
select announcement.event_id,announcement.user_id,array['LEGACY_ANNOUNCEMENT'],announcement.announced_at
from public.event_announcements announcement
on conflict(event_id,employee_id) do nothing;

-- Legacy insert triggers announced every event to every employee before the
-- caller could save assignments. Event creation is now one protected RPC.
drop trigger if exists announce_new_event_trg on public.events;
drop trigger if exists request_event_push_trg on public.events;

create or replace function public.resolve_event_participants(p_event_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event public.events%rowtype;v_count integer:=0;
begin
  select * into v_event from public.events where id=p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  delete from public.event_participants where event_id=p_event_id;

  insert into public.event_participants(event_id,employee_id,assignment_sources)
  select p_event_id,profile.id,array_remove(array[
    case when v_event.audience_scope in ('ALL_EMPLOYEES','LEGACY_ALL') then 'ALL_EMPLOYEES' end,
    case when employee.employee_id is not null then 'EMPLOYEE' end,
    case when team.team_id is not null then 'TEAM' end,
    case when department.department_key is not null then 'DEPARTMENT' end
  ],null)
  from public.profiles profile
  left join public.event_employee_assignments employee
    on employee.event_id=p_event_id and employee.employee_id=profile.id
  left join public.event_team_assignments team
    on team.event_id=p_event_id and team.team_id=profile.team_id
  left join public.event_department_assignments department
    on department.event_id=p_event_id
   and department.department_key=lower(btrim(coalesce(profile.department,'')))
  where profile.is_active and not coalesce(profile.is_service_account,false)
    and (v_event.audience_scope in ('ALL_EMPLOYEES','LEGACY_ALL')
      or employee.employee_id is not null or team.team_id is not null
      or department.department_key is not null)
  on conflict(event_id,employee_id) do update
    set assignment_sources=excluded.assignment_sources,assigned_at=now();
  get diagnostics v_count=row_count;
  return v_count;
end $$;
revoke all on function public.resolve_event_participants(uuid) from public,anon,authenticated;

create or replace function public.announce_event_to_active_employees(p_event_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event public.events%rowtype;recipient record;v_count integer:=0;
begin
  select * into v_event from public.events where id=p_event_id;
  if not found then return 0; end if;
  for recipient in
    select participant.employee_id
    from public.event_participants participant
    join public.profiles profile on profile.id=participant.employee_id
    where participant.event_id=p_event_id and profile.is_active
  loop
    insert into public.event_announcements(event_id,user_id,announced_at,acknowledged_at)
    values(p_event_id,recipient.employee_id,now(),null)
    on conflict(event_id,user_id) do update
      set announced_at=excluded.announced_at,acknowledged_at=null;
    perform public.enqueue_hrms_notification(
      recipient.employee_id,'New Event Assigned',v_event.title||E'\nDate: '||
      to_char(v_event.event_date,'DD Mon YYYY')||E'\nTime: '||
      to_char(v_event.start_time,'HH12:MI AM')||' - '||to_char(v_event.end_time,'HH12:MI AM')||
      E'\nLocation: '||v_event.address,'event_announcement',
      'EVENT_CREATED:'||v_event.id||':'||recipient.employee_id,
      '/HRMS/tasks/'||v_event.id,null,v_event.id,
      jsonb_build_object('eventId',v_event.id,'action','OPEN_EVENT'));
    insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
    values(v_event.created_by,recipient.employee_id,'EVENT_NOTIFICATION_CREATED','event',v_event.id,
      jsonb_build_object('dedupe_key','EVENT_CREATED:'||v_event.id||':'||recipient.employee_id),'NOTIFICATION_ENGINE');
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.announce_event_to_active_employees(uuid) from public,anon,authenticated;

create or replace function public.rpc_admin_event_audience_options()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform public.require_profile_admin();
  select jsonb_build_object(
    'employees',coalesce((select jsonb_agg(jsonb_build_object(
      'id',profile.id,'name',coalesce(profile.name,profile.full_name,'Employee'),
      'employee_number',profile.employee_number,'department',profile.department,
      'team_id',profile.team_id,'team_name',team.name) order by coalesce(profile.name,profile.full_name))
      from public.profiles profile left join public.teams team on team.id=profile.team_id
      where profile.is_active and not coalesce(profile.is_service_account,false)),'[]'::jsonb),
    'teams',coalesce((select jsonb_agg(jsonb_build_object(
      'id',team.id,'name',team.name,'member_count',(select count(*) from public.profiles p
        where p.team_id=team.id and p.is_active and not coalesce(p.is_service_account,false))) order by team.name)
      from public.teams team where team.is_active),'[]'::jsonb),
    'departments',coalesce((select jsonb_agg(jsonb_build_object('name',department,'member_count',member_count) order by department)
      from (select btrim(profile.department) department,count(*) member_count from public.profiles profile
        where profile.is_active and not coalesce(profile.is_service_account,false)
          and nullif(btrim(profile.department),'') is not null group by btrim(profile.department)) grouped),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.rpc_admin_create_event(
  p_values jsonb,p_employee_ids uuid[] default '{}',p_team_ids uuid[] default '{}',
  p_departments text[] default '{}',p_all_employees boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event public.events%rowtype;v_key uuid;v_participants integer;
begin
  perform public.require_profile_admin();
  v_key:=nullif(p_values->>'idempotency_key','')::uuid;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select * into v_event from public.events where created_by=auth.uid() and idempotency_key=v_key;
  if found then return jsonb_build_object('success',true,'idempotent',true,'event',to_jsonb(v_event)); end if;
  if nullif(btrim(p_values->>'title'),'') is null then raise exception 'EVENT_TITLE_REQUIRED'; end if;
  if nullif(btrim(p_values->>'address'),'') is null then raise exception 'EVENT_LOCATION_REQUIRED'; end if;
  if nullif(p_values->>'event_date','')::date is null then raise exception 'EVENT_DATE_REQUIRED'; end if;
  if nullif(p_values->>'latitude','')::double precision not between -90 and 90
     or nullif(p_values->>'longitude','')::double precision not between -180 and 180 then
    raise exception 'VALID_EVENT_COORDINATES_REQUIRED';
  end if;
  if not p_all_employees and coalesce(cardinality(p_employee_ids),0)=0
     and coalesce(cardinality(p_team_ids),0)=0 and coalesce(cardinality(p_departments),0)=0 then
    raise exception 'EVENT_AUDIENCE_REQUIRED';
  end if;
  insert into public.events(title,description,event_date,start_time,end_time,address,
    latitude,longitude,photo_url,checkin_radius_m,comp_off_enabled,comp_off_team,
    comp_off_days,created_by,status,audience_scope,event_late_grace_minutes,idempotency_key)
  values(btrim(p_values->>'title'),nullif(btrim(p_values->>'description'),''),
    (p_values->>'event_date')::date,(p_values->>'start_time')::time,(p_values->>'end_time')::time,
    btrim(p_values->>'address'),(p_values->>'latitude')::double precision,
    (p_values->>'longitude')::double precision,nullif(p_values->>'photo_url',''),
    greatest(25,least(coalesce(nullif(p_values->>'checkin_radius_m','')::integer,100),1000)),
    coalesce((p_values->>'comp_off_enabled')::boolean,false),'ALL_ATTENDEES',
    greatest(0.5,least(coalesce(nullif(p_values->>'comp_off_days','')::numeric,1),5)),
    auth.uid(),'ACTIVE',case when p_all_employees then 'ALL_EMPLOYEES' else 'SELECTED' end,
    greatest(0,least(coalesce(nullif(p_values->>'event_late_grace_minutes','')::integer,10),240)),v_key)
  returning * into v_event;

  insert into public.event_employee_assignments(event_id,employee_id,assigned_by)
  select v_event.id,selected.employee_id,auth.uid()
  from unnest(coalesce(p_employee_ids,'{}'::uuid[])) as selected(employee_id)
  join public.profiles profile on profile.id=selected.employee_id and profile.is_active
  on conflict do nothing;
  insert into public.event_team_assignments(event_id,team_id,assigned_by)
  select v_event.id,selected.team_id,auth.uid()
  from unnest(coalesce(p_team_ids,'{}'::uuid[])) as selected(team_id)
  join public.teams team on team.id=selected.team_id and team.is_active on conflict do nothing;
  insert into public.event_department_assignments(event_id,department_name,assigned_by)
  select v_event.id,btrim(selected.department_name),auth.uid()
  from unnest(coalesce(p_departments,'{}'::text[])) as selected(department_name)
  where nullif(btrim(selected.department_name),'') is not null on conflict do nothing;
  v_participants:=public.resolve_event_participants(v_event.id);
  if v_participants=0 then raise exception 'EVENT_AUDIENCE_RESOLVED_EMPTY'; end if;
  perform public.announce_event_to_active_employees(v_event.id);
  insert into public.hrms_audit_events(actor_user_id,action,entity_type,entity_id,new_values,source)
  values(auth.uid(),'EVENT_CREATED','event',v_event.id,
    jsonb_build_object('participant_count',v_participants,'audience_scope',v_event.audience_scope),'HRMS_ADMIN');
  return jsonb_build_object('success',true,'idempotent',false,'participant_count',v_participants,'event',to_jsonb(v_event));
exception when unique_violation then
  select * into v_event from public.events where created_by=auth.uid() and idempotency_key=v_key;
  if found then return jsonb_build_object('success',true,'idempotent',true,'event',to_jsonb(v_event)); end if;
  raise;
end $$;

create or replace function public.rpc_admin_delete_event(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.require_profile_admin();
  if exists(select 1 from public.event_checkins where event_id=p_event_id) then
    raise exception 'EVENT_WITH_ATTENDANCE_CANNOT_BE_DELETED';
  end if;
  delete from public.events where id=p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  return jsonb_build_object('success',true,'event_id',p_event_id);
end $$;

-- Updates notify only the already-resolved participant set.
create or replace function public.notify_event_updated()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient record;v_key_suffix text;
begin
  if to_jsonb(new)-'created_at'-'idempotency_key' is not distinct from
     to_jsonb(old)-'created_at'-'idempotency_key' then return new; end if;
  v_key_suffix:=md5((to_jsonb(new)-'created_at'-'idempotency_key')::text);
  for recipient in select employee_id from public.event_participants where event_id=new.id loop
    insert into public.event_announcements(event_id,user_id,announced_at,acknowledged_at)
    values(new.id,recipient.employee_id,now(),null)
    on conflict(event_id,user_id) do update set announced_at=excluded.announced_at,acknowledged_at=null;
    perform public.enqueue_hrms_notification(recipient.employee_id,'Event Updated: '||new.title,
      new.event_date||' | '||left(new.start_time::text,5)||'-'||left(new.end_time::text,5)||' | '||new.address,
      'event_announcement','event-updated:'||new.id||':'||v_key_suffix||':'||recipient.employee_id,
      '/HRMS/tasks/'||new.id,null,new.id,jsonb_build_object('eventId',new.id));
  end loop;
  return new;
end $$;

drop trigger if exists notify_event_updated_trg on public.events;
create trigger notify_event_updated_trg after update on public.events
for each row execute function public.notify_event_updated();

alter table public.event_checkins
  add column if not exists arrival_status text,
  add column if not exists late_minutes integer,
  add column if not exists gps_accuracy_metres double precision,
  add column if not exists location_captured_at timestamptz,
  add column if not exists travel_start_time timestamptz,
  add column if not exists travel_end_time timestamptz,
  add column if not exists approved_duty_start_time timestamptz,
  add column if not exists approved_duty_end_time timestamptz,
  add column if not exists duty_times_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists comp_off_eligible_days numeric(8,2) not null default 0;

-- Admin summary supplies event details without comma-separated audience data.
create or replace view public.event_admin_summary as
select event.*,
  (select count(*) from public.event_participants participant where participant.event_id=event.id) participant_count,
  (select count(*) from public.event_checkins checkin where checkin.event_id=event.id) attendance_count,
  (select count(*) from public.event_checkins checkin where checkin.event_id=event.id and checkin.arrival_status='ON_TIME') on_time_count,
  (select count(*) from public.event_checkins checkin where checkin.event_id=event.id and checkin.arrival_status='LATE') late_count,
  (select count(*) from public.event_checkins checkin where checkin.event_id=event.id and coalesce(checkin.comp_off_eligible_days,0)>0) comp_off_eligible_count,
  coalesce((select array_agg(team.name order by team.name) from public.event_team_assignments assignment
    join public.teams team on team.id=assignment.team_id where assignment.event_id=event.id),'{}'::text[]) assigned_team_names,
  coalesce((select array_agg(assignment.department_name order by assignment.department_name)
    from public.event_department_assignments assignment where assignment.event_id=event.id),'{}'::text[]) assigned_departments
from public.events event;

-- ---------------------------------------------------------------------------
-- Event attendance time, context, travel duty and comp-off policy
-- ---------------------------------------------------------------------------
alter table public.event_checkins drop constraint if exists event_checkins_arrival_status_check;
alter table public.event_checkins add constraint event_checkins_arrival_status_check
  check(arrival_status is null or arrival_status in ('ON_TIME','LATE')) not valid;

create table if not exists public.event_attendance_policy (
  singleton boolean primary key default true check(singleton),
  weekly_off_event_comp_off numeric(8,2) not null default 1 check(weekly_off_event_comp_off between 0 and 5),
  holiday_event_comp_off numeric(8,2) not null default 1 check(holiday_event_comp_off between 0 and 5),
  extended_event_duty_enabled boolean not null default true,
  extended_event_threshold_hours numeric(8,2) not null default 16 check(extended_event_threshold_hours between 1 and 48),
  additional_extended_duty_comp_off numeric(8,2) not null default 1 check(additional_extended_duty_comp_off between 0 and 5),
  maximum_comp_off_per_event numeric(8,2) not null default 2 check(maximum_comp_off_per_event between 0.5 and 5),
  auto_approve_comp_off boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.event_attendance_policy(singleton) values(true) on conflict do nothing;

create or replace function public.evaluate_event_comp_off(p_event_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event public.events%rowtype;v_checkin public.event_checkins%rowtype;
  v_policy public.event_attendance_policy%rowtype;v_calendar jsonb;v_base numeric:=0;
  v_units numeric:=0;v_hours numeric:=null;v_reason text;v_earning public.comp_off_earnings%rowtype;v_tx uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('event-comp-off:'||p_event_id||':'||p_user_id,0));
  select * into v_event from public.events where id=p_event_id;
  select * into v_checkin from public.event_checkins where event_id=p_event_id and user_id=p_user_id for update;
  select * into v_policy from public.event_attendance_policy where singleton=true;
  if v_event.id is null or v_checkin.id is null or not coalesce(v_event.comp_off_enabled,false) then
    return jsonb_build_object('eligible',false,'days',0,'credited',false);
  end if;
  v_calendar:=public.resolve_hrms_calendar_day(p_user_id,v_event.event_date);
  if v_calendar->>'kind'='WEEKLY_OFF' then v_base:=v_policy.weekly_off_event_comp_off;
  elsif v_calendar->>'kind'='HOLIDAY' then v_base:=v_policy.holiday_event_comp_off;
  else
    insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
    values(v_event.created_by,p_user_id,'COMP_OFF_REJECTED','event',p_event_id,
      jsonb_build_object('reason','WORKING_DAY','calendar_kind',v_calendar->>'kind'),'EVENT_ENGINE');
    return jsonb_build_object('eligible',false,'days',0,'credited',false,'calendar_kind',v_calendar->>'kind');
  end if;
  if coalesce(v_checkin.approved_duty_end_time,v_checkin.travel_end_time,v_checkin.checkout_time) is not null then
    v_hours:=extract(epoch from (coalesce(v_checkin.approved_duty_end_time,v_checkin.travel_end_time,v_checkin.checkout_time)-
      coalesce(v_checkin.approved_duty_start_time,v_checkin.travel_start_time,v_checkin.checkin_time)))/3600.0;
  end if;
  v_units:=v_base+case when v_policy.extended_event_duty_enabled and v_hours>=v_policy.extended_event_threshold_hours
    then v_policy.additional_extended_duty_comp_off else 0 end;
  v_units:=least(v_units,v_policy.maximum_comp_off_per_event);
  v_reason:='Company Event - '||case when v_calendar->>'kind'='WEEKLY_OFF' then 'Weekly Off' else 'Holiday' end||
    case when v_units>v_base then ' + Extended Duty' else '' end;
  update public.event_checkins set comp_off_eligible_days=v_units where id=v_checkin.id;

  select * into v_earning from public.comp_off_earnings
    where user_id=p_user_id and eligible_work_date=v_event.event_date
      and source_type='EVENT_ATTENDANCE' and source_id=p_event_id for update;
  if not found then
    insert into public.comp_off_earnings(user_id,eligible_work_date,units,remaining_units,
      source_type,source_id,reason,status,created_by)
    values(p_user_id,v_event.event_date,v_units,v_units,'EVENT_ATTENDANCE',p_event_id,v_reason,'PENDING',v_event.created_by)
    returning * into v_earning;
  elsif v_earning.status='PENDING' then
    update public.comp_off_earnings set units=v_units,remaining_units=v_units,reason=v_reason,updated_at=now()
      where id=v_earning.id returning * into v_earning;
  end if;
  if v_policy.auto_approve_comp_off and v_earning.status='PENDING' then
    v_tx:=public.apply_leave_transaction(p_user_id,'COMP_OFF','COMP_OFF_EARNING',v_earning.units,
      v_event.event_date,null,'EVENT_ATTENDANCE',p_event_id,v_reason,v_event.created_by,
      'comp-off-earning:'||v_earning.id);
    update public.comp_off_earnings set status='APPROVED',approved_by=v_event.created_by,
      approved_at=now(),credited_transaction_id=v_tx,updated_at=now() where id=v_earning.id returning * into v_earning;
  end if;
  insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
  values(v_event.created_by,p_user_id,'COMP_OFF_EARNED','comp_off_earning',v_earning.id,
    jsonb_build_object('event_id',p_event_id,'days',v_units,'reason',v_reason,'status',v_earning.status),'EVENT_ENGINE');
  return jsonb_build_object('eligible',true,'days',v_units,'credited',v_earning.status='APPROVED',
    'status',v_earning.status,'earning_id',v_earning.id,'reason',v_reason,'duty_hours',v_hours);
end $$;
revoke all on function public.evaluate_event_comp_off(uuid,uuid) from public,anon,authenticated;

create or replace function public.sync_event_checkin_to_attendance()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event public.events%rowtype;v_attendance public.attendance_logs%rowtype;
  v_lat double precision;v_lon double precision;
begin
  select * into v_event from public.events where id=new.event_id;
  if not found then return new; end if;
  v_lat:=nullif(new.checkin_location->>'latitude','')::double precision;
  v_lon:=nullif(new.checkin_location->>'longitude','')::double precision;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text||':'||v_event.event_date::text,0));
  select * into v_attendance from public.attendance_logs
    where user_id=new.user_id and date=v_event.event_date order by checkin_time nulls last limit 1 for update;
  if found then
    update public.attendance_logs set
      checkin_time=coalesce(checkin_time,new.checkin_time),
      attendance_type=case when checkin_time is null then 'EVENT' else attendance_type end,
      checkin_source=case when checkin_time is null then 'EVENT' else checkin_source end,
      checkin_status=case when checkin_time is null then 'EVENT' else checkin_status end,
      checkin_location=case when checkin_time is null then new.checkin_location else checkin_location end,
      checkin_latitude=case when checkin_time is null then v_lat else checkin_latitude end,
      checkin_longitude=case when checkin_time is null then v_lon else checkin_longitude end,
      checkin_location_name=case when checkin_time is null then v_event.address else checkin_location_name end,
      checkin_distance_meters=case when checkin_time is null then new.distance_metres else checkin_distance_meters end,
      attendance_context='EVENT',event_id=new.event_id,context_location_name=v_event.address,
      context_started_at=new.checkin_time,attendance_state='AT_EVENT',attendance_status='PRESENT',
      day_status='P',is_off_day_work=(public.resolve_hrms_calendar_day(new.user_id,v_event.event_date)->>'kind' in ('WEEKLY_OFF','HOLIDAY')),
      status=case when checkout_time is null then 'CHECKED_IN' else status end,updated_at=now()
    where id=v_attendance.id;
  else
    insert into public.attendance_logs(user_id,date,attendance_type,attendance_status,day_status,is_off_day_work,
      checkin_time,checkin_source,checkin_status,checkin_location,checkin_latitude,checkin_longitude,
      checkin_location_name,checkin_distance_meters,status,attendance_state,attendance_context,event_id,
      context_location_name,context_started_at,auto_checkout,notes)
    values(new.user_id,v_event.event_date,'EVENT','PRESENT','P',
      public.resolve_hrms_calendar_day(new.user_id,v_event.event_date)->>'kind' in ('WEEKLY_OFF','HOLIDAY'),
      new.checkin_time,'EVENT','EVENT',new.checkin_location,v_lat,v_lon,v_event.address,new.distance_metres,
      'CHECKED_IN','AT_EVENT','EVENT',new.event_id,v_event.address,new.checkin_time,false,
      'Event attendance: '||v_event.title||'.');
  end if;
  return new;
end $$;

create or replace function public.rpc_event_check_in_v2(p_event_id uuid,p_location jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_event public.events%rowtype;v_existing public.event_checkins%rowtype;
  v_now timestamptz:=clock_timestamp();v_today date:=(v_now at time zone 'Asia/Kolkata')::date;
  v_lat double precision;v_lon double precision;v_accuracy double precision;v_captured timestamptz;
  v_distance integer;v_start timestamptz;v_late integer;v_status text;v_comp jsonb;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  select * into v_event from public.events where id=p_event_id and status='ACTIVE';
  if not found then raise exception 'EVENT_NOT_ACTIVE'; end if;
  if not exists(select 1 from public.event_participants where event_id=p_event_id and employee_id=v_uid) then
    insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
    values(v_uid,v_uid,'EVENT_CHECKIN_REJECTED','event',p_event_id,jsonb_build_object('reason','NOT_ASSIGNED'),'EVENT_ENGINE');
    return jsonb_build_object('success',false,'error','EVENT_NOT_ASSIGNED_TO_EMPLOYEE',
      'message','This event is not assigned to you.');
  end if;
  select * into v_existing from public.event_checkins where event_id=p_event_id and user_id=v_uid;
  if found then return jsonb_build_object('success',true,'already_checked_in',true,
    'checkin_time',v_existing.checkin_time,'distance_metres',v_existing.distance_metres,
    'arrival_status',v_existing.arrival_status,'late_minutes',v_existing.late_minutes,
    'comp_off_eligible_days',v_existing.comp_off_eligible_days,'message','You are already checked in to this event.'); end if;
  if v_event.event_date<>v_today then raise exception 'EVENT_CHECKIN_OUTSIDE_EVENT_DATE'; end if;
  begin
    v_lat:=(p_location->>'latitude')::double precision;v_lon:=(p_location->>'longitude')::double precision;
    v_accuracy:=(p_location->>'accuracy')::double precision;
    v_captured:=coalesce(p_location->>'captured_at',p_location->>'capturedAt')::timestamptz;
  exception when others then raise exception 'VALID_PRECISE_LOCATION_REQUIRED'; end;
  if v_lat not between -90 and 90 or v_lon not between -180 and 180
    or v_accuracy is null or v_accuracy<0 or v_accuracy>100 then raise exception 'GPS_ACCURACY_NOT_ACCEPTABLE'; end if;
  if v_captured<v_now-interval '120 seconds' or v_captured>v_now+interval '10 seconds' then raise exception 'STALE_LOCATION_EVIDENCE'; end if;
  if coalesce((p_location->>'mocked')::boolean,false) then raise exception 'MOCK_LOCATION_DETECTED'; end if;
  v_distance:=round(public.event_distance_metres(v_event.latitude,v_event.longitude,v_lat,v_lon));
  if v_distance>v_event.checkin_radius_m then
    insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
    values(v_uid,v_uid,'EVENT_CHECKIN_REJECTED','event',p_event_id,
      jsonb_build_object('reason','OUTSIDE_GEOFENCE','distance_metres',v_distance,'radius_metres',v_event.checkin_radius_m),'EVENT_ENGINE');
    return jsonb_build_object('success',false,'distance_metres',v_distance,
      'message','You are outside the event geofence. Move within '||v_event.checkin_radius_m||'m and try again.');
  end if;
  v_start:=((v_event.event_date+v_event.start_time) at time zone 'Asia/Kolkata');
  v_late:=greatest(0,floor(extract(epoch from (v_now-(v_start+make_interval(mins=>v_event.event_late_grace_minutes))))/60)::integer);
  v_status:=case when v_now<=v_start+make_interval(mins=>v_event.event_late_grace_minutes) then 'ON_TIME' else 'LATE' end;
  insert into public.event_checkins(event_id,user_id,checkin_time,checkin_location,distance_metres,
    arrival_status,late_minutes,gps_accuracy_metres,location_captured_at)
  values(p_event_id,v_uid,v_now,jsonb_build_object('latitude',v_lat,'longitude',v_lon,'accuracy',v_accuracy,
    'captured_at',v_captured,'provider',left(coalesce(p_location->>'provider','unknown'),80)),v_distance,
    v_status,v_late,v_accuracy,v_captured)
  on conflict(event_id,user_id) do nothing returning * into v_existing;
  if v_existing.id is null then select * into v_existing from public.event_checkins where event_id=p_event_id and user_id=v_uid; end if;
  v_comp:=public.evaluate_event_comp_off(p_event_id,v_uid);
  insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
  values(v_uid,v_uid,'EVENT_CHECKIN_SUCCESS','event_checkin',v_existing.id,
    jsonb_build_object('event_id',p_event_id,'arrival_status',v_status,'late_minutes',v_late,'distance_metres',v_distance),'EVENT_ENGINE');
  insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
  values(v_uid,v_uid,'EVENT_LATE_CALCULATION','event_checkin',v_existing.id,
    jsonb_build_object('event_start',v_start,'grace_minutes',v_event.event_late_grace_minutes,
      'arrival_time',v_now,'arrival_status',v_status,'late_minutes',v_late),'EVENT_ENGINE');
  return jsonb_build_object('success',true,'already_checked_in',false,'checkin_time',v_now,
    'distance_metres',v_distance,'arrival_status',v_status,'late_minutes',v_late,
    'comp_off_credited',coalesce((v_comp->>'credited')::boolean,false),
    'comp_off_eligible_days',coalesce((v_comp->>'days')::numeric,0),'message','Event check-in completed.');
exception when unique_violation then
  select * into v_existing from public.event_checkins where event_id=p_event_id and user_id=v_uid;
  return jsonb_build_object('success',true,'already_checked_in',true,'checkin_time',v_existing.checkin_time,
    'distance_metres',v_existing.distance_metres,'arrival_status',v_existing.arrival_status,
    'late_minutes',v_existing.late_minutes,'comp_off_eligible_days',v_existing.comp_off_eligible_days,
    'message','You are already checked in to this event.');
end $$;

create or replace function public.rpc_event_check_out_v2(p_event_id uuid,p_location jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_event public.events%rowtype;v_checkin public.event_checkins%rowtype;
  v_now timestamptz:=clock_timestamp();v_lat double precision;v_lon double precision;v_accuracy double precision;
  v_captured timestamptz;v_distance integer;v_comp jsonb;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  select * into v_event from public.events where id=p_event_id;
  select * into v_checkin from public.event_checkins where event_id=p_event_id and user_id=v_uid for update;
  if v_event.id is null or v_checkin.id is null then raise exception 'EVENT_CHECKIN_REQUIRED'; end if;
  if v_checkin.checkout_time is not null then return jsonb_build_object('success',true,'already_checked_out',true,
    'checkout_time',v_checkin.checkout_time,'distance_metres',v_checkin.checkout_distance_metres,
    'message','You are already checked out from this event.'); end if;
  begin
    v_lat:=(p_location->>'latitude')::double precision;v_lon:=(p_location->>'longitude')::double precision;
    v_accuracy:=(p_location->>'accuracy')::double precision;
    v_captured:=coalesce(p_location->>'captured_at',p_location->>'capturedAt')::timestamptz;
  exception when others then raise exception 'VALID_PRECISE_LOCATION_REQUIRED'; end;
  if v_accuracy is null or v_accuracy<0 or v_accuracy>100 then raise exception 'GPS_ACCURACY_NOT_ACCEPTABLE'; end if;
  if v_captured<v_now-interval '120 seconds' or v_captured>v_now+interval '10 seconds' then raise exception 'STALE_LOCATION_EVIDENCE'; end if;
  if coalesce((p_location->>'mocked')::boolean,false) then raise exception 'MOCK_LOCATION_DETECTED'; end if;
  v_distance:=round(public.event_distance_metres(v_event.latitude,v_event.longitude,v_lat,v_lon));
  if v_distance>v_event.checkin_radius_m then raise exception 'OUTSIDE_EVENT_GEOFENCE'; end if;
  update public.event_checkins set checkout_time=v_now,
    checkout_location=jsonb_build_object('latitude',v_lat,'longitude',v_lon,'accuracy',v_accuracy,'captured_at',v_captured),
    checkout_distance_metres=v_distance where id=v_checkin.id;
  v_comp:=public.evaluate_event_comp_off(p_event_id,v_uid);
  insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
  values(v_uid,v_uid,'EVENT_CHECKOUT_SUCCESS','event_checkin',v_checkin.id,
    jsonb_build_object('event_id',p_event_id,'distance_metres',v_distance),'EVENT_ENGINE');
  return jsonb_build_object('success',true,'already_checked_out',false,'checkout_time',v_now,
    'distance_metres',v_distance,'comp_off_eligible_days',coalesce((v_comp->>'days')::numeric,0),
    'message','Event check-out completed.');
end $$;

create or replace function public.rpc_admin_set_event_duty_times(
  p_event_id uuid,p_user_id uuid,p_duty_start timestamptz,p_duty_end timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform public.require_profile_admin();
  if p_duty_start is null or p_duty_end is null or p_duty_end<=p_duty_start
     or p_duty_end-p_duty_start>interval '48 hours' then raise exception 'INVALID_EVENT_DUTY_PERIOD'; end if;
  update public.event_checkins set approved_duty_start_time=p_duty_start,approved_duty_end_time=p_duty_end,
    duty_times_approved_by=auth.uid() where event_id=p_event_id and user_id=p_user_id;
  if not found then raise exception 'EVENT_ATTENDANCE_NOT_FOUND'; end if;
  v_result:=public.evaluate_event_comp_off(p_event_id,p_user_id);
  return jsonb_build_object('success',true,'comp_off',v_result);
end $$;

-- ---------------------------------------------------------------------------
-- Direct-to-site field visit: server geofence + atomic daily attendance link
-- ---------------------------------------------------------------------------
create or replace function public.sync_field_visit_arrival_attendance(p_visit_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_visit public.field_visits%rowtype;v_attendance public.attendance_logs%rowtype;
  v_lat double precision;v_lon double precision;v_distance integer;
begin
  select * into v_visit from public.field_visits where id=p_visit_id;
  if not found or v_visit.checkin_time is null then raise exception 'FIELD_VISIT_ARRIVAL_REQUIRED'; end if;
  v_lat:=nullif(v_visit.checkin_location->>'latitude','')::double precision;
  v_lon:=nullif(v_visit.checkin_location->>'longitude','')::double precision;
  v_distance:=round(coalesce(v_visit.arrival_distance_metres,
    nullif(v_visit.checkin_location->>'distance_metres','')::double precision,0));
  perform pg_advisory_xact_lock(hashtextextended(v_visit.user_id::text||':'||v_visit.date::text,0));
  select * into v_attendance from public.attendance_logs
    where user_id=v_visit.user_id and date=v_visit.date order by checkin_time nulls last limit 1 for update;
  if found then
    update public.attendance_logs set
      checkin_time=coalesce(checkin_time,v_visit.checkin_time),
      attendance_type=case when checkin_time is null then 'FIELD_VISIT' else attendance_type end,
      checkin_source=case when checkin_time is null then 'FIELD_VISIT' else checkin_source end,
      checkin_status=case when checkin_time is null then 'FIELD_VISIT' else checkin_status end,
      checkin_location=case when checkin_time is null then v_visit.checkin_location else checkin_location end,
      checkin_latitude=case when checkin_time is null then v_lat else checkin_latitude end,
      checkin_longitude=case when checkin_time is null then v_lon else checkin_longitude end,
      checkin_location_name=case when checkin_time is null then coalesce(v_visit.project_name,v_visit.location_name) else checkin_location_name end,
      checkin_distance_meters=case when checkin_time is null then v_distance else checkin_distance_meters end,
      attendance_context='FIELD_VISIT',field_visit_id=v_visit.id,
      context_location_name=coalesce(v_visit.project_name,v_visit.location_name),context_started_at=v_visit.checkin_time,
      attendance_state='ON_FIELD_VISIT',attendance_status='PRESENT',day_status='P',
      status=case when checkout_time is null then 'CHECKED_IN' else status end,updated_at=now()
    where id=v_attendance.id returning * into v_attendance;
  else
    insert into public.attendance_logs(user_id,date,attendance_type,attendance_status,day_status,
      checkin_time,checkin_source,checkin_status,checkin_location,checkin_latitude,checkin_longitude,
      checkin_location_name,checkin_distance_meters,status,attendance_state,attendance_context,
      field_visit_id,context_location_name,context_started_at,auto_checkout,notes)
    values(v_visit.user_id,v_visit.date,'FIELD_VISIT','PRESENT','P',v_visit.checkin_time,
      'FIELD_VISIT','FIELD_VISIT',v_visit.checkin_location,v_lat,v_lon,
      coalesce(v_visit.project_name,v_visit.location_name),v_distance,'CHECKED_IN','ON_FIELD_VISIT',
      'FIELD_VISIT',v_visit.id,coalesce(v_visit.project_name,v_visit.location_name),v_visit.checkin_time,false,
      'Direct field visit attendance: '||v_visit.location_name||'.') returning * into v_attendance;
  end if;
  return v_attendance.id;
exception when unique_violation then
  select * into v_attendance from public.attendance_logs where user_id=v_visit.user_id and date=v_visit.date limit 1;
  update public.attendance_logs set attendance_context='FIELD_VISIT',field_visit_id=v_visit.id,
    context_location_name=coalesce(v_visit.project_name,v_visit.location_name),context_started_at=v_visit.checkin_time,
    attendance_state='ON_FIELD_VISIT',updated_at=now() where id=v_attendance.id;
  return v_attendance.id;
end $$;
revoke all on function public.sync_field_visit_arrival_attendance(uuid) from public,anon,authenticated;

create or replace function public.rpc_mutate_own_field_visit(
  p_action text,p_visit_id uuid default null,p_values jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v_now timestamptz:=clock_timestamp();v_action text:=upper(btrim(coalesce(p_action,'')));
  v_row public.field_visits%rowtype;v_attendance public.attendance_logs%rowtype;v_site public.predefined_sites%rowtype;
  v_lat double precision:=nullif(p_values->>'latitude','')::double precision;
  v_lon double precision:=nullif(p_values->>'longitude','')::double precision;
  v_accuracy double precision:=nullif(p_values->>'accuracy','')::double precision;
  v_captured timestamptz:=nullif(coalesce(p_values->>'captured_at',p_values->>'capturedAt'),'')::timestamptz;
  v_dest_lat double precision:=nullif(p_values->'destination_coords'->>'latitude','')::double precision;
  v_dest_lon double precision:=nullif(p_values->'destination_coords'->>'longitude','')::double precision;
  v_key text:=nullif(btrim(p_values->>'idempotency_key'),'');v_radius integer;v_distance double precision;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'EMPLOYEE_INACTIVE'; end if;
  if v_action not in ('CREATE','CHECK_IN','CHECK_OUT','MARK_MISSED') then raise exception 'INVALID_FIELD_VISIT_ACTION'; end if;
  if v_action='CREATE' then
    if nullif(btrim(p_values->>'location_name'),'') is null then raise exception 'LOCATION_NAME_REQUIRED'; end if;
    if coalesce(p_values->>'visit_type','') not in ('site','meeting','office','others') then raise exception 'INVALID_VISIT_TYPE'; end if;
    if v_dest_lat is null or v_dest_lat not between -90 and 90 or v_dest_lon is null or v_dest_lon not between -180 and 180 then
      raise exception 'VALID_DESTINATION_COORDINATES_REQUIRED'; end if;
    if v_key is not null then
      select * into v_row from public.field_visits where user_id=v_uid and idempotency_key=v_key;
      if found then return jsonb_build_object('success',true,'idempotent',true,'visit',to_jsonb(v_row)); end if;
    end if;
    insert into public.field_visits(user_id,visit_type,location_name,status,date,activity_log_id,
      predefined_site_id,location_address,destination_coords,checkin_radius_m,meeting_type,contact_name,
      contact_phone,company_name,project_name,notes,origin_lat,origin_lon,origin_name,visit_state,
      google_place_id,location_source,arrival_radius_m,employee_notes,evidence_photo_path,
      evidence_file_hash,idempotency_key,journey_status)
    values(v_uid,p_values->>'visit_type',btrim(p_values->>'location_name'),'PENDING',v_today,
      nullif(p_values->>'activity_log_id','')::uuid,nullif(p_values->>'predefined_site_id','')::uuid,
      nullif(btrim(p_values->>'location_address'),''),p_values->'destination_coords',
      greatest(25,least(coalesce(nullif(p_values->>'checkin_radius_m','')::integer,100),1000)),
      nullif(p_values->>'meeting_type',''),nullif(btrim(p_values->>'contact_name'),''),
      nullif(btrim(p_values->>'contact_phone'),''),nullif(btrim(p_values->>'company_name'),''),
      nullif(btrim(p_values->>'project_name'),''),nullif(btrim(p_values->>'notes'),''),
      nullif(p_values->>'origin_lat','')::double precision,nullif(p_values->>'origin_lon','')::double precision,
      nullif(btrim(p_values->>'origin_name'),''),'TRAVELLING',nullif(p_values->>'google_place_id',''),
      coalesce(nullif(p_values->>'location_source',''),case when nullif(p_values->>'predefined_site_id','') is not null then 'PREDEFINED_SITE' else 'MAP_PIN' end),
      greatest(25,least(coalesce(nullif(p_values->>'checkin_radius_m','')::integer,100),1000)),
      nullif(btrim(p_values->>'employee_notes'),''),nullif(p_values->>'evidence_photo_path',''),
      nullif(p_values->>'evidence_file_hash',''),v_key,'TRAVELLING') returning * into v_row;
    update public.attendance_logs set attendance_state='ON_FIELD_VISIT',updated_at=now()
      where user_id=v_uid and date=v_today and checkin_time is not null and checkout_time is null;
    insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
    values(v_uid,v_uid,'FIELD_VISIT_STARTED','field_visit',v_row.id,
      jsonb_build_object('destination',v_row.destination_coords,'started_without_office_attendance',
        not exists(select 1 from public.attendance_logs where user_id=v_uid and date=v_today and checkin_time is not null)),'APP');
  else
    if p_visit_id is null then raise exception 'VISIT_ID_REQUIRED'; end if;
    select * into v_row from public.field_visits where id=p_visit_id and user_id=v_uid for update;
    if not found then raise exception 'FIELD_VISIT_NOT_FOUND'; end if;
    if v_action='CHECK_IN' then
      if v_row.status='CHECKED_IN' and v_row.checkin_time is not null then
        perform public.sync_field_visit_arrival_attendance(v_row.id);
        return jsonb_build_object('success',true,'idempotent',true,'visit',to_jsonb(v_row));
      end if;
      if v_row.date<>v_today or v_row.status not in ('PENDING','IN_TRANSIT')
         or v_row.visit_state='CANCELLED' then raise exception 'FIELD_VISIT_CHECKIN_NOT_ALLOWED'; end if;
      if v_lat is null or v_lat not between -90 and 90 or v_lon is null or v_lon not between -180 and 180 then
        raise exception 'VALID_LOCATION_REQUIRED'; end if;
      if v_accuracy is null or v_accuracy<0 or v_accuracy>100 then raise exception 'GPS_ACCURACY_NOT_ACCEPTABLE'; end if;
      if v_captured is null or v_captured<v_now-interval '120 seconds' or v_captured>v_now+interval '10 seconds' then
        raise exception 'STALE_LOCATION_EVIDENCE'; end if;
      if coalesce((p_values->>'mocked')::boolean,false) then raise exception 'MOCK_LOCATION_DETECTED'; end if;
      if v_row.predefined_site_id is not null then
        select * into v_site from public.predefined_sites where id=v_row.predefined_site_id and is_active;
        if not found then raise exception 'SELECTED_SITE_NOT_ACTIVE'; end if;
        v_dest_lat:=v_site.latitude;v_dest_lon:=v_site.longitude;v_radius:=v_site.checkin_radius_m;
      else
        v_dest_lat:=nullif(v_row.destination_coords->>'latitude','')::double precision;
        v_dest_lon:=nullif(v_row.destination_coords->>'longitude','')::double precision;
        v_radius:=coalesce(v_row.checkin_radius_m,v_row.arrival_radius_m,100);
      end if;
      if v_dest_lat is null or v_dest_lon is null or v_radius is null or v_radius<10 then raise exception 'VISIT_DESTINATION_NOT_CONFIGURED'; end if;
      v_distance:=public.field_visit_distance_metres(v_dest_lat,v_dest_lon,v_lat,v_lon);
      insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
      values(v_uid,v_uid,'FIELD_VISIT_CHECKIN_ATTEMPT','field_visit',v_row.id,
        jsonb_build_object('distance_metres',round(v_distance),'radius_metres',v_radius,'accuracy_metres',v_accuracy),'FIELD_VISIT_ENGINE');
      if v_distance>v_radius then
        insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
        values(v_uid,v_uid,'FIELD_VISIT_CHECKIN_REJECTED','field_visit',v_row.id,
          jsonb_build_object('reason','OUTSIDE_GEOFENCE','distance_metres',round(v_distance),'radius_metres',v_radius),'FIELD_VISIT_ENGINE');
        return jsonb_build_object('success',false,'error','OUTSIDE_FIELD_VISIT_GEOFENCE',
          'message','You are outside the field visit geofence. Move within '||v_radius||'m and try again.',
          'distance_metres',round(v_distance),'radius_metres',v_radius);
      end if;
      update public.field_visits set checkin_time=v_now,
        checkin_location=jsonb_build_object('latitude',v_lat,'longitude',v_lon,'accuracy',v_accuracy,
          'captured_at',v_captured,'provider',left(coalesce(p_values->>'provider','unknown'),80),'distance_metres',v_distance),
        arrival_latitude=v_lat,arrival_longitude=v_lon,arrival_accuracy_metres=v_accuracy,
        arrival_distance_metres=v_distance,status='CHECKED_IN',visit_state='ARRIVED',arrived_at=v_now,journey_status='ARRIVED'
      where id=p_visit_id returning * into v_row;
      perform public.sync_field_visit_arrival_attendance(v_row.id);
      insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
      values(v_uid,v_uid,'FIELD_VISIT_CHECKIN_SUCCESS','field_visit',v_row.id,
        jsonb_build_object('arrived_at',v_now,'distance_metres',round(v_distance)),'FIELD_VISIT_ENGINE');
    elsif v_action='CHECK_OUT' then
      if v_row.status<>'CHECKED_IN' or v_row.checkout_time is not null then raise exception 'FIELD_VISIT_CHECKOUT_NOT_ALLOWED'; end if;
      if v_lat is null or v_lat not between -90 and 90 or v_lon is null or v_lon not between -180 and 180 then raise exception 'VALID_LOCATION_REQUIRED'; end if;
      update public.field_visits set checkout_time=v_now,checkout_location=jsonb_build_object('latitude',v_lat,'longitude',v_lon),
        checkout_notes=nullif(btrim(p_values->>'notes'),''),checkout_office_id=nullif(p_values->>'nearest_office_id','')::uuid,
        status='COMPLETED',visit_state='COMPLETED',journey_status='COMPLETED' where id=p_visit_id returning * into v_row;
      if not exists(select 1 from public.field_visits where user_id=v_uid and date=v_today and id<>p_visit_id
        and visit_state in ('TRAVELLING','ARRIVED','IN_PROGRESS')) then
        update public.attendance_logs set attendance_state='WORKING',updated_at=now()
          where user_id=v_uid and date=v_today and checkout_time is null;
      end if;
    else
      if v_row.status not in ('PENDING','IN_TRANSIT') then raise exception 'FIELD_VISIT_CANCEL_NOT_ALLOWED'; end if;
      update public.field_visits set status='MISSED',visit_state='CANCELLED',journey_status='CANCELLED'
        where id=p_visit_id returning * into v_row;
    end if;
  end if;
  return jsonb_build_object('success',true,'visit',to_jsonb(v_row));
end $$;

create or replace function public.check_in_field_visit_at_selected_site(
  p_visit_id uuid,p_latitude double precision,p_longitude double precision,p_accuracy_metres double precision,
  p_captured_at timestamptz,p_location_provider text,p_mocked_location boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_visit jsonb;
begin
  v_result:=public.rpc_mutate_own_field_visit('CHECK_IN',p_visit_id,jsonb_build_object(
    'latitude',p_latitude,'longitude',p_longitude,'accuracy',p_accuracy_metres,'captured_at',p_captured_at,
    'provider',p_location_provider,'mocked',coalesce(p_mocked_location,false)));
  v_visit:=v_result->'visit';
  return jsonb_build_object('success',v_result->'success','idempotent',coalesce(v_result->'idempotent','false'::jsonb),
    'visit_id',v_visit->>'id','status',v_visit->>'status','visit_state',v_visit->>'visit_state',
    'checkin_time',v_visit->>'checkin_time','distance_metres',v_visit->>'arrival_distance_metres',
    'accuracy_metres',v_visit->>'arrival_accuracy_metres','message',v_result->>'message');
end $$;

-- ---------------------------------------------------------------------------
-- Push-token lifecycle and attendance reminder state machine
-- ---------------------------------------------------------------------------
create or replace function public.rpc_register_device_push_token(
  p_token text,p_platform text,p_device_id text,p_app_version text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if nullif(btrim(p_token),'') is null or p_platform not in ('android','ios')
     or nullif(btrim(p_device_id),'') is null then raise exception 'INVALID_PUSH_TOKEN'; end if;
  update public.device_push_tokens set active=false,updated_at=now()
    where (user_id=auth.uid() and device_id=p_device_id and token<>p_token)
       or (token=p_token and user_id<>auth.uid());
  insert into public.device_push_tokens(user_id,token,platform,device_id,app_version,active,updated_at,last_used_at)
  values(auth.uid(),p_token,p_platform,p_device_id,nullif(btrim(p_app_version),''),true,now(),now())
  on conflict(user_id,token) do update set platform=excluded.platform,device_id=excluded.device_id,
    app_version=excluded.app_version,active=true,updated_at=now(),last_used_at=now()
  returning id into v_id;
  return jsonb_build_object('success',true,'id',v_id);
end $$;

create or replace function public.rpc_deactivate_device_push_token(p_device_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  update public.device_push_tokens set active=false,updated_at=now()
    where user_id=auth.uid() and device_id=p_device_id and active;
  get diagnostics v_count=row_count;
  return jsonb_build_object('success',true,'deactivated',v_count);
end $$;

create or replace function public.hrms_attendance_state(p_user_id uuid,p_date date)
returns text language sql stable security definer set search_path=public,pg_temp as $$
  select case
    when exists(select 1 from public.attendance_logs a where a.user_id=p_user_id and a.date=p_date
      and a.checkin_time is not null and a.checkout_time is not null and a.deleted_at is null) then 'CHECKED_OUT'
    when exists(select 1 from public.event_checkins c join public.events e on e.id=c.event_id
      where c.user_id=p_user_id and e.event_date=p_date and c.checkin_time is not null and c.checkout_time is null) then 'AT_EVENT'
    when exists(select 1 from public.field_visits v where v.user_id=p_user_id and v.date=p_date
      and v.status='CHECKED_IN' and v.checkout_time is null) then 'ON_FIELD_VISIT'
    when exists(select 1 from public.attendance_logs a where a.user_id=p_user_id and a.date=p_date
      and a.checkin_time is not null and a.checkout_time is null and a.deleted_at is null) then 'CHECKED_IN'
    else 'NOT_CHECKED_IN' end
$$;

create or replace function public.process_attendance_reminder_notifications()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamp:=now() at time zone 'Asia/Kolkata';v_today date:=v_now::date;
  candidate record;v_state text;v_checkin integer:=0;v_checkout integer:=0;v_skipped integer:=0;
begin
  for candidate in
    select profile.id user_id,policy.checkin_reminder_time,policy.checkout_reminder_time
    from public.profiles profile join public.attendance_policies policy
      on policy.office_id=profile.office_id and policy.role='all' and policy.is_active
    where profile.is_active and not coalesce(profile.is_service_account,false)
  loop
    v_state:=public.hrms_attendance_state(candidate.user_id,v_today);
    if v_now::time>=candidate.checkin_reminder_time and v_now::time<candidate.checkin_reminder_time+interval '2 minutes' then
      if v_state='NOT_CHECKED_IN' then
        perform public.enqueue_hrms_notification(candidate.user_id,'Attendance check-in reminder',
          'Please mark your attendance according to company policy.','attendance_checkin_reminder',
          'attendance-checkin-reminder:'||candidate.user_id||':'||v_today,'/HRMS/attendance',null,null,
          jsonb_build_object('attendanceDate',v_today,'attendanceState',v_state));v_checkin:=v_checkin+1;
      else
        insert into public.hrms_audit_events(target_user_id,action,entity_type,new_values,source)
        values(candidate.user_id,'ATTENDANCE_REMINDER_SKIPPED_ALREADY_CHECKED_IN','notification',
          jsonb_build_object('date',v_today,'attendance_state',v_state),'NOTIFICATION_ENGINE');v_skipped:=v_skipped+1;
      end if;
    end if;
    if v_now::time>=candidate.checkout_reminder_time and v_now::time<candidate.checkout_reminder_time+interval '2 minutes' then
      if v_state='CHECKED_IN' then
        perform public.enqueue_hrms_notification(candidate.user_id,'Attendance checkout reminder',
          'Remember to check out before leaving.','attendance_checkout_reminder',
          'attendance-checkout-reminder:'||candidate.user_id||':'||v_today,'/HRMS/attendance',null,null,
          jsonb_build_object('attendanceDate',v_today,'attendanceState',v_state));v_checkout:=v_checkout+1;
      else
        insert into public.hrms_audit_events(target_user_id,action,entity_type,new_values,source)
        values(candidate.user_id,'CHECKOUT_REMINDER_SKIPPED_ALREADY_CHECKED_OUT','notification',
          jsonb_build_object('date',v_today,'attendance_state',v_state),'NOTIFICATION_ENGINE');v_skipped:=v_skipped+1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('success',true,'checked_at',now(),'checkin_queued',v_checkin,
    'checkout_queued',v_checkout,'skipped',v_skipped);
end $$;

-- Keep all existing notification rules and append the authoritative attendance
-- reminder pass. This is evaluated immediately before outbox dispatch.
create or replace function public.process_hrms_notification_schedules()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_attendance jsonb;
begin
  update public.field_visits set overdue_notified_at=coalesce(overdue_notified_at,now())
    where date<(now() at time zone 'Asia/Kolkata')::date and status in ('PENDING','IN_TRANSIT');
  v_result:=public.process_hrms_notification_schedules_v1();
  v_attendance:=public.process_attendance_reminder_notifications();
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
    'historical_field_visit_catchup_suppressed',true,'attendance_reminders',v_attendance);
end $$;

-- Employee calendar details expose the active work context while keeping the
-- original first-in source (for example BIOMETRIC) intact.
create or replace function public.rpc_get_my_monthly_attendance_v3(p_month date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_base jsonb;v_record jsonb;v_records jsonb:='[]'::jsonb;
  v_date date;v_attendance public.attendance_logs%rowtype;v_event record;v_visit record;
  v_comp_days numeric;v_comp_name text;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  v_base:=public.rpc_get_my_monthly_attendance_v2(p_month);
  if not coalesce((v_base->>'success')::boolean,false) or jsonb_typeof(v_base->'records')<>'array' then
    raise exception 'MONTHLY_ATTENDANCE_NOT_CONFIRMED'; end if;
  for v_record in select item.value from jsonb_array_elements(v_base->'records') item(value) loop
    v_date:=(v_record->>'date')::date;
    select * into v_attendance from public.attendance_logs where user_id=v_uid and date=v_date
      order by created_at limit 1;
    select event.id,event.title,event.address,checkin.arrival_status,checkin.late_minutes,
      checkin.checkin_time,checkin.checkout_time,checkin.comp_off_eligible_days
      into v_event from public.event_checkins checkin join public.events event on event.id=checkin.event_id
      where checkin.user_id=v_uid and event.event_date=v_date order by checkin.checkin_time limit 1;
    select visit.id,coalesce(visit.project_name,visit.location_name) name,visit.location_address,
      visit.checkin_time,visit.checkout_time into v_visit from public.field_visits visit
      where visit.user_id=v_uid and visit.date=v_date and visit.checkin_time is not null
      order by visit.checkin_time desc limit 1;
    select coalesce(sum(earning.units),0),string_agg(distinct event.title,', ' order by event.title)
      into v_comp_days,v_comp_name from public.comp_off_earnings earning
      join public.events event on event.id=earning.source_id
      where earning.user_id=v_uid and earning.eligible_work_date=v_date
        and earning.source_type='EVENT_ATTENDANCE' and earning.status='APPROVED';
    if v_comp_days=0 then
      select coalesce(sum(credit.days),0),string_agg(distinct event.title,', ' order by event.title)
        into v_comp_days,v_comp_name from public.event_comp_off_credits credit
        join public.events event on event.id=credit.event_id
        where credit.user_id=v_uid and event.event_date=v_date;
    end if;
    v_record:=v_record||jsonb_build_object(
      'attendanceContext',coalesce(v_attendance.attendance_context,
        case when v_event.id is not null then 'EVENT' when v_visit.id is not null then 'FIELD_VISIT' end,
        upper(coalesce(v_attendance.attendance_type,v_attendance.checkin_source,'OFFICE'))),
      'contextName',coalesce(v_attendance.context_location_name,v_event.title,v_visit.name,v_attendance.checkin_location_name),
      'eventId',v_event.id,'eventName',v_event.title,'eventLocation',v_event.address,
      'eventArrivalStatus',v_event.arrival_status,'eventLateMinutes',v_event.late_minutes,
      'eventCheckIn',v_event.checkin_time,'eventCheckOut',v_event.checkout_time,
      'fieldVisitName',coalesce(v_record->>'fieldVisitName',v_visit.name),
      'compOffEligible',coalesce(v_event.comp_off_eligible_days,0),
      'compOffEarned',coalesce(v_comp_days,0),'compOffEventName',v_comp_name);
    if v_event.id is not null then
      v_record:=v_record||jsonb_build_object('status',case when v_event.arrival_status='LATE' then 'late' else 'present' end,
        'is_late',v_event.arrival_status='LATE');
    elsif v_comp_days>0 then
      v_record:=v_record||jsonb_build_object('status','compoff','is_late',false);
    end if;
    v_records:=v_records||jsonb_build_array(v_record);
  end loop;
  return jsonb_set(v_base,'{records}',v_records,true)||jsonb_build_object(
    'detail_contract','attendance-day-v7','attendance_context_contract','OFFICE|BIOMETRIC|FIELD_VISIT|EVENT',
    'event_late_source','EVENT_START_PLUS_GRACE','comp_off_source','comp_off_earnings');
end $$;

-- Restrict direct mutations and expose protected RPCs.
alter table public.event_team_assignments enable row level security;
alter table public.event_department_assignments enable row level security;
alter table public.event_employee_assignments enable row level security;
alter table public.event_participants enable row level security;
revoke insert,update,delete on public.event_team_assignments,public.event_department_assignments,
  public.event_employee_assignments,public.event_participants from anon,authenticated;
grant select on public.event_participants to authenticated;
grant select on public.event_team_assignments,public.event_department_assignments,
  public.event_employee_assignments,public.event_admin_summary to authenticated;

drop policy if exists event_participants_self_or_admin_read on public.event_participants;
create policy event_participants_self_or_admin_read on public.event_participants for select to authenticated
  using(employee_id=auth.uid() or public.is_profile_admin());
drop policy if exists event_team_assignments_admin_read on public.event_team_assignments;
create policy event_team_assignments_admin_read on public.event_team_assignments for select to authenticated
  using(public.is_profile_admin());
drop policy if exists event_department_assignments_admin_read on public.event_department_assignments;
create policy event_department_assignments_admin_read on public.event_department_assignments for select to authenticated
  using(public.is_profile_admin());
drop policy if exists event_employee_assignments_admin_read on public.event_employee_assignments;
create policy event_employee_assignments_admin_read on public.event_employee_assignments for select to authenticated
  using(public.is_profile_admin());

revoke all on function public.rpc_admin_event_audience_options(),
  public.rpc_admin_create_event(jsonb,uuid[],uuid[],text[],boolean),
  public.rpc_admin_delete_event(uuid),public.rpc_admin_set_event_duty_times(uuid,uuid,timestamptz,timestamptz),
  public.rpc_event_check_in_v2(uuid,jsonb),public.rpc_event_check_out_v2(uuid,jsonb),
  public.rpc_deactivate_device_push_token(text),public.hrms_attendance_state(uuid,date),
  public.process_attendance_reminder_notifications() from public,anon;
grant execute on function public.rpc_admin_event_audience_options(),
  public.rpc_admin_create_event(jsonb,uuid[],uuid[],text[],boolean),
  public.rpc_admin_delete_event(uuid),public.rpc_admin_set_event_duty_times(uuid,uuid,timestamptz,timestamptz),
  public.rpc_event_check_in_v2(uuid,jsonb),public.rpc_event_check_out_v2(uuid,jsonb),
  public.rpc_deactivate_device_push_token(text) to authenticated;
grant execute on function public.hrms_attendance_state(uuid,date),
  public.process_attendance_reminder_notifications() to service_role;

create or replace function public.rpc_get_release_contract()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$ select jsonb_build_object(
  'backend_schema_version','20260810000000','attendance_timezone','Asia/Kolkata',
  'attendance_context_contract','OFFICE|BIOMETRIC|FIELD_VISIT|EVENT',
  'event_audience_contract','participants_v2|team|department|employee|all',
  'event_comp_off_contract','ledger_v2|weekly_off|holiday|extended_duty',
  'notification_contract','outbox_v2|live_attendance_state|device_lifecycle'
) $$;
revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract() to anon,authenticated,service_role;

notify pgrst, 'reload schema';
