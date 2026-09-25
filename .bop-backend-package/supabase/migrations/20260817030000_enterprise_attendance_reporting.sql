-- Enterprise attendance reporting contract.
--
-- The operational v3 view intentionally remains available to existing TV and
-- monitoring consumers. This report view corrects its organizational labels
-- and policy classification with verified effective-dated history so an
-- employee transfer cannot rewrite an older report.

create or replace function public.resolve_hrms_calendar_day_at_assignment(
  p_user_id uuid,
  p_office_id uuid,
  p_team_id uuid,
  p_date date
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with candidates as (
  select 'HOLIDAY'::text kind, holiday.name label,
    case
      when holiday.user_id is not null then 4
      when holiday.team_id is not null then 3
      when holiday.office_id is not null then 2
      else 1
    end specificity,
    holiday.id rule_id
  from public.holiday_calendar holiday
  where holiday.is_active
    and not holiday.is_optional
    and holiday.holiday_date = p_date
    and (
      holiday.user_id = p_user_id
      or holiday.team_id = p_team_id
      or holiday.office_id = p_office_id
      or (
        holiday.user_id is null
        and holiday.team_id is null
        and holiday.office_id is null
      )
    )
  union all
  select 'WEEKLY_OFF', to_char(p_date, 'FMDay'),
    case
      when weekly.user_id is not null then 4
      when weekly.team_id is not null then 3
      when weekly.office_id is not null then 2
      else 1
    end,
    weekly.id
  from public.weekly_off_rules weekly
  where weekly.is_active
    and p_date between weekly.valid_from and coalesce(weekly.valid_to, 'infinity'::date)
    and weekly.weekday = extract(dow from p_date)::integer
    and (
      weekly.week_of_month is null
      or weekly.week_of_month = ((extract(day from p_date)::integer - 1) / 7) + 1
    )
    and (
      weekly.user_id = p_user_id
      or weekly.team_id = p_team_id
      or weekly.office_id = p_office_id
      or (
        weekly.user_id is null
        and weekly.team_id is null
        and weekly.office_id is null
      )
    )
)
select coalesce(
  (
    select jsonb_build_object(
      'kind', kind,
      'label', label,
      'specificity', specificity,
      'rule_id', rule_id
    )
    from candidates
    order by specificity desc,
      case kind when 'HOLIDAY' then 0 else 1 end,
      rule_id
    limit 1
  ),
  jsonb_build_object('kind', 'WORKING_DAY', 'specificity', 0)
)
$$;

revoke all on function public.resolve_hrms_calendar_day_at_assignment(
  uuid, uuid, uuid, date
) from public, anon;
grant execute on function public.resolve_hrms_calendar_day_at_assignment(
  uuid, uuid, uuid, date
) to authenticated;

create or replace view public.v_attendance_daily_enterprise
with (security_invoker = true)
as
with historical as (
  select
    canonical.*,
    assignment.employee_name historical_employee_name,
    assignment.employee_number historical_employee_number,
    assignment.office_id historical_office_id,
    assignment.office_name historical_office_name,
    assignment.team historical_team_name,
    assignment.reports_to historical_team_head_id,
    assignment.manager_name historical_team_head_name,
    assignment.role historical_role,
    coalesce(assignment.verified, false) assignment_verified,
    resolved_team.id historical_team_id,
    policy.late_checkin_time historical_late_checkin_time,
    coalesce(policy.verified, false) policy_verified,
    public.resolve_hrms_calendar_day_at_assignment(
      canonical.user_id,
      assignment.office_id,
      resolved_team.id,
      canonical.work_date
    ) calendar_value,
    leave_request.leave_type,
    fraud.severity fraud_severity,
    fraud.score fraud_score,
    fraud.reasons fraud_reasons
  from public.v_attendance_daily_canonical canonical
  left join lateral (
    select history.*
    from public.employee_assignment_history history
    where history.profile_id = canonical.user_id
      and canonical.work_date >= history.effective_from
      and (
        history.effective_to is null
        or canonical.work_date <= history.effective_to
      )
    order by history.verified desc, history.effective_from desc,
      history.recorded_at desc, history.id
    limit 1
  ) assignment on true
  left join public.teams resolved_team
    on lower(btrim(resolved_team.name)) = lower(btrim(assignment.team))
  left join lateral (
    select history.late_checkin_time, history.verified
    from public.attendance_policy_history history
    where history.office_id = assignment.office_id
      and lower(history.role) in (
        lower(coalesce(assignment.role, '')),
        'all'
      )
      and canonical.work_date >= history.effective_from
      and (
        history.effective_to is null
        or canonical.work_date <= history.effective_to
      )
    order by
      case
        when lower(history.role) = lower(coalesce(assignment.role, '')) then 0
        else 1
      end,
      history.verified desc,
      history.effective_from desc,
      history.id
    limit 1
  ) policy on true
  left join lateral (
    select request.leave_type
    from public.leave_requests request
    where request.user_id = canonical.user_id
      and lower(request.status) = 'approved'
      and canonical.work_date between request.start_date and request.end_date
    order by request.created_at, request.id
    limit 1
  ) leave_request on true
  left join lateral (
    select event.severity, event.score, event.reasons
    from public.attendance_fraud_events event
    where event.attendance_id = canonical.attendance_log_id
    order by event.created_at desc, event.id
    limit 1
  ) fraud on true
), classified as (
  select historical.*,
    historical.assignment_verified and historical.policy_verified
      and historical.historical_office_id is not null
      as enterprise_history_verified,
    case
      when not historical.assignment_verified then 'ASSIGNMENT_HISTORY_NOT_VERIFIED'
      when historical.historical_office_id is null then 'HISTORICAL_OFFICE_NOT_ASSIGNED'
      when not historical.policy_verified then 'POLICY_HISTORY_NOT_VERIFIED'
      else null
    end configuration_issue
  from historical
)
select
  attendance_log_id,
  user_id,
  work_date,
  coalesce(historical_employee_name, employee_name) employee_name,
  coalesce(historical_employee_number, employee_number) employee_number,
  historical_office_id office_id,
  historical_office_name office_name,
  historical_team_id team_id,
  historical_team_name team_name,
  historical_team_head_id team_head_id,
  historical_team_head_name team_head_name,
  historical_role role,
  app_first_in,
  biometric_first_in,
  field_visit_first_in,
  official_first_in,
  first_in_source,
  app_checkout,
  approved_regularization_checkout,
  admin_corrected_checkout,
  official_last_out,
  last_out_source,
  biometric_last_punch_evidence,
  field_visit_checkout,
  presence_source,
  case
    when not enterprise_history_verified then 'CONFIG_REQUIRED'
    when leave_type is not null then 'ON_LEAVE'
    when calendar_value->>'kind' = 'HOLIDAY' then 'HOLIDAY'
    when calendar_value->>'kind' = 'WEEKLY_OFF' then 'WEEKLY_OFF'
    when official_first_in is null then 'ABSENT'
    when official_last_out is not null then 'CHECKED_OUT'
    when has_field_visit then 'FIELD_VISIT'
    when historical_late_checkin_time is not null
      and (official_first_in at time zone 'Asia/Kolkata')::time
        >= historical_late_checkin_time then 'LATE'
    else 'PRESENT'
  end attendance_status,
  enterprise_history_verified
    and official_first_in is not null
    and historical_late_checkin_time is not null
    and (official_first_in at time zone 'Asia/Kolkata')::time
      >= historical_late_checkin_time as is_late,
  working_minutes,
  case
    when configuration_issue is not null then configuration_issue
    when tracking_health_reason is not null then tracking_health_reason
    when warning is not null then warning::text
    when official_first_in is not null and official_last_out is null then 'No checkout'
    else null
  end warning,
  has_field_visit,
  enterprise_history_verified history_verified,
  show_on_tv,
  latest_ping_at,
  latest_accuracy_m,
  latest_tracking_status,
  tracking_health_reason,
  ping_is_stale,
  active_field_visit_id,
  active_field_visit_name,
  distance_from_destination_m,
  distance_from_office_m,
  tracking_session_status,
  fraud_severity,
  fraud_score,
  fraud_reasons,
  configuration_issue
from classified;

revoke all on public.v_attendance_daily_enterprise
  from public, anon, authenticated;

create or replace function public.rpc_admin_attendance_report_v4(
  p_start date,
  p_end date,
  p_offset integer default 0,
  p_limit integer default 500,
  p_office_names text[] default null,
  p_team_names text[] default null,
  p_head_names text[] default null,
  p_roles text[] default null,
  p_statuses text[] default null,
  p_sources text[] default null,
  p_search text default null,
  p_exceptions_only boolean default false
) returns setof public.v_attendance_daily_enterprise
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_profile_admin();
  if p_start is null
     or p_end is null
     or p_end < p_start
     or p_end > (now() at time zone 'Asia/Kolkata')::date
     or p_end - p_start > 366
     or p_offset < 0
     or p_limit < 1
     or p_limit > 1000 then
    raise exception 'INVALID_ATTENDANCE_REPORT_RANGE';
  end if;

  return query
  select report.*
  from public.v_attendance_daily_enterprise report
  where report.work_date between p_start and p_end
    and (
      coalesce(cardinality(p_office_names), 0) = 0
      or regexp_replace(lower(btrim(report.office_name)), '\\s+office$', '') = any (
        select regexp_replace(lower(btrim(value)), '\\s+office$', '')
        from unnest(p_office_names) value
      )
    )
    and (
      coalesce(cardinality(p_team_names), 0) = 0
      or regexp_replace(lower(btrim(report.team_name)), '\\s+team$', '') = any (
        select regexp_replace(lower(btrim(value)), '\\s+team$', '')
        from unnest(p_team_names) value
      )
    )
    and (
      coalesce(cardinality(p_head_names), 0) = 0
      or lower(btrim(report.team_head_name)) = any (
        select lower(btrim(value)) from unnest(p_head_names) value
      )
    )
    and (
      coalesce(cardinality(p_roles), 0) = 0
      or replace(upper(btrim(report.role)), '_', ' ') = any (
        select replace(upper(btrim(value)), '_', ' ')
        from unnest(p_roles) value
      )
    )
    and (
      coalesce(cardinality(p_sources), 0) = 0
      or upper(report.presence_source) = any (
        select upper(btrim(value)) from unnest(p_sources) value
      )
    )
    and (
      nullif(btrim(p_search), '') is null
      or report.employee_name ilike '%' || btrim(p_search) || '%'
      or coalesce(report.employee_number, '') ilike '%' || btrim(p_search) || '%'
    )
    and (
      coalesce(cardinality(p_statuses), 0) = 0
      or exists (
        select 1
        from unnest(p_statuses) requested(value)
        where
          (upper(btrim(requested.value)) = upper(report.attendance_status))
          or (
            upper(btrim(requested.value)) = 'NO_CHECKOUT'
            and report.official_first_in is not null
            and report.official_last_out is null
          )
          or (
            upper(btrim(requested.value)) = 'FIELD_VISIT'
            and report.has_field_visit
          )
          or (
            upper(btrim(requested.value)) = 'SUSPICIOUS_GPS'
            and (
              upper(coalesce(report.fraud_severity, '')) = 'SUSPICIOUS'
              or report.tracking_health_reason is not null
              or report.ping_is_stale
            )
          )
      )
    )
    and (
      not p_exceptions_only
      or report.attendance_status in ('ABSENT', 'LATE', 'CONFIG_REQUIRED')
      or (
        report.official_first_in is not null
        and report.official_last_out is null
      )
      or upper(coalesce(report.fraud_severity, '')) in ('WARNING', 'SUSPICIOUS')
      or report.tracking_health_reason is not null
    )
  order by report.work_date desc,
    report.employee_number nulls last,
    report.user_id
  offset p_offset limit p_limit;
end
$$;

revoke all on function public.rpc_admin_attendance_report_v4(
  date, date, integer, integer, text[], text[], text[], text[], text[], text[], text, boolean
) from public, anon;
grant execute on function public.rpc_admin_attendance_report_v4(
  date, date, integer, integer, text[], text[], text[], text[], text[], text[], text, boolean
) to authenticated;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
select jsonb_build_object(
  'backend_schema_version', '20260817030000',
  'attendance_timezone', 'Asia/Kolkata',
  'attendance_context_contract', 'OFFICE|BIOMETRIC|FIELD_VISIT|EVENT',
  'attendance_reporting_contract', 'enterprise-v4|effective-dated|server-filtered',
  'event_audience_contract', 'participants_v2|team|department|employee|all',
  'event_comp_off_contract', 'ledger_v2|weekly_off|holiday|extended_duty',
  'notification_contract', 'outbox_v2|live_attendance_state|device_lifecycle'
)
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
