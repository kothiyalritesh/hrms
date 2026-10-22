-- =============================================================================
-- 2026-10-21 Office exit reviews panel.
-- The review RPCs already exist (rpc_geofence_review_queue,
-- rpc_review_geofence_event, 20261008100000). This adds:
--   1. the screen entry "OfficeExitReviews" (opened with live_tracking.view,
--      the same key the review RPCs check);
--   2. notification taps for managers / HR open the new panel instead of Live
--      Tracking.
-- Needs 20261020100000 (permission_screen_access, hrms_patch_function_body).
-- Safe to run twice.
-- =============================================================================

INSERT INTO public.permission_screen_access (route, keys) VALUES
  ('OfficeExitReviews', ARRAY['live_tracking.view'])
ON CONFLICT (route) DO UPDATE SET keys = EXCLUDED.keys;

-- "Employee outside office" and "Reason submitted" notifications.
SELECT public.hrms_patch_function_body('hrms_confirm_office_exit',
  $p$'/HRMS/admin/live-tracking'$p$, $r$'/HRMS/admin/office-exits'$r$);
SELECT public.hrms_patch_function_body('rpc_submit_geofence_reason',
  $p$'/HRMS/admin/live-tracking'$p$, $r$'/HRMS/admin/office-exits'$r$);

-- Check: both functions now link to the panel.
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_missing
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('hrms_confirm_office_exit', 'rpc_submit_geofence_reason')
    AND pg_get_functiondef(p.oid) NOT LIKE '%/HRMS/admin/office-exits%';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'office exit links not updated in: %', v_missing;
  END IF;
END $$;
