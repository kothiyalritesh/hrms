-- =============================================================================
-- 20261008180000_location_reliability_phase1.sql
--
-- Location tracking — Phase 1 (critical reliability), see
-- docs/LOCATION_TRACKING_AUDIT_2026-10-08.md.
--
--  1. Heartbeat. Every accepted fix (stored or not) updates the tracking
--     session: last_seen_at (device alive) and last_fix_* (newest RELIABLE
--     position). A person sitting still stays LIVE without storing duplicates.
--     record_location_ping now also answers stored / stored_reason.
--  2. Storage guard rewritten:
--       * accuracy-aware "did not move" test, compared with the last RELIABLE
--         point (not with junk points), better accuracy is always kept;
--       * offline / late points are kept (compared with the point before them)
--         instead of silently dropped;
--       * poor-accuracy points are kept as LOW_ACCURACY evidence (one per 10
--         minutes) instead of being thrown away;
--       * the same GPS fix sent twice is stored once;
--       * location_point fixed (was ST_MakePoint(,)).
--  3. GPS jumps: one accuracy-aware check for every ping (office and visit),
--     with self-correction when the previous "reliable" point was the bad one.
--  4. Live Tracking reads the newest RELIABLE point (a jump never becomes the
--     current location) plus the heartbeat, quality and speed.
--  5. Office geofence sweep no longer treats silence as "left the office":
--     it decides from the newest real fix; with no data the cycle is closed as
--     UNVERIFIED_NO_DATA without notifications.
--  6. Server-side silence detection (every 5 min, 08:00-21:00 IST, Android
--     app only): checked in but no location for 20 min -> employee notified
--     (max 3 / day); 45 min -> location alert + team head notified (once /
--     day). Recovery resolves the alert automatically. Scheduled separately
--     after the new APK is rolled out (see section 7).
--  7. Site-visit pings no longer fail with TRACKING_SESSION_MISMATCH after a
--     session restart.
--  8. GPS-off / permission-revoked are recorded per hour, not once per day.
-- Idempotent. Run after 20261008170000.
-- =============================================================================

SET statement_timeout = '15min';

-- ─── 1. Heartbeat columns ────────────────────────────────────────────────────
ALTER TABLE public.tracking_sessions
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_fix_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_fix_latitude double precision,
  ADD COLUMN IF NOT EXISTS last_fix_longitude double precision,
  ADD COLUMN IF NOT EXISTS last_fix_accuracy_m double precision,
  ADD COLUMN IF NOT EXISTS last_fix_speed_mps double precision,
  ADD COLUMN IF NOT EXISTS last_quality_status text,
  ADD COLUMN IF NOT EXISTS last_provider text,
  ADD COLUMN IF NOT EXISTS silence_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS silence_escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS silence_notice_count integer NOT NULL DEFAULT 0;

UPDATE public.tracking_sessions SET last_seen_at = last_location_at
WHERE last_seen_at IS NULL AND last_location_at IS NOT NULL;

ALTER TABLE public.geofence_events ADD COLUMN IF NOT EXISTS resolution text;

-- ─── 2. Storage guard ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adaptive_location_storage_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_prev public.location_tracking%rowtype;
  v_quality text := coalesce(new.quality_status, 'RELIABLE');
  v_moved double precision;
  v_threshold double precision;
  v_point_type text;
