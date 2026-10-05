CREATE OR REPLACE FUNCTION public.rpc_employee_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'Asia/Kolkata')::date;
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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'AUTHENTICATION_REQUIRED',
      'message', 'A valid authenticated session is required.'
    );
  END IF;

  SELECT profile.* INTO v_profile
  FROM public.profiles profile
  WHERE profile.id = v_user_id;

  IF NOT FOUND OR NOT COALESCE(v_profile.is_active, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ACTIVE_PROFILE_REQUIRED',
      'message', 'An active employee profile is required.'
    );
  END IF;

  -- 1. Today's attendance
  SELECT to_jsonb(attendance) INTO v_attendance
  FROM public.attendance_logs attendance
  WHERE attendance.user_id = v_user_id
    AND attendance.date = v_today
  ORDER BY attendance.created_at DESC
  LIMIT 1;

  -- 2. Leave balance
  SELECT jsonb_build_object(
    'sick', COALESCE(balance.sick, 0),
    'casual', COALESCE(balance.casual, 0),
    'earned', COALESCE(balance.earned, 0),
    'comp_off', COALESCE(balance.comp_off, 0)
  ) INTO v_leave_balance
  FROM public.leave_balance balance
  WHERE balance.user_id = v_user_id
  LIMIT 1;

  -- 3. Notifications count
  SELECT count(*) INTO v_unread_notifications
  FROM public.notifications notification
  WHERE notification.user_id = v_user_id
    AND notification.read = false;

  -- 4. Field visits count
  SELECT count(*) INTO v_pending_visits
  FROM public.field_visits visit
  WHERE visit.user_id = v_user_id
    AND visit.date = v_today
    AND visit.status in ('PENDING', 'CHECKED_IN');

  -- 5. Direct reports count
  SELECT count(*) INTO v_direct_reports
  FROM public.profiles report
  WHERE report.reports_to = v_user_id
    AND report.is_active = true;

  -- 6. Escalation matrix check
  SELECT exists (
    SELECT 1 FROM public.escalation_matrix matrix WHERE matrix.user_id = v_user_id
  ) INTO v_is_escalation_member;

  -- 7. Scalar task counts
  SELECT
    count(*),
    count(*) FILTER (WHERE COALESCE(task.type, 'other') = 'site_visit')
  INTO v_pending_tasks_count, v_site_visit_tasks_count
  FROM public.tasks task
  WHERE task.assigned_to = v_user_id
    AND task.status = 'pending';

  -- 8. Top 5 tasks only with essential fields
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', top_task.id,
      'title', top_task.title,
      'status', top_task.status,
      'priority', top_task.priority,
      'due_date', top_task.due_date,
      'type', COALESCE(top_task.type, 'other')
    ) ORDER BY top_task.due_date ASC NULLS LAST
  ), '[]'::jsonb) INTO v_tasks
  FROM (
    SELECT task.id, task.title, task.status, task.priority, task.due_date, COALESCE(task.type, 'other') AS type
    FROM public.tasks task
    WHERE task.assigned_to = v_user_id
      AND task.status = 'pending'
    ORDER BY task.due_date ASC NULLS LAST
    LIMIT 5
  ) top_task;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'server_now', v_now,
    'business_date', v_today,
    'timezone', 'Asia/Kolkata',
    'attendance', v_attendance,
    'base_latitude', v_profile.base_latitude,
    'base_longitude', v_profile.base_longitude,
    'leave_balance', COALESCE(
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
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_employee_dashboard_summary() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_employee_dashboard_summary() TO authenticated;
NOTIFY pgrst, 'reload schema';
