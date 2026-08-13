-- One authoritative attendance timeline:
--   * the first verified biometric punch is the check-in;
--   * an HRMS checkout remains authoritative during the live day;
--   * a still-open day is finalized only after IST day rollover, using the
--     last verified punch when it proves a separate exit punch;
--   * a one-punch/no-biometric day uses the protected 23:59 IST fallback.

set local statement_timeout = '10min';
select set_config('app.suppress_attendance_outbox', 'true', true);

create or replace function public.set_authoritative_attendance_late_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_late_time time;
  v_local_checkin time;
begin
  if new.checkin_time is null then
    new.is_late := false;
    new.late_by_minutes := 0;
    return new;
  end if;

  select policy.late_checkin_time
  into v_late_time
  from public.profiles profile
  join public.attendance_policies policy
    on policy.office_id = coalesce(new.office_id, profile.office_id)
   and coalesce(policy.is_active, true)
   and lower(coalesce(policy.role, 'all')) in (
     lower(coalesce(profile.role, '')),
     'all'
   )
  where profile.id = new.user_id
  order by
    case when lower(coalesce(policy.role, 'all')) =
      lower(coalesce(profile.role, '')) then 0 else 1 end
  limit 1;

  if v_late_time is null then
    new.is_late := null;
    new.late_by_minutes := null;
    return new;
  end if;

  v_local_checkin := (new.checkin_time at time zone 'Asia/Kolkata')::time;
  new.is_late := v_local_checkin >= v_late_time;
  new.late_by_minutes := case
    when v_local_checkin >= v_late_time then
      greatest(
        0,
        floor(extract(epoch from (v_local_checkin - v_late_time)) / 60)::int
      )
    else 0
  end;
  return new;
end;
$$;

create or replace function public.apply_biometric_daily_punches_v2(
  p_user_id uuid,
  p_attendance_date date,
  p_first_punch timestamptz,
  p_last_punch timestamptz,
  p_punch_count integer,
  p_checkout_punch timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attendance public.attendance_logs%rowtype;
  v_previous_checkin timestamptz;
  v_created boolean := false;
  v_checkin_updated boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_user_id is null
     or p_attendance_date is null
     or p_first_punch is null
     or p_last_punch is null
     or coalesce(p_punch_count, 0) < 1
     or p_last_punch < p_first_punch then
    raise exception 'INVALID_BIOMETRIC_PUNCH_SUMMARY';
  end if;

  if (p_first_punch at time zone 'Asia/Kolkata')::date <> p_attendance_date
     or (p_last_punch at time zone 'Asia/Kolkata')::date <> p_attendance_date
  then
    raise exception 'BIOMETRIC_PUNCH_DATE_MISMATCH';
  end if;

  -- Kept in the signature for deployed importer compatibility. It is evidence
  -- only and can never close a live attendance day.
  if p_checkout_punch is not null and (
       p_checkout_punch <= p_first_punch
       or p_checkout_punch > p_last_punch
       or (p_checkout_punch at time zone 'Asia/Kolkata')::date
            <> p_attendance_date
     ) then
    raise exception 'INVALID_BIOMETRIC_CHECKOUT_EVIDENCE';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and is_active = true
      and nullif(btrim(smartoffice_employee_code), '') is not null
  ) then
    raise exception 'ACTIVE_MAPPED_EMPLOYEE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_attendance_date::text, 0)
  );

  select * into v_attendance
  from public.attendance_logs
  where user_id = p_user_id and date = p_attendance_date
  for update;

  if not found then
    insert into public.attendance_logs(
      user_id, date, checkin_time, checkin_source, checkout_time, status,
      attendance_status, day_status, attendance_type, smartoffice_imported,
      biometric_first_punch, biometric_last_punch, biometric_punch_count
    ) values (
      p_user_id, p_attendance_date, p_first_punch, 'BIOMETRIC', null,
      'CHECKED_IN', 'PRESENT', 'P', 'BIOMETRIC', true,
      p_first_punch, p_last_punch, p_punch_count
    )
    returning * into v_attendance;
    v_created := true;
    v_checkin_updated := true;
  else
    v_previous_checkin := v_attendance.checkin_time;
    update public.attendance_logs
    set checkin_time = p_first_punch,
        checkin_source = 'BIOMETRIC',
        status = case
          when checkout_time is null then 'CHECKED_IN'
          else status
        end,
        attendance_status = coalesce(attendance_status, 'PRESENT'),
        day_status = coalesce(day_status, 'P'),
        attendance_type = coalesce(attendance_type, 'BIOMETRIC'),
        smartoffice_imported = true,
        biometric_first_punch = p_first_punch,
        biometric_last_punch = p_last_punch,
        biometric_punch_count = p_punch_count,
        work_hours = case
          when checkout_time is null then work_hours
          else greatest(
            0,
            round(
              (extract(epoch from (checkout_time - p_first_punch)) / 3600)::numeric,
              2
            )
          )
        end,
        updated_at = now()
    where id = v_attendance.id
    returning * into v_attendance;
    v_checkin_updated := v_previous_checkin is distinct from
      v_attendance.checkin_time;
  end if;

  return jsonb_build_object(
    'success', true,
    'attendance_id', v_attendance.id,
    'created', v_created,
    'checkin_updated', v_checkin_updated,
    'checkin_time', v_attendance.checkin_time,
    'checkin_source', v_attendance.checkin_source,
    'checked_out', false,
    'checkout_deferred_until_rollover', v_attendance.checkout_time is null,
    'punch_count', p_punch_count
  );
