-- =============================================================================
-- 20261006100000_security_lockdown.sql
--
-- Phase 0 security fixes (audit SEC-02, SEC-03, SEC-07, SEC-08, SEC-10).
-- Safe to re-run: every statement is idempotent, and it also cleans up objects
-- left behind by the abandoned 20261006000000 / 20261006010000 drafts.
--
--   1. One admin definition: hrms_is_admin_user(uuid). is_profile_admin() and
--      require_profile_admin() are role-only again. Having ANY row in
--      user_permissions no longer makes someone an admin (SEC-02).
--      Admin roles: SYSTEM_ADMIN, ADMIN, HR, HRD (after normalize_profile_role).
--      To remove HR/HRD from admin, edit hrms_admin_roles() only.
--   2. RLS on permissions / role_permissions / user_permission_overrides /
--      permission_audit_logs / work_schedule_configs / compliance_score_config (SEC-03).
--   3. anon can no longer execute admin/diagnostic SECURITY DEFINER RPCs (SEC-07/08).
--   4. smartoffice_device_logs insert policy limited to service_role (SEC-10).
--
-- NOT in this file: revoking anon from rpc_sync_biometric_punches. That is in
-- 20261006101000 because the biometric daemon must be switched to the
-- service-role key first (see docs/HRMS_IMPLEMENTATION_GUIDE.md).
-- =============================================================================

-- ─── 1. Single admin definition ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hrms_admin_roles()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY['SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD']::text[];
$$;

CREATE OR REPLACE FUNCTION public.hrms_is_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles actor
    WHERE actor.id = p_user_id
      AND actor.is_active = true
      AND public.normalize_profile_role(actor.role) = ANY (public.hrms_admin_roles())
  );
$$;

