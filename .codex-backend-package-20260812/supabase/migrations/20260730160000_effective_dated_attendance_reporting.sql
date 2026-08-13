-- Effective-dated organizational and policy history for authoritative reports.
-- Current state is trustworthy from migration day forward. Older dates remain
-- fail-closed until HR backfills and verifies the required history.

alter table public.profiles
  add column if not exists joining_date date,
  add column if not exists last_working_date date;

create table if not exists public.employee_assignment_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  employee_name text not null,
  employee_number text,
  office_id uuid references public.offices(id),
  office_name text,
  team text,
  reports_to uuid references public.profiles(id),
  manager_name text,
  role text,
  joining_date date,
  last_working_date date,
  verified boolean not null default false,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists employee_assignment_history_lookup_idx
  on public.employee_assignment_history(profile_id, effective_from, effective_to);
alter table public.employee_assignment_history enable row level security;
revoke all on public.employee_assignment_history from public, anon, authenticated;

create table if not exists public.attendance_policy_history (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  office_id uuid not null references public.offices(id),
  role text not null,
  late_checkin_time time not null,
  effective_from date not null,
  effective_to date,
  verified boolean not null default false,
  recorded_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists attendance_policy_history_lookup_idx
  on public.attendance_policy_history(office_id, role, effective_from, effective_to);
alter table public.attendance_policy_history enable row level security;
revoke all on public.attendance_policy_history from public, anon, authenticated;

create table if not exists public.office_calendar_history (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id),
  effective_from date not null,
  effective_to date,
  weekly_rules jsonb not null default '[]'::jsonb,
  verified boolean not null default false,
  recorded_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists office_calendar_history_lookup_idx
  on public.office_calendar_history(office_id, effective_from, effective_to);
alter table public.office_calendar_history enable row level security;
revoke all on public.office_calendar_history from public, anon, authenticated;

create or replace function public.capture_profile_assignment_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_office_name text;
  v_manager_name text;
begin
  if tg_op = 'UPDATE' and not (
    new.office_id is distinct from old.office_id
    or new.team is distinct from old.team
    or new.reports_to is distinct from old.reports_to
    or new.role is distinct from old.role
    or new.name is distinct from old.name
    or new.employee_number is distinct from old.employee_number
    or new.joining_date is distinct from old.joining_date
    or new.last_working_date is distinct from old.last_working_date
  ) then return new; end if;

  update public.employee_assignment_history
  set effective_to = v_today - 1
  where profile_id = new.id and effective_to is null
    and effective_from < v_today;
  delete from public.employee_assignment_history
  where profile_id = new.id and effective_from = v_today;

  select name into v_office_name from public.offices where id = new.office_id;
  select name into v_manager_name from public.profiles where id = new.reports_to;
  insert into public.employee_assignment_history(
    profile_id, effective_from, employee_name, employee_number,
    office_id, office_name, team, reports_to, manager_name, role,
    joining_date, last_working_date, verified, recorded_by
  ) values (
    new.id, v_today, new.name, new.employee_number,
    new.office_id, v_office_name, new.team, new.reports_to, v_manager_name,
    new.role, new.joining_date, new.last_working_date, true, auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists capture_profile_assignment_history_trigger
  on public.profiles;
create trigger capture_profile_assignment_history_trigger
after insert or update on public.profiles
for each row execute function public.capture_profile_assignment_history();

insert into public.employee_assignment_history(
  profile_id, effective_from, employee_name, employee_number,
  office_id, office_name, team, reports_to, manager_name, role,
  joining_date, last_working_date, verified
)
select
  profile.id,
  (now() at time zone 'Asia/Kolkata')::date,
  profile.name,
  profile.employee_number,
  profile.office_id,
  office.name,
  profile.team,
  profile.reports_to,
  manager.name,
  profile.role,
  profile.joining_date,
  profile.last_working_date,
  true
from public.profiles profile
left join public.offices office on office.id = profile.office_id
left join public.profiles manager on manager.id = profile.reports_to
where not exists (
  select 1 from public.employee_assignment_history history
  where history.profile_id = profile.id and history.effective_to is null
);

create or replace function public.capture_attendance_policy_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_policy public.attendance_policies%rowtype;
begin
  v_policy := case when tg_op = 'DELETE' then old else new end;
  update public.attendance_policy_history
  set effective_to = v_today - 1
  where policy_id = v_policy.id and effective_to is null
    and effective_from < v_today;
  delete from public.attendance_policy_history
  where policy_id = v_policy.id and effective_from = v_today;
  if tg_op <> 'DELETE' and coalesce(new.is_active, true) then
    insert into public.attendance_policy_history(
      policy_id, office_id, role, late_checkin_time,
      effective_from, verified
    ) values (
      new.id, new.office_id, coalesce(new.role, 'all'),
      new.late_checkin_time, v_today, true
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_attendance_policy_history_trigger
  on public.attendance_policies;
create trigger capture_attendance_policy_history_trigger
after insert or update or delete on public.attendance_policies
for each row execute function public.capture_attendance_policy_history();

insert into public.attendance_policy_history(
  policy_id, office_id, role, late_checkin_time,
  effective_from, verified
)
select id, office_id, coalesce(role, 'all'), late_checkin_time,
  (now() at time zone 'Asia/Kolkata')::date, true
from public.attendance_policies policy
where coalesce(is_active, true)
  and not exists (
    select 1 from public.attendance_policy_history history
    where history.policy_id = policy.id and history.effective_to is null
  );

create or replace function public.refresh_office_calendar_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  update public.office_calendar_history
  set effective_to = v_today - 1
  where effective_to is null and effective_from < v_today;
  delete from public.office_calendar_history where effective_from = v_today;
  insert into public.office_calendar_history(
    office_id, effective_from, weekly_rules, verified
  )
  select office.id, v_today,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', rule.weekday,
        'week_of_month', rule.week_of_month,
        'user_id', rule.user_id
      ) order by rule.weekday, rule.week_of_month, rule.user_id)
      from public.weekly_off_rules rule
      where rule.is_active
        and (
          rule.office_id = office.id
          or (
            rule.user_id is not null and exists (
              select 1 from public.profiles profile
              where profile.id = rule.user_id and profile.office_id = office.id
            )
          )
        )
    ), '[]'::jsonb), true
  from public.offices office
  where office.is_active;
  return null;
