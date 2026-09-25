-- 1. Ensure type column exists on tasks table
alter table public.tasks
  add column if not exists type text default 'other';

-- 2. Index for fast task retrieval by assignee, status, and due date
create index if not exists idx_tasks_assigned_status_due
  on public.tasks (assigned_to, status, due_date asc nulls last)
  where status = 'pending';

-- 3. Optimized employee dashboard summary RPC
create or replace function public.rpc_employee_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_today date := (v_now at time zone 'Asia/Kolkata')::date;
  v_profile public.profiles%rowtype;
  v_attendance jsonb;
  v_leave_balance jsonb;
  v_tasks jsonb;
  v_pending_tasks_count bigint := 0;
  v_site_visit_tasks_count bigint := 0;
  v_unread_notifications bigint := 0;
  v_pending_visits bigint := 0;
  v_direct_reports bigint := 0;
  v_is_escalation_member boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'AUTHENTICATION_REQUIRED',
      'message', 'A valid authenticated session is required.'
    );
  end if;

  select profile.*
  into v_profile
  from public.profiles profile
  where profile.id = v_user_id;

  if not found or not coalesce(v_profile.is_active, false) then
    return jsonb_build_object(
      'success', false,
      'error', 'ACTIVE_PROFILE_REQUIRED',
      'message', 'An active employee profile is required.'
    );
  end if;

  -- 1. Today's attendance
  select to_jsonb(attendance)
  into v_attendance
  from public.attendance_logs attendance
  where attendance.user_id = v_user_id
    and attendance.date = v_today
  order by attendance.created_at desc
  limit 1;

  -- 2. Leave balance
  select jsonb_build_object(
    'sick', coalesce(balance.sick, 0),
    'casual', coalesce(balance.casual, 0),
    'earned', coalesce(balance.earned, 0),
    'comp_off', coalesce(balance.comp_off, 0)
  )
  into v_leave_balance
  from public.leave_balance balance
  where balance.user_id = v_user_id
  limit 1;

  -- 3. Notifications count
  select count(*)
  into v_unread_notifications
  from public.notifications notification
  where notification.user_id = v_user_id
    and notification.read = false;

  -- 4. Field visits count
  select count(*)
  into v_pending_visits
  from public.field_visits visit
  where visit.user_id = v_user_id
    and visit.date = v_today
    and visit.status in ('PENDING', 'CHECKED_IN');

  -- 5. Direct reports count
  select count(*)
  into v_direct_reports
  from public.profiles report
  where report.reports_to = v_user_id
    and report.is_active = true;

  -- 6. Escalation matrix check
  select exists (
    select 1
    from public.escalation_matrix matrix
    where matrix.user_id = v_user_id
  ) into v_is_escalation_member;

  -- 7. Scalar task counts
  select
    count(*),
    count(*) filter (where coalesce(task.type, 'other') = 'site_visit')
  into
    v_pending_tasks_count,
    v_site_visit_tasks_count
  from public.tasks task
  where task.assigned_to = v_user_id
    and task.status = 'pending';

  -- 8. Top 5 tasks only with essential fields (trimmed payload)
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', top_task.id,
      'title', top_task.title,
      'status', top_task.status,
      'priority', top_task.priority,
      'due_date', top_task.due_date,
      'type', coalesce(top_task.type, 'other')
    ) order by top_task.due_date asc nulls last
  ), '[]'::jsonb)
  into v_tasks
  from (
    select task.id, task.title, task.status, task.priority, task.due_date, coalesce(task.type, 'other') as type
    from public.tasks task
    where task.assigned_to = v_user_id
      and task.status = 'pending'
    order by task.due_date asc nulls last
    limit 5
  ) top_task;

  return jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'server_now', v_now,
    'business_date', v_today,
    'timezone', 'Asia/Kolkata',
    'attendance', v_attendance,
    'base_latitude', v_profile.base_latitude,
    'base_longitude', v_profile.base_longitude,
    'leave_balance', coalesce(
      v_leave_balance,
      jsonb_build_object('sick', 0, 'casual', 0, 'earned', 0, 'comp_off', 0)
    ),
    'unread_notifications', v_unread_notifications,
    'pending_visits', v_pending_visits,
    'direct_reports', v_direct_reports,
    'is_escalation_member', v_is_escalation_member,
    'pending_tasks_count', v_pending_tasks_count,
    'site_visit_tasks_count', v_site_visit_tasks_count,
    'pending_tasks', v_tasks
  );
end;
$$;

revoke all on function public.rpc_employee_dashboard_summary() from public, anon;
grant execute on function public.rpc_employee_dashboard_summary() to authenticated;

notify pgrst, 'reload schema';