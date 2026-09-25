-- ============================================================================
-- PRODUCTION RLS REMEDIATION — RESUME SCRIPT
-- File: 20260901000001_rls_remediation_resume.sql
-- Purpose: Apply the remaining sections (1.4, 2–11) that were aborted when
--          the deadlock on notifications killed the original session.
--          All operations are fully idempotent — safe to re-run.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1.4: NOTIFICATIONS (previously deadlocked — retrying)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.notifications FROM anon;

    DROP POLICY IF EXISTS "Allow all notifications"        ON public.notifications;
    DROP POLICY IF EXISTS "notifications_all_public"       ON public.notifications;
    DROP POLICY IF EXISTS "profile_admin_read_all"         ON public.notifications;
    DROP POLICY IF EXISTS "notifications_self_select"      ON public.notifications;
    DROP POLICY IF EXISTS "notifications_self_update"      ON public.notifications;
    DROP POLICY IF EXISTS "notifications_admin_manage"     ON public.notifications;

    CREATE POLICY "notifications_self_select"
      ON public.notifications FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.is_profile_admin());

    CREATE POLICY "notifications_self_update"
      ON public.notifications FOR UPDATE TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());

    CREATE POLICY "notifications_admin_manage"
      ON public.notifications FOR ALL TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());

    GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2: REFERENCE DATA RLS
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE v_ref_table text;
BEGIN
  FOR v_ref_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'departments','designations','holiday_calendar','public_holidays',
        'weekly_off_rules','approved_locations','predefined_sites'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_ref_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_ref_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_ref_table || '_authenticated_select', v_ref_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_ref_table || '_admin_manage', v_ref_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      v_ref_table || '_authenticated_select', v_ref_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_ref_table || '_admin_manage', v_ref_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_ref_table);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3: CORE ATTENDANCE RLS
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.attendance') IS NOT NULL THEN
    ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.attendance FROM anon;
    DROP POLICY IF EXISTS "attendance_self_or_review_select" ON public.attendance;
    DROP POLICY IF EXISTS "attendance_admin_manage"           ON public.attendance;
    CREATE POLICY "attendance_self_or_review_select"
      ON public.attendance FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id));
    CREATE POLICY "attendance_admin_manage"
      ON public.attendance FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT ON TABLE public.attendance TO authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.attendance_regularization_requests') IS NOT NULL THEN
    ALTER TABLE public.attendance_regularization_requests ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.attendance_regularization_requests FROM anon;
    DROP POLICY IF EXISTS "regularization_self_or_review_select"  ON public.attendance_regularization_requests;
    DROP POLICY IF EXISTS "regularization_self_insert"            ON public.attendance_regularization_requests;
    DROP POLICY IF EXISTS "regularization_self_or_review_update"  ON public.attendance_regularization_requests;
    DROP POLICY IF EXISTS "regularization_admin_manage"           ON public.attendance_regularization_requests;
    CREATE POLICY "regularization_self_or_review_select"
      ON public.attendance_regularization_requests FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id));
    CREATE POLICY "regularization_self_insert"
      ON public.attendance_regularization_requests FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
    CREATE POLICY "regularization_self_or_review_update"
      ON public.attendance_regularization_requests FOR UPDATE TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id))
      WITH CHECK (user_id = auth.uid() OR public.current_user_can_review(user_id));
    CREATE POLICY "regularization_admin_manage"
      ON public.attendance_regularization_requests FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT, INSERT, UPDATE ON TABLE public.attendance_regularization_requests TO authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.checkin_attempts') IS NOT NULL THEN
    ALTER TABLE public.checkin_attempts ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.checkin_attempts FROM anon;
    DROP POLICY IF EXISTS "checkin_attempts_self_or_admin_select" ON public.checkin_attempts;
    DROP POLICY IF EXISTS "checkin_attempts_self_insert"          ON public.checkin_attempts;
    DROP POLICY IF EXISTS "checkin_attempts_admin_manage"         ON public.checkin_attempts;
    CREATE POLICY "checkin_attempts_self_or_admin_select"
      ON public.checkin_attempts FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.is_profile_admin());
    CREATE POLICY "checkin_attempts_self_insert"
      ON public.checkin_attempts FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
    CREATE POLICY "checkin_attempts_admin_manage"
      ON public.checkin_attempts FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT, INSERT ON TABLE public.checkin_attempts TO authenticated;
  END IF;
