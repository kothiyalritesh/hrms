-- Migration: 20260908030000_visit_report_export.sql
-- Exports site visit data in tabular format for weekly/custom date range reports.

create or replace function public.generate_site_visit_report(
  p_start_date date,
  p_end_date   date
)
returns table (
  employee_name     text,
  employee_no       text,
  visit_date        date,
  day_of_week       text,
  check_in_time     text,
  check_out_time    text,
  project_name      text,
  client_name       text,
  client_phone      text,
  visit_status      text,
  duration_minutes  int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.name,
    p.employee_number,
    fv.date,
    to_char(fv.date, 'FMDay'),
    to_char(fv.checkin_time at time zone 'Asia/Kolkata', 'HH12:MI AM'),
    to_char(fv.checkout_time at time zone 'Asia/Kolkata', 'HH12:MI AM'),
    coalesce(fv.project_name, fv.location_name),
    fv.client_name,
    fv.client_phone,
    fv.status,
    case
      when fv.checkout_time is not null and fv.checkin_time is not null
      then (extract(epoch from (fv.checkout_time - fv.checkin_time))::int / 60)
      else null
    end as duration_minutes
  from public.field_visits fv
  join public.profiles p on p.id = fv.user_id
  where fv.date between p_start_date and p_end_date
    and (
      auth.uid() = fv.user_id
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
      )
      or exists (
        select 1 from public.user_permissions
        where user_id = auth.uid() and permission = 'view_location_reports'
      )
    )
  order by fv.date desc, p.name asc, fv.created_at asc;
$$;

revoke all on function public.generate_site_visit_report(date, date) from public, anon;
grant execute on function public.generate_site_visit_report(date, date) to authenticated;