REVOKE ALL ON FUNCTION public.hrms_admin_roles() FROM public, anon;
REVOKE ALL ON FUNCTION public.hrms_is_admin_user(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_admin_roles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hrms_is_admin_user(uuid) TO authenticated, service_role;

-- The function every RLS policy uses. Role-only again.
CREATE OR REPLACE FUNCTION public.is_profile_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.hrms_is_admin_user(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_profile_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_profile_admin() TO authenticated, service_role;

-- Same return type (text) as the existing definition, so CREATE OR REPLACE is valid.
CREATE OR REPLACE FUNCTION public.require_profile_admin()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT public.normalize_profile_role(profile.role)
  INTO v_role
  FROM public.profiles profile
  WHERE profile.id = auth.uid()
    AND profile.is_active = true;

  IF coalesce(v_role, '') = ANY (public.hrms_admin_roles()) THEN
    RETURN v_role;
  END IF;

  RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.require_profile_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.require_profile_admin() TO authenticated, service_role;

-- Clean up the 1-argument overload created by the abandoned drafts, together
-- with the draft policies that referenced it.
DO $$
BEGIN
  IF to_regclass('public.permissions') IS NOT NULL THEN
    DROP POLICY IF EXISTS permissions_admin ON public.permissions;
    DROP POLICY IF EXISTS permissions_select ON public.permissions;
    DROP POLICY IF EXISTS admin_all_permissions ON public.permissions;
  END IF;
  IF to_regclass('public.permission_audit_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS audit_select ON public.permission_audit_logs;
    DROP POLICY IF EXISTS audit_insert ON public.permission_audit_logs;
    DROP POLICY IF EXISTS admin_view_permission_audit ON public.permission_audit_logs;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.is_profile_admin(uuid);

-- ─── 2. RLS on permission / config tables ────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'permissions', 'role_permissions', 'user_permission_overrides',
    'permission_audit_logs', 'work_schedule_configs', 'compliance_score_config',
    '_mig_fv_ts_audit'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, public', t);
    END IF;
  END LOOP;
END $$;

-- permissions catalog: everyone signed in can read; only admins write.
DO $$
BEGIN
  IF to_regclass('public.permissions') IS NOT NULL THEN
    GRANT SELECT ON public.permissions TO authenticated;
    DROP POLICY IF EXISTS hrms_permissions_read ON public.permissions;
    DROP POLICY IF EXISTS hrms_permissions_admin_write ON public.permissions;
    CREATE POLICY hrms_permissions_read ON public.permissions
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY hrms_permissions_admin_write ON public.permissions
      FOR ALL TO authenticated
      USING (public.is_profile_admin())
      WITH CHECK (public.is_profile_admin());
  END IF;

  -- Legacy RBAC tables are unused by the app: admin-only, no other access.
  IF to_regclass('public.role_permissions') IS NOT NULL THEN
    DROP POLICY IF EXISTS hrms_role_permissions_admin ON public.role_permissions;
    CREATE POLICY hrms_role_permissions_admin ON public.role_permissions
      FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
  END IF;
  IF to_regclass('public.user_permission_overrides') IS NOT NULL THEN
    DROP POLICY IF EXISTS hrms_user_permission_overrides_admin ON public.user_permission_overrides;
    CREATE POLICY hrms_user_permission_overrides_admin ON public.user_permission_overrides
      FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
  END IF;

  -- Audit log: append-only. Rows are written by SECURITY DEFINER triggers/RPCs,
  -- so there is deliberately NO insert/update/delete policy.
  IF to_regclass('public.permission_audit_logs') IS NOT NULL THEN
    GRANT SELECT ON public.permission_audit_logs TO authenticated;
    DROP POLICY IF EXISTS hrms_permission_audit_read ON public.permission_audit_logs;
    -- Tightened to permission admins in 20261006120000 (hrms_permission_audit_read).
    CREATE POLICY hrms_permission_audit_read ON public.permission_audit_logs
      FOR SELECT TO authenticated
      USING (public.is_profile_admin());
  END IF;

  IF to_regclass('public.work_schedule_configs') IS NOT NULL THEN
    GRANT SELECT ON public.work_schedule_configs TO authenticated;
    DROP POLICY IF EXISTS hrms_work_schedule_read ON public.work_schedule_configs;
    DROP POLICY IF EXISTS hrms_work_schedule_admin_write ON public.work_schedule_configs;
    CREATE POLICY hrms_work_schedule_read ON public.work_schedule_configs
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY hrms_work_schedule_admin_write ON public.work_schedule_configs
      FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
  END IF;

  IF to_regclass('public.compliance_score_config') IS NOT NULL THEN
    GRANT SELECT ON public.compliance_score_config TO authenticated;
    DROP POLICY IF EXISTS hrms_compliance_config_read ON public.compliance_score_config;
    DROP POLICY IF EXISTS hrms_compliance_config_admin_write ON public.compliance_score_config;
    CREATE POLICY hrms_compliance_config_read ON public.compliance_score_config
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY hrms_compliance_config_admin_write ON public.compliance_score_config
      FOR ALL TO authenticated
      USING (public.is_profile_admin()) WITH CHECK (public.is_profile_admin());
  END IF;
END $$;

-- ─── 3. No anon execution of admin / diagnostic SECURITY DEFINER RPCs ────────
-- Applies to every overload of each name. Signed-in access is unchanged, except
-- that the summary RPCs below get an admin guard.

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'rpc_admin_attendance_daily_v3',
        'rpc_admin_audit_logs_summary',
        'rpc_admin_notification_monitoring_summary',
        'get_effective_permissions',
        'has_permission',
        'test_counts',
        'can_access_user_data',
        'get_my_permissions',
        'admin_grant_permission',
        'admin_revoke_permission'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn.sig);
  END LOOP;
END $$;

-- Debug helper left in the migrations folder (test_counts.sql): remove entirely.
DROP FUNCTION IF EXISTS public.test_counts();

-- get_effective_permissions(p_user_id) lets the caller inspect ANY user's
-- permissions: restrict to self or admin.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_effective_permissions'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
  END LOOP;
END $$;

-- Audit summary: same output, but admins only and IST dates.
CREATE OR REPLACE FUNCTION public.rpc_admin_audit_logs_summary()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result json;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  PERFORM public.require_profile_admin();

  SELECT json_build_object(
    'total_today', (SELECT count(*) FROM audit_logs
                    WHERE (performed_at AT TIME ZONE 'Asia/Kolkata')::date = v_today),
    'total_week', (SELECT count(*) FROM audit_logs
                   WHERE (performed_at AT TIME ZONE 'Asia/Kolkata')::date >= v_today - 7),
    'most_active_admin', (
      SELECT p.name
      FROM audit_logs a
      JOIN profiles p ON p.id = a.performed_by
      WHERE (a.performed_at AT TIME ZONE 'Asia/Kolkata')::date >= v_today - 30
      GROUP BY p.name
      ORDER BY count(*) DESC
      LIMIT 1
    ),
    'most_modified_table', (
      SELECT table_name
      FROM audit_logs
      WHERE (performed_at AT TIME ZONE 'Asia/Kolkata')::date >= v_today - 30
      GROUP BY table_name
      ORDER BY count(*) DESC
      LIMIT 1
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_audit_logs_summary() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_audit_logs_summary() TO authenticated;

-- ─── 4. Device-log inserts: service role only ───────────────────────────────
-- Edge functions use the service role (which bypasses RLS anyway); the old
-- policy had no TO clause, so it also applied to anon.
DO $$
BEGIN
  IF to_regclass('public.smartoffice_device_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System can insert device logs" ON public.smartoffice_device_logs;
    DROP POLICY IF EXISTS hrms_device_logs_service_insert ON public.smartoffice_device_logs;
    CREATE POLICY hrms_device_logs_service_insert ON public.smartoffice_device_logs
      FOR INSERT TO service_role WITH CHECK (true);
    REVOKE INSERT, UPDATE, DELETE ON public.smartoffice_device_logs FROM anon;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK (manual, only if this migration causes an outage):
--   Re-run supabase/migrations/20260901000000_comprehensive_production_rls_remediation.sql
--   sections for is_profile_admin()/require_profile_admin(), or temporarily:
--     CREATE OR REPLACE FUNCTION public.hrms_admin_roles() RETURNS text[]
--       LANGUAGE sql IMMUTABLE AS $r$ SELECT ARRAY['SYSTEM_ADMIN','ADMIN','HR','HRD'] $r$;
--   (the admin list is the single switch). Do NOT restore the
--   "any permission = admin" behaviour.
-- =============================================================================