END $$;

DO $$
DECLARE v_sum_table text;
BEGIN
  FOR v_sum_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('attendance_summary','monthly_attendance_summary')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_sum_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_sum_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_sum_table || '_self_or_review_select', v_sum_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_sum_table || '_admin_manage', v_sum_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.current_user_can_review(user_id))',
      v_sum_table || '_self_or_review_select', v_sum_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_sum_table || '_admin_manage', v_sum_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_sum_table);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4: LEAVE & COMP-OFF RLS
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE v_leave_table text;
BEGIN
  FOR v_leave_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('leave_requests','leaves')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_leave_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_user_select',          v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_user_insert',          v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_admin_select',         v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_admin_update',         v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_self_or_review_select',v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_self_insert',          v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_self_or_review_update',v_leave_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_leave_table || '_admin_manage',         v_leave_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.current_user_can_review(user_id))',
      v_leave_table || '_self_or_review_select', v_leave_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())',
      v_leave_table || '_self_insert', v_leave_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.current_user_can_review(user_id)) WITH CHECK (user_id = auth.uid() OR public.current_user_can_review(user_id))',
      v_leave_table || '_self_or_review_update', v_leave_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_leave_table || '_admin_manage', v_leave_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO authenticated', v_leave_table);
  END LOOP;
END $$;

