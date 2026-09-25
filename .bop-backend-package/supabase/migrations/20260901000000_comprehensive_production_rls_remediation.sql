-- ============================================================================
-- PRODUCTION SUPABASE RLS SECURITY REMEDIATION
-- Migration: 20260901000000_comprehensive_production_rls_remediation.sql
-- Purpose: Complete least-privilege RLS implementation across all 7 domains,
--          eliminating all unauthorized anonymous/public table access,
--          protecting sensitive HRMS data, securing views, and hardening RPCs.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 0: CORE SECURITY DEFINER FUNCTIONS (IDEMPOTENT HARDENING)
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Normalization helper
CREATE OR REPLACE FUNCTION public.normalize_profile_role(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE regexp_replace(
    upper(btrim(coalesce(p_role, ''))),
    '[^A-Z0-9]+',
    '_',
    'g'
  )
    WHEN 'SUPER_ADMIN' THEN 'SYSTEM_ADMIN'
    WHEN 'SUPERADMIN' THEN 'SYSTEM_ADMIN'
    WHEN 'SYSTEMADMIN' THEN 'SYSTEM_ADMIN'
    WHEN 'SYS_ADMIN' THEN 'SYSTEM_ADMIN'
    WHEN 'ADMINISTRATOR' THEN 'ADMIN'
    WHEN 'HR_MANAGER' THEN 'HR'
    ELSE regexp_replace(
      upper(btrim(coalesce(p_role, ''))),
      '[^A-Z0-9]+',
      '_',
      'g'
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.normalize_profile_role(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.normalize_profile_role(text) TO authenticated, service_role;

-- 2. Profile Admin check (SYSTEM_ADMIN, ADMIN, HR, HRD)
CREATE OR REPLACE FUNCTION public.is_profile_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles actor
    WHERE actor.id = auth.uid()
      AND actor.is_active = true
      AND public.normalize_profile_role(actor.role) IN (
        'SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_profile_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_profile_admin() TO authenticated, service_role;

-- 3. Reviewer hierarchy check (Reports-to recursive CTE + Admin check)
CREATE OR REPLACE FUNCTION public.current_user_can_review(employee_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE team(id) AS (
    SELECT p.id
    FROM public.profiles p
    WHERE p.reports_to = auth.uid()
      AND p.is_active = true
    UNION
    SELECT p.id
    FROM public.profiles p
    JOIN team t ON p.reports_to = t.id
    WHERE p.is_active = true
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles me
    WHERE me.id = auth.uid()
      AND me.is_active = true
      AND (
        public.normalize_profile_role(me.role) IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
        OR (employee_id IS NOT NULL AND employee_id IN (SELECT id FROM team))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_can_review(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_review(uuid) TO authenticated, service_role;

-- 4. Tracking and location viewer check
CREATE OR REPLACE FUNCTION public.can_view_tracking_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles employee
      WHERE employee.id = p_user_id
        AND employee.reports_to = auth.uid()
        AND employee.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles actor
      WHERE actor.id = auth.uid()
        AND actor.is_active = true
        AND public.normalize_profile_role(actor.role) IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_tracking_user(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_view_tracking_user(uuid) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1: P0 ANONYMOUS / PUBLIC POLICY CLEANUP & CORE TABLES
-- (attendance_logs, roles, offices, notifications)
-- ────────────────────────────────────────────────────────────────────────────

-- 1.1 ATTENDANCE_LOGS
DO $$
BEGIN
  IF to_regclass('public.attendance_logs') IS NOT NULL THEN
    ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.attendance_logs FROM anon;

    -- Drop permissive/anonymous legacy policies
    DROP POLICY IF EXISTS "Allow all attendance_logs" ON public.attendance_logs;
    DROP POLICY IF EXISTS "attendance_logs_anon_insert" ON public.attendance_logs;
    DROP POLICY IF EXISTS "attendance_logs_anon_select" ON public.attendance_logs;
    DROP POLICY IF EXISTS "attendance_logs_anon_update" ON public.attendance_logs;
    DROP POLICY IF EXISTS "attendance_logs_anon_delete" ON public.attendance_logs;
    DROP POLICY IF EXISTS "attendance_logs_all_public" ON public.attendance_logs;
    DROP POLICY IF EXISTS "profile_admin_read_all" ON public.attendance_logs;
    DROP POLICY IF EXISTS "attendance_logs_admin_all" ON public.attendance_logs;
    DROP POLICY IF EXISTS "attendance_logs_employee_select" ON public.attendance_logs;
    DROP POLICY IF EXISTS "attendance_logs_employee_insert" ON public.attendance_logs;
    DROP POLICY IF EXISTS "attendance_logs_employee_update" ON public.attendance_logs;

    -- Create explicit least-privilege policies
    CREATE POLICY "attendance_logs_admin_all"
      ON public.attendance_logs
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    CREATE POLICY "attendance_logs_employee_select"
      ON public.attendance_logs
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id));

    CREATE POLICY "attendance_logs_employee_insert"
      ON public.attendance_logs
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());

    CREATE POLICY "attendance_logs_employee_update"
      ON public.attendance_logs
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());

    GRANT SELECT, INSERT, UPDATE ON TABLE public.attendance_logs TO authenticated;
  END IF;
END $$;

-- 1.2 ROLES
DO $$
BEGIN
  IF to_regclass('public.roles') IS NOT NULL THEN
    ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.roles FROM anon;

    DROP POLICY IF EXISTS "Allow all roles" ON public.roles;
    DROP POLICY IF EXISTS "roles_all_public" ON public.roles;
    DROP POLICY IF EXISTS "profile_admin_read_all" ON public.roles;
    DROP POLICY IF EXISTS "roles_read_authenticated" ON public.roles;
    DROP POLICY IF EXISTS "roles_admin_manage" ON public.roles;

    CREATE POLICY "roles_read_authenticated"
      ON public.roles
      FOR SELECT
      TO authenticated
      USING (true);

    CREATE POLICY "roles_admin_manage"
      ON public.roles
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT ON TABLE public.roles TO authenticated;
  END IF;
END $$;

-- 1.3 OFFICES
DO $$
BEGIN
  IF to_regclass('public.offices') IS NOT NULL THEN
    ALTER TABLE public.offices ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.offices FROM anon;

    DROP POLICY IF EXISTS "Allow all offices" ON public.offices;
    DROP POLICY IF EXISTS "offices_all_public" ON public.offices;
    DROP POLICY IF EXISTS "profile_admin_read_all" ON public.offices;
    DROP POLICY IF EXISTS "offices_read_authenticated" ON public.offices;
    DROP POLICY IF EXISTS "offices_admin_manage" ON public.offices;

    CREATE POLICY "offices_read_authenticated"
      ON public.offices
      FOR SELECT
      TO authenticated
      USING (true);

    CREATE POLICY "offices_admin_manage"
      ON public.offices
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT ON TABLE public.offices TO authenticated;
  END IF;
END $$;

-- 1.4 NOTIFICATIONS
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.notifications FROM anon;

    DROP POLICY IF EXISTS "Allow all notifications" ON public.notifications;
    DROP POLICY IF EXISTS "notifications_all_public" ON public.notifications;
    DROP POLICY IF EXISTS "profile_admin_read_all" ON public.notifications;
    DROP POLICY IF EXISTS "notifications_self_select" ON public.notifications;
    DROP POLICY IF EXISTS "notifications_self_update" ON public.notifications;
    DROP POLICY IF EXISTS "notifications_admin_manage" ON public.notifications;

    CREATE POLICY "notifications_self_select"
      ON public.notifications
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid() OR public.is_profile_admin());

    CREATE POLICY "notifications_self_update"
      ON public.notifications
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());

    CREATE POLICY "notifications_admin_manage"
      ON public.notifications
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2: REFERENCE DATA RLS
-- (departments, designations, holiday_calendar, public_holidays,
--  weekly_off_rules, approved_locations, predefined_sites)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_ref_table text;
BEGIN
  FOR v_ref_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'departments',
        'designations',
        'holiday_calendar',
        'public_holidays',
        'weekly_off_rules',
        'approved_locations',
        'predefined_sites'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_ref_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_ref_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_ref_table || '_authenticated_select', v_ref_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_ref_table || '_admin_manage', v_ref_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      v_ref_table || '_authenticated_select',
      v_ref_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_ref_table || '_admin_manage',
      v_ref_table
    );

    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_ref_table);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3: CORE ATTENDANCE RLS
-- (attendance, attendance_regularization_requests, checkin_attempts,
--  attendance_summary, monthly_attendance_summary)
-- ────────────────────────────────────────────────────────────────────────────

-- 3.1 ATTENDANCE (Legacy table if exists)
DO $$
BEGIN
  IF to_regclass('public.attendance') IS NOT NULL THEN
    ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.attendance FROM anon;

    DROP POLICY IF EXISTS "attendance_self_or_review_select" ON public.attendance;
    DROP POLICY IF EXISTS "attendance_admin_manage" ON public.attendance;

    CREATE POLICY "attendance_self_or_review_select"
      ON public.attendance
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id));

    CREATE POLICY "attendance_admin_manage"
      ON public.attendance
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT ON TABLE public.attendance TO authenticated;
  END IF;
