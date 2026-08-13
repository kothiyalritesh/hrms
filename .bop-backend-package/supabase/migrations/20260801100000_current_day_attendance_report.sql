-- Current-day operational reporting must remain available even when an active
-- employee is missing office/policy configuration. Such rows are labelled
-- CONFIG_REQUIRED rather than falsely counted absent. Historical payroll
-- periods continue to fail closed when effective-dated history is incomplete.

create or replace view public.attendance_reconciliation_v2
with (security_invoker = true)
as
select
  report.user_id,
  report.date,
  report.name,
  report.employee_number,
  report.office_id,
  report.office_name,
  report.team,
  report.reports_to,
  report.team_head_name,
  report.role,
  report.app_in,
  report.app_out,
  report.bio_in,
  report.bio_out,
  report.final_in,
  report.final_out,
  case
    when report.history_verified then report.is_late
    else false
  end as is_late,
  report.has_field_visit,
  case
    when not report.history_verified
         and report.final_in is null
         and not report.has_field_visit
      then 'CONFIG_REQUIRED'
    else report.report_status
  end as report_status,
  report.presence_source,
  case
    when not report.history_verified then 'CONFIG_REQUIRED'
    else report.suggested_status
  end as suggested_status,
  report.fraud_severity,
  report.fraud_score,
  report.history_verified
from public.attendance_reconciliation report
join public.profiles profile on profile.id = report.user_id
where report.date < (now() at time zone 'Asia/Kolkata')::date
   or coalesce(profile.is_active, false);

revoke all on public.attendance_reconciliation_v2
  from public, anon, authenticated;

create or replace function public.rpc_admin_attendance_reconciliation_v2(
  p_start date,
  p_end date,
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof public.attendance_reconciliation_v2
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.require_profile_admin();
  if p_start is null or p_end is null or p_end < p_start
     or p_end > v_today
     or p_end - p_start > 366
     or p_offset < 0 or p_limit < 1 or p_limit > 1000 then
    raise exception 'INVALID_ATTENDANCE_REPORT_RANGE';
  end if;

  if p_start < v_today and exists (
    select 1 from public.profiles profile
    where profile.joining_date is null
      and (profile.created_at at time zone 'Asia/Kolkata')::date <= p_end
  ) then
    raise exception 'JOINING_DATE_HISTORY_REQUIRED';
  end if;

  if p_start < v_today and exists (
    select 1
    from public.profiles profile
    cross join lateral generate_series(
      greatest(p_start, profile.joining_date),
      least(p_end, coalesce(profile.last_working_date, p_end)),
      interval '1 day'
    ) report_day
    where report_day::date < v_today
      and profile.joining_date is not null
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

  if p_start < v_today and exists (
    select 1
    from public.attendance_reconciliation_v2 report
    where report.date between p_start and least(p_end, v_today - 1)
      and not report.history_verified
  ) then
    raise exception 'HISTORICAL_ASSIGNMENT_OR_POLICY_NOT_VERIFIED';
  end if;

  return query
  select *
  from public.attendance_reconciliation_v2 report
  where report.date between p_start and p_end
  order by report.date desc, report.employee_number, report.user_id
  offset p_offset limit p_limit;
end;
$$;

revoke all on function public.rpc_admin_attendance_reconciliation_v2(
  date, date, integer, integer
) from public, anon;
grant execute on function public.rpc_admin_attendance_reconciliation_v2(
  date, date, integer, integer
) to authenticated;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260801100000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'attendance_history_rpc', 'rpc_get_my_monthly_attendance_v3',
    'attendance_day_detail_contract', 'attendance-day-v6',
    'attendance_checkin_precedence', 'BIOMETRIC_FIRST_PUNCH',
    'attendance_checkout_precedence', 'HRMS_THEN_IST_ROLLOVER',
    'sunday_event_comp_off', 'MARKETING_ONLY_IDEMPOTENT',
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
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation_v2',
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