DO $$
DECLARE v_bal_table text;
BEGIN
  FOR v_bal_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('leave_balances','comp_off_ledger','compoff_credits','compoff_usage')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_bal_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_bal_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_bal_table || '_self_or_review_select', v_bal_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_bal_table || '_admin_manage',          v_bal_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_profile_admin())',
      v_bal_table || '_self_or_review_select', v_bal_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_bal_table || '_admin_manage', v_bal_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_bal_table);
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.leave_accrual_runs') IS NOT NULL THEN
    ALTER TABLE public.leave_accrual_runs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.leave_accrual_runs FROM anon;
    DROP POLICY IF EXISTS "accrual_runs_admin_all" ON public.leave_accrual_runs;
    CREATE POLICY "accrual_runs_admin_all"
      ON public.leave_accrual_runs FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT ON TABLE public.leave_accrual_runs TO authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.leave_application_audit') IS NOT NULL THEN
    ALTER TABLE public.leave_application_audit ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.leave_application_audit FROM anon;
    DROP POLICY IF EXISTS "leave_audit_self_or_review_select" ON public.leave_application_audit;
    DROP POLICY IF EXISTS "leave_audit_admin_manage"          ON public.leave_application_audit;
    CREATE POLICY "leave_audit_self_or_review_select"
      ON public.leave_application_audit FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id));
    CREATE POLICY "leave_audit_admin_manage"
      ON public.leave_application_audit FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT ON TABLE public.leave_application_audit TO authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.on_duty_events') IS NOT NULL THEN
    ALTER TABLE public.on_duty_events ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.on_duty_events FROM anon;
    DROP POLICY IF EXISTS "on_duty_self_or_review_select"  ON public.on_duty_events;
    DROP POLICY IF EXISTS "on_duty_self_insert"            ON public.on_duty_events;
    DROP POLICY IF EXISTS "on_duty_self_or_review_update"  ON public.on_duty_events;
    DROP POLICY IF EXISTS "on_duty_admin_manage"           ON public.on_duty_events;
    CREATE POLICY "on_duty_self_or_review_select"
      ON public.on_duty_events FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id));
    CREATE POLICY "on_duty_self_insert"
      ON public.on_duty_events FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
    CREATE POLICY "on_duty_self_or_review_update"
      ON public.on_duty_events FOR UPDATE TO authenticated
      USING (user_id = auth.uid() OR public.current_user_can_review(user_id))
      WITH CHECK (user_id = auth.uid() OR public.current_user_can_review(user_id));
    CREATE POLICY "on_duty_admin_manage"
      ON public.on_duty_events FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT, INSERT, UPDATE ON TABLE public.on_duty_events TO authenticated;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 5: LOCATION / GPS & TELEMETRY RLS
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE v_loc_table text;
BEGIN
  FOR v_loc_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('user_location_logs','location_violations','location_alerts')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_loc_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_loc_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_loc_table || '_authorized_select', v_loc_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_loc_table || '_self_insert',       v_loc_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_loc_table || '_admin_manage',      v_loc_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_view_tracking_user(user_id))',
      v_loc_table || '_authorized_select', v_loc_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())',
      v_loc_table || '_self_insert', v_loc_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_loc_table || '_admin_manage', v_loc_table);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO authenticated', v_loc_table);
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.location_ping_requests') IS NOT NULL THEN
    ALTER TABLE public.location_ping_requests ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.location_ping_requests FROM anon;
    DROP POLICY IF EXISTS "ping_requests_authorized_select" ON public.location_ping_requests;
    DROP POLICY IF EXISTS "ping_requests_authorized_insert" ON public.location_ping_requests;
    DROP POLICY IF EXISTS "ping_requests_authorized_update" ON public.location_ping_requests;
    DROP POLICY IF EXISTS "ping_requests_admin_manage"      ON public.location_ping_requests;
    -- target_user_id = employee being pinged; requested_by = admin/manager who sent ping
    CREATE POLICY "ping_requests_authorized_select"
      ON public.location_ping_requests FOR SELECT TO authenticated
      USING (
        target_user_id = auth.uid()
        OR requested_by = auth.uid()
        OR public.is_profile_admin()
      );
    CREATE POLICY "ping_requests_authorized_insert"
      ON public.location_ping_requests FOR INSERT TO authenticated
      WITH CHECK (
        requested_by = auth.uid()
        AND (
          public.is_profile_admin()
          OR public.current_user_can_review(target_user_id)
        )
      );
    CREATE POLICY "ping_requests_authorized_update"
      ON public.location_ping_requests FOR UPDATE TO authenticated
      USING (
        target_user_id = auth.uid()
        OR requested_by = auth.uid()
        OR public.is_profile_admin()
      );
    CREATE POLICY "ping_requests_admin_manage"
      ON public.location_ping_requests FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT, INSERT, UPDATE ON TABLE public.location_ping_requests TO authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.transit_warnings') IS NOT NULL THEN
    ALTER TABLE public.transit_warnings ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.transit_warnings FROM anon;
    DROP POLICY IF EXISTS "transit_warnings_authorized_select" ON public.transit_warnings;
    DROP POLICY IF EXISTS "transit_warnings_self_insert"       ON public.transit_warnings;
    DROP POLICY IF EXISTS "transit_warnings_admin_manage"      ON public.transit_warnings;
    CREATE POLICY "transit_warnings_authorized_select"
      ON public.transit_warnings FOR SELECT TO authenticated
      USING (public.can_view_tracking_user(user_id));
    CREATE POLICY "transit_warnings_self_insert"
      ON public.transit_warnings FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
    CREATE POLICY "transit_warnings_admin_manage"
      ON public.transit_warnings FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT, INSERT ON TABLE public.transit_warnings TO authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.escalation_matrix') IS NOT NULL THEN
    ALTER TABLE public.escalation_matrix ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.escalation_matrix FROM anon;
    DROP POLICY IF EXISTS "escalation_matrix_read_authenticated" ON public.escalation_matrix;
    DROP POLICY IF EXISTS "escalation_matrix_admin_manage"       ON public.escalation_matrix;
    CREATE POLICY "escalation_matrix_read_authenticated"
      ON public.escalation_matrix FOR SELECT TO authenticated USING (true);
    CREATE POLICY "escalation_matrix_admin_manage"
      ON public.escalation_matrix FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT ON TABLE public.escalation_matrix TO authenticated;
  END IF;

  IF to_regclass('public.escalation_log') IS NOT NULL THEN
    ALTER TABLE public.escalation_log ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.escalation_log FROM anon;
    DROP POLICY IF EXISTS "escalation_log_authorized_select" ON public.escalation_log;
    DROP POLICY IF EXISTS "escalation_log_admin_manage"      ON public.escalation_log;
    -- escalation_log schema: alert_id, user_id, level, note, created_at
    CREATE POLICY "escalation_log_authorized_select"
      ON public.escalation_log FOR SELECT TO authenticated
      USING (public.can_view_tracking_user(user_id) OR public.is_profile_admin());
    CREATE POLICY "escalation_log_admin_manage"
      ON public.escalation_log FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT ON TABLE public.escalation_log TO authenticated;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 6: PAYROLL & PERFORMANCE RLS
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.payroll_records') IS NOT NULL THEN
    ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.payroll_records FROM anon;
    DROP POLICY IF EXISTS "payroll_records_self_select"   ON public.payroll_records;
    DROP POLICY IF EXISTS "payroll_records_admin_manage"  ON public.payroll_records;
    CREATE POLICY "payroll_records_self_select"
      ON public.payroll_records FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.is_profile_admin());
    CREATE POLICY "payroll_records_admin_manage"
      ON public.payroll_records FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT ON TABLE public.payroll_records TO authenticated;
  END IF;