END $$;

-- 3.2 ATTENDANCE_REGULARIZATION_REQUESTS
DO $$
BEGIN
  IF to_regclass('public.attendance_regularization_requests') IS NOT NULL THEN
    ALTER TABLE public.attendance_regularization_requests ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.attendance_regularization_requests FROM anon;

    DROP POLICY IF EXISTS "regularization_self_or_review_select" ON public.attendance_regularization_requests;
    DROP POLICY IF EXISTS "regularization_self_insert" ON public.attendance_regularization_requests;
    DROP POLICY IF EXISTS "regularization_self_or_review_update" ON public.attendance_regularization_requests;
    DROP POLICY IF EXISTS "regularization_admin_manage" ON public.attendance_regularization_requests;

    CREATE POLICY "regularization_self_or_review_select"
      ON public.attendance_regularization_requests
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id));

    CREATE POLICY "regularization_self_insert"
      ON public.attendance_regularization_requests
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());

    CREATE POLICY "regularization_self_or_review_update"
      ON public.attendance_regularization_requests
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id))
      WITH CHECK (user_id = auth.uid() OR public.current_user_can_review(user_id));

    CREATE POLICY "regularization_admin_manage"
      ON public.attendance_regularization_requests
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT, INSERT, UPDATE ON TABLE public.attendance_regularization_requests TO authenticated;
  END IF;
