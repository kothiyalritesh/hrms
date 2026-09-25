-- Active Workforce & Dashboard Summary Migration
-- Updates rpc_admin_dashboard_summary() to distinguish:
--   - today_attendance: Historical total of unique employees who checked in today
--   - currently_checked_in: Real-time count of unique employees currently checked in (checkout_time is null)
--   - checked_out_today: Count of unique employees who checked in and subsequently checked out today
create or replace function public.rpc_admin_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_today date := (v_now at time zone 'Asia/Kolkata')::date;
  v_total_employees bigint;
  v_active_employees bigint;
  v_today_attendance bigint;
  v_currently_checked_in bigint;
  v_checked_out_today bigint;
  v_pending_leaves bigint;
  v_overdue_tasks bigint;
  v_open_tickets bigint;
  v_live_tracking bigint;
begin
  perform public.require_profile_admin();

  select count(*), count(*) filter (where profile.is_active)
  into v_total_employees, v_active_employees
  from public.profiles profile;

  -- Historical cumulative check-ins today (never decreases after checkout)
  select count(distinct attendance.user_id)
  into v_today_attendance
  from public.attendance_logs attendance
  where attendance.date = v_today
    and attendance.checkin_time is not null;

  -- Real-time active checked-in workforce (decreases when an employee checks out)
  select count(distinct attendance.user_id)
  into v_currently_checked_in
  from public.attendance_logs attendance
  where attendance.date = v_today
    and attendance.checkin_time is not null
    and attendance.checkout_time is null
    and coalesce(attendance.status, 'CHECKED_IN') in ('CHECKED_IN', 'present', 'LATE');

  -- Employees who have checked out today
  select count(distinct attendance.user_id)
  into v_checked_out_today
  from public.attendance_logs attendance
  where attendance.date = v_today
    and attendance.checkin_time is not null
    and attendance.checkout_time is not null;

  select count(*)
  into v_pending_leaves
  from public.leave_requests request
  where lower(coalesce(request.status, '')) = 'pending';

  select count(*)
  into v_overdue_tasks
  from public.tasks task
  where task.due_date is not null
    and task.due_date::date < v_today
    and lower(coalesce(task.status, '')) in ('pending', 'in_progress');

  select count(*)
  into v_open_tickets
  from public.support_tickets ticket
  where lower(coalesce(ticket.status, '')) in ('open', 'in_progress');

  select count(distinct tracking.user_id)
  into v_live_tracking
  from public.location_tracking tracking
  where tracking.recorded_at >= v_now - interval '15 minutes'
    and tracking.recorded_at <= v_now + interval '10 seconds'
    and tracking.latitude is not null
    and tracking.longitude is not null;

  return jsonb_build_object(
    'success', true,
    'server_now', v_now,
    'business_date', v_today,
    'timezone', 'Asia/Kolkata',
    'total_employees', v_total_employees,
    'active_employees', v_active_employees,
    'today_attendance', v_today_attendance,
    'currently_checked_in', v_currently_checked_in,
    'checked_out_today', v_checked_out_today,
    'pending_leaves', v_pending_leaves,
    'overdue_tasks', v_overdue_tasks,
    'open_tickets', v_open_tickets,
    'live_tracking', v_live_tracking
  );
end;
$$;

revoke all on function public.rpc_admin_dashboard_summary() from public, anon;
grant execute on function public.rpc_admin_dashboard_summary() to authenticated;