END $$;

DO $$
DECLARE v_perf_table text;
BEGIN
  FOR v_perf_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('performance_metrics','overtime_logs')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_perf_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_perf_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_perf_table || '_self_or_review_select', v_perf_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_perf_table || '_admin_manage',          v_perf_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.current_user_can_review(user_id))',
      v_perf_table || '_self_or_review_select', v_perf_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_perf_table || '_admin_manage', v_perf_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_perf_table);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 7: AUDIT & SECURITY TABLES RLS
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE v_audit_table text;
BEGIN
  FOR v_audit_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'audit_logs','attendance_audit_log',
        'attendance_logs_backup','profile_role_repair_audit'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_audit_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_audit_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_audit_table || '_admin_only_select', v_audit_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_audit_table || '_admin_manage',      v_audit_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_profile_admin())',
      v_audit_table || '_admin_only_select', v_audit_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_audit_table || '_admin_manage', v_audit_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_audit_table);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 8: TASKS, EVENTS & SUPPORT RLS
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.tasks') IS NOT NULL THEN
    ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.tasks FROM anon;
    DROP POLICY IF EXISTS "tasks_authorized_select" ON public.tasks;
    DROP POLICY IF EXISTS "tasks_authorized_insert" ON public.tasks;
    DROP POLICY IF EXISTS "tasks_authorized_update" ON public.tasks;
    DROP POLICY IF EXISTS "tasks_admin_manage"       ON public.tasks;
    -- tasks schema: assigned_to, assigned_by (not created_by)
    CREATE POLICY "tasks_authorized_select"
      ON public.tasks FOR SELECT TO authenticated
      USING (
        assigned_to = auth.uid()
        OR assigned_by = auth.uid()
        OR public.current_user_can_review(assigned_to)
        OR public.is_profile_admin()
      );
    CREATE POLICY "tasks_authorized_insert"
      ON public.tasks FOR INSERT TO authenticated
      WITH CHECK (
        assigned_by = auth.uid()
        OR public.is_profile_admin()
      );
    CREATE POLICY "tasks_authorized_update"
      ON public.tasks FOR UPDATE TO authenticated
      USING (
        assigned_to = auth.uid()
        OR assigned_by = auth.uid()
        OR public.current_user_can_review(assigned_to)
        OR public.is_profile_admin()
      );
    CREATE POLICY "tasks_admin_manage"
      ON public.tasks FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT, INSERT, UPDATE ON TABLE public.tasks TO authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.support_tickets') IS NOT NULL THEN
    ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.support_tickets FROM anon;
    DROP POLICY IF EXISTS "support_tickets_authorized_select" ON public.support_tickets;
    DROP POLICY IF EXISTS "support_tickets_self_insert"       ON public.support_tickets;
    DROP POLICY IF EXISTS "support_tickets_authorized_update" ON public.support_tickets;
    DROP POLICY IF EXISTS "support_tickets_admin_manage"      ON public.support_tickets;
    CREATE POLICY "support_tickets_authorized_select"
      ON public.support_tickets FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR assigned_to = auth.uid() OR public.is_profile_admin());
    CREATE POLICY "support_tickets_self_insert"
      ON public.support_tickets FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
    CREATE POLICY "support_tickets_authorized_update"
      ON public.support_tickets FOR UPDATE TO authenticated
      USING (user_id = auth.uid() OR assigned_to = auth.uid() OR public.is_profile_admin());
    CREATE POLICY "support_tickets_admin_manage"
      ON public.support_tickets FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
    GRANT SELECT, INSERT, UPDATE ON TABLE public.support_tickets TO authenticated;
  END IF;