end;
$$;

drop trigger if exists refresh_office_calendar_history_trigger
  on public.weekly_off_rules;
create trigger refresh_office_calendar_history_trigger
after insert or update or delete on public.weekly_off_rules
for each statement execute function public.refresh_office_calendar_history();

insert into public.office_calendar_history(
  office_id, effective_from, weekly_rules, verified
)
select office.id, (now() at time zone 'Asia/Kolkata')::date,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'weekday', rule.weekday,
      'week_of_month', rule.week_of_month,
      'user_id', rule.user_id
    ) order by rule.weekday, rule.week_of_month, rule.user_id)
    from public.weekly_off_rules rule
    where rule.is_active
      and (
        rule.office_id = office.id
        or (
          rule.user_id is not null and exists (
            select 1 from public.profiles profile
            where profile.id = rule.user_id and profile.office_id = office.id
          )
        )
      )
  ), '[]'::jsonb), true
from public.offices office
where office.is_active
  and not exists (
    select 1 from public.office_calendar_history history
    where history.office_id = office.id and history.effective_to is null
  );

create or replace function public.prevent_past_holiday_rewrite()
returns trigger
language plpgsql
as $$
begin
  if old.holiday_date < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'PAST_HOLIDAY_IS_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists prevent_past_holiday_rewrite_trigger
  on public.holiday_calendar;
create trigger prevent_past_holiday_rewrite_trigger
before update or delete on public.holiday_calendar
for each row execute function public.prevent_past_holiday_rewrite();

