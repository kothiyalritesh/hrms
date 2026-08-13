-- Load the administrator dashboard through one authorized, bounded database
-- request instead of seven independent browser queries.

create index if not exists attendance_logs_dashboard_date_idx
  on public.attendance_logs(date, user_id)
  where checkin_time is not null;
create index if not exists leave_requests_dashboard_status_idx
  on public.leave_requests(lower(status));
create index if not exists tasks_dashboard_due_status_idx
  on public.tasks(due_date, status);
create index if not exists support_tickets_dashboard_status_idx
  on public.support_tickets(status);
create index if not exists location_tracking_dashboard_recent_idx
  on public.location_tracking(recorded_at desc, user_id)
  where latitude is not null and longitude is not null;

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
  v_pending_leaves bigint;
  v_overdue_tasks bigint;
  v_open_tickets bigint;
  v_live_tracking bigint;
begin
  perform public.require_profile_admin();

  select count(*), count(*) filter (where profile.is_active)
  into v_total_employees, v_active_employees
  from public.profiles profile;

  select count(distinct attendance.user_id)
  into v_today_attendance
  from public.attendance_logs attendance
  where attendance.date = v_today
    and attendance.checkin_time is not null;

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
    'pending_leaves', v_pending_leaves,
    'overdue_tasks', v_overdue_tasks,
    'open_tickets', v_open_tickets,
    'live_tracking', v_live_tracking
  );
end;
$$;

revoke all on function public.rpc_admin_dashboard_summary()
  from public, anon;
grant execute on function public.rpc_admin_dashboard_summary()
  to authenticated;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260730260000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'field_visit_evidence_rpc', 'submit_field_visit_current_location_v3',
    'admin_dashboard_rpc', 'rpc_admin_dashboard_summary',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260731.1',
      'otp-auth', '20260731.1',
      'field-visit-evidence-upload', '20260731.2',
      'smartoffice-proxy', '20260731.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