BEGIN
  IF new.latitude IS NULL OR new.longitude IS NULL
     OR new.latitude NOT BETWEEN -90 AND 90 OR new.longitude NOT BETWEEN -180 AND 180 THEN
    RETURN NULL;
  END IF;

  IF new.recorded_at IS NOT NULL THEN
    -- The same fix delivered twice (cached position re-sent with a new id).
    IF EXISTS (SELECT 1 FROM public.location_tracking
               WHERE user_id = new.user_id AND recorded_at = new.recorded_at
                 AND latitude = new.latitude AND longitude = new.longitude) THEN
      RETURN NULL;
    END IF;

    -- Compare with the point just before this one (works for late/offline
    -- points too), of the same kind: good with good, junk with junk.
    -- STALE = a good fix that arrived late (offline queue): it is route data.
    IF v_quality IN ('RELIABLE', 'STALE') THEN
      v_quality := 'RELIABLE';
      SELECT * INTO v_prev FROM public.location_tracking
      WHERE user_id = new.user_id AND recorded_at <= new.recorded_at
        AND coalesce(quality_status, 'RELIABLE') IN ('RELIABLE', 'STALE')
      ORDER BY recorded_at DESC LIMIT 1;
    ELSE
      SELECT * INTO v_prev FROM public.location_tracking
      WHERE user_id = new.user_id AND recorded_at <= new.recorded_at
        AND quality_status = v_quality
      ORDER BY recorded_at DESC LIMIT 1;
    END IF;

    IF FOUND AND new.recorded_at - v_prev.recorded_at < interval '10 minutes'
       AND new.field_visit_id IS NOT DISTINCT FROM v_prev.field_visit_id THEN
      IF v_quality = 'IMPOSSIBLE_SPEED' THEN
        NULL;         -- jumps are always kept (evidence + self-correction)
      ELSIF v_quality <> 'RELIABLE' THEN
        RETURN NULL;  -- one low-accuracy / mocked point per 10 minutes is enough evidence
      ELSE
        v_moved := public.tracking_distance_metres(v_prev.latitude, v_prev.longitude, new.latitude, new.longitude);
        -- "Did not move" = within the GPS noise of this fix (30-100 m).
        v_threshold := greatest(30, least(coalesce(new.accuracy, 100), 100));
        IF v_moved < v_threshold
           AND NOT (coalesce(new.accuracy, 999) * 2 <= coalesce(v_prev.accuracy, 999)) THEN
          RETURN NULL;  -- heartbeat only (tracking_sessions.last_seen_at / last_fix_*)
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_point_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.location_tracking'::regclass AND a.attname = 'location_point' AND NOT a.attisdropped;
  IF v_point_type LIKE 'geography%' THEN
    EXECUTE 'SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography'
      INTO new.location_point USING new.longitude, new.latitude;
  ELSIF v_point_type = 'jsonb' THEN
    new.location_point := jsonb_build_object('type', 'Point',
      'coordinates', jsonb_build_array(new.longitude, new.latitude));
  END IF;
  RETURN new;
END;
$$;

-- ─── 3. One accuracy-aware jump check for every ping ─────────────────────────
-- Runs after a_hrms_normalize_location_recorded_at, before the storage guard.
CREATE OR REPLACE FUNCTION public.hrms_location_jump_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev public.location_tracking%rowtype;
  v_last public.location_tracking%rowtype;
  v_elapsed double precision;
  v_effective double precision;
  v_jump boolean := false;
  -- STALE = good fix that arrived late (offline queue); checked the same way.
  v_base text := CASE WHEN new.quality_status = 'STALE' THEN 'STALE' ELSE 'RELIABLE' END;