drop view if exists public.attendance_reconciliation;
create view public.attendance_reconciliation
with (security_invoker = true)
as
with biometric as (
  select user_id, log_date_only as date,
    min(log_date) as bio_in,
    max(log_date) filter (where log_date > (
      select min(inner_log.log_date)
      from public.smartoffice_device_logs inner_log
      where inner_log.user_id = device.user_id
        and inner_log.log_date_only = device.log_date_only
    )) as bio_out
  from public.smartoffice_device_logs device
  where user_id is not null and log_date_only is not null
  group by user_id, log_date_only
), employee_days as (
  select history.*, day::date as date
  from public.employee_assignment_history history
  cross join lateral generate_series(
    greatest(history.effective_from, coalesce(history.joining_date, history.effective_from)),
    least(
      coalesce(history.effective_to, (now() at time zone 'Asia/Kolkata')::date),
      coalesce(history.last_working_date, (now() at time zone 'Asia/Kolkata')::date),
      (now() at time zone 'Asia/Kolkata')::date
    ),
    interval '1 day'
  ) day
)
select
  employee.profile_id as user_id,
  employee.date,
  employee.employee_name as name,
  employee.employee_number,
  employee.office_id,
  employee.office_name,
  employee.team,
  employee.reports_to,
  employee.manager_name as team_head_name,
  employee.role,
  attendance.checkin_time as app_in,
  attendance.checkout_time as app_out,
  biometric.bio_in,
  biometric.bio_out,
  case
    when attendance.checkin_time is null then biometric.bio_in
    when biometric.bio_in is null then attendance.checkin_time
    else least(attendance.checkin_time, biometric.bio_in)
  end as final_in,
  case
    when attendance.checkout_time is null then biometric.bio_out
    when biometric.bio_out is null then attendance.checkout_time
    else greatest(attendance.checkout_time, biometric.bio_out)
  end as final_out,
  (
    coalesce(attendance.checkin_time, biometric.bio_in) is not null
    and policy.late_checkin_time is not null
    and (
      coalesce(attendance.checkin_time, biometric.bio_in)
        at time zone 'Asia/Kolkata'
    )::time >= policy.late_checkin_time
  ) as is_late,
  exists (
    select 1 from public.field_visits visit
    where visit.user_id = employee.profile_id
      and visit.date = employee.date
      and visit.checkin_time is not null
  ) as has_field_visit,
  case
    when leave_request.user_id is not null then
      case upper(coalesce(leave_request.leave_type, 'LEAVE'))
        when 'CASUAL' then 'CL'
        when 'SICK' then 'SL'
        when 'PAID' then 'PL'
        when 'WFH' then 'WFH'
        else upper(coalesce(leave_request.leave_type, 'LEAVE'))
      end
    when holiday.holiday_date is not null then 'H'
    when weekly.is_weekly_off then 'WO'
    when coalesce(attendance.checkin_time, biometric.bio_in) is null
      and exists (
        select 1 from public.field_visits visit
        where visit.user_id = employee.profile_id
          and visit.date = employee.date
          and visit.checkin_time is not null
      ) then 'FV'
    when coalesce(attendance.checkin_time, biometric.bio_in) is null then 'A'
    when coalesce(attendance.checkout_time, biometric.bio_out) is null then 'P-NC'
    else 'P'
  end as report_status,
  case
    when attendance.checkin_time is not null and biometric.bio_in is not null
      then 'APP+BIOMETRIC'
    when attendance.checkin_time is not null then 'APP'
    when biometric.bio_in is not null then 'BIOMETRIC'
    when exists (
      select 1 from public.field_visits visit
      where visit.user_id = employee.profile_id
        and visit.date = employee.date and visit.checkin_time is not null
    ) then 'FIELD_VISIT'
    else 'NONE'
  end as presence_source,
  case
    when coalesce(attendance.checkin_time, biometric.bio_in) is not null
      and coalesce(attendance.checkout_time, biometric.bio_out) is null
      then 'NO_CHECKOUT'
    else null
  end as suggested_status,
  null::text as fraud_severity,
  null::numeric as fraud_score,
  employee.verified
    and coalesce(policy.verified, false)
    and coalesce(calendar.verified, false) as history_verified
from employee_days employee
left join lateral (
  select log.*
  from public.attendance_logs log
  where log.user_id = employee.profile_id and log.date = employee.date
  order by log.created_at
  limit 1
) attendance on true
left join biometric
  on biometric.user_id = employee.profile_id and biometric.date = employee.date