END $$;

-- 3.3 CHECKIN_ATTEMPTS
DO $$
BEGIN
  IF to_regclass('public.checkin_attempts') IS NOT NULL THEN
    ALTER TABLE public.checkin_attempts ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.checkin_attempts FROM anon;

    DROP POLICY IF EXISTS "checkin_attempts_self_or_admin_select" ON public.checkin_attempts;
    DROP POLICY IF EXISTS "checkin_attempts_self_insert" ON public.checkin_attempts;
    DROP POLICY IF EXISTS "checkin_attempts_admin_manage" ON public.checkin_attempts;

    CREATE POLICY "checkin_attempts_self_or_admin_select"
      ON public.checkin_attempts
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid() OR public.is_profile_admin());

    CREATE POLICY "checkin_attempts_self_insert"
      ON public.checkin_attempts
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());

    CREATE POLICY "checkin_attempts_admin_manage"
      ON public.checkin_attempts
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT, INSERT ON TABLE public.checkin_attempts TO authenticated;
  END IF;
END $$;

-- 3.4 ATTENDANCE_SUMMARY & MONTHLY_ATTENDANCE_SUMMARY
DO $$
DECLARE
  v_sum_table text;
BEGIN
  FOR v_sum_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('attendance_summary', 'monthly_attendance_summary')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_sum_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_sum_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_sum_table || '_self_or_review_select', v_sum_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_sum_table || '_admin_manage', v_sum_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.current_user_can_review(user_id))',
      v_sum_table || '_self_or_review_select',
      v_sum_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_sum_table || '_admin_manage',
      v_sum_table
    );

    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_sum_table);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4: LEAVE & COMP-OFF RLS
-- (leave_requests, leaves, leave_balances, leave_balance, leave_accrual_runs,
--  leave_application_audit, comp_off_ledger, compoff_credits, compoff_usage,
--  on_duty_events)
-- ────────────────────────────────────────────────────────────────────────────

-- 4.1 LEAVE_REQUESTS & LEAVES
DO $$
DECLARE
  v_leave_table text;
