-- =============================================================================
-- 20261009140000_security_advisor_fixes.sql
--
-- Supabase Security Advisor findings (2026-10-09). Idempotent. No data change.
--
-- 1. v_attendance_daily_canonical (SECURITY DEFINER view)
--    The view runs with its owner's rights, so ANY signed-in employee could
--    read the whole company's attendance through /rest/v1/v_attendance_daily_canonical
--    (RLS of the underlying tables does not apply to a definer view).
--    Fix: employees and anonymous users can no longer read the view directly.
--    All screens get attendance through rpc_attendance_canonical_range /
--    rpc_activity_analysis_day, which check permissions and scope and read the
--    view as owner (unchanged). The Profile screen was moved to the RPC in the
--    same release.
--
-- 2. _mig_fv_ts_verify: a one-off verification view left over from migration
--    20260912000000 (field-visit timestamps). Readable by every employee and
--    used by nothing. Dropped (without CASCADE: fails safely if something
--    unexpected depends on it).
--
-- 3. v_duplicate_device_usage: kept. Its rows are already limited to holders
--    of devices.manage (WHERE hrms_has_permission('devices.manage')) and anon
--    has no access; a non-holder sees zero rows.
--
-- 4. spatial_ref_sys (PostGIS reference table of coordinate systems, not
--    personal data). RLS cannot be enabled on it by the project owner
--    (extension-owned). The real risk is write access: employees / anonymous
--    users must not be able to change coordinate-system definitions used by
--    the distance calculations. Read access stays (PostGIS needs it).
-- =============================================================================

-- 1 ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.v_attendance_daily_canonical') IS NOT NULL THEN
    REVOKE ALL ON public.v_attendance_daily_canonical FROM anon, authenticated;
    -- service_role (Edge Functions) keeps access.
    GRANT SELECT ON public.v_attendance_daily_canonical TO service_role;
  END IF;
END $$;

-- 2 ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public._mig_fv_ts_verify;

-- 4 ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.spatial_ref_sys') IS NOT NULL THEN
    BEGIN
      REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
        ON public.spatial_ref_sys FROM anon, authenticated;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'spatial_ref_sys: not owner, write grants left unchanged';
    END;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- Should return no rows (employees cannot read the attendance view directly):
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_name = 'v_attendance_daily_canonical' AND grantee IN ('anon','authenticated');