left join lateral (
  select request.user_id, request.leave_type
  from public.leave_requests request
  where request.user_id = employee.profile_id
    and lower(request.status) = 'approved'
    and employee.date between request.start_date and request.end_date
  order by request.created_at
  limit 1
) leave_request on true
left join public.holiday_calendar holiday
  on holiday.holiday_date = employee.date
  and not coalesce(holiday.is_optional, false)
  and (holiday.office_id is null or holiday.office_id = employee.office_id)
left join lateral (
  select history.late_checkin_time, history.verified
  from public.attendance_policy_history history
  where history.office_id = employee.office_id
    and lower(history.role) in (lower(coalesce(employee.role, '')), 'all')
    and employee.date >= history.effective_from
    and (history.effective_to is null or employee.date <= history.effective_to)
  order by case when lower(history.role) =
    lower(coalesce(employee.role, '')) then 0 else 1 end
  limit 1
) policy on true
left join lateral (
  select history.weekly_rules, history.verified
  from public.office_calendar_history history
  where history.office_id = employee.office_id
    and employee.date >= history.effective_from
    and (history.effective_to is null or employee.date <= history.effective_to)
  limit 1
) calendar on true
left join lateral (
  select exists (
    select 1
    from jsonb_to_recordset(coalesce(calendar.weekly_rules, '[]'::jsonb))
      as rule(weekday integer, week_of_month integer, user_id uuid)
    where rule.weekday = extract(dow from employee.date)::integer
      and (rule.user_id is null or rule.user_id = employee.profile_id)
      and (
        rule.week_of_month is null
        or rule.week_of_month =
          ((extract(day from employee.date)::integer - 1) / 7) + 1
      )
  ) as is_weekly_off
) weekly on true;

revoke all on public.attendance_reconciliation from public, anon, authenticated;

create or replace function public.rpc_admin_attendance_reconciliation(
  p_start date,
  p_end date,
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof public.attendance_reconciliation
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_profile_admin();
  if p_start is null or p_end is null or p_end < p_start
     or p_end > (now() at time zone 'Asia/Kolkata')::date
     or p_end - p_start > 366
     or p_offset < 0 or p_limit < 1 or p_limit > 1000 then
    raise exception 'INVALID_ATTENDANCE_REPORT_RANGE';
  end if;
  if exists (
    select 1 from public.profiles profile
    where profile.joining_date is null
      and (profile.created_at at time zone 'Asia/Kolkata')::date <= p_end
  ) and p_start < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'JOINING_DATE_HISTORY_REQUIRED';
  end if;
  if exists (
    select 1
    from public.profiles profile
    cross join lateral generate_series(
      greatest(p_start, profile.joining_date),
      least(p_end, coalesce(profile.last_working_date, p_end)),
      interval '1 day'
    ) report_day
    where profile.joining_date is not null
      and profile.joining_date <= p_end
      and coalesce(profile.last_working_date, p_end) >= p_start
      and not exists (
        select 1
        from public.employee_assignment_history history
        where history.profile_id = profile.id
          and report_day::date >= history.effective_from
          and (
            history.effective_to is null
            or report_day::date <= history.effective_to
          )
          and history.verified
      )
  ) then
    raise exception 'HISTORICAL_ASSIGNMENT_COVERAGE_REQUIRED';
  end if;
  if exists (
    select 1
    from public.attendance_reconciliation report
    where report.date between p_start and p_end
      and not report.history_verified
  ) then
    raise exception 'HISTORICAL_ASSIGNMENT_OR_POLICY_NOT_VERIFIED';
  end if;
  return query
  select *
  from public.attendance_reconciliation report
  where report.date between p_start and p_end
  order by report.date desc, report.employee_number, report.user_id
  offset p_offset limit p_limit;
end;
$$;

revoke all on function public.rpc_admin_attendance_reconciliation(
  date, date, integer, integer
) from public, anon;
grant execute on function public.rpc_admin_attendance_reconciliation(
  date, date, integer, integer
) to authenticated;

notify pgrst, 'reload schema';