BEGIN
  FOR v_leave_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('leave_requests', 'leaves')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_leave_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_leave_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_user_select', v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_user_insert', v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_admin_select', v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_admin_update', v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_self_or_review_select', v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_self_insert', v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_self_or_review_update', v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_admin_manage', v_leave_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.current_user_can_review(user_id))',
      v_leave_table || '_self_or_review_select',
      v_leave_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())',
      v_leave_table || '_self_insert',
      v_leave_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.current_user_can_review(user_id)) WITH CHECK (user_id = auth.uid() OR public.current_user_can_review(user_id))',
      v_leave_table || '_self_or_review_update',
      v_leave_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_leave_table || '_admin_manage',
      v_leave_table
    );

    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO authenticated', v_leave_table);
  END LOOP;
END $$;

-- 4.2 LEAVE_BALANCES, COMP_OFF_LEDGER, COMPOFF_CREDITS, COMPOFF_USAGE
DO $$
DECLARE
  v_bal_table text;
BEGIN
  FOR v_bal_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('leave_balances', 'comp_off_ledger', 'compoff_credits', 'compoff_usage')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_bal_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_bal_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_bal_table || '_self_or_review_select', v_bal_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_bal_table || '_admin_manage', v_bal_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_profile_admin())',
      v_bal_table || '_self_or_review_select',
      v_bal_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_bal_table || '_admin_manage',
      v_bal_table
    );

    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_bal_table);
  END LOOP;
END $$;

-- 4.3 LEAVE_ACCRUAL_RUNS
DO $$
BEGIN
  IF to_regclass('public.leave_accrual_runs') IS NOT NULL THEN
    ALTER TABLE public.leave_accrual_runs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.leave_accrual_runs FROM anon;

    DROP POLICY IF EXISTS "accrual_runs_admin_all" ON public.leave_accrual_runs;

    CREATE POLICY "accrual_runs_admin_all"
      ON public.leave_accrual_runs
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT ON TABLE public.leave_accrual_runs TO authenticated;
  END IF;
END $$;

-- 4.4 LEAVE_APPLICATION_AUDIT
DO $$
BEGIN
  IF to_regclass('public.leave_application_audit') IS NOT NULL THEN
    ALTER TABLE public.leave_application_audit ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.leave_application_audit FROM anon;

    DROP POLICY IF EXISTS "leave_audit_self_or_review_select" ON public.leave_application_audit;
    DROP POLICY IF EXISTS "leave_audit_admin_manage" ON public.leave_application_audit;

    CREATE POLICY "leave_audit_self_or_review_select"
      ON public.leave_application_audit
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id));

    CREATE POLICY "leave_audit_admin_manage"
      ON public.leave_application_audit
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT ON TABLE public.leave_application_audit TO authenticated;
  END IF;
END $$;

-- 4.5 ON_DUTY_EVENTS
DO $$
BEGIN
  IF to_regclass('public.on_duty_events') IS NOT NULL THEN
    ALTER TABLE public.on_duty_events ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.on_duty_events FROM anon;

    DROP POLICY IF EXISTS "on_duty_self_or_review_select" ON public.on_duty_events;
    DROP POLICY IF EXISTS "on_duty_self_insert" ON public.on_duty_events;
    DROP POLICY IF EXISTS "on_duty_self_or_review_update" ON public.on_duty_events;
    DROP POLICY IF EXISTS "on_duty_admin_manage" ON public.on_duty_events;

    CREATE POLICY "on_duty_self_or_review_select"
      ON public.on_duty_events
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id));

    CREATE POLICY "on_duty_self_insert"
      ON public.on_duty_events
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());

    CREATE POLICY "on_duty_self_or_review_update"
      ON public.on_duty_events
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id))
      WITH CHECK (user_id = auth.uid() OR public.current_user_can_review(user_id));

    CREATE POLICY "on_duty_admin_manage"
      ON public.on_duty_events
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT, INSERT, UPDATE ON TABLE public.on_duty_events TO authenticated;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 5: LOCATION / GPS & TELEMETRY RLS
-- (user_location_logs, location_violations, location_alerts,
--  location_ping_requests, transit_warnings, escalation_matrix, escalation_log)
-- ────────────────────────────────────────────────────────────────────────────

-- 5.1 USER_LOCATION_LOGS, LOCATION_VIOLATIONS, LOCATION_ALERTS
DO $$
DECLARE
  v_loc_table text;
