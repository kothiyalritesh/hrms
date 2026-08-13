-- A missing historical joining date must remain visible as a setup warning on
-- historical days, but it must not invalidate today's live attendance. Current
-- day verification depends on the captured assignment, policy and calendar.

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
    when report.history_verified
         and (
           report.date = (now() at time zone 'Asia/Kolkata')::date
           or profile.joining_date is not null
         )
      then report.is_late
    else false
  end as is_late,
  report.has_field_visit,
  case
    when not (
           report.history_verified
           and (
             report.date = (now() at time zone 'Asia/Kolkata')::date
             or profile.joining_date is not null
           )
         )
         and report.final_in is null
         and not report.has_field_visit
      then 'CONFIG_REQUIRED'
    else report.report_status
  end as report_status,
  report.presence_source,
  case
    when not (
      report.history_verified
      and (
        report.date = (now() at time zone 'Asia/Kolkata')::date
        or profile.joining_date is not null
      )
    ) then 'CONFIG_REQUIRED'
    else report.suggested_status
  end as suggested_status,
  report.fraud_severity,
  report.fraud_score,
  report.history_verified
    and (
      report.date = (now() at time zone 'Asia/Kolkata')::date
      or profile.joining_date is not null
    ) as history_verified
from public.attendance_reconciliation report
join public.profiles profile on profile.id = report.user_id
where report.date < (now() at time zone 'Asia/Kolkata')::date
   or coalesce(profile.is_active, false);

revoke all on public.attendance_reconciliation_v2
  from public, anon, authenticated;

notify pgrst, 'reload schema';

