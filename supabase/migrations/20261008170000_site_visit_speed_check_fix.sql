-- =============================================================================
-- 20261008170000_site_visit_speed_check_fix.sql
--
-- Regression from 20261008160000_location_time_fix.sql: location_tracking.
-- recorded_at is now stored as IST wall clock. The site-visit ping path
-- (record_location_ping_unscoped_20260725) computes the time since the previous
-- ping as "p_recorded_at - v_previous_ping.recorded_at" (timestamptz minus a
-- naive timestamp cast in the UTC session zone), which is now about -5.5 h, so
-- the impossible-speed (GPS jump) check never runs on site visits.
--
-- Fix: read the previous ping through hrms_timestamp(), like the attendance
-- path already does. Idempotent.
-- =============================================================================

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regproc('public.record_location_ping_unscoped_20260725') IS NULL THEN
    RAISE NOTICE 'record_location_ping_unscoped_20260725 not found - nothing to patch';
    RETURN;
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_location_ping_unscoped_20260725'
  LIMIT 1;

  v_new := replace(v_def,
    '(p_recorded_at - v_previous_ping.recorded_at)',
    '(p_recorded_at - public.hrms_timestamp(v_previous_ping.recorded_at))');

  IF v_new <> v_def THEN
    EXECUTE v_new;
    RAISE NOTICE 'site-visit speed check patched';
  ELSIF position('hrms_timestamp(v_previous_ping.recorded_at)' IN v_def) > 0 THEN
    RAISE NOTICE 'already patched';
  ELSE
    RAISE WARNING 'speed-check expression not found - check the function manually';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