BEGIN
  FOR v_loc_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('user_location_logs', 'location_violations', 'location_alerts')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_loc_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_loc_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_loc_table || '_authorized_select', v_loc_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_loc_table || '_self_insert', v_loc_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_loc_table || '_admin_manage', v_loc_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_view_tracking_user(user_id))',
      v_loc_table || '_authorized_select',
      v_loc_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())',
      v_loc_table || '_self_insert',
      v_loc_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_loc_table || '_admin_manage',
      v_loc_table
    );

    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO authenticated', v_loc_table);
  END LOOP;
END $$;

-- 5.2 LOCATION_PING_REQUESTS
-- Note: this table uses target_user_id (the employee being pinged), not user_id
DO $$
BEGIN
  IF to_regclass('public.location_ping_requests') IS NOT NULL THEN
    ALTER TABLE public.location_ping_requests ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.location_ping_requests FROM anon;

    DROP POLICY IF EXISTS "ping_requests_authorized_select" ON public.location_ping_requests;
    DROP POLICY IF EXISTS "ping_requests_authorized_insert" ON public.location_ping_requests;
    DROP POLICY IF EXISTS "ping_requests_authorized_update" ON public.location_ping_requests;
    DROP POLICY IF EXISTS "ping_requests_admin_manage" ON public.location_ping_requests;

    -- Employee sees pings targeting them; requester/admin sees pings they sent
    CREATE POLICY "ping_requests_authorized_select"
      ON public.location_ping_requests
      FOR SELECT
      TO authenticated
      USING (
        target_user_id = auth.uid()
        OR requested_by = auth.uid()
        OR public.is_profile_admin()
      );

    -- Only managers/admins can create ping requests (requested_by must be the caller)
    CREATE POLICY "ping_requests_authorized_insert"
      ON public.location_ping_requests
      FOR INSERT
      TO authenticated
      WITH CHECK (
        requested_by = auth.uid()
        AND public.is_profile_admin()
        OR (requested_by = auth.uid() AND public.current_user_can_review(target_user_id))
      );

    -- Employee device fulfills the ping (UPDATE); requester/admin can also update
    CREATE POLICY "ping_requests_authorized_update"
      ON public.location_ping_requests
      FOR UPDATE
      TO authenticated
      USING (
        target_user_id = auth.uid()
        OR requested_by = auth.uid()
        OR public.is_profile_admin()
      );

    CREATE POLICY "ping_requests_admin_manage"
      ON public.location_ping_requests
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT, INSERT, UPDATE ON TABLE public.location_ping_requests TO authenticated;
  END IF;
END $$;

-- 5.3 TRANSIT_WARNINGS
DO $$
BEGIN
  IF to_regclass('public.transit_warnings') IS NOT NULL THEN
    ALTER TABLE public.transit_warnings ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.transit_warnings FROM anon;

    DROP POLICY IF EXISTS "transit_warnings_authorized_select" ON public.transit_warnings;
    DROP POLICY IF EXISTS "transit_warnings_self_insert" ON public.transit_warnings;
    DROP POLICY IF EXISTS "transit_warnings_admin_manage" ON public.transit_warnings;

    CREATE POLICY "transit_warnings_authorized_select"
      ON public.transit_warnings
      FOR SELECT
      TO authenticated
      USING (public.can_view_tracking_user(user_id));

    CREATE POLICY "transit_warnings_self_insert"
      ON public.transit_warnings
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());

    CREATE POLICY "transit_warnings_admin_manage"
      ON public.transit_warnings
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT, INSERT ON TABLE public.transit_warnings TO authenticated;
  END IF;
END $$;

