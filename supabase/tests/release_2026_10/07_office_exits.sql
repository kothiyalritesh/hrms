-- Office exit reviews panel (migration 20261021110000).
-- The two notification senders are stubbed with the production deep link.
\set ON_ERROR_STOP on
\ir mock_permissions.sql
\ir ../../migrations/20261020100000_permission_capabilities_and_hierarchy.sql

CREATE FUNCTION public.hrms_confirm_office_exit(p_event_id uuid, p_distance double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE NOTICE 'link %, employee link %', '/HRMS/admin/live-tracking', '/HRMS/?geofenceEvent=' || p_event_id;
END $$;
REVOKE ALL ON FUNCTION public.hrms_confirm_office_exit(uuid, double precision) FROM public, anon, authenticated;

CREATE FUNCTION public.rpc_submit_geofence_reason(p_event_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN jsonb_build_object('link', '/HRMS/admin/live-tracking');
END $$;
REVOKE ALL ON FUNCTION public.rpc_submit_geofence_reason(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_geofence_reason(uuid, text) TO authenticated;

\ir ../../migrations/20261021110000_office_exit_reviews.sql
\ir ../../migrations/20261021110000_office_exit_reviews.sql

SELECT t_assert('screen opens with live_tracking.view',
  (SELECT keys::text FROM permission_screen_access WHERE route = 'OfficeExitReviews'), '{live_tracking.view}');
SELECT t_assert('reason-submitted link points to the panel',
  rpc_submit_geofence_reason(gen_random_uuid(), 'x')->>'link', '/HRMS/admin/office-exits');
SELECT t_assert('no live-tracking link left',
  (SELECT count(*)::text FROM pg_proc WHERE proname IN ('hrms_confirm_office_exit', 'rpc_submit_geofence_reason')
     AND pg_get_functiondef(oid) LIKE '%/HRMS/admin/live-tracking%'), '0');
SELECT t_assert('employee link unchanged',
  (SELECT (pg_get_functiondef(oid) LIKE '%/HRMS/?geofenceEvent=%')::text FROM pg_proc WHERE proname = 'hrms_confirm_office_exit'), 'true');
SELECT t_assert('internal sender still not callable by users',
  has_function_privilege('authenticated', 'public.hrms_confirm_office_exit(uuid, double precision)', 'EXECUTE')::text, 'false');
SELECT t_assert('employees can still submit reasons',
  has_function_privilege('authenticated', 'public.rpc_submit_geofence_reason(uuid, text)', 'EXECUTE')::text, 'true');

SELECT 'PASS 07_office_exits' AS result;
