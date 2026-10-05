-- ==============================================================================
-- Migration: 20261005020000_phase0_security_hotfixes.sql
-- Description: Emergency Security Remediation (Phase 0)
-- Covers SEC-02, SEC-03, SEC-04, SEC-07, SEC-10
-- ==============================================================================

-- 1. SEC-03: Enable RLS on RBAC/Permission tables that were completely open
DO $$
BEGIN
  -- We use DO block to gracefully handle if tables don't exist
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'permissions') THEN
    ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.permissions FROM anon, public;
    GRANT SELECT ON public.permissions TO authenticated;
    
    -- Admins can manage permissions catalog
    CREATE POLICY admin_all_permissions ON public.permissions 
      FOR ALL TO authenticated 
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() AND profiles.role IN ('SYSTEM_ADMIN', 'ADMIN')
        )
      );
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'role_permissions') THEN
    ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.role_permissions FROM anon, public;
    GRANT SELECT ON public.role_permissions TO authenticated;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_permission_overrides') THEN
    ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.user_permission_overrides FROM anon, public;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'permission_audit_logs') THEN
    ALTER TABLE public.permission_audit_logs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.permission_audit_logs FROM anon, public;
    
    -- Only viewable by admins, no direct inserts allowed
    CREATE POLICY admin_view_permission_audit ON public.permission_audit_logs 
      FOR SELECT TO authenticated 
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() AND profiles.role IN ('SYSTEM_ADMIN', 'ADMIN')
        )
      );
  END IF;
  
  -- SEC-10: work_schedule_configs missing RLS
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'work_schedule_configs') THEN
    ALTER TABLE public.work_schedule_configs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.work_schedule_configs FROM anon;
    GRANT SELECT ON public.work_schedule_configs TO authenticated;
  END IF;
END $$;

-- 2. SEC-04: Revoke anon access from biometric sync to prevent unauthenticated forgery
REVOKE EXECUTE ON FUNCTION public.rpc_sync_biometric_punches(jsonb) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_sync_biometric_punches(jsonb) TO service_role;

-- 3. SEC-07: Revoke anon from rpc_admin_attendance_daily_v3
REVOKE EXECUTE ON FUNCTION public.rpc_admin_attendance_daily_v3(date, date, uuid, uuid) FROM anon, public;
-- Note: it is already SECURITY DEFINER, we just needed to remove anon.

-- 4. SEC-02: Revert is_profile_admin / require_profile_admin to check for 'SYSTEM_ADMIN' and 'ADMIN' only
-- The over-broad "has any permission" logic resulted in privilege escalation.

CREATE OR REPLACE FUNCTION public.is_profile_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE id = p_user_id 
      AND is_active = true 
      AND role IN ('SYSTEM_ADMIN', 'ADMIN')
  );
$$;

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
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT role INTO v_role 
  FROM public.profiles 
  WHERE id = auth.uid() AND is_active = true;

  IF v_role IN ('SYSTEM_ADMIN', 'ADMIN') THEN
    RETURN v_role;
  END IF;

  RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ACCESS';
END;
$$;

NOTIFY pgrst, 'reload schema';
