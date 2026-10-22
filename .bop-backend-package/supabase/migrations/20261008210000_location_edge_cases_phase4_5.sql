-- =============================================================================
-- 20261008210000_location_edge_cases_phase4_5.sql
--
-- Location tracking — Phases 4 + 5 (edge cases, rollout safety, optimisation),
-- see docs/LOCATION_TRACKING_AUDIT_2026-10-08.md. Run after 20261008200000.
--
--  1. Device tracking health: the Android app reports permissions, GPS on/off,
--     background service state, queued offline points and its app / tracking
--     version (rpc_report_tracking_health). HR sees "GPS turned off",
--     "background location not allowed", "old app version" per person.
--     A new problem is also logged in tracking_health_events.
--  2. Silence alerts are safe to switch on now: only phones that report the new
--     tracking (version >= 2, every-minute fixes) are checked, so people still
--     on the old app are never alerted for sitting still. Scheduled here.
--  3. The attendance view's location columns (latest_ping_at, accuracy,
--     office status / distance, session status, health reason) were hard-coded
--     NULL, so TV display and reports showed everyone as "stale". They now come
--     from the tracking heartbeat.
--  4. Optimisation: indexes for the per-attendance session lookups and the
--     5-minute geofence sweep.
-- Idempotent.
-- =============================================================================

SET statement_timeout = '15min';

-- ─── 1. Device tracking health ───────────────────────────────────────────────
ALTER TABLE public.tracking_sessions
  ADD COLUMN IF NOT EXISTS device_health jsonb,
  ADD COLUMN IF NOT EXISTS device_health_at timestamptz;