end;
$$;

revoke all on function public.apply_biometric_daily_punches_v2(
  uuid, date, timestamptz, timestamptz, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_biometric_daily_punches_v2(
  uuid, date, timestamptz, timestamptz, integer, timestamptz
) to service_role;

-- Machine data is evidence, never a live-day checkout mutation.
create or replace function public.prevent_machine_attendance_checkout()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_is_new_checkout boolean;
  v_machine_source boolean;
  v_authorized_day_end boolean;
begin
  if tg_op = 'INSERT' then
    v_is_new_checkout := new.checkout_time is not null;
  else
    v_is_new_checkout := new.checkout_time is not null and
      (old.checkout_time is null or
       new.checkout_time is distinct from old.checkout_time);
  end if;

  v_authorized_day_end :=
    current_setting('app.authorized_attendance_checkout', true) = 'DAY_END';
  v_machine_source :=
    upper(coalesce(new.checkout_source, '')) in
      ('BIOMETRIC', 'SMARTOFFICE', 'PUNCH_MACHINE')
    or (
      upper(coalesce(new.checkout_source, '')) = 'SYSTEM'
      and not v_authorized_day_end
    );

  if v_is_new_checkout and v_machine_source then
    if tg_op = 'UPDATE' then
      new.checkout_time := old.checkout_time;
      new.checkout_source := old.checkout_source;
      new.status := old.status;
    else
      new.checkout_time := null;
      new.checkout_source := null;
      if new.status in ('CHECKED_OUT', 'AUTO_CHECKED_OUT') then
        new.status := 'CHECKED_IN';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.require_protected_checkout_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.date = (now() at time zone 'Asia/Kolkata')::date
     and new.checkout_time is not null
     and new.checkout_time is distinct from old.checkout_time
     and not exists (
       select 1 from public.attendance_audit_logs audit
       where audit.attendance_id = new.id
         and audit.new_checkout_at = new.checkout_time
         and (
           (
             audit.action in ('CHECKOUT_MANUAL', 'CHECKOUT_EARLY')
             and audit.source = 'APP'
           )
           or (
             audit.action = 'CHECKOUT_AUTO'
             and audit.source = 'SYSTEM'
           )
         )
     ) then
    raise exception 'CHECKOUT_REQUIRES_HRMS_OR_DAY_END_ACTION';
  end if;
  return null;
end;
$$;

-- Reconstruct historical daily summaries from both legacy and current log
-- timestamp shapes. The temporary table never leaves this migration session.
create temporary table biometric_daily_authoritative
on commit drop
as
select
  log.user_id,
  log.log_date_only::date as attendance_date,
  min(coalesce(
    log.log_date,
    (log.log_date_only::text || ' ' || log.log_time::text)::timestamp
      at time zone 'Asia/Kolkata'
  )) as first_punch,
  max(coalesce(
    log.log_date,
    (log.log_date_only::text || ' ' || log.log_time::text)::timestamp
      at time zone 'Asia/Kolkata'
  )) as last_punch,
  count(*)::integer as punch_count
from public.smartoffice_device_logs log
where log.user_id is not null
  and log.log_date_only is not null
  and log.log_time is not null
group by log.user_id, log.log_date_only::date;

select set_config('app.authorized_attendance_checkout', 'DAY_END', true);

-- Create attendance for verified punch-days that predate automatic first-punch
-- creation. Historical open days are immediately finalized by rollover rules.
insert into public.attendance_logs(
  user_id, office_id, date, checkin_time, checkin_source,
  checkout_time, checkout_source, status, attendance_status, day_status,
  attendance_type, smartoffice_imported, biometric_first_punch,
  biometric_last_punch, biometric_punch_count, auto_checkout,
  auto_checkout_reason, work_hours
)
select
  daily.user_id,
  coalesce(history.office_id, profile.office_id),
  daily.attendance_date,
  daily.first_punch,
  'BIOMETRIC',
  case
    when daily.attendance_date <
      (now() at time zone 'Asia/Kolkata')::date then
      case
        when daily.punch_count >= 2 and daily.last_punch > daily.first_punch
          then daily.last_punch
        else (daily.attendance_date::text || ' 23:59:00+05:30')::timestamptz
      end
    else null
  end,
  case when daily.attendance_date <
    (now() at time zone 'Asia/Kolkata')::date then 'SYSTEM' else null end,
  case when daily.attendance_date <
    (now() at time zone 'Asia/Kolkata')::date
    then 'AUTO_CHECKED_OUT' else 'CHECKED_IN' end,
  'PRESENT',
  'P',
  'BIOMETRIC',
  true,
  daily.first_punch,
  daily.last_punch,
  daily.punch_count,
  daily.attendance_date < (now() at time zone 'Asia/Kolkata')::date,
  case
    when daily.attendance_date >=
      (now() at time zone 'Asia/Kolkata')::date then null
    when daily.punch_count >= 2 and daily.last_punch > daily.first_punch
      then 'Day rollover checkout using last verified biometric punch'
    else 'Day rollover checkout at 23:59 IST; no separate exit punch'
  end,
  case
    when daily.attendance_date <
      (now() at time zone 'Asia/Kolkata')::date then greatest(
      0,
      round((extract(epoch from (
        case
          when daily.punch_count >= 2 and daily.last_punch > daily.first_punch
            then daily.last_punch
          else (daily.attendance_date::text || ' 23:59:00+05:30')::timestamptz
        end - daily.first_punch
      )) / 3600)::numeric, 2)
    )
    else null
  end
from biometric_daily_authoritative daily
join public.profiles profile on profile.id = daily.user_id
left join lateral (
  select assignment.office_id
  from public.employee_assignment_history assignment
  where assignment.profile_id = daily.user_id
    and daily.attendance_date >= assignment.effective_from
    and (
      assignment.effective_to is null
      or daily.attendance_date <= assignment.effective_to
    )
  order by assignment.effective_from desc
  limit 1
) history on true
where not exists (
  select 1 from public.attendance_logs attendance
  where attendance.user_id = daily.user_id
    and attendance.date = daily.attendance_date
);

-- Existing attendance adopts the machine's first punch as its check-in. Manual
-- and already-finalized SYSTEM checkout times are preserved here.
update public.attendance_logs attendance
set checkin_time = daily.first_punch,
    checkin_source = 'BIOMETRIC',
    smartoffice_imported = true,
    biometric_first_punch = daily.first_punch,
    biometric_last_punch = daily.last_punch,
    biometric_punch_count = daily.punch_count,
    attendance_status = coalesce(attendance.attendance_status, 'PRESENT'),
    day_status = coalesce(attendance.day_status, 'P'),
    work_hours = case
      when attendance.checkout_time is null then attendance.work_hours
      else greatest(
        0,
        round((extract(epoch from (
          attendance.checkout_time - daily.first_punch
        )) / 3600)::numeric, 2)
      )
    end,
    updated_at = now()
from biometric_daily_authoritative daily
where attendance.user_id = daily.user_id
  and attendance.date = daily.attendance_date
  and (
    attendance.checkin_time is distinct from daily.first_punch
    or attendance.checkin_source is distinct from 'BIOMETRIC'
    or attendance.biometric_first_punch is distinct from daily.first_punch
    or attendance.biometric_last_punch is distinct from daily.last_punch
    or attendance.biometric_punch_count is distinct from daily.punch_count
  );

-- A machine checkout from older behavior is not allowed to close today's live
-- session. It becomes normal rollover data only after the day has changed.
update public.attendance_logs
set checkout_time = null,
    checkout_source = null,
    status = 'CHECKED_IN',
    auto_checkout = false,
    auto_checkout_reason = null,
    work_hours = null,
    updated_at = now()
where date = (now() at time zone 'Asia/Kolkata')::date
  and upper(coalesce(checkout_source, '')) in
    ('BIOMETRIC', 'SMARTOFFICE', 'PUNCH_MACHINE');

-- Finalize every older unclosed/machine-closed day. Multiple punches use the
-- last verified punch; a single/no biometric punch uses the protected 23:59
-- timestamp so no session can leak into the next business day.
with candidates as materialized (
  select
    attendance.id,
    attendance.user_id,
    attendance.status as old_status,
    attendance.checkout_time as old_checkout,
    case
      when attendance.biometric_punch_count >= 2
           and attendance.biometric_last_punch > attendance.checkin_time
        then attendance.biometric_last_punch
      else (attendance.date::text || ' 23:59:00+05:30')::timestamptz
    end as final_checkout,
    case
      when attendance.biometric_punch_count >= 2
           and attendance.biometric_last_punch > attendance.checkin_time
        then 'Day rollover checkout using last verified biometric punch'
      else 'Day rollover checkout at 23:59 IST; no separate exit punch'
    end as final_reason
  from public.attendance_logs attendance
  where attendance.date < (now() at time zone 'Asia/Kolkata')::date
    and attendance.checkin_time is not null
    and (
      attendance.checkout_time is null
      or upper(coalesce(attendance.checkout_source, '')) in
        ('BIOMETRIC', 'SMARTOFFICE', 'PUNCH_MACHINE')
    )
), updated as (
  update public.attendance_logs attendance
  set checkout_time = candidate.final_checkout,
      checkout_source = 'SYSTEM',
      status = 'AUTO_CHECKED_OUT',
      auto_checkout = true,
      auto_checkout_reason = candidate.final_reason,
      undo_token = null,
      undo_expires_at = null,
      work_hours = greatest(
        0,
        round((extract(epoch from (
          candidate.final_checkout - attendance.checkin_time
        )) / 3600)::numeric, 2)
      ),
      updated_at = now()
  from candidates candidate
  where attendance.id = candidate.id
  returning attendance.id
)
insert into public.attendance_audit_logs(
  attendance_id, user_id, action, old_status, new_status,
  old_checkout_at, new_checkout_at, reason, source
)
select
  candidate.id,
  candidate.user_id,
  'CHECKOUT_AUTO',
  candidate.old_status,
  'AUTO_CHECKED_OUT',
  candidate.old_checkout,
  candidate.final_checkout,
  candidate.final_reason,
  'SYSTEM'
from candidates candidate
join updated on updated.id = candidate.id;

create or replace function public.auto_checkout_attendance_end_of_day()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now_time time := (now() at time zone 'Asia/Kolkata')::time;
  v_updated integer := 0;
  v_row record;
  v_checkout_time timestamptz;
  v_reason text;
begin
  perform set_config('app.authorized_attendance_checkout', 'DAY_END', true);

  for v_row in
    select attendance.*
    from public.attendance_logs attendance
    where attendance.checkin_time is not null
      and attendance.checkout_time is null
      and (
        attendance.date < v_today
        or (attendance.date = v_today and v_now_time >= time '23:59:00')
      )
    order by attendance.date, attendance.id
    for update
  loop
    if v_row.biometric_punch_count >= 2
       and v_row.biometric_last_punch > v_row.checkin_time then
      v_checkout_time := v_row.biometric_last_punch;
      v_reason := 'Day rollover checkout using last verified biometric punch';
    else
      v_checkout_time :=
        (v_row.date::text || ' 23:59:00+05:30')::timestamptz;
      v_reason := 'Day rollover checkout at 23:59 IST; no separate exit punch';
    end if;

    update public.attendance_logs
    set checkout_time = v_checkout_time,
        checkout_source = 'SYSTEM',
        status = 'AUTO_CHECKED_OUT',
        auto_checkout = true,
        auto_checkout_reason = v_reason,
        undo_token = null,
        undo_expires_at = null,
        work_hours = greatest(
          0,
          round((extract(epoch from (
            v_checkout_time - v_row.checkin_time
          )) / 3600)::numeric, 2)
        ),
        updated_at = now()
    where id = v_row.id;

    insert into public.attendance_audit_logs(
      attendance_id, user_id, action, old_status, new_status,
      old_checkout_at, new_checkout_at, reason, source
    ) values (
      v_row.id, v_row.user_id, 'CHECKOUT_AUTO', v_row.status,
      'AUTO_CHECKED_OUT', null, v_checkout_time, v_reason, 'SYSTEM'
    );
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'updated', v_updated,
    'business_date', v_today,
    'message', 'Open attendance days were finalized after IST rollover.'
  );
