-- Startup and Dashboard Performance Optimization
-- Aligns query predicates and expression indexes for admin summary, employee dashboard,
-- event announcements, and pending tasks.

-- 1. Admin summary expression indexes
create index if not exists leave_requests_status_expr_idx
  on public.leave_requests((lower(coalesce(status, ''))));

create index if not exists tasks_admin_overdue_expr_idx
  on public.tasks((due_date::date), (lower(coalesce(status, ''))));

create index if not exists support_tickets_status_expr_idx
  on public.support_tickets((lower(coalesce(status, ''))));

create index if not exists location_tracking_recent_live_idx
  on public.location_tracking(recorded_at desc, user_id)
  where latitude is not null and longitude is not null;

-- 2. Event and task access pattern indexes
create index if not exists event_announcements_user_announced_idx
  on public.event_announcements(user_id, announced_at desc);

create index if not exists event_announcements_event_user_idx
  on public.event_announcements(event_id, user_id);

create index if not exists event_checkins_user_event_idx
  on public.event_checkins(user_id, event_id);

create index if not exists event_participants_employee_event_idx
  on public.event_participants(employee_id, event_id);

create index if not exists events_date_start_idx
  on public.events(event_date, start_time);

create index if not exists tasks_assigned_pending_due_idx
  on public.tasks(assigned_to, due_date asc nulls last)
  where status = 'pending';

-- 3. Aligned admin dashboard summary RPC
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

-- 4. Aligned employee dashboard summary RPC
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
  v_unread_notifications bigint := 0;
  v_pending_visits bigint := 0;
  v_direct_reports bigint := 0;
  v_is_escalation_member boolean := false;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select profile.*
  into v_profile
  from public.profiles profile
  where profile.id = v_user_id;

  if not found or not coalesce(v_profile.is_active, false) then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = '42501';
  end if;

  select to_jsonb(attendance)
  into v_attendance
  from public.attendance_logs attendance
  where attendance.user_id = v_user_id
    and attendance.date = v_today
  order by attendance.created_at desc
  limit 1;

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

  select count(*)
  into v_unread_notifications
  from public.notifications notification
  where notification.user_id = v_user_id
    and notification.read = false;

  select count(*)
  into v_pending_visits
  from public.field_visits visit
  where visit.user_id = v_user_id
    and visit.date = v_today
    and visit.status in ('PENDING', 'CHECKED_IN');

  select count(*)
  into v_direct_reports
  from public.profiles report
  where report.reports_to = v_user_id
    and report.is_active = true;

  select exists (
    select 1
    from public.escalation_matrix matrix
    where matrix.user_id = v_user_id
  ) into v_is_escalation_member;

  select coalesce(jsonb_agg(to_jsonb(visible_task) order by visible_task.due_date nulls last), '[]'::jsonb)
  into v_tasks
  from (
    select task.*
    from public.tasks task
    where task.status = 'pending'
      and (
        task.assigned_to = v_user_id
        or exists (
          select 1
          from public.profiles visible_profile
          where visible_profile.id = task.assigned_to
            and visible_profile.is_active = true
            and (
              visible_profile.reports_to = v_user_id
              or (
                v_profile.reports_to is not null
                and visible_profile.reports_to = v_profile.reports_to
              )
            )
        )
      )
    order by task.due_date asc nulls last
    limit 200
  ) visible_task;

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
    'pending_tasks', v_tasks
  );
end;
$$;

revoke all on function public.rpc_employee_dashboard_summary()
  from public, anon;
grant execute on function public.rpc_employee_dashboard_summary()
  to authenticated;

notify pgrst, 'reload schema';

