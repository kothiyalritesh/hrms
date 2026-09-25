-- Migration: Fix pending_visits dashboard count (Module 22)
-- Description: The Pending Site Visit card should disappear once the destination is reached (status = CHECKED_IN).

CREATE OR REPLACE FUNCTION public.rpc_employee_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
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
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  -- 1. Leave balance
  SELECT COALESCE(
    jsonb_object_agg(
      LOWER(b.leave_type), 
      COALESCE(b.total_days, 0) + COALESCE(b.carried_over, 0) - COALESCE(b.used_days, 0) - COALESCE(b.locked_days, 0)
    ),
    '{}'::jsonb
  )
  INTO v_leave_balance
  FROM public.employee_leave_balances b
  WHERE b.user_id = v_user_id AND b.year = extract(year from v_today)::integer;

  -- 2. Tasks summary
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE type = 'site_visit'),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'title', title,
          'type', type,
          'due_date', due_date
        ) ORDER BY due_date ASC
      ) FILTER (WHERE type = 'site_visit' AND due_date >= v_today),
      '[]'::jsonb
    )
  INTO v_pending_tasks_count, v_site_visit_tasks_count, v_tasks
  FROM public.tasks
  WHERE assigned_to = v_user_id AND status != 'COMPLETED';

  -- 3. Unread notifications
  SELECT COUNT(*)
  INTO v_unread_notifications
  FROM public.notifications
  WHERE user_id = v_user_id AND read = false;

  -- 4. Field visits count
  -- FIX: User requirement explicitly stated "Once the employee reaches the destination: The Pending screen/card on the Dashboard should disappear/update."
  -- We ONLY count 'PENDING' (not 'CHECKED_IN').
  SELECT COUNT(*)
  INTO v_pending_visits
  FROM public.field_visits
  WHERE user_id = v_user_id
    AND date = v_today
    AND status = 'PENDING';

  -- 5. Direct reports count (for managers)
  SELECT COUNT(*)
  INTO v_direct_reports
  FROM public.profiles
  WHERE reports_to = v_user_id AND is_active = true;

  -- 6. Escalation matrix check (for warnings/flags)
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD', 'ASSOCIATE_PARTNER')
  ) INTO v_is_escalation_member;

  RETURN jsonb_build_object(
    'leave_balance', COALESCE(v_leave_balance, jsonb_build_object('sick', 0, 'casual', 0, 'earned', 0, 'comp_off', 0)),
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
