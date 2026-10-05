-- Migration: 20260908090000_enhanced_visit_reports.sql
-- Enhanced Site Visit Report Export with Scoped Access, 90-Day Range Limit, and Audit Logging

drop function if exists public.generate_site_visit_report(date, date);

create or replace function public.generate_site_visit_report(
  p_start_date date,
  p_end_date   date
)
returns table (
  employee_name         text,
  employee_no           text,
  department            text,
  branch                text,
  visit_date            date,
  day_of_week           text,
  check_in_time         text,
  check_out_time        text,
  project_name          text,
  client_name           text,
  client_phone          text,
  visit_type            text,
  visit_status          text,
  duration_minutes      int,
  distance_travelled_km double precision,
  tracking_status       text,
  gps_point_count       int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_is_admin    boolean := false;
  v_record_count int := 0;
begin
  -- 1. Authentication
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  -- 2. Date-Range Limit (Maximum 90 days)
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  if (p_end_date - p_start_date) > 90 then
    raise exception 'Please select a maximum 90-day range.';
  end if;

  -- 3. Permission Gate
  select exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) into v_is_admin;

  if not v_is_admin and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'view_location_reports' and revoked_at is null
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  -- 4. Count for audit log
  select count(*) into v_record_count
  from public.field_visits fv
  where fv.date between p_start_date and p_end_date
    and (v_is_admin or public.can_access_user_data(fv.user_id, 'view_location_reports'));

  -- 5. Audit Log Entry
  perform public.log_audit_event(
    'LOCATION_REPORT_EXPORTED',
    'field_visits',
    null,
    null,
    jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date,
      'records_count', v_record_count
    )
  );

  -- 6. Query and Return Rows
  return query
  select
    p.name as employee_name,
    p.employee_number as employee_no,
    p.department,
    coalesce(off.name, 'Main Office') as branch,
    fv.date as visit_date,
    to_char(fv.date, 'FMDay') as day_of_week,
    to_char(fv.checkin_time at time zone 'Asia/Kolkata', 'HH12:MI AM') as check_in_time,
    to_char(fv.checkout_time at time zone 'Asia/Kolkata', 'HH12:MI AM') as check_out_time,
    coalesce(fv.project_name, fv.location_name, 'Site') as project_name,
    coalesce(fv.client_name, fv.contact_name) as client_name,
    coalesce(fv.client_phone, fv.contact_phone) as client_phone,
    fv.visit_type,
    fv.status as visit_status,
    case
      when fv.checkout_time is not null and fv.checkin_time is not null
      then (extract(epoch from (fv.checkout_time - fv.checkin_time))::int / 60)
      else null
    end as duration_minutes,
    coalesce(round((fv.last_distance_m / 1000.0)::numeric, 2)::double precision, 0.0) as distance_travelled_km,
    coalesce(svl.tracking_status, 'COMPLETED') as tracking_status,
    coalesce(pts.cnt, 0)::int as gps_point_count
  from public.field_visits fv
  join public.profiles p on p.id = fv.user_id
  left join public.offices off on off.id = p.office_id
  left join public.site_visit_live_locations svl on svl.field_visit_id = fv.id
  left join lateral (
    select count(*)::int as cnt
    from public.site_visit_location_history hist
    where hist.field_visit_id = fv.id
  ) pts on true
  where fv.date between p_start_date and p_end_date
    and (v_is_admin or public.can_access_user_data(fv.user_id, 'view_location_reports'))
  order by fv.date desc, p.name asc, fv.created_at asc;
end $$;

revoke all on function public.generate_site_visit_report(date, date) from public, anon;
grant execute on function public.generate_site_visit_report(date, date) to authenticated;

notify pgrst, 'reload schema';

