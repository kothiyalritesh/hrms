-- Canonical attendance, IST timestamp repair, team calendar scopes and tracking health.
-- This migration is additive and keeps the previous v2 contracts available during rollout.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Migration evidence and safe legacy timestamp conversion
-- ---------------------------------------------------------------------------
create table if not exists public.hrms_migration_report (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null,
  entity_type text not null,
  entity_id text,
  status text not null check (status in ('MIGRATED','BACKFILLED','SKIPPED','REVIEW_REQUIRED')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(migration_key, entity_type, entity_id)
);

create table if not exists public.hrms_timestamp_backup_20260806 (
  table_name text not null,
  record_id uuid not null,
  column_name text not null,
  original_data_type text not null,
  original_value text,
  backed_up_at timestamptz not null default now(),
  primary key(table_name, record_id, column_name)
);

-- Overloads let reconciliation normalize a legacy IST wall-clock column or an
-- already-correct timestamptz column without shifting the latter a second time.
create or replace function public.hrms_timestamp(p_value timestamp without time zone)
returns timestamptz language sql immutable strict
set search_path = public, pg_temp
as $$ select p_value at time zone 'Asia/Kolkata' $$;

create or replace function public.hrms_timestamp(p_value timestamptz)
returns timestamptz language sql immutable strict
set search_path = public, pg_temp
as $$ select p_value $$;

do $$
declare
  v_table text;
  v_column text;
  v_type text;
begin
  foreach v_table in array array['attendance_logs','field_visits','location_tracking'] loop
    foreach v_column in array array['checkin_time','checkout_time','recorded_at'] loop
      select c.data_type into v_type
      from information_schema.columns c
      where c.table_schema='public' and c.table_name=v_table and c.column_name=v_column;
      if v_type = 'timestamp without time zone' then
        execute format(
          'insert into public.hrms_timestamp_backup_20260806(table_name,record_id,column_name,original_data_type,original_value)
           select %L,id,%L,%L,%I::text from public.%I where %I is not null on conflict do nothing',
          v_table,v_column,v_type,v_column,v_table,v_column
        );
        begin
          execute format(
            'alter table public.%I alter column %I type timestamptz using %I at time zone %L',
            v_table,v_column,v_column,'Asia/Kolkata'
          );
          insert into public.hrms_migration_report(migration_key,entity_type,entity_id,status,detail)
          values('20260806010000','TIMESTAMP_COLUMN',v_table||'.'||v_column,'MIGRATED',
            jsonb_build_object('from',v_type,'to','timestamp with time zone','legacy_zone','Asia/Kolkata'))
          on conflict (migration_key,entity_type,entity_id) do update set status=excluded.status,detail=excluded.detail;
        exception when others then
          insert into public.hrms_migration_report(migration_key,entity_type,entity_id,status,detail)
          values('20260806010000','TIMESTAMP_COLUMN',v_table||'.'||v_column,'REVIEW_REQUIRED',
            jsonb_build_object(
              'reason','COLUMN_CONVERSION_BLOCKED',
              'sqlstate',sqlstate,
              'database_error',sqlerrm,
              'runtime_normalization','hrms_timestamp'
            ))
          on conflict (migration_key,entity_type,entity_id) do update set status=excluded.status,detail=excluded.detail;
        end;
      elsif v_type = 'timestamp with time zone' then
        insert into public.hrms_migration_report(migration_key,entity_type,entity_id,status,detail)
        values('20260806010000','TIMESTAMP_COLUMN',v_table||'.'||v_column,'SKIPPED',
          jsonb_build_object('reason','ALREADY_TIMESTAMPTZ_NO_SHIFT_APPLIED'))
        on conflict (migration_key,entity_type,entity_id) do nothing;
      end if;
    end loop;
  end loop;
end $$;

-- Business dates are always assigned by PostgreSQL in India time.
create or replace function public.set_hrms_business_date()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_event timestamptz;
begin
  v_event := case tg_table_name
    when 'field_visits' then coalesce(public.hrms_timestamp(new.checkin_time), public.hrms_timestamp(new.created_at), now())
    when 'location_tracking' then coalesce(public.hrms_timestamp(new.recorded_at), now())
    else now() end;
  new.date := (v_event at time zone 'Asia/Kolkata')::date;
  return new;
end $$;

drop trigger if exists field_visits_business_date_trg on public.field_visits;
create trigger field_visits_business_date_trg before insert or update of checkin_time
on public.field_visits for each row execute function public.set_hrms_business_date();
drop trigger if exists location_tracking_business_date_trg on public.location_tracking;
create trigger location_tracking_business_date_trg before insert or update of recorded_at
on public.location_tracking for each row execute function public.set_hrms_business_date();

-- ---------------------------------------------------------------------------
-- Teams and scoped calendars
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  office_id uuid references public.offices(id) on delete set null,
  team_head_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists teams_name_ci_uq on public.teams(lower(btrim(name)));

alter table public.profiles
  add column if not exists team_id uuid references public.teams(id) on delete set null,
  add column if not exists show_on_tv boolean not null default true,
  add column if not exists attendance_reporting_enabled boolean not null default true,
  add column if not exists is_service_account boolean not null default false;

insert into public.teams(name)
select distinct btrim(profile.team)
from public.profiles profile
where nullif(btrim(profile.team),'') is not null
on conflict do nothing;

update public.profiles profile set team_id=team.id
from public.teams team
where profile.team_id is null and lower(btrim(profile.team))=lower(btrim(team.name));

alter table public.holiday_calendar
  add column if not exists team_id uuid references public.teams(id) on delete cascade,
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists is_active boolean not null default true;
alter table public.weekly_off_rules
  add column if not exists team_id uuid references public.teams(id) on delete cascade,
  add column if not exists valid_from date not null default current_date,
  add column if not exists valid_to date,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

do $$ declare c record; begin
  for c in select conname from pg_constraint
    where conrelid='public.weekly_off_rules'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%user_id%office_id%'
  loop execute format('alter table public.weekly_off_rules drop constraint %I',c.conname); end loop;
end $$;

alter table public.holiday_calendar drop constraint if exists holiday_calendar_scope_ck;
alter table public.holiday_calendar add constraint holiday_calendar_scope_ck
  check (num_nonnulls(office_id,team_id,user_id) <= 1) not valid;
alter table public.weekly_off_rules drop constraint if exists weekly_off_rules_scope_ck;
alter table public.weekly_off_rules add constraint weekly_off_rules_scope_ck
  check (num_nonnulls(office_id,team_id,user_id) <= 1 and (valid_to is null or valid_to >= valid_from)) not valid;

create unique index if not exists holiday_calendar_scope_uq
  on public.holiday_calendar(holiday_date,
    coalesce(office_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(team_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(user_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists holiday_calendar_date_scope_idx on public.holiday_calendar(holiday_date,team_id,office_id) where is_active;
create index if not exists weekly_off_rules_team_day_idx on public.weekly_off_rules(team_id,weekday,is_active);
create index if not exists profiles_team_office_active_idx on public.profiles(team_id,office_id,is_active);

create or replace function public.resolve_hrms_calendar_day(p_user_id uuid,p_date date)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with person as (
  select id,office_id,team_id from public.profiles where id=p_user_id
), candidates as (
  select 'HOLIDAY'::text kind,h.name label,
    case when h.user_id is not null then 4 when h.team_id is not null then 3 when h.office_id is not null then 2 else 1 end specificity,
    h.id rule_id
  from public.holiday_calendar h cross join person p
  where h.is_active and not h.is_optional and h.holiday_date=p_date
    and (h.user_id=p.id or h.team_id=p.team_id or h.office_id=p.office_id
      or (h.user_id is null and h.team_id is null and h.office_id is null))
  union all
  select 'WEEKLY_OFF',to_char(p_date,'FMDay'),
    case when w.user_id is not null then 4 when w.team_id is not null then 3 when w.office_id is not null then 2 else 1 end,
    w.id
  from public.weekly_off_rules w cross join person p
  where w.is_active and p_date between w.valid_from and coalesce(w.valid_to,'infinity'::date)
    and w.weekday=extract(dow from p_date)::integer
    and (w.week_of_month is null or w.week_of_month=((extract(day from p_date)::integer-1)/7)+1)
    and (w.user_id=p.id or w.team_id=p.team_id or w.office_id=p.office_id
      or (w.user_id is null and w.team_id is null and w.office_id is null))
)
select coalesce((select jsonb_build_object('kind',kind,'label',label,'specificity',specificity,'rule_id',rule_id)
  from candidates order by specificity desc,case kind when 'HOLIDAY' then 0 else 1 end limit 1),
  jsonb_build_object('kind','WORKING_DAY','specificity',0));
$$;

-- Shared calendar resolution for leave requests.
create or replace function public.leave_working_days(p_user_id uuid,p_start_date date,p_end_date date)
returns numeric language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_date date; v_days numeric:=0; v_calendar jsonb;
begin
  if p_end_date<p_start_date then return 0; end if;
  for v_date in select generate_series(p_start_date,p_end_date,interval '1 day')::date loop
    v_calendar:=public.resolve_hrms_calendar_day(p_user_id,v_date);
    if v_calendar->>'kind' not in ('HOLIDAY','WEEKLY_OFF') then v_days:=v_days+1; end if;
  end loop;
  return v_days;
end $$;

-- ---------------------------------------------------------------------------
-- Attendance evidence, policy resolution and tracking diagnostics
-- ---------------------------------------------------------------------------
alter table public.attendance_logs add column if not exists app_checkin_time timestamptz;
alter table public.attendance_policies
  add column if not exists allow_field_visit_checkout boolean not null default false,
  add column if not exists effective_from date not null default '2000-01-01',
  add column if not exists effective_to date;
alter table public.offices add column if not exists default_attendance_time time;

do $$
begin
  update public.attendance_logs
  set app_checkin_time=public.hrms_timestamp(checkin_time)
  where app_checkin_time is null
    and upper(coalesce(checkin_source,attendance_type,'')) like 'APP%';
exception when others then
  insert into public.hrms_migration_report(
    migration_key,entity_type,entity_id,status,detail
  ) values (
    '20260806010000','ATTENDANCE_EVIDENCE','APP_CHECKIN_BACKFILL',
    'REVIEW_REQUIRED',jsonb_build_object(
      'reason','PROTECTED_HISTORY_BACKFILL_BLOCKED',
      'sqlstate',sqlstate,
      'database_error',sqlerrm,
      'runtime_fallback','checkin_source'
    )
  ) on conflict (migration_key,entity_type,entity_id) do update
    set status=excluded.status,detail=excluded.detail;
end $$;

create or replace function public.capture_app_checkin_evidence()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.checkin_time is not null and new.app_checkin_time is null
     and upper(coalesce(new.checkin_source,new.attendance_type,'')) like 'APP%' then
    new.app_checkin_time:=public.hrms_timestamp(new.checkin_time);
  end if;
  return new;
end $$;
drop trigger if exists attendance_capture_app_evidence_trg on public.attendance_logs;
create trigger attendance_capture_app_evidence_trg before insert or update of checkin_time,checkin_source,attendance_type
on public.attendance_logs for each row execute function public.capture_app_checkin_evidence();

create or replace function public.require_protected_checkout_audit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.date=(now() at time zone 'Asia/Kolkata')::date and new.checkout_time is not null
   and new.checkout_time is distinct from old.checkout_time
   and current_setting('app.authorized_attendance_correction',true)<>'REGULARIZATION'
   and not exists(select 1 from public.attendance_audit_logs audit where audit.attendance_id=new.id
    and audit.new_checkout_at=new.checkout_time and ((audit.action in ('CHECKOUT_MANUAL','CHECKOUT_EARLY') and audit.source='APP')
      or (audit.action='CHECKOUT_AUTO' and audit.source='SYSTEM'))) then
  raise exception 'CHECKOUT_REQUIRES_HRMS_OR_AUTHORIZED_CORRECTION';
 end if;
 return null;
end $$;

create table if not exists public.attendance_runtime_settings (
  id boolean primary key default true check(id),
  tv_tracking_stale_minutes integer not null default 15 check(tv_tracking_stale_minutes between 1 and 180),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.attendance_runtime_settings(id) values(true) on conflict do nothing;

create table if not exists public.tracking_health_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 attendance_log_id uuid references public.attendance_logs(id) on delete set null,
 tracking_session_id uuid references public.tracking_sessions(id) on delete set null,
 reason text not null check(reason in ('ANDROID_APP_NOT_INSTALLED','BACKGROUND_PERMISSION_DENIED','PRECISE_LOCATION_DISABLED',
  'GPS_DISABLED','BATTERY_OPTIMISATION_BLOCKING','TRACKING_SESSION_NOT_STARTED','NO_ACTIVE_ATTENDANCE',
  'OFFLINE_LOCATIONS_QUEUED','LAST_PING_STALE','NATIVE_BRIDGE_UNAVAILABLE','SERVER_REJECTED_LOCATION_PING')),
 detail jsonb not null default '{}'::jsonb,occurred_at timestamptz not null default now(),resolved_at timestamptz,
 client_event_id uuid unique
);
create index if not exists tracking_health_events_user_time_idx on public.tracking_health_events(user_id,occurred_at desc);

create or replace function public.capture_tracking_health_diagnostic()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_reason text;
begin
 if new.event_type not in ('GPS_OFF','PERMISSION_REVOKED','LOCATION_STALE') then return new; end if;
 v_reason:=case when new.event_type='GPS_OFF' then 'GPS_DISABLED'
  when new.event_type='LOCATION_STALE' then 'LAST_PING_STALE'
  when coalesce((new.metadata->>'precise_location')::boolean,true)=false then 'PRECISE_LOCATION_DISABLED'
  else 'BACKGROUND_PERMISSION_DENIED' end;
 insert into public.tracking_health_events(user_id,attendance_log_id,tracking_session_id,reason,detail,occurred_at,client_event_id)
 values(new.user_id,new.attendance_log_id,new.tracking_session_id,v_reason,new.metadata,new.occurred_at,new.client_event_id)
 on conflict(client_event_id) do nothing;
 return new;
end $$;
drop trigger if exists journey_tracking_health_diagnostic_trg on public.journey_events;
create trigger journey_tracking_health_diagnostic_trg after insert on public.journey_events
for each row execute function public.capture_tracking_health_diagnostic();

create or replace function public.rpc_admin_tracking_diagnostics(p_user_id uuid default null,p_limit integer default 100)
returns table(id uuid,user_id uuid,employee_name text,attendance_log_id uuid,tracking_session_id uuid,reason text,detail jsonb,occurred_at timestamptz,resolved_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin perform public.require_profile_admin();
 return query select e.id,e.user_id,p.name,e.attendance_log_id,e.tracking_session_id,e.reason,e.detail,e.occurred_at,e.resolved_at
 from public.tracking_health_events e join public.profiles p on p.id=e.user_id
 where p_user_id is null or e.user_id=p_user_id order by e.occurred_at desc limit greatest(1,least(p_limit,500));
end $$;

-- Backfill an office-wide policy instead of allowing one unconfigured office
-- to crash all Activity Analysis rows.
insert into public.attendance_policies(office_id,role,late_checkin_time)
select office.id,'all',coalesce(office.default_attendance_time,time '10:32')
from public.offices office
where office.is_active and not exists(
  select 1 from public.attendance_policies policy
  where policy.office_id=office.id and policy.is_active
    and lower(coalesce(policy.role,'all'))='all')
on conflict (office_id,role) do nothing;

insert into public.hrms_migration_report(migration_key,entity_type,entity_id,status,detail)
select '20260806010000','OFFICE_POLICY',office.id::text,'BACKFILLED',
  jsonb_build_object('office_name',office.name,'role','ALL','late_checkin_time',coalesce(office.default_attendance_time,time '10:32'))
from public.offices office join public.attendance_policies policy on policy.office_id=office.id
where office.is_active and lower(coalesce(policy.role,'all'))='all'
on conflict (migration_key,entity_type,entity_id) do nothing;

-- Canonical view: one row per reporting-enabled employee per IST business day.
create or replace view public.v_attendance_daily_canonical
with (security_invoker=true) as
with employee_days as (
  select p.id user_id,day::date work_date,p.name employee_name,p.employee_number,
    p.office_id,o.name office_name,p.team_id,coalesce(t.name,p.team) team_name,
    p.reports_to team_head_id,manager.name team_head_name,p.role,p.show_on_tv,
    p.joining_date,p.is_active
  from public.profiles p
  left join public.offices o on o.id=p.office_id
  left join public.teams t on t.id=p.team_id
  left join public.profiles manager on manager.id=p.reports_to
  cross join lateral generate_series(
    greatest(coalesce(p.joining_date,(p.created_at at time zone 'Asia/Kolkata')::date),date '2020-01-01'),
    least(coalesce(p.last_working_date,(now() at time zone 'Asia/Kolkata')::date),(now() at time zone 'Asia/Kolkata')::date),
    interval '1 day') day
  where p.attendance_reporting_enabled
    and (day::date<(now() at time zone 'Asia/Kolkata')::date or p.is_active)
), evidence as (
select employee.*,
  attendance.id attendance_log_id,
  coalesce(attendance.app_checkin_time,
    case when upper(coalesce(attendance.checkin_source,attendance.attendance_type,'')) like 'APP%' then attendance.checkin_time end) app_first_in,
  coalesce(attendance.biometric_first_punch,biometric.first_punch) biometric_first_in,
  visit.first_in field_visit_first_in,
  attendance.checkout_time raw_checkout,
  case when upper(coalesce(attendance.checkout_source,'')) not in ('ADMIN','REGULARIZATION','SYSTEM','BIOMETRIC','FIELD_VISIT')
       then attendance.checkout_time end app_checkout,
  regularization.requested_checkout approved_regularization_checkout,
  case when regularization.id is null and upper(coalesce(attendance.checkout_source,''))='ADMIN'
       then attendance.checkout_time end admin_corrected_checkout,
  coalesce(attendance.biometric_last_punch,biometric.last_punch) biometric_last_punch_evidence,
  visit.last_out field_visit_checkout,visit.has_visit,visit.active_id,visit.active_name,visit.distance_m,
  policy.late_checkin_time,policy.allow_field_visit_checkout,policy.policy_id,
  calendar.value calendar_value,leave_request.leave_type,
  attendance.warning attendance_warning,
  ping.recorded_at latest_ping_at,ping.accuracy latest_accuracy_m,ping.status latest_tracking_status,
  ping.distance_from_base distance_from_office_m,
  session.status tracking_session_status,
  health.reason tracking_health_reason,
  settings.tv_tracking_stale_minutes
from employee_days employee
left join lateral (
  select a.* from public.attendance_logs a where a.user_id=employee.user_id and a.date=employee.work_date
  order by a.created_at,a.id limit 1) attendance on true
left join lateral (
  select min(coalesce(d.log_date,(d.log_date_only::text||' '||d.log_time::text)::timestamp at time zone 'Asia/Kolkata')) first_punch,
    max(coalesce(d.log_date,(d.log_date_only::text||' '||d.log_time::text)::timestamp at time zone 'Asia/Kolkata')) last_punch
  from public.smartoffice_device_logs d where d.user_id=employee.user_id and d.log_date_only=employee.work_date) biometric on true
left join lateral (
  select min(public.hrms_timestamp(v.checkin_time)) first_in,max(public.hrms_timestamp(v.checkout_time)) last_out,
    bool_or(v.checkin_time is not null) has_visit,
    (array_agg(v.id order by public.hrms_timestamp(v.checkin_time) desc nulls last,v.created_at desc)
      filter (where v.status in ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_id,
    (array_agg(coalesce(v.project_name,v.location_name) order by public.hrms_timestamp(v.checkin_time) desc nulls last,v.created_at desc)
      filter (where v.status in ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_name,
    (array_agg(v.last_distance_m order by v.last_distance_at desc nulls last))[1] distance_m
  from public.field_visits v where v.user_id=employee.user_id and v.date=employee.work_date
    and coalesce(v.verification_status,'PENDING')<>'REJECTED') visit on true
left join lateral (
  select r.id,r.requested_checkout from public.attendance_regularization_requests r
  where r.attendance_id=attendance.id and r.status='APPROVED'
  order by r.reviewed_at desc nulls last,r.created_at desc limit 1) regularization on true
left join lateral (
  select p.id policy_id,p.late_checkin_time,p.allow_field_visit_checkout
  from public.attendance_policies p
  where p.is_active and employee.work_date between p.effective_from and coalesce(p.effective_to,'infinity'::date)
    and (p.office_id=employee.office_id or p.office_id is null)
    and lower(coalesce(p.role,'all')) in (lower(coalesce(employee.role,'')),'all')
  order by case
    when p.office_id=employee.office_id and lower(p.role)=lower(coalesce(employee.role,'')) then 1
    when p.office_id=employee.office_id and lower(coalesce(p.role,'all'))='all' then 2
    when p.office_id is null and lower(p.role)=lower(coalesce(employee.role,'')) then 3 else 4 end
  limit 1) policy on true
left join lateral (select public.resolve_hrms_calendar_day(employee.user_id,employee.work_date) value) calendar on true
left join lateral (select l.leave_type from public.leave_requests l where l.user_id=employee.user_id
  and lower(l.status)='approved' and employee.work_date between l.start_date and l.end_date order by l.created_at limit 1) leave_request on true
left join lateral (select l.recorded_at,l.accuracy,l.status,l.distance_from_base from public.location_tracking l
  where l.user_id=employee.user_id and l.date=employee.work_date order by l.recorded_at desc limit 1) ping on true
left join lateral (select s.status from public.tracking_sessions s where s.user_id=employee.user_id and s.attendance_log_id=attendance.id
  order by s.created_at desc limit 1) session on true
left join lateral (select coalesce(j.metadata->>'reason',case j.event_type when 'GPS_OFF' then 'GPS disabled'
  when 'PERMISSION_REVOKED' then 'Background permission denied' when 'LOCATION_STALE' then 'Last ping is stale' end) reason
  from public.journey_events j where j.user_id=employee.user_id and j.attendance_log_id=attendance.id
  order by j.occurred_at desc limit 1) health on true
cross join public.attendance_runtime_settings settings
), official as (
select evidence.*,
  least(app_first_in,biometric_first_in,field_visit_first_in) official_first_in,
  case when approved_regularization_checkout is not null then approved_regularization_checkout
       when admin_corrected_checkout is not null then admin_corrected_checkout
       when app_checkout is not null then app_checkout
       when allow_field_visit_checkout then field_visit_checkout end official_last_out
from evidence
)
select user_id,work_date,employee_name,employee_number,office_id,office_name,team_id,team_name,
 team_head_id,team_head_name,role,
 app_first_in,biometric_first_in,field_visit_first_in,official_first_in,
 case when official_first_in is null then 'NO_DATA'
      when num_nonnulls(case when app_first_in=official_first_in then app_first_in end,
        case when biometric_first_in=official_first_in then biometric_first_in end,
        case when field_visit_first_in=official_first_in then field_visit_first_in end)>1 then 'MULTIPLE'
      when app_first_in=official_first_in then 'APP' when biometric_first_in=official_first_in then 'BIOMETRIC'
      else 'FIELD_VISIT' end first_in_source,
 app_checkout,approved_regularization_checkout,admin_corrected_checkout,official_last_out,
 case when approved_regularization_checkout is not null then 'REGULARIZATION'
      when admin_corrected_checkout is not null then 'ADMIN_CORRECTED'
      when app_checkout is not null then 'APP'
      when allow_field_visit_checkout and field_visit_checkout is not null then 'FIELD_VISIT' else 'NO_DATA' end last_out_source,
 biometric_last_punch_evidence,field_visit_checkout,
 case when official_first_in is null then 'NO_DATA'
      when num_nonnulls(app_first_in,biometric_first_in,field_visit_first_in)>1 then 'MULTIPLE'
      when app_first_in is not null then 'APP' when biometric_first_in is not null then 'BIOMETRIC' else 'FIELD_VISIT' end presence_source,
 case when policy_id is null or office_id is null then 'CONFIG_REQUIRED'
      when leave_type is not null then 'ON_LEAVE'
      when calendar_value->>'kind'='HOLIDAY' then 'HOLIDAY'
      when calendar_value->>'kind'='WEEKLY_OFF' then 'WEEKLY_OFF'
      when official_first_in is null then 'ABSENT'
      when official_last_out is not null then 'CHECKED_OUT'
      when has_visit then 'FIELD_VISIT'
      when late_checkin_time is not null and (official_first_in at time zone 'Asia/Kolkata')::time>=late_checkin_time then 'LATE'
      else 'PRESENT' end attendance_status,
 coalesce(official_first_in is not null and late_checkin_time is not null
   and (official_first_in at time zone 'Asia/Kolkata')::time>=late_checkin_time,false) is_late,
 case when official_first_in is not null and official_last_out is not null
   then greatest(0,floor(extract(epoch from (official_last_out-official_first_in))/60))::integer end working_minutes,
 case when policy_id is null then 'Attendance policy configuration required'
      when office_id is null then 'Office assignment required'
      when tracking_health_reason is not null then tracking_health_reason
      when attendance_warning then 'Attendance evidence warning'
      when official_first_in is not null and official_last_out is null then 'No checkout' end warning,
 coalesce(has_visit,false) has_field_visit,(policy_id is not null and office_id is not null) history_verified,
 show_on_tv,latest_ping_at,latest_accuracy_m,latest_tracking_status,tracking_health_reason,
 coalesce(latest_ping_at is null or latest_ping_at<now()-make_interval(mins=>tv_tracking_stale_minutes),true) ping_is_stale,
 active_id active_field_visit_id,active_name active_field_visit_name,distance_m distance_from_destination_m,
 distance_from_office_m,tracking_session_status,attendance_log_id
from official;

revoke all on public.v_attendance_daily_canonical from public,anon,authenticated;

create or replace function public.rpc_admin_attendance_daily_v3(p_start date,p_end date,p_offset integer default 0,p_limit integer default 500)
returns setof public.v_attendance_daily_canonical language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.require_profile_admin();
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 or p_limit not between 1 and 1000 or p_offset<0
    or p_end>(now() at time zone 'Asia/Kolkata')::date then raise exception 'INVALID_ATTENDANCE_REPORT_RANGE'; end if;
  return query select * from public.v_attendance_daily_canonical r where r.work_date between p_start and p_end
    order by r.work_date desc,r.employee_number nulls last,r.user_id offset p_offset limit p_limit;
end $$;
revoke all on function public.rpc_admin_attendance_daily_v3(date,date,integer,integer) from public,anon;
grant execute on function public.rpc_admin_attendance_daily_v3(date,date,integer,integer) to authenticated;

create or replace function public.rpc_my_attendance_daily_v3(p_start date,p_end date)
returns setof public.v_attendance_daily_canonical language sql stable security definer set search_path=public,pg_temp as $$
  select * from public.v_attendance_daily_canonical r where r.user_id=auth.uid() and r.work_date between p_start and p_end
  order by r.work_date desc limit 367
$$;
revoke all on function public.rpc_my_attendance_daily_v3(date,date) from public,anon;
grant execute on function public.rpc_my_attendance_daily_v3(date,date) to authenticated;

-- Regularization list includes canonical values and reviewer evidence.
create or replace function public.rpc_admin_list_attendance_regularization(p_status text default 'PENDING',p_offset integer default 0,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_records jsonb; v_total integer;
begin
  perform public.require_profile_admin();
  if upper(p_status) not in ('PENDING','APPROVED','REJECTED') or p_offset<0 or p_limit not between 1 and 500 then raise exception 'INVALID_REGULARIZATION_FILTER'; end if;
  select count(*) into v_total from public.attendance_regularization_requests r where r.status=upper(p_status);
  select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc),'[]'::jsonb) into v_records from (
    select r.*,jsonb_build_object('name',p.name,'employee_number',p.employee_number) profiles,
      jsonb_build_object('date',a.date,'checkin_time',a.checkin_time,'checkout_time',a.checkout_time,'is_late',a.is_late) attendance_logs,
      c.official_first_in,c.first_in_source,c.official_last_out current_official_last_out,c.last_out_source,
      case when r.status='APPROVED' then r.requested_checkout end final_approved_checkout,
      c.team_name,c.office_name,c.attendance_status
    from public.attendance_regularization_requests r join public.profiles p on p.id=r.user_id
    join public.attendance_logs a on a.id=r.attendance_id
    left join public.v_attendance_daily_canonical c on c.user_id=r.user_id and c.work_date=a.date
    where r.status=upper(p_status) order by r.created_at desc offset p_offset limit p_limit) page;
  return jsonb_build_object('success',true,'records',v_records,'total',v_total,'has_more',p_offset+jsonb_array_length(v_records)<v_total);
end $$;

create or replace function public.rpc_review_attendance_regularization(
 p_request_id uuid,p_admin_id uuid,p_approve boolean,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.attendance_regularization_requests%rowtype;a public.attendance_logs%rowtype;v_status text:=case when p_approve then 'APPROVED' else 'REJECTED' end;
begin
 perform public.require_profile_admin();
 if auth.uid()<>p_admin_id then raise exception 'ADMIN_IDENTITY_MISMATCH'; end if;
 select * into r from public.attendance_regularization_requests where id=p_request_id for update;
 if not found then raise exception 'REGULARIZATION_NOT_FOUND'; end if;
 if r.status<>'PENDING' then
  return jsonb_build_object('success',true,'status',r.status,'attendance_id',r.attendance_id,
   'final_checkout',case when r.status='APPROVED' then r.requested_checkout end,'idempotent',true,
   'message','Request was already reviewed.');
 end if;
 if not p_approve and length(btrim(coalesce(p_notes,'')))<3 then raise exception 'REJECTION_REASON_REQUIRED'; end if;
 select * into a from public.attendance_logs where id=r.attendance_id and user_id=r.user_id for update;
 if not found then raise exception 'ATTENDANCE_NOT_FOUND'; end if;
 if p_approve then
  perform set_config('app.authorized_attendance_correction','REGULARIZATION',true);
  update public.attendance_logs set checkout_time=r.requested_checkout,checkout_source='ADMIN',
   status='ADMIN_CORRECTED',corrected_by=auth.uid(),correction_reason=r.reason,
   updated_at=now() where id=a.id;
  insert into public.attendance_audit_logs(attendance_id,user_id,action,old_status,new_status,old_checkout_at,new_checkout_at,reason,source)
  values(a.id,r.user_id,'REGULARIZATION_APPROVED',a.status,'ADMIN_CORRECTED',a.checkout_time,r.requested_checkout,
   r.reason||coalesce(' | HR: '||nullif(btrim(p_notes),''),''),'REGULARIZATION');
 end if;
 update public.attendance_regularization_requests set status=v_status,reviewed_by=auth.uid(),reviewed_at=now(),review_notes=nullif(btrim(p_notes),'') where id=r.id;
 insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,old_values,new_values,source)
 values(auth.uid(),r.user_id,'REGULARIZATION_'||v_status,'attendance_regularization',r.id,
  jsonb_build_object('checkout',a.checkout_time,'status',a.status),
  jsonb_build_object('checkout',case when p_approve then r.requested_checkout else a.checkout_time end,'status',v_status,'notes',p_notes),'HRMS_ADMIN');
 return jsonb_build_object('success',true,'status',v_status,'attendance_id',r.attendance_id,
  'previous_checkout',a.checkout_time,'final_checkout',case when p_approve then r.requested_checkout else a.checkout_time end,
  'message','Regularization '||lower(v_status)||'.');
end $$;

-- Calendar mutations now accept exactly one of company, office, team or user.
create or replace function public.rpc_admin_mutate_configuration(p_entity text,p_action text,p_id uuid default null,p_values jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entity text:=upper(btrim(coalesce(p_entity,'')));v_action text:=upper(btrim(coalesce(p_action,'')));v_id uuid:=p_id;v_radius integer;
begin
 perform public.require_profile_admin();
 if v_entity='ATTENDANCE_POLICY' and v_action='UPDATE' then
  update public.attendance_policies set min_work_duration_minutes=(p_values->>'min_work_duration_minutes')::integer,
   earliest_checkout_time=p_values->>'earliest_checkout_time',auto_close_time=p_values->>'auto_close_time',
   allow_night_shift=(p_values->>'allow_night_shift')::boolean,require_early_checkout_reason=(p_values->>'require_early_checkout_reason')::boolean,
   undo_checkout_minutes=(p_values->>'undo_checkout_minutes')::integer,
   allow_field_visit_checkout=coalesce((p_values->>'allow_field_visit_checkout')::boolean,allow_field_visit_checkout),updated_at=now() where id=p_id;
 elsif v_entity='OFFICE' and v_action='CREATE' then
  v_radius:=coalesce((p_values->>'attendance_radius')::integer,100);
  insert into public.offices(name,address,latitude,longitude,attendance_radius,is_active) values(btrim(p_values->>'name'),btrim(p_values->>'address'),
   nullif(p_values->>'latitude','')::double precision,nullif(p_values->>'longitude','')::double precision,v_radius,true) returning id into v_id;
 elsif v_entity='OFFICE' and v_action='SET_ACTIVE' then
  if (p_values->>'is_active')::boolean and not exists(select 1 from public.attendance_policies p where p.office_id=p_id and p.is_active) then raise exception 'ACTIVE_OFFICE_REQUIRES_ATTENDANCE_POLICY'; end if;
  update public.offices set is_active=(p_values->>'is_active')::boolean where id=p_id;
 elsif v_entity='OFFICE' and v_action='SET_RADIUS' then update public.offices set attendance_radius=(p_values->>'attendance_radius')::integer where id=p_id;
 elsif v_entity='HOLIDAY' and v_action='CREATE' then
  if num_nonnulls(nullif(p_values->>'office_id',''),nullif(p_values->>'team_id',''),nullif(p_values->>'user_id',''))>1 then raise exception 'CONFLICTING_CALENDAR_SCOPE'; end if;
  insert into public.holiday_calendar(holiday_date,name,office_id,team_id,user_id,is_optional,created_by)
  values((p_values->>'holiday_date')::date,btrim(p_values->>'name'),nullif(p_values->>'office_id','')::uuid,
   nullif(p_values->>'team_id','')::uuid,nullif(p_values->>'user_id','')::uuid,coalesce((p_values->>'is_optional')::boolean,false),auth.uid()) returning id into v_id;
 elsif v_entity='HOLIDAY' and v_action='DELETE' then delete from public.holiday_calendar where id=p_id;
 elsif v_entity='WEEKLY_OFF' and v_action='CREATE' then
  if num_nonnulls(nullif(p_values->>'office_id',''),nullif(p_values->>'team_id',''),nullif(p_values->>'user_id',''))>1 then raise exception 'CONFLICTING_CALENDAR_SCOPE'; end if;
  insert into public.weekly_off_rules(office_id,team_id,user_id,weekday,week_of_month,valid_from,valid_to,is_active,created_by)
  values(nullif(p_values->>'office_id','')::uuid,nullif(p_values->>'team_id','')::uuid,nullif(p_values->>'user_id','')::uuid,
   (p_values->>'weekday')::integer,nullif(p_values->>'week_of_month','')::integer,coalesce(nullif(p_values->>'valid_from','')::date,(now() at time zone 'Asia/Kolkata')::date),
   nullif(p_values->>'valid_to','')::date,true,auth.uid()) returning id into v_id;
 elsif v_entity='WEEKLY_OFF' and v_action='DEACTIVATE' then update public.weekly_off_rules set is_active=false where id=p_id;
 else raise exception 'UNSUPPORTED_CONFIGURATION_ACTION'; end if;
 if v_id is null or not found then raise exception 'CONFIGURATION_ROW_NOT_FOUND'; end if;
 insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
 values(auth.uid(),null,'CONFIGURATION_'||v_action,lower(v_entity),v_id,jsonb_build_object('values',p_values),'HRMS_ADMIN');
 return jsonb_build_object('success',true,'id',v_id);
end $$;

-- Admin validation is non-blocking and explicitly identifies configuration gaps.
create or replace function public.rpc_admin_attendance_configuration_issues()
returns table(issue_type text,office_id uuid,office_name text,role text,user_id uuid,employee_name text,detail text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.require_profile_admin();
 return query
 select 'OFFICE_WITHOUT_POLICY',o.id,o.name,null::text,null::uuid,null::text,'Add an ALL policy or complete role policies'
 from public.offices o where o.is_active and not exists(select 1 from public.attendance_policies p where p.office_id=o.id and p.is_active)
 union all select 'EMPLOYEE_WITHOUT_OFFICE',null,null,p.role,p.id,p.name,'Assign an active office' from public.profiles p where p.is_active and p.office_id is null
 union all select 'EMPLOYEE_WITHOUT_TEAM',p.office_id,o.name,p.role,p.id,p.name,'Assign a team' from public.profiles p left join public.offices o on o.id=p.office_id where p.is_active and p.team_id is null
 union all select 'INVALID_LATE_TIME',p.office_id,o.name,p.role,null,null,'Late check-in time is missing' from public.attendance_policies p left join public.offices o on o.id=p.office_id where p.is_active and p.late_checkin_time is null;
end $$;

-- RLS and grants for all new objects.
alter table public.teams enable row level security;
alter table public.hrms_migration_report enable row level security;
alter table public.hrms_timestamp_backup_20260806 enable row level security;
alter table public.attendance_runtime_settings enable row level security;
alter table public.tracking_health_events enable row level security;
drop policy if exists teams_read_authenticated on public.teams;
create policy teams_read_authenticated on public.teams for select to authenticated using(true);
drop policy if exists migration_report_admin_read on public.hrms_migration_report;
create policy migration_report_admin_read on public.hrms_migration_report for select to authenticated using(public.is_profile_admin());
drop policy if exists timestamp_backup_admin_read on public.hrms_timestamp_backup_20260806;
create policy timestamp_backup_admin_read on public.hrms_timestamp_backup_20260806 for select to authenticated using(public.is_profile_admin());
drop policy if exists runtime_settings_admin_read on public.attendance_runtime_settings;
create policy runtime_settings_admin_read on public.attendance_runtime_settings for select to authenticated using(public.is_profile_admin());
drop policy if exists tracking_health_self_or_admin_read on public.tracking_health_events;
create policy tracking_health_self_or_admin_read on public.tracking_health_events for select to authenticated using(user_id=auth.uid() or public.is_profile_admin());
revoke insert,update,delete on public.teams,public.hrms_migration_report,public.hrms_timestamp_backup_20260806,public.attendance_runtime_settings,public.tracking_health_events from anon,authenticated;
grant select on public.teams to authenticated;
grant execute on function public.rpc_admin_tracking_diagnostics(uuid,integer) to authenticated;

create index if not exists attendance_logs_user_date_v3_idx on public.attendance_logs(user_id,date);
create index if not exists field_visits_user_date_status_v3_idx on public.field_visits(user_id,date,status);
create index if not exists location_tracking_user_recorded_v3_idx on public.location_tracking(user_id,recorded_at desc);

notify pgrst,'reload schema';