BEGIN
  IF coalesce(new.quality_status, 'RELIABLE') NOT IN ('RELIABLE', 'STALE', 'IMPOSSIBLE_SPEED')
     OR new.recorded_at IS NULL THEN
    RETURN new;
  END IF;

  SELECT * INTO v_prev FROM public.location_tracking
  WHERE user_id = new.user_id AND recorded_at < new.recorded_at
    AND recorded_at >= new.recorded_at - interval '30 minutes'
    AND coalesce(quality_status, 'RELIABLE') IN ('RELIABLE', 'STALE')
  ORDER BY recorded_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN new;  -- nothing recent to compare with: keep the caller's verdict
  END IF;

  v_elapsed := extract(epoch FROM (new.recorded_at - v_prev.recorded_at));
  -- Distance that GPS error cannot explain.
  v_effective := greatest(0,
    public.tracking_distance_metres(v_prev.latitude, v_prev.longitude, new.latitude, new.longitude)
    - least(coalesce(v_prev.accuracy, 100), 100) - least(coalesce(new.accuracy, 100), 100));
  v_jump := (v_elapsed >= 5 AND v_effective / v_elapsed > 42)   -- > ~150 km/h
         OR (v_elapsed < 5 AND v_effective > 300);

  IF v_jump THEN
    -- Self-correction: when the newest stored point was itself flagged as a
    -- jump and agrees with this one, the earlier "reliable" anchor was wrong.
    SELECT * INTO v_last FROM public.location_tracking
    WHERE user_id = new.user_id AND recorded_at < new.recorded_at
    ORDER BY recorded_at DESC LIMIT 1;
    IF FOUND AND v_last.quality_status = 'IMPOSSIBLE_SPEED'
       AND new.recorded_at - v_last.recorded_at <= interval '10 minutes'
       AND public.tracking_distance_metres(v_last.latitude, v_last.longitude, new.latitude, new.longitude)
           <= 100 + least(coalesce(v_last.accuracy, 100), 100) + least(coalesce(new.accuracy, 100), 100) THEN
      v_jump := false;
    END IF;
  END IF;

  new.quality_status := CASE WHEN v_jump THEN 'IMPOSSIBLE_SPEED' ELSE v_base END;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS a_hrms_quality_location_jump ON public.location_tracking;
CREATE TRIGGER a_hrms_quality_location_jump
BEFORE INSERT ON public.location_tracking
FOR EACH ROW EXECUTE FUNCTION public.hrms_location_jump_check();