-- 5.4 ESCALATION_MATRIX & ESCALATION_LOG
DO $$
BEGIN
  IF to_regclass('public.escalation_matrix') IS NOT NULL THEN
    ALTER TABLE public.escalation_matrix ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.escalation_matrix FROM anon;

    DROP POLICY IF EXISTS "escalation_matrix_read_authenticated" ON public.escalation_matrix;
    DROP POLICY IF EXISTS "escalation_matrix_admin_manage" ON public.escalation_matrix;

    CREATE POLICY "escalation_matrix_read_authenticated"
      ON public.escalation_matrix
      FOR SELECT
      TO authenticated
      USING (true);

    CREATE POLICY "escalation_matrix_admin_manage"
      ON public.escalation_matrix
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT ON TABLE public.escalation_matrix TO authenticated;
  END IF;

  IF to_regclass('public.escalation_log') IS NOT NULL THEN
    ALTER TABLE public.escalation_log ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.escalation_log FROM anon;

    DROP POLICY IF EXISTS "escalation_log_authorized_select" ON public.escalation_log;
    DROP POLICY IF EXISTS "escalation_log_admin_manage" ON public.escalation_log;

    -- escalation_log schema: alert_id, user_id, level, note, created_at
    -- No escalated_to column. Allow viewing if you are the subject (user_id) or an admin.
    CREATE POLICY "escalation_log_authorized_select"
      ON public.escalation_log
      FOR SELECT
      TO authenticated
      USING (public.can_view_tracking_user(user_id) OR public.is_profile_admin());

    CREATE POLICY "escalation_log_admin_manage"
      ON public.escalation_log
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT ON TABLE public.escalation_log TO authenticated;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 6: PAYROLL & PERFORMANCE RLS
-- (payroll_records, performance_metrics, overtime_logs)
-- ────────────────────────────────────────────────────────────────────────────

-- 6.1 PAYROLL_RECORDS (Strict isolation: Own slip only, Admin/HR full manage)
DO $$
BEGIN
  IF to_regclass('public.payroll_records') IS NOT NULL THEN
    ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.payroll_records FROM anon;

    DROP POLICY IF EXISTS "payroll_records_self_select" ON public.payroll_records;
    DROP POLICY IF EXISTS "payroll_records_admin_manage" ON public.payroll_records;

    CREATE POLICY "payroll_records_self_select"
      ON public.payroll_records
      FOR SELECT
      TO authenticated
      USING (
        user_id = auth.uid()
        OR public.is_profile_admin()
      );

    CREATE POLICY "payroll_records_admin_manage"
      ON public.payroll_records
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT ON TABLE public.payroll_records TO authenticated;
  END IF;
END $$;

-- 6.2 PERFORMANCE_METRICS & OVERTIME_LOGS
DO $$
DECLARE
  v_perf_table text;
BEGIN
  FOR v_perf_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('performance_metrics', 'overtime_logs')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_perf_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_perf_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_perf_table || '_self_or_review_select', v_perf_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_perf_table || '_admin_manage', v_perf_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.current_user_can_review(user_id))',
      v_perf_table || '_self_or_review_select',
      v_perf_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_perf_table || '_admin_manage',
      v_perf_table
    );

    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_perf_table);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 7: AUDIT & SECURITY TABLES RLS
-- (audit_logs, attendance_audit_log, attendance_logs_backup,
--  profile_role_repair_audit)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_audit_table text;
BEGIN
  FOR v_audit_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'audit_logs',
        'attendance_audit_log',
        'attendance_logs_backup',
        'profile_role_repair_audit'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_audit_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_audit_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_audit_table || '_admin_only_select', v_audit_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_audit_table || '_admin_manage', v_audit_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_profile_admin())',
      v_audit_table || '_admin_only_select',
      v_audit_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_audit_table || '_admin_manage',
      v_audit_table
    );

    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_audit_table);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 8: TASKS, EVENTS & SUPPORT RLS
-- (tasks, support_tickets, events, event_announcements, event_checkins,
--  event_comp_off_credits)
-- ────────────────────────────────────────────────────────────────────────────

-- 8.1 TASKS
DO $$
BEGIN
  IF to_regclass('public.tasks') IS NOT NULL THEN
    ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.tasks FROM anon;

    DROP POLICY IF EXISTS "tasks_authorized_select" ON public.tasks;
    DROP POLICY IF EXISTS "tasks_authorized_insert" ON public.tasks;
    DROP POLICY IF EXISTS "tasks_authorized_update" ON public.tasks;
    DROP POLICY IF EXISTS "tasks_admin_manage" ON public.tasks;

    CREATE POLICY "tasks_authorized_select"
      ON public.tasks
      FOR SELECT
      TO authenticated
      USING (
        assigned_to = auth.uid()
        OR assigned_by = auth.uid()
        OR public.current_user_can_review(assigned_to)
        OR public.is_profile_admin()
      );

    CREATE POLICY "tasks_authorized_insert"
      ON public.tasks
      FOR INSERT
      TO authenticated
      WITH CHECK (
        assigned_by = auth.uid()
        OR public.is_profile_admin()
      );

    CREATE POLICY "tasks_authorized_update"
      ON public.tasks
      FOR UPDATE
      TO authenticated
      USING (
        assigned_to = auth.uid()
        OR assigned_by = auth.uid()
        OR public.current_user_can_review(assigned_to)
        OR public.is_profile_admin()
      );

    CREATE POLICY "tasks_admin_manage"
      ON public.tasks
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT, INSERT, UPDATE ON TABLE public.tasks TO authenticated;
  END IF;
