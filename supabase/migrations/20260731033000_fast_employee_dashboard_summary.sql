-- Keep the employee dashboard bounded to one authenticated database request.
-- Previously the screen issued many sequential browser queries (including the
-- same team lookup twice), which amplified network latency and auth-lock waits.

create index if not exists profiles_reports_to_active_idx
  on public.profiles(reports_to, id)
  where is_active = true;

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id)
  where read = false;

create index if not exists tasks_assignee_pending_due_idx
  on public.tasks(assigned_to, due_date)
  where status = 'pending';

create index if not exists field_visits_user_date_pending_idx
  on public.field_visits(user_id, date, created_at)
  where status in ('PENDING', 'CHECKED_IN');

create index if not exists escalation_matrix_user_idx
  on public.escalation_matrix(user_id);

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