-- ─── 4. Entry point: heartbeat + stored / stored_reason ──────────────────────
CREATE OR REPLACE FUNCTION public.record_location_ping(
  p_attendance_log_id uuid DEFAULT NULL,
  p_tracking_session_id uuid DEFAULT NULL,
  p_field_visit_id uuid DEFAULT NULL,
  p_client_event_id uuid DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_accuracy_m double precision DEFAULT NULL,
  p_altitude_m double precision DEFAULT NULL,
  p_heading double precision DEFAULT NULL,
  p_speed_mps double precision DEFAULT NULL,
  p_mocked boolean DEFAULT false,
  p_recorded_at timestamptz DEFAULT now(),
  p_provider text DEFAULT 'expo-location',
  p_client_quality_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_visit_id uuid;
  v_date date := (coalesce(p_recorded_at, now()) AT TIME ZONE 'Asia/Kolkata')::date;
  v_result jsonb;
  v_session_id uuid;
  v_row_quality text;
  v_stored boolean;
  v_quality text;
  v_seen timestamptz := least(coalesce(p_recorded_at, now()), now());
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;

  -- An active site visit of the ping's own IST date (the device's cached one first).
  IF p_field_visit_id IS NOT NULL THEN
    SELECT fv.id INTO v_visit_id FROM public.field_visits fv
    WHERE fv.id = p_field_visit_id AND fv.user_id = v_uid AND fv.date = v_date
      AND fv.status IN ('PENDING', 'IN_TRANSIT', 'CHECKED_IN') AND fv.destination_coords IS NOT NULL;
  END IF;
  IF v_visit_id IS NULL THEN
    SELECT fv.id INTO v_visit_id FROM public.field_visits fv
    WHERE fv.user_id = v_uid AND fv.date = v_date
      AND fv.status IN ('PENDING', 'IN_TRANSIT', 'CHECKED_IN') AND fv.destination_coords IS NOT NULL
    ORDER BY fv.created_at DESC LIMIT 1;
  END IF;

  IF v_visit_id IS NOT NULL THEN
    -- The server picks the active session itself; a device holding an older
    -- session id must not be rejected (TRACKING_SESSION_MISMATCH).
    v_result := public.record_location_ping_unscoped_20260725(
      p_attendance_log_id, NULL, v_visit_id, p_client_event_id,
      p_latitude, p_longitude, p_accuracy_m, p_altitude_m, p_heading, p_speed_mps,
      p_mocked, p_recorded_at, p_provider, p_client_quality_status);
    IF NOT coalesce((v_result->>'duplicate')::boolean, false) THEN
      PERFORM public.hrms_mirror_site_visit_ping(p_client_event_id);
    END IF;
  ELSE
    v_result := public.hrms_record_attendance_ping(
      v_uid, p_attendance_log_id, p_tracking_session_id, p_client_event_id,
      p_latitude, p_longitude, p_accuracy_m, p_altitude_m, p_heading, p_speed_mps,
      p_mocked, p_recorded_at, p_provider);
  END IF;

  IF coalesce((v_result->>'duplicate')::boolean, false) THEN
    RETURN v_result || jsonb_build_object('stored', true, 'stored_reason', 'DUPLICATE_EVENT');
  END IF;

  v_session_id := nullif(v_result->>'tracking_session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN v_result || jsonb_build_object('stored', false, 'stored_reason', coalesce(v_result->>'health_warning', 'NO_ACTIVE_SESSION'));
  END IF;

  SELECT lt.quality_status INTO v_row_quality FROM public.location_tracking lt
  WHERE lt.client_event_id = p_client_event_id;
  v_stored := FOUND;
  v_quality := coalesce(v_row_quality, v_result->>'quality_status', 'RELIABLE');

  -- Heartbeat: the device is alive (any quality); position only from RELIABLE.
  UPDATE public.tracking_sessions s
  SET last_seen_at = greatest(coalesce(s.last_seen_at, v_seen), v_seen),
      last_quality_status = CASE WHEN v_seen >= coalesce(s.last_seen_at, '-infinity') THEN v_quality ELSE s.last_quality_status END,
      last_provider = CASE WHEN v_seen >= coalesce(s.last_seen_at, '-infinity') THEN left(p_provider, 80) ELSE s.last_provider END,
      last_fix_at = CASE WHEN v_quality = 'RELIABLE' AND v_seen >= coalesce(s.last_fix_at, '-infinity') THEN v_seen ELSE s.last_fix_at END,
      last_fix_latitude = CASE WHEN v_quality = 'RELIABLE' AND v_seen >= coalesce(s.last_fix_at, '-infinity') THEN p_latitude ELSE s.last_fix_latitude END,
      last_fix_longitude = CASE WHEN v_quality = 'RELIABLE' AND v_seen >= coalesce(s.last_fix_at, '-infinity') THEN p_longitude ELSE s.last_fix_longitude END,
      last_fix_accuracy_m = CASE WHEN v_quality = 'RELIABLE' AND v_seen >= coalesce(s.last_fix_at, '-infinity') THEN p_accuracy_m ELSE s.last_fix_accuracy_m END,
      last_fix_speed_mps = CASE WHEN v_quality = 'RELIABLE' AND v_seen >= coalesce(s.last_fix_at, '-infinity') THEN p_speed_mps ELSE s.last_fix_speed_mps END
  WHERE s.id = v_session_id;

  RETURN v_result || jsonb_build_object(
    'quality_status', v_quality,
    'health_warning', CASE WHEN v_quality = 'RELIABLE' THEN NULL ELSE v_quality END,
    'stored', v_stored,
    'stored_reason', CASE WHEN v_stored THEN NULL ELSE 'NO_MOVEMENT' END);
END;
$$;
REVOKE ALL ON FUNCTION public.record_location_ping(
  uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision,
  boolean, timestamptz, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_location_ping(
  uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision,
  boolean, timestamptz, text, text) TO authenticated;

-- ─── 5. Live Tracking: newest RELIABLE point + heartbeat ─────────────────────
DROP FUNCTION IF EXISTS public.rpc_latest_location_pings(date);
CREATE FUNCTION public.rpc_latest_location_pings(p_business_date date DEFAULT NULL)
RETURNS TABLE (
  user_id        uuid,
  latitude       double precision,
  longitude      double precision,
  recorded_at    timestamptz,
  accuracy       double precision,
  provider       text,
  quality_status text,
  speed          double precision,
  last_seen_at   timestamptz,
  last_seen_quality text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_day  date := coalesce(p_business_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_from timestamptz := (v_day::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_to   timestamptz := ((v_day + 1)::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_all  boolean;
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
    WITH visible AS (
      SELECT p.id FROM public.profiles p WHERE v_all
      UNION SELECT v_uid
      UNION SELECT public.authorized_user_ids('live_tracking.view')
      UNION SELECT public.authorized_user_ids('attendance.view')
    )
    -- A stationary person's newest position is often heartbeat-only (not
    -- stored as a new row): use it when it is newer than the stored point.
    SELECT v.id,
           CASE WHEN hb.newer THEN hb.last_fix_latitude ELSE l.latitude::double precision END,
           CASE WHEN hb.newer THEN hb.last_fix_longitude ELSE l.longitude::double precision END,
           CASE WHEN hb.newer THEN hb.last_fix_at ELSE public.hrms_timestamp(l.recorded_at) END,
           CASE WHEN hb.newer THEN hb.last_fix_accuracy_m ELSE l.accuracy::double precision END,
           CASE WHEN hb.newer THEN hb.last_provider ELSE l.provider::text END,
           CASE WHEN hb.newer THEN 'RELIABLE' ELSE coalesce(l.quality_status, 'RELIABLE')::text END,
           CASE WHEN hb.newer THEN hb.last_fix_speed_mps ELSE l.speed::double precision END,
           hb.last_seen_at,
           hb.last_quality_status
    FROM visible v
    JOIN LATERAL (
      SELECT lt.latitude, lt.longitude, lt.recorded_at, lt.accuracy, lt.provider, lt.quality_status, lt.speed
      FROM public.location_tracking lt
      WHERE lt.user_id = v.id
        AND lt.recorded_at >= v_from - interval '1 day'
        AND lt.recorded_at <  v_to + interval '1 day'
        AND public.hrms_timestamp(lt.recorded_at) >= v_from
        AND public.hrms_timestamp(lt.recorded_at) <  v_to
        AND lt.latitude IS NOT NULL AND lt.longitude IS NOT NULL
        AND coalesce(lt.quality_status, 'RELIABLE') <> 'MOCKED'
      -- a RELIABLE point always wins over a newer jump / low-accuracy point
      ORDER BY (coalesce(lt.quality_status, 'RELIABLE') = 'RELIABLE') DESC, lt.recorded_at DESC
      LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT s.last_seen_at, s.last_quality_status, s.last_provider,
             s.last_fix_at, s.last_fix_latitude, s.last_fix_longitude, s.last_fix_accuracy_m, s.last_fix_speed_mps,
             (s.last_fix_at IS NOT NULL AND s.last_fix_latitude IS NOT NULL
              AND s.last_fix_at >= v_from AND s.last_fix_at < v_to
              AND (coalesce(l.quality_status, 'RELIABLE') <> 'RELIABLE'
                   OR s.last_fix_at > public.hrms_timestamp(l.recorded_at))) AS newer
      FROM public.tracking_sessions s
      WHERE s.user_id = v.id AND s.started_at >= v_from - interval '1 day'
        AND s.last_seen_at IS NOT NULL
      ORDER BY s.last_seen_at DESC
      LIMIT 1
    ) hb ON true;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_latest_location_pings(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_latest_location_pings(date) TO authenticated;

-- Heartbeat of today's tracked employees, for screens that need "device alive"
-- even when the position did not change (same visibility as above).
CREATE OR REPLACE FUNCTION public.rpc_tracking_heartbeats()
RETURNS TABLE (
  user_id uuid,
  tracking_session_id uuid,
  session_status text,
  last_seen_at timestamptz,
  last_quality_status text,
  last_fix_at timestamptz,
  last_fix_latitude double precision,
  last_fix_longitude double precision,
  last_fix_accuracy_m double precision,
  last_fix_speed_mps double precision,
  last_provider text,
  silence_notified_at timestamptz
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
           s.user_id, s.id, s.status, s.last_seen_at, s.last_quality_status, s.last_fix_at,
           s.last_fix_latitude, s.last_fix_longitude, s.last_fix_accuracy_m, s.last_fix_speed_mps,
           s.last_provider, s.silence_notified_at
    FROM public.tracking_sessions s
    WHERE s.started_at >= now() - interval '20 hours'
      AND (v_all OR s.user_id = v_uid
           OR s.user_id IN (SELECT public.authorized_user_ids('live_tracking.view'))
           OR s.user_id IN (SELECT public.authorized_user_ids('attendance.view')))
    ORDER BY s.user_id, (s.status = 'ACTIVE') DESC, coalesce(s.last_seen_at, s.started_at) DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_tracking_heartbeats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_tracking_heartbeats() TO authenticated;

-- ─── 6. Office geofence sweep: never confirm an exit on silence ──────────────
CREATE OR REPLACE FUNCTION public.hrms_geofence_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_fix record;
  v_office record;
  v_radius double precision;
  v_distance double precision;
  v_outside boolean;
  v_confirmed integer := 0;
  v_returned integer := 0;
  v_unverified integer := 0;
  v_closed integer := 0;
BEGIN
  UPDATE public.geofence_events g
  SET status = 'CLOSED', processed_at = now(), resolution = coalesce(g.resolution, 'CHECKED_OUT')
  FROM public.attendance_logs a
  WHERE a.id = g.attendance_id AND a.checkout_time IS NOT NULL
    AND g.status = 'POTENTIAL_EXIT';
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  FOR r IN
    SELECT g.id, g.user_id, g.attendance_id, g.geofence_id, g.detected_at
    FROM public.geofence_events g
    JOIN public.attendance_logs a ON a.id = g.attendance_id AND a.checkout_time IS NULL
    WHERE g.status = 'POTENTIAL_EXIT' AND g.geofence_type = 'OFFICE'
      AND g.detected_at <= now() - interval '10 minutes'
      AND g.detected_at >= now() - interval '1 day'
  LOOP
    -- Newest real (RELIABLE) fix of this attendance, stored or heartbeat-only.
    SELECT s.last_fix_at, s.last_fix_latitude, s.last_fix_longitude, s.last_fix_accuracy_m
    INTO v_fix
    FROM public.tracking_sessions s
    WHERE s.attendance_log_id = r.attendance_id AND s.last_fix_at IS NOT NULL
    ORDER BY s.last_fix_at DESC LIMIT 1;

    SELECT o.latitude, o.longitude, coalesce(o.allowed_radius_meters, o.attendance_radius) AS radius
    INTO v_office FROM public.offices o WHERE o.id = r.geofence_id;

    IF v_fix.last_fix_at IS NOT NULL AND v_fix.last_fix_at > r.detected_at
       AND v_office.latitude IS NOT NULL AND v_office.longitude IS NOT NULL THEN
      v_radius := greatest(coalesce(v_office.radius, 200), 50);
      v_distance := public.tracking_distance_metres(v_office.latitude, v_office.longitude,
                                                     v_fix.last_fix_latitude, v_fix.last_fix_longitude);
      v_outside := (v_distance - coalesce(v_fix.last_fix_accuracy_m, 0)) > v_radius + 150;
      IF v_outside AND v_fix.last_fix_at >= r.detected_at + interval '10 minutes' THEN
        PERFORM public.hrms_confirm_office_exit(r.id, v_distance);      -- 2nd outside fix, 10+ min later
        v_confirmed := v_confirmed + 1;
      ELSIF NOT v_outside THEN
        UPDATE public.geofence_events SET status = 'RETURNED_INSIDE', processed_at = now()
        WHERE id = r.id AND status = 'POTENTIAL_EXIT';
        v_returned := v_returned + 1;
      END IF;
    ELSIF r.detected_at <= now() - interval '30 minutes' THEN
      -- One outside reading and then no location at all: not evidence of an
      -- exit. Silence is handled by the tracking-silence alerts instead.
      UPDATE public.geofence_events
      SET status = 'CLOSED', processed_at = now(), resolution = 'UNVERIFIED_NO_DATA'
      WHERE id = r.id AND status = 'POTENTIAL_EXIT';
      v_unverified := v_unverified + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('confirmed', v_confirmed, 'returned', v_returned,
                            'unverified', v_unverified, 'closed', v_closed);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_geofence_sweep() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_geofence_sweep() TO service_role;

-- ─── 7. Server-side silence detection ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hrms_tracking_silence_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_ist_time time := (now() AT TIME ZONE 'Asia/Kolkata')::time;
  v_seen_ist text;
  v_mins integer;
  v_notified integer := 0;
  v_escalated integer := 0;
  v_recovered integer := 0;
BEGIN
  -- Recovery: location is arriving again.
  FOR r IN
    SELECT s.id, s.user_id FROM public.tracking_sessions s
    WHERE s.silence_notified_at IS NOT NULL
      AND coalesce(s.last_seen_at, s.last_location_at) > s.silence_notified_at
  LOOP
    UPDATE public.tracking_sessions SET silence_notified_at = NULL WHERE id = r.id;
    UPDATE public.location_alerts SET resolved = true
    WHERE user_id = r.user_id AND lower(alert_type) = 'no_data' AND resolved = false;
    UPDATE public.tracking_health_events SET resolved_at = now()
    WHERE tracking_session_id = r.id AND reason = 'LAST_PING_STALE' AND resolved_at IS NULL;
    v_recovered := v_recovered + 1;
  END LOOP;

  IF v_ist_time < time '08:00' OR v_ist_time > time '21:00' THEN
    RETURN jsonb_build_object('recovered', v_recovered, 'skipped', 'outside working hours');
  END IF;

  FOR r IN
    SELECT s.id, s.user_id, s.attendance_log_id, s.silence_notified_at, s.silence_escalated_at,
           s.silence_notice_count, p.name, p.reports_to,
           coalesce(s.last_seen_at, s.last_location_at, s.started_at) AS seen
    FROM public.tracking_sessions s
    JOIN public.attendance_logs a ON a.id = s.attendance_log_id
     AND a.checkin_time IS NOT NULL AND a.checkout_time IS NULL
     AND a.checkin_time >= now() - interval '16 hours'
    JOIN public.profiles p ON p.id = s.user_id
    WHERE s.status = 'ACTIVE'
      -- Android app only: a browser tab legitimately stops sending when hidden.
      AND coalesce(s.last_provider, 'expo-location') LIKE 'expo-location%'
      AND coalesce(s.last_seen_at, s.last_location_at, s.started_at) < now() - interval '20 minutes'
  LOOP
    v_seen_ist := to_char(r.seen AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');
    v_mins := floor(extract(epoch FROM (now() - r.seen)) / 60)::int;

    IF r.silence_notified_at IS NULL THEN
      UPDATE public.tracking_sessions
      SET silence_notified_at = now(), silence_notice_count = silence_notice_count + 1
      WHERE id = r.id;
      INSERT INTO public.tracking_health_events (user_id, attendance_log_id, tracking_session_id, reason, detail, occurred_at)
      VALUES (r.user_id, r.attendance_log_id, r.id, 'LAST_PING_STALE',
              jsonb_build_object('source', 'server_silence_sweep', 'last_seen_at', r.seen, 'minutes', v_mins), now());
      IF r.silence_notice_count < 3 THEN
        PERFORM public.enqueue_hrms_notification(r.user_id,
          'Location not received',
          'HRMS has not received your location since ' || v_seen_ist
            || '. Open HRMS and keep location turned on while you are checked in.',
          'location_silent', 'location-silent:' || r.id || ':' || r.silence_notice_count,
          '/HRMS/', NULL, NULL,
          jsonb_build_object('trackingSessionId', r.id, 'lastSeenAt', r.seen));
      END IF;
      v_notified := v_notified + 1;
    ELSIF r.silence_escalated_at IS NULL AND r.seen < now() - interval '45 minutes' THEN
      UPDATE public.tracking_sessions SET silence_escalated_at = now() WHERE id = r.id;
      IF NOT EXISTS (SELECT 1 FROM public.location_alerts
                     WHERE user_id = r.user_id AND lower(alert_type) = 'no_data' AND resolved = false) THEN
        INSERT INTO public.location_alerts (user_id, alert_type, message)
        VALUES (r.user_id, 'no_data',
                coalesce(r.name, 'Employee') || ': no location received since ' || v_seen_ist
                  || ' (' || v_mins || ' min) while checked in.');
      END IF;
      IF r.reports_to IS NOT NULL THEN
        PERFORM public.enqueue_hrms_notification(r.reports_to,
          'Employee location not received',
          coalesce(r.name, 'An employee') || ' is checked in but HRMS has not received a location since '
            || v_seen_ist || ' (' || v_mins || ' min).',
          'location_silent_escalation', 'location-silent-escalation:' || r.id,
          '/HRMS/admin/live-tracking', NULL, NULL,
          jsonb_build_object('userId', r.user_id, 'trackingSessionId', r.id, 'lastSeenAt', r.seen));
      END IF;
      v_escalated := v_escalated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('notified', v_notified, 'escalated', v_escalated, 'recovered', v_recovered);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_tracking_silence_sweep() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_tracking_silence_sweep() TO service_role;

-- NOT scheduled here on purpose: the current Android app (before this
-- release) sends nothing while the phone is still, so the sweep would alert
-- stationary people wrongly. Schedule it once most phones run the new APK:
--
--   SELECT cron.schedule('hrms-tracking-silence-5min', '*/5 * * * *',
--     $job$ select public.hrms_tracking_silence_sweep(); $job$);

-- ─── 8. GPS-off / permission-revoked: once per hour, not once per day ────────
DO $$
BEGIN
  IF to_regclass('public.journey_events') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.journey_events_health_event_idx;
    CREATE UNIQUE INDEX IF NOT EXISTS journey_events_health_daily_idx
      ON public.journey_events (attendance_log_id, event_type)
      WHERE field_visit_id IS NULL AND attendance_log_id IS NOT NULL
        AND event_type NOT IN ('GPS_OFF', 'PERMISSION_REVOKED');
    CREATE UNIQUE INDEX IF NOT EXISTS journey_events_health_hourly_idx
      ON public.journey_events (attendance_log_id, event_type, date_trunc('hour', occurred_at AT TIME ZONE 'UTC'))
      WHERE field_visit_id IS NULL AND attendance_log_id IS NOT NULL
        AND event_type IN ('GPS_OFF', 'PERMISSION_REVOKED');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- SELECT p.name, s.status, s.last_seen_at AT TIME ZONE 'Asia/Kolkata' AS seen_ist,
--        s.last_fix_at AT TIME ZONE 'Asia/Kolkata' AS fix_ist, s.last_fix_accuracy_m, s.last_quality_status
-- FROM tracking_sessions s JOIN profiles p ON p.id = s.user_id
-- WHERE s.status = 'ACTIVE' ORDER BY s.last_seen_at DESC NULLS LAST LIMIT 20;