END $$;

-- 8.2 SUPPORT_TICKETS
DO $$
BEGIN
  IF to_regclass('public.support_tickets') IS NOT NULL THEN
    ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.support_tickets FROM anon;

    DROP POLICY IF EXISTS "support_tickets_authorized_select" ON public.support_tickets;
    DROP POLICY IF EXISTS "support_tickets_self_insert" ON public.support_tickets;
    DROP POLICY IF EXISTS "support_tickets_authorized_update" ON public.support_tickets;
    DROP POLICY IF EXISTS "support_tickets_admin_manage" ON public.support_tickets;

    CREATE POLICY "support_tickets_authorized_select"
      ON public.support_tickets
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid() OR assigned_to = auth.uid() OR public.is_profile_admin());

    CREATE POLICY "support_tickets_self_insert"
      ON public.support_tickets
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());

    CREATE POLICY "support_tickets_authorized_update"
      ON public.support_tickets
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid() OR assigned_to = auth.uid() OR public.is_profile_admin());

    CREATE POLICY "support_tickets_admin_manage"
      ON public.support_tickets
      FOR ALL
      TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT, INSERT, UPDATE ON TABLE public.support_tickets TO authenticated;
  END IF;
END $$;

-- 8.3 EVENTS & EVENT_ANNOUNCEMENTS
DO $$
DECLARE
  v_evt_table text;
BEGIN
  FOR v_evt_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('events', 'event_announcements')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_evt_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_evt_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_evt_table || '_authenticated_select', v_evt_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_evt_table || '_admin_manage', v_evt_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      v_evt_table || '_authenticated_select',
      v_evt_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_evt_table || '_admin_manage',
      v_evt_table
    );

    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_evt_table);
  END LOOP;
END $$;

-- 8.4 EVENT_CHECKINS & EVENT_COMP_OFF_CREDITS
DO $$
DECLARE
  v_evt_sub_table text;
BEGIN
  FOR v_evt_sub_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('event_checkins', 'event_comp_off_credits')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_evt_sub_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_evt_sub_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_evt_sub_table || '_self_or_admin_select', v_evt_sub_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_evt_sub_table || '_self_insert', v_evt_sub_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_evt_sub_table || '_admin_manage', v_evt_sub_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_profile_admin())',
      v_evt_sub_table || '_self_or_admin_select',
      v_evt_sub_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())',
      v_evt_sub_table || '_self_insert',
      v_evt_sub_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_evt_sub_table || '_admin_manage',
      v_evt_sub_table
    );

    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO authenticated', v_evt_sub_table);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 9: VIEW SECURITY & INVOKER CONFIGURATION
-- (Configuring security_invoker on all public analytical views)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_view text;
BEGIN
  FOR v_view IN
    SELECT table_name
    FROM information_schema.views
    WHERE table_schema = 'public'
      AND table_name IN (
        'active_attendance_logs',
        'admin_attendance_export',
        'admin_daily_employee_log',
        'attendance_reconciliation',
        'attendance_reconciliation_v2',
        'deleted_attendance_view',
        'employee_live_status',
        'event_admin_summary',
        'monthly_attendance_report',
        'performance_leaderboard',
        'user_latest_location',
        'v_attendance_daily_canonical',
        'v_attendance_daily_enterprise',
        'v_attendance_daily_enterprise_v5'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v_view);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_view);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_view);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not set security_invoker on view %: %', v_view, SQLERRM;
    END;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 10: FUNCTION HARDENING & SEARCH_PATH
-- (Hardening SECURITY DEFINER functions against search path manipulation)
-- ────────────────────────────────────────────────────────────────────────────