END $$;

DO $$
DECLARE v_evt_table text;
BEGIN
  FOR v_evt_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('events','event_announcements')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_evt_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_evt_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_evt_table || '_authenticated_select', v_evt_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_evt_table || '_admin_manage',         v_evt_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      v_evt_table || '_authenticated_select', v_evt_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_evt_table || '_admin_manage', v_evt_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_evt_table);
  END LOOP;
END $$;

DO $$
DECLARE v_evt_sub_table text;
BEGIN
  FOR v_evt_sub_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('event_checkins','event_comp_off_credits')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_evt_sub_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_evt_sub_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_evt_sub_table || '_self_or_admin_select', v_evt_sub_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_evt_sub_table || '_self_insert',          v_evt_sub_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_evt_sub_table || '_admin_manage',         v_evt_sub_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_profile_admin())',
      v_evt_sub_table || '_self_or_admin_select', v_evt_sub_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())',
      v_evt_sub_table || '_self_insert', v_evt_sub_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin())',
      v_evt_sub_table || '_admin_manage', v_evt_sub_table);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO authenticated', v_evt_sub_table);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 9: VIEW SECURITY INVOKER CONFIGURATION
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE v_view text;
BEGIN
  FOR v_view IN
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'public'
      AND table_name IN (
        'active_attendance_logs','admin_attendance_export','admin_daily_employee_log',
        'attendance_reconciliation','attendance_reconciliation_v2','deleted_attendance_view',
        'employee_live_status','event_admin_summary','monthly_attendance_report',
        'performance_leaderboard','user_latest_location',
        'v_attendance_daily_canonical','v_attendance_daily_enterprise','v_attendance_daily_enterprise_v5'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v_view);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_view);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_view);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not configure view %: %', v_view, SQLERRM;
    END;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 10: HELPER FUNCTION GRANTS & SCHEMA
-- ────────────────────────────────────────────────────────────────────────────

-- Ensure biometric RPC grants are correct (function was restored separately)
DO $$
BEGIN
  IF to_regclass('public.rpc_sync_biometric_punches') IS NULL
     AND EXISTS (
       SELECT 1 FROM pg_proc WHERE proname = 'rpc_sync_biometric_punches'
     ) THEN
    -- already handled by the emergency restore query
    NULL;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