end;
$$;

revoke all on function public.auto_checkout_attendance_end_of_day()
  from public, anon, authenticated;
grant execute on function public.auto_checkout_attendance_end_of_day()
  to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in (
      'attendance-auto-checkout-2359-ist',
      'attendance-auto-checkout-day-rollover',
      'auto-close-stale-attendance'
    );
    -- 18:30 UTC is 00:00 IST. The function also catches any older day if a
    -- previous invocation was delayed or temporarily unavailable.
    perform cron.schedule(
      'attendance-auto-checkout-day-rollover',
      '30 18 * * *',
      $job$select public.auto_checkout_attendance_end_of_day()$job$
    );
  end if;
end;
$$;

-- Payroll/admin reconciliation must use the same precedence: biometric first
-- punch for entry, protected HRMS/SYSTEM attendance checkout for exit.
create or replace view public.attendance_reconciliation
with (security_invoker = true)
as
with biometric as (
  select user_id, log_date_only as date,
    min(coalesce(
      log_date,
      (log_date_only::text || ' ' || log_time::text)::timestamp
        at time zone 'Asia/Kolkata'
    )) as bio_in,
    max(coalesce(
      log_date,
      (log_date_only::text || ' ' || log_time::text)::timestamp
        at time zone 'Asia/Kolkata'
    )) filter (where coalesce(
      log_date,
      (log_date_only::text || ' ' || log_time::text)::timestamp
        at time zone 'Asia/Kolkata'
    ) > (
      select min(coalesce(
        inner_log.log_date,
        (inner_log.log_date_only::text || ' ' || inner_log.log_time::text)::timestamp
          at time zone 'Asia/Kolkata'
      ))
      from public.smartoffice_device_logs inner_log
      where inner_log.user_id = device.user_id
        and inner_log.log_date_only = device.log_date_only
    )) as bio_out
  from public.smartoffice_device_logs device
  where user_id is not null and log_date_only is not null and log_time is not null
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
  coalesce(biometric.bio_in, attendance.checkin_time) as final_in,
  attendance.checkout_time as final_out,
  (
    coalesce(biometric.bio_in, attendance.checkin_time) is not null
    and policy.late_checkin_time is not null
    and (
      coalesce(biometric.bio_in, attendance.checkin_time)
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
    when coalesce(biometric.bio_in, attendance.checkin_time) is null
      and exists (
        select 1 from public.field_visits visit
        where visit.user_id = employee.profile_id
          and visit.date = employee.date
          and visit.checkin_time is not null
      ) then 'FV'
    when coalesce(biometric.bio_in, attendance.checkin_time) is null then 'A'
    when attendance.checkout_time is null then 'P-NC'
    else 'P'
  end as report_status,
  case
    when biometric.bio_in is not null then 'BIOMETRIC'
    when attendance.checkin_time is not null then 'APP'
    when exists (
      select 1 from public.field_visits visit
      where visit.user_id = employee.profile_id
        and visit.date = employee.date and visit.checkin_time is not null
    ) then 'FIELD_VISIT'
    else 'NONE'
  end as presence_source,
  case
    when coalesce(biometric.bio_in, attendance.checkin_time) is not null
      and attendance.checkout_time is null then 'NO_CHECKOUT'
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

-- Resume the existing authenticated SmartOffice synchronization after the
-- one-time historical rewrite has released its attendance-row locks.
do $$
declare
  v_publishable_key text;
begin
  select decrypted_secret
  into v_publishable_key
  from vault.decrypted_secrets
  where name = 'SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON'
  limit 1;

  if nullif(v_publishable_key, '') is null then
    raise exception 'BIOMETRIC_CRON_PROJECT_KEY_NOT_CONFIGURED';
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname in (
    'biometric-attendance-sync-every-2-minutes',
    'biometric-attendance-sync-every-minute'
  );
  perform cron.schedule(
    'biometric-attendance-sync-every-minute',
    '* * * * *',
    format(
      $job$
        select net.http_post(
          url := 'https://jidbrwpzfpbursihtvpg.supabase.co/functions/v1/biometric-attendance-sync',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer %s',
            'apikey', '%s',
            'x-biometric-sync-source', 'pg_cron'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 55000
        );
      $job$,
      v_publishable_key,
      v_publishable_key
    )
  );
end;
$$;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260801040000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'attendance_history_rpc', 'rpc_get_my_monthly_attendance_v2',
    'attendance_day_detail_contract', 'attendance-day-v4',
    'attendance_checkin_precedence', 'BIOMETRIC_FIRST_PUNCH',
    'attendance_checkout_precedence', 'HRMS_THEN_IST_ROLLOVER',
    'attendance_regularization_list_rpc',
      'rpc_admin_list_attendance_regularization',
    'attendance_late_cutoff', '10:32:00',
    'attendance_late_boundary', 'INCLUSIVE',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'biometric_cron_auth', 'PROJECT_PUBLISHABLE_KEY',
    'smartoffice_config', 'DATABASE_VAULT_SERVICE_ROLE',
    'field_visit_evidence_rpc', 'submit_field_visit_current_location_v3',
    'admin_dashboard_rpc', 'rpc_admin_dashboard_summary',
    'authenticated_profile_rpc', 'rpc_get_my_profile_v2',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260801.1',
      'otp-auth', '20260731.1',
      'field-visit-evidence-upload', '20260731.2',
      'smartoffice-proxy', '20260801.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
