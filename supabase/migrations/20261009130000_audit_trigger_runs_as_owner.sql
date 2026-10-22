-- =============================================================================
-- 20261009130000_audit_trigger_runs_as_owner.sql
--
-- BUG-03 (bug report 2026-10-09): employees with the User role could not
-- create tasks: "new row violates row-level security policy for table
-- audit_logs".
--
-- Cause (confirmed on production 2026-10-09): trigger audit_tasks on
-- public.tasks calls public.log_audit_trigger(), which runs with the caller's
-- rights (SECURITY INVOKER). audit_logs only allows INSERT for admins
-- (audit_logs_admin_manage), so the audit row - and with it the task insert -
-- fails for everyone else. Admin/HR were unaffected.
--
-- Fix: the audit trigger function runs as its owner, like every other audit
-- writer (log_audit_event). audit_logs stays append-only for users: no INSERT
-- policy is added for authenticated, so nobody can write audit rows directly.
-- This also fixes the same failure on any other table using this trigger.
--
-- The function body is not changed. Idempotent; skipped if the function does
-- not exist.
-- =============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.log_audit_trigger()') IS NULL THEN
    RAISE NOTICE 'public.log_audit_trigger() not found - nothing to change';
    RETURN;
  END IF;
  ALTER FUNCTION public.log_audit_trigger() SECURITY DEFINER;
  ALTER FUNCTION public.log_audit_trigger() SET search_path = public, pg_temp;
  -- Trigger functions are never called directly by users.
  REVOKE ALL ON FUNCTION public.log_audit_trigger() FROM public, anon, authenticated;
END
$$;