CREATE OR REPLACE FUNCTION public.rpc_report_tracking_health(p_health jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.tracking_sessions%rowtype;
  v_clean jsonb;
  v_old jsonb;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_session FROM public.tracking_sessions
  WHERE user_id = v_uid AND status = 'ACTIVE'
  ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Only known, small fields are kept.
  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'platform', left(p_health->>'platform', 20),
    'app_version', left(p_health->>'app_version', 40),
    'build', left(p_health->>'build', 40),
    'tracking_options_version', CASE WHEN (p_health->>'tracking_options_version') ~ '^\d{1,3}$'
                                     THEN (p_health->>'tracking_options_version')::int END,
    'foreground', CASE WHEN jsonb_typeof(p_health->'foreground') = 'boolean' THEN p_health->'foreground' END,
    'background', CASE WHEN jsonb_typeof(p_health->'background') = 'boolean' THEN p_health->'background' END,
    'precise', CASE WHEN jsonb_typeof(p_health->'precise') = 'boolean' THEN p_health->'precise' END,
    'gps_on', CASE WHEN jsonb_typeof(p_health->'gps_on') = 'boolean' THEN p_health->'gps_on' END,
    'notifications', CASE WHEN jsonb_typeof(p_health->'notifications') = 'boolean' THEN p_health->'notifications' END,
    'task_active', CASE WHEN jsonb_typeof(p_health->'task_active') = 'boolean' THEN p_health->'task_active' END,
    'queue_size', CASE WHEN (p_health->>'queue_size') ~ '^\d{1,5}$' THEN (p_health->>'queue_size')::int END,
    'source', left(p_health->>'source', 30)));

  v_old := coalesce(v_session.device_health, '{}'::jsonb);
  UPDATE public.tracking_sessions
  SET device_health = v_clean, device_health_at = now(),
      native_task_active = coalesce((v_clean->>'task_active')::boolean, native_task_active),
      updated_at = now()
  WHERE id = v_session.id;

  -- Log a problem when it starts (not on every report).
  v_reason := CASE
    WHEN (v_clean->>'gps_on') = 'false' AND coalesce(v_old->>'gps_on', 'true') <> 'false' THEN 'GPS_DISABLED'
    WHEN (v_clean->>'background') = 'false' AND coalesce(v_old->>'background', 'true') <> 'false' THEN 'BACKGROUND_PERMISSION_DENIED'
    WHEN (v_clean->>'precise') = 'false' AND coalesce(v_old->>'precise', 'true') <> 'false' THEN 'PRECISE_LOCATION_DISABLED'
    WHEN coalesce((v_clean->>'queue_size')::int, 0) >= 30 AND coalesce((v_old->>'queue_size')::int, 0) < 30 THEN 'OFFLINE_LOCATIONS_QUEUED'
  END;
  IF v_reason IS NOT NULL AND to_regclass('public.tracking_health_events') IS NOT NULL THEN
    INSERT INTO public.tracking_health_events (user_id, attendance_log_id, tracking_session_id, reason, detail, occurred_at)
    VALUES (v_uid, v_session.attendance_log_id, v_session.id, v_reason, v_clean, now());
  END IF;
  -- Problems that went away are resolved.
  IF to_regclass('public.tracking_health_events') IS NOT NULL THEN
    UPDATE public.tracking_health_events
    SET resolved_at = now()
    WHERE tracking_session_id = v_session.id AND resolved_at IS NULL
      AND ((reason = 'GPS_DISABLED' AND (v_clean->>'gps_on') = 'true')
        OR (reason = 'BACKGROUND_PERMISSION_DENIED' AND (v_clean->>'background') = 'true')
        OR (reason = 'PRECISE_LOCATION_DISABLED' AND (v_clean->>'precise') = 'true')
        OR (reason = 'OFFLINE_LOCATIONS_QUEUED' AND coalesce((v_clean->>'queue_size')::int, 0) < 30));
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_report_tracking_health(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_report_tracking_health(jsonb) TO authenticated;

-- Heartbeats now include the device health.
DROP FUNCTION IF EXISTS public.rpc_tracking_heartbeats();
CREATE FUNCTION public.rpc_tracking_heartbeats()
RETURNS TABLE (
  user_id uuid,
  tracking_session_id uuid,
  session_status text,
  attendance_log_id uuid,
  field_visit_id uuid,
  last_seen_at timestamptz,
  last_quality_status text,
  last_fix_at timestamptz,
  last_fix_latitude double precision,
  last_fix_longitude double precision,
  last_fix_accuracy_m double precision,
  last_fix_speed_mps double precision,
  last_provider text,
  silence_notified_at timestamptz,
  office_state text,
  office_distance_m double precision,
  site_state text,
  site_distance_m double precision,
  relation_at timestamptz,
  device_health jsonb,
  device_health_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_all boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  v_all := public.hrms_is_admin_user(v_uid) OR EXISTS (
    SELECT 1 FROM public.user_permissions up
    WHERE up.user_id = v_uid AND up.revoked_at IS NULL AND (up.expires_at IS NULL OR up.expires_at > now())
      AND up.scope::text = 'GLOBAL'
      AND up.permission IN ('live_tracking.view', 'attendance.view'));
  RETURN QUERY
    SELECT DISTINCT ON (s.user_id)
           s.user_id, s.id, s.status, s.attendance_log_id, s.field_visit_id,
           s.last_seen_at, s.last_quality_status, s.last_fix_at,
           s.last_fix_latitude, s.last_fix_longitude, s.last_fix_accuracy_m, s.last_fix_speed_mps,
           s.last_provider, s.silence_notified_at,
           s.office_state, s.office_distance_m, s.site_state, s.site_distance_m, s.relation_at,
           s.device_health, s.device_health_at
    FROM public.tracking_sessions s
    WHERE s.started_at >= now() - interval '20 hours'
      AND (v_all OR public.hrms_can_view_location(s.user_id))
    ORDER BY s.user_id, (s.status = 'ACTIVE') DESC, coalesce(s.last_seen_at, s.started_at) DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_tracking_heartbeats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_tracking_heartbeats() TO authenticated;

-- ─── 2. Silence alerts: new-app phones only, then switch them on ─────────────
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.hrms_tracking_silence_sweep()') IS NULL THEN
    RAISE WARNING 'hrms_tracking_silence_sweep missing: run 20261008180000 first';
    RETURN;
  END IF;
  v_def := pg_get_functiondef('public.hrms_tracking_silence_sweep()'::regprocedure);
  v_new := replace(v_def,
    'AND coalesce(s.last_provider, ''expo-location'') LIKE ''expo-location%''',
    'AND coalesce(s.last_provider, ''expo-location'') LIKE ''expo-location%''
      -- New app only (fixes every minute even when still); the old app sends
      -- nothing while still and would be alerted wrongly.
      AND coalesce((s.device_health->>''tracking_options_version'')::int, 0) >= 2');
  IF v_new <> v_def THEN
    EXECUTE v_new;
  ELSIF position('tracking_options_version' IN v_def) = 0 THEN
    RAISE WARNING 'silence sweep provider condition not found';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hrms-tracking-silence-5min';
    PERFORM cron.schedule('hrms-tracking-silence-5min', '*/5 * * * *',
      $job$ select public.hrms_tracking_silence_sweep(); $job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed: schedule hrms_tracking_silence_sweep() every 5 minutes.';
  END IF;
END $$;

-- ─── 3. Attendance view location columns from the heartbeat ──────────────────
CREATE INDEX IF NOT EXISTS tracking_sessions_attendance_started_idx
  ON public.tracking_sessions (attendance_log_id, started_at DESC)
  WHERE attendance_log_id IS NOT NULL;

DO $$
DECLARE
  v_def text;
  v_new text;
  v_hb text := '(SELECT %s FROM public.tracking_sessions hb WHERE hb.attendance_log_id = attendance.id '
               'ORDER BY hb.started_at DESC LIMIT 1)';
BEGIN
  IF to_regclass('public.v_attendance_daily_canonical') IS NULL THEN RETURN; END IF;
  v_def := pg_get_viewdef('public.v_attendance_daily_canonical'::regclass, false);
  IF position('tracking_sessions hb' IN v_def) > 0 THEN RETURN; END IF;  -- already done
  v_new := v_def;
  v_new := regexp_replace(v_new, 'NULL::timestamp with time zone AS latest_ping_at',
    format(v_hb, 'coalesce(hb.last_fix_at, hb.last_location_at)') || ' AS latest_ping_at');
  v_new := regexp_replace(v_new, 'NULL::numeric AS latest_accuracy_m',
    format(v_hb, 'coalesce(hb.last_fix_accuracy_m, hb.last_accuracy_m)::numeric') || ' AS latest_accuracy_m');
  v_new := regexp_replace(v_new, 'NULL::text AS latest_tracking_status',
    format(v_hb, 'CASE hb.office_state WHEN ''INSIDE'' THEN ''GREEN'' WHEN ''NEAR'' THEN ''YELLOW'' WHEN ''OUTSIDE'' THEN ''RED_RANGE'' END') || ' AS latest_tracking_status');
  v_new := regexp_replace(v_new, 'NULL::numeric AS distance_from_office_m',
    format(v_hb, 'hb.office_distance_m::numeric') || ' AS distance_from_office_m');
  v_new := regexp_replace(v_new, 'NULL::text AS tracking_session_status',
    format(v_hb, 'hb.status') || ' AS tracking_session_status');
  v_new := regexp_replace(v_new, 'NULL::text AS tracking_health_reason',
    format(v_hb, 'CASE WHEN hb.silence_notified_at IS NOT NULL THEN ''LAST_PING_STALE''
                       WHEN hb.device_health->>''gps_on'' = ''false'' THEN ''GPS_DISABLED''
                       WHEN hb.device_health->>''background'' = ''false'' THEN ''BACKGROUND_PERMISSION_DENIED'' END')
      || ' AS tracking_health_reason');
  IF v_new = v_def THEN
    RAISE WARNING 'canonical view: location placeholders not found - left unchanged';
    RETURN;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_attendance_daily_canonical AS ' || v_new;
END $$;

-- ─── 4. Optimisation ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS geofence_events_potential_exit_idx
  ON public.geofence_events (detected_at)
  WHERE status = 'POTENTIAL_EXIT';
CREATE INDEX IF NOT EXISTS tracking_sessions_silence_idx
  ON public.tracking_sessions (user_id)
  WHERE silence_notified_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- Who already runs the new app (reports tracking version 2):
-- SELECT p.name, s.device_health->>'app_version' app, s.device_health->>'tracking_options_version' tracking,
--        s.device_health->>'gps_on' gps, s.device_health->>'background' bg, s.device_health_at AT TIME ZONE 'Asia/Kolkata' at_ist
-- FROM tracking_sessions s JOIN profiles p ON p.id = s.user_id
-- WHERE s.status = 'ACTIVE' ORDER BY s.device_health_at DESC NULLS LAST;