-- Hardening biometric sync RPC to ensure search_path is locked to public, pg_temp
CREATE OR REPLACE FUNCTION public.rpc_sync_biometric_punches(p_punches jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_inserted_logs integer := 0;
  v_updated_attendance integer := 0;
BEGIN
  IF p_punches IS NULL OR jsonb_array_length(p_punches) = 0 THEN
    RETURN jsonb_build_object('success', true, 'updated', 0, 'message', 'No punches provided');
  END IF;

  -- A. Insert into smartoffice_device_logs
  INSERT INTO public.smartoffice_device_logs (
    employee_code,
    log_datetime,
    serial_number,
    punch_direction,
    temperature
  )
  SELECT
    trim(r->>'EmployeeCode'),
    trim(r->>'LogDate'),
    coalesce(r->>'SerialNumber', ''),
    coalesce(r->>'PunchDirection', ''),
    coalesce((r->>'Temperature')::numeric, 0)
  FROM jsonb_array_elements(p_punches) AS r
  WHERE nullif(trim(r->>'EmployeeCode'), '') IS NOT NULL
    AND nullif(trim(r->>'LogDate'), '') IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted_logs = ROW_COUNT;

  -- B. Link any unlinked logs to active employee profiles
  UPDATE public.smartoffice_device_logs dl
  SET user_id = p.id
  FROM public.profiles p
  WHERE (
      lower(trim(p.smartoffice_employee_code)) = lower(trim(dl.employee_code))
      OR lower(trim(p.employee_number)) = lower(trim(dl.employee_code))
    )
    AND p.is_active = true
    AND dl.user_id IS NULL;

  -- C. Upsert attendance_logs for today with CHECKED_IN status and exact punch times
  WITH parsed_punches AS (
    SELECT
      dl.user_id,
      p.office_id,
      v_today AS att_date,
      (trim(dl.log_datetime) || '+05:30')::timestamptz AS punch_ts
    FROM public.smartoffice_device_logs dl
    JOIN public.profiles p ON p.id = dl.user_id
    WHERE dl.user_id IS NOT NULL
      AND length(trim(dl.log_datetime)) >= 10
      AND substring(trim(dl.log_datetime) from 1 for 10) = v_today::text
  ),
  daily_group AS (
    SELECT
      user_id,
      office_id,
      att_date,
      min(punch_ts) AS first_punch,
      max(punch_ts) AS last_punch,
      count(*)::int AS punch_cnt
    FROM parsed_punches
    GROUP BY user_id, office_id, att_date
  )
  INSERT INTO public.attendance_logs(
    user_id,
    office_id,
    date,
    checkin_time,
    checkin_source,
    checkout_time,
    checkout_source,
    status,
    attendance_status,
    day_status,
    attendance_type,
    smartoffice_imported,
    biometric_first_punch,
    biometric_last_punch,
    biometric_punch_count,
    work_hours,
    updated_at
  )
  SELECT
    g.user_id,
    g.office_id,
    g.att_date,
    g.first_punch,
    'BIOMETRIC',
    NULL,
    NULL,
    'CHECKED_IN',
    'PRESENT',
    'P',
    'BIOMETRIC',
    true,
    g.first_punch,
    g.last_punch,
    g.punch_cnt,
    NULL,
    now()
  FROM daily_group g
  ON CONFLICT (user_id, date) DO UPDATE
  SET
    checkin_time = coalesce(attendance_logs.checkin_time, EXCLUDED.checkin_time),
    checkin_source = 'BIOMETRIC',
    smartoffice_imported = true,
    biometric_first_punch = EXCLUDED.biometric_first_punch,
    biometric_last_punch = EXCLUDED.biometric_last_punch,
    biometric_punch_count = EXCLUDED.biometric_punch_count,
    attendance_status = 'PRESENT',
    day_status = 'P',
    status = CASE
      WHEN attendance_logs.checkout_time IS NULL THEN 'CHECKED_IN'
      ELSE attendance_logs.status
    END,
    updated_at = now();

  GET DIAGNOSTICS v_updated_attendance = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_raw_punches', v_inserted_logs,
    'updated_attendance_count', v_updated_attendance,
    'date', v_today
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_sync_biometric_punches(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_sync_biometric_punches(jsonb) TO anon, authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 11: GRANTS & NOTIFY SCHEMA RELOAD
-- ────────────────────────────────────────────────────────────────────────────

-- Grant appropriate schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

