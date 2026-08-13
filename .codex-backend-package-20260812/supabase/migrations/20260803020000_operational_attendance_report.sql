-- The attendance-intelligence screen is operational, not a payroll approval
-- endpoint. Return available rows even when HR setup is incomplete and mark
-- those rows CONFIG_REQUIRED. The original fail-closed payroll RPC remains
-- unchanged for workflows that require fully verified historical inputs.

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
    when report.history_verified and profile.joining_date is not null
      then report.is_late
    else false
  end as is_late,
  report.has_field_visit,
  case
    when not (report.history_verified and profile.joining_date is not null)
         and report.final_in is null
         and not report.has_field_visit
      then 'CONFIG_REQUIRED'
    else report.report_status
  end as report_status,
  report.presence_source,
  case
    when not (report.history_verified and profile.joining_date is not null)
      then 'CONFIG_REQUIRED'
    else report.suggested_status
  end as suggested_status,
  report.fraud_severity,
  report.fraud_score,
  report.history_verified and profile.joining_date is not null
    as history_verified
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

notify pgrst, 'reload schema';

