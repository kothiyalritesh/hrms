-- =============================================================================
-- 20261009100000_bugfix_profile_notifications_tasks.sql
--
-- Bug report 2026-10-09. Idempotent; safe to re-run. No data is changed.
--
-- BUG-05  profiles.home_address. The original migration shares the version
--         20261008150000 with location_ping_request_notify, so the Supabase CLI
--         records only one of them and the column can be missing.
-- BUG-04  rpc_update_my_profile also saves the address. Direct UPDATE on
--         profiles is revoked for users (20260729040000), so the screen's old
--         direct update always failed. Users may set or correct their own
--         address; nothing else about the profile changes.
-- BUG-01  Users can delete their own notifications (Clear All). Before, only
--         admins had a DELETE policy, so Clear All removed nothing.
-- BUG-11  HR panel: holders of tasks.manage (not only tasks.view) get the
--         task card and counts.
-- =============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS home_address text;
ALTER TABLE public.field_visits ADD COLUMN IF NOT EXISTS lead_source text;

-- ---------------------------------------------------------------------------
-- BUG-04
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_update_my_profile(p_values jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_address text := nullif(btrim(p_values->>'home_address'), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF nullif(btrim(p_values->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'PROFILE_NAME_REQUIRED';
  END IF;
  IF v_address IS NOT NULL AND length(v_address) > 500 THEN
    RAISE EXCEPTION 'ADDRESS_TOO_LONG' USING HINT = 'Use at most 500 characters.';
  END IF;
  UPDATE public.profiles
  SET name = btrim(p_values->>'name'),
      avatar = CASE
        WHEN p_values ? 'avatar' THEN nullif(btrim(p_values->>'avatar'), '')
        ELSE avatar
      END,
      home_address = CASE
        WHEN p_values ? 'home_address' AND v_address IS NOT NULL THEN v_address
        ELSE home_address
      END,
      updated_at = now()
  WHERE id = auth.uid() AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_PROFILE_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_update_my_profile(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_update_my_profile(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- BUG-01
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS notifications_self_delete ON public.notifications;
CREATE POLICY notifications_self_delete
  ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());
GRANT DELETE ON TABLE public.notifications TO authenticated;

-- ---------------------------------------------------------------------------
-- BUG-11 (same function as 20261007110000; only the task permission changed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_now   timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'Asia/Kolkata')::date;
  v_admin boolean;
  can_employees boolean; can_attendance boolean; can_leave boolean;
  can_tasks boolean; can_tickets boolean; can_tracking boolean;
  v_total_employees bigint; v_active_employees bigint; v_today_attendance bigint;
  v_currently_checked_in bigint; v_checked_out_today bigint; v_pending_leaves bigint;
  v_overdue_tasks bigint; v_open_tickets bigint; v_live_tracking bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  v_admin        := public.hrms_is_admin_user(v_uid);
  can_employees  := v_admin OR public.hrms_has_permission('employees.view');
  can_attendance := v_admin OR public.hrms_has_permission('attendance.view');
  can_leave      := v_admin OR public.hrms_has_permission('leave.view') OR public.hrms_has_permission('leave.approve');
  can_tasks      := v_admin OR public.hrms_has_permission('tasks.view') OR public.hrms_has_permission('tasks.manage');
  can_tickets    := v_admin OR public.hrms_has_permission('tickets.manage');
  can_tracking   := v_admin OR public.hrms_has_permission('live_tracking.view');

  IF NOT (can_employees OR can_attendance OR can_leave OR can_tasks OR can_tickets OR can_tracking) THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED: HR panel'
      USING ERRCODE = '42501', HINT = 'Ask an administrator to grant a permission in the Permission Manager.';
  END IF;

  IF can_employees THEN
    WITH scope AS (SELECT public.authorized_user_ids('employees.view') AS id)
    SELECT count(*),
           count(*) FILTER (WHERE p.is_active = true
                              AND p.attendance_reporting_enabled = true
                              AND (p.last_working_date IS NULL OR p.last_working_date >= v_today)
                              AND (p.joining_date IS NULL OR p.joining_date <= v_today))
    INTO v_total_employees, v_active_employees
    FROM public.profiles p
    WHERE v_admin OR p.id IN (SELECT id FROM scope);
  END IF;

  IF can_attendance THEN
    WITH scope AS (SELECT public.authorized_user_ids('attendance.view') AS id),
    day AS (
      SELECT a.user_id,
             bool_or(a.checkin_time IS NOT NULL) AS checked_in,
             bool_or(a.checkin_time IS NOT NULL AND a.checkout_time IS NULL
                     AND coalesce(a.status, 'CHECKED_IN') IN ('CHECKED_IN', 'present', 'LATE')) AS still_in,
             bool_or(a.checkin_time IS NOT NULL AND a.checkout_time IS NOT NULL) AS checked_out
      FROM public.attendance_logs a
      JOIN public.profiles p ON p.id = a.user_id
      WHERE a.date = v_today
        AND p.is_active = true
        AND p.attendance_reporting_enabled = true
        AND (p.last_working_date IS NULL OR p.last_working_date >= v_today)
        AND (v_admin OR a.user_id IN (SELECT id FROM scope))
      GROUP BY a.user_id)
    SELECT count(*) FILTER (WHERE checked_in),
           count(*) FILTER (WHERE still_in),
           count(*) FILTER (WHERE checked_out)
    INTO v_today_attendance, v_currently_checked_in, v_checked_out_today
    FROM day;
  END IF;

  IF can_leave THEN
    SELECT count(*) INTO v_pending_leaves
    FROM public.leave_requests r
    WHERE lower(coalesce(r.status, '')) = 'pending'
      AND (v_admin
           OR r.user_id IN (SELECT public.authorized_user_ids('leave.view'))
           OR r.user_id IN (SELECT public.authorized_user_ids('leave.approve')));
  END IF;

  IF can_tasks THEN
    SELECT count(*) INTO v_overdue_tasks
    FROM public.tasks t
    WHERE t.due_date IS NOT NULL
      AND t.due_date::date < v_today
      AND lower(coalesce(t.status, '')) IN ('pending', 'in_progress')
      AND (v_admin
           OR t.assigned_to IN (SELECT public.authorized_user_ids('tasks.view'))
           OR t.assigned_to IN (SELECT public.authorized_user_ids('tasks.manage')));
  END IF;

  IF can_tickets THEN
    SELECT count(*) INTO v_open_tickets
    FROM public.support_tickets t
    WHERE lower(coalesce(t.status, '')) IN ('open', 'in_progress');
  END IF;

  IF can_tracking THEN
    -- recorded_at is IST wall-clock (timestamp without time zone) in production
    SELECT count(DISTINCT lt.user_id) INTO v_live_tracking
    FROM public.location_tracking lt
    WHERE lt.recorded_at >= v_now - interval '1 day'
      AND public.hrms_timestamp(lt.recorded_at) >= v_now - interval '15 minutes'
      AND public.hrms_timestamp(lt.recorded_at) <= v_now + interval '10 seconds'
      AND lt.latitude IS NOT NULL AND lt.longitude IS NOT NULL
      AND (v_admin OR lt.user_id IN (SELECT public.authorized_user_ids('live_tracking.view')));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'server_now', v_now,
    'business_date', v_today,
    'timezone', 'Asia/Kolkata',
    'scoped', NOT v_admin,
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
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_dashboard_summary() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_dashboard_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
