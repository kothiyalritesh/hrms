-- =============================================================================
-- 20261008190000_location_precision_phase2.sql
--
-- Location tracking — Phase 2 (office + field precision), see
-- docs/LOCATION_TRACKING_AUDIT_2026-10-08.md. Run after 20261008180000.
--
--  1. Office relationship on every good fix, with GPS accuracy taken into
--     account: INSIDE / NEAR (uncertain, no decision) / OUTSIDE + distance.
--     "Back in the office" now needs an INSIDE reading, not just "not far".
--  2. Site relationship on every good visit fix: AT_SITE / NEAR_SITE /
--     APPROACHING / LEFT_SITE + distance to the SELECTED site.
--  3. Travel to a site is tracked even before office/site check-in (direct
--     field visits): pings are stored on a visit-only tracking session
--     instead of being discarded with NO_OPEN_ATTENDANCE.
--  4. Automatic site arrival needs 2 good fixes inside the site AND 2 minutes
--     there (no "drive-by" arrivals); inside/outside allow for GPS error.
--  5. Site check-in allows for GPS error: distance - min(accuracy, 50 m) must
--     be within the radius (accuracy must still be <= 100 m).
--  6. Location evidence for every visit (points, time at site, closest
--     distance, best accuracy, gaps, flagged points -> STRONG / PARTIAL /
--     NOT_AT_SITE / NONE). Saved on the visit when it is completed and
--     readable live by reviewers (rpc_field_visit_location_evidence).
-- Idempotent.
-- =============================================================================

SET statement_timeout = '15min';

-- ─── 0. Columns / indexes ────────────────────────────────────────────────────
ALTER TABLE public.tracking_sessions
  ADD COLUMN IF NOT EXISTS field_visit_id uuid REFERENCES public.field_visits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS office_id uuid,
  ADD COLUMN IF NOT EXISTS office_state text,
  ADD COLUMN IF NOT EXISTS office_distance_m double precision,
  ADD COLUMN IF NOT EXISTS site_state text,
  ADD COLUMN IF NOT EXISTS site_distance_m double precision,
  ADD COLUMN IF NOT EXISTS relation_at timestamptz;

-- Visit-only sessions (travel before any check-in) have no attendance yet.
ALTER TABLE public.tracking_sessions ALTER COLUMN attendance_log_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracking_sessions_owner_check') THEN
    ALTER TABLE public.tracking_sessions ADD CONSTRAINT tracking_sessions_owner_check
      CHECK (attendance_log_id IS NOT NULL OR field_visit_id IS NOT NULL);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS tracking_sessions_one_active_visit_only
  ON public.tracking_sessions (field_visit_id)
  WHERE status = 'ACTIVE' AND attendance_log_id IS NULL;

ALTER TABLE public.field_visits ADD COLUMN IF NOT EXISTS location_evidence jsonb;

-- Per-visit point lookups (dwell, evidence). Brief write lock while it builds.
CREATE INDEX IF NOT EXISTS location_tracking_visit_recorded_idx
  ON public.location_tracking (field_visit_id, recorded_at)
  WHERE field_visit_id IS NOT NULL;

-- ─── 1. Relationship helpers ─────────────────────────────────────────────────
-- Office: INSIDE if the fix (allowing up to 50 m of GPS error) is within the
-- radius; OUTSIDE only if it is clearly 150 m beyond it; NEAR otherwise.
CREATE OR REPLACE FUNCTION public.hrms_office_relation(
  p_office_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_office record;
  v_radius double precision;
  v_distance double precision;
BEGIN
  SELECT o.latitude, o.longitude, coalesce(o.allowed_radius_meters, o.attendance_radius) AS radius
  INTO v_office FROM public.offices o WHERE o.id = p_office_id;
  IF NOT FOUND OR v_office.latitude IS NULL OR v_office.longitude IS NULL
     OR p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN jsonb_build_object('state', 'UNKNOWN');
  END IF;
  v_radius := greatest(coalesce(v_office.radius, 200), 50);
  v_distance := public.tracking_distance_metres(v_office.latitude, v_office.longitude, p_latitude, p_longitude);
  RETURN jsonb_build_object(
    'state', CASE
      WHEN v_distance - least(coalesce(p_accuracy_m, 100), 50) <= v_radius THEN 'INSIDE'
      WHEN v_distance - coalesce(p_accuracy_m, 0) > v_radius + 150 THEN 'OUTSIDE'
      ELSE 'NEAR' END,
    'distance_m', round(v_distance::numeric, 1),
    'radius_m', v_radius);
END;
$$;

-- Coordinates + radius of a visit's selected site (predefined site first).
CREATE OR REPLACE FUNCTION public.hrms_field_visit_site(
  p_visit_id uuid,
  OUT latitude double precision, OUT longitude double precision, OUT radius_m double precision
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visit public.field_visits%rowtype;
  v_site_radius double precision;
BEGIN
  SELECT * INTO v_visit FROM public.field_visits WHERE id = p_visit_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF to_jsonb(v_visit) ? 'predefined_site_id' AND (to_jsonb(v_visit)->>'predefined_site_id') IS NOT NULL
     AND to_regclass('public.predefined_sites') IS NOT NULL THEN
    EXECUTE 'SELECT latitude, longitude, checkin_radius_m FROM public.predefined_sites WHERE id = $1'
      INTO latitude, longitude, v_site_radius USING (to_jsonb(v_visit)->>'predefined_site_id')::uuid;
  END IF;
  IF latitude IS NULL OR longitude IS NULL THEN
    BEGIN
      latitude := coalesce((v_visit.destination_coords->>'latitude')::double precision,
                           (v_visit.destination_coords->>'lat')::double precision);
      longitude := coalesce((v_visit.destination_coords->>'longitude')::double precision,
                            (v_visit.destination_coords->>'lng')::double precision,
                            (v_visit.destination_coords->>'lon')::double precision);
    EXCEPTION WHEN others THEN
      latitude := NULL; longitude := NULL;
    END;
  END IF;
  radius_m := greatest(25, least(coalesce(v_site_radius,
    (to_jsonb(v_visit)->>'checkin_radius_m')::double precision,
    (to_jsonb(v_visit)->>'arrival_radius_m')::double precision, 100), 1000));
END;
$$;

-- Site: AT_SITE within the radius (allowing up to 50 m GPS error); away when
-- clearly 100 m beyond it (LEFT_SITE after arrival, APPROACHING before).
CREATE OR REPLACE FUNCTION public.hrms_site_relation(
  p_visit_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site record;
  v_visit public.field_visits%rowtype;
  v_distance double precision;
  v_arrived boolean;
BEGIN
  SELECT * INTO v_site FROM public.hrms_field_visit_site(p_visit_id);
  SELECT * INTO v_visit FROM public.field_visits WHERE id = p_visit_id;
  IF v_site.latitude IS NULL OR v_site.longitude IS NULL OR p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN jsonb_build_object('state', 'UNKNOWN');
  END IF;
  v_distance := public.tracking_distance_metres(v_site.latitude, v_site.longitude, p_latitude, p_longitude);
  v_arrived := v_visit.status = 'CHECKED_IN' OR v_visit.arrived_at IS NOT NULL;
  RETURN jsonb_build_object(
    'state', CASE
      WHEN v_distance - least(coalesce(p_accuracy_m, 100), 50) <= v_site.radius_m THEN 'AT_SITE'
      WHEN v_distance - coalesce(p_accuracy_m, 0) > v_site.radius_m + 100 THEN
        CASE WHEN v_arrived THEN 'LEFT_SITE' ELSE 'APPROACHING' END
      ELSE 'NEAR_SITE' END,
    'distance_m', round(v_distance::numeric, 1),
    'radius_m', v_site.radius_m);
END;
$$;

-- Continuous presence at the site for >= 2 minutes (stored good points of
-- this visit since it was last outside).
CREATE OR REPLACE FUNCTION public.hrms_visit_dwell_ok(
  p_visit_id uuid, p_site_lat double precision, p_site_lon double precision,
  p_radius double precision, p_at timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH pts AS (
    SELECT public.hrms_timestamp(lt.recorded_at) AS t,
           public.tracking_distance_metres(p_site_lat, p_site_lon, lt.latitude, lt.longitude)
             - least(coalesce(lt.accuracy, 100), 50) <= p_radius AS inside
    FROM public.location_tracking lt
    WHERE lt.field_visit_id = p_visit_id
      AND coalesce(lt.quality_status, 'RELIABLE') IN ('RELIABLE', 'STALE')
      AND lt.recorded_at >= (p_at AT TIME ZONE 'Asia/Kolkata') - interval '14 hours'
  ), last_out AS (
    SELECT max(t) AS t FROM pts WHERE NOT inside AND t <= p_at
  )
  SELECT coalesce(p_at - min(pts.t) >= interval '2 minutes', false)
  FROM pts, last_out
  WHERE pts.inside AND pts.t <= p_at AND pts.t > coalesce(last_out.t, '-infinity'::timestamptz);
$$;

-- ─── 2. Travel to a site before any check-in ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.hrms_record_visit_travel_ping(
  p_uid uuid, p_visit_id uuid, p_client_event_id uuid,
  p_latitude double precision, p_longitude double precision, p_accuracy_m double precision,
  p_altitude_m double precision, p_heading double precision, p_speed_mps double precision,
  p_mocked boolean, p_recorded_at timestamptz, p_provider text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.tracking_sessions%rowtype;
  v_quality text := 'RELIABLE';
  v_site record;
  v_distance double precision;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'CLIENT_EVENT_ID_REQUIRED'; END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180
     OR (p_latitude = 0 AND p_longitude = 0) THEN
    RAISE EXCEPTION 'INVALID_COORDINATES';
  END IF;
  IF p_recorded_at > now() + interval '1 minute' OR p_recorded_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'INVALID_TIMESTAMP_SKEW';
  END IF;

  SELECT * INTO v_session FROM public.tracking_sessions
  WHERE field_visit_id = p_visit_id AND attendance_log_id IS NULL AND status = 'ACTIVE'
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.tracking_sessions (user_id, attendance_log_id, field_visit_id, status, start_reason, native_task_active)
    VALUES (p_uid, NULL, p_visit_id, 'ACTIVE', 'FIELD_VISIT_TRAVEL', true)
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_session;
    IF v_session.id IS NULL THEN
      SELECT * INTO v_session FROM public.tracking_sessions
      WHERE field_visit_id = p_visit_id AND attendance_log_id IS NULL AND status = 'ACTIVE';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.location_tracking WHERE client_event_id = p_client_event_id) THEN
    RETURN jsonb_build_object('tracking_session_id', v_session.id, 'tracking_session_status', 'ACTIVE',
                              'journey_status', NULL, 'duplicate', true, 'should_notify_local', false);
  END IF;

  IF coalesce(p_mocked, false) THEN
    v_quality := 'MOCKED';
  ELSIF p_accuracy_m IS NULL OR p_accuracy_m < 0 OR p_accuracy_m > 100 THEN
    v_quality := 'LOW_ACCURACY';
  ELSIF p_recorded_at < now() - interval '5 minutes' THEN
    v_quality := 'STALE';
  ELSIF p_latitude NOT BETWEEN 6.5 AND 37.6 OR p_longitude NOT BETWEEN 68 AND 97.5 THEN
    v_quality := 'OUTSIDE_ALLOWED_REGION';
  END IF;  -- jumps: a_hrms_quality_location_jump trigger

  INSERT INTO public.location_tracking (
    user_id, tracking_session_id, field_visit_id, latitude, longitude,
    accuracy, altitude, heading, speed, mocked, provider, client_event_id,
    sync_source, quality_status, gps_available, status, recorded_at, date,
    source, received_at
  ) VALUES (
    p_uid, v_session.id, p_visit_id, p_latitude, p_longitude,
    p_accuracy_m, p_altitude_m, p_heading, p_speed_mps, coalesce(p_mocked, false),
    left(p_provider, 80), p_client_event_id,
    CASE WHEN p_provider ILIKE '%offline%' THEN 'OFFLINE_SYNC' ELSE 'NATIVE' END,
    v_quality, true, 'GREEN', p_recorded_at,
    (p_recorded_at AT TIME ZONE 'Asia/Kolkata')::date, 'app', now()
  );

  UPDATE public.tracking_sessions
  SET last_location_at = greatest(coalesce(last_location_at, p_recorded_at), p_recorded_at),
      last_accuracy_m = p_accuracy_m, native_task_active = true, updated_at = now()
  WHERE id = v_session.id;

  IF v_quality = 'RELIABLE' THEN
    SELECT * INTO v_site FROM public.hrms_field_visit_site(p_visit_id);
    IF v_site.latitude IS NOT NULL THEN
      v_distance := public.tracking_distance_metres(v_site.latitude, v_site.longitude, p_latitude, p_longitude);
      UPDATE public.field_visits
      SET tracking_started_at = coalesce(tracking_started_at, p_recorded_at),
          last_distance_m = v_distance, last_distance_at = p_recorded_at
      WHERE id = p_visit_id AND p_recorded_at >= coalesce(last_distance_at, '-infinity');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'tracking_session_id', v_session.id,
    'tracking_session_status', 'ACTIVE',
    'journey_status', 'TRAVELLING',
    'distance_m', v_distance,
    'quality_status', v_quality,
    'should_notify_local', false,
    'health_warning', CASE WHEN v_quality = 'RELIABLE' THEN NULL ELSE v_quality END,
    'duplicate', false);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_record_visit_travel_ping(uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision, boolean, timestamptz, text)
  FROM public, anon, authenticated;

-- ─── 3. Entry point: + travel path + office/site relationship ────────────────
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
  v_open_attendance boolean;
  v_office_id uuid;
  v_relation jsonb;
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

  v_open_attendance := EXISTS (
    SELECT 1 FROM public.attendance_logs a
    WHERE a.user_id = v_uid AND a.checkin_time IS NOT NULL AND a.checkout_time IS NULL);
  -- Travel-only sessions end at check-in, or when their visit is no longer the active one.
  UPDATE public.tracking_sessions
  SET status = 'STOPPED', stopped_at = now(), updated_at = now(),
      stop_reason = CASE WHEN v_open_attendance THEN 'ATTENDANCE_STARTED' ELSE 'FIELD_VISIT_ENDED' END
  WHERE user_id = v_uid AND attendance_log_id IS NULL AND status = 'ACTIVE'
    AND (v_open_attendance OR field_visit_id IS DISTINCT FROM v_visit_id);

  IF v_visit_id IS NOT NULL AND NOT v_open_attendance THEN
    v_result := public.hrms_record_visit_travel_ping(
      v_uid, v_visit_id, p_client_event_id, p_latitude, p_longitude, p_accuracy_m,
      p_altitude_m, p_heading, p_speed_mps, p_mocked, p_recorded_at, p_provider);
    IF NOT coalesce((v_result->>'duplicate')::boolean, false) THEN
      PERFORM public.hrms_mirror_site_visit_ping(p_client_event_id);
    END IF;
  ELSIF v_visit_id IS NOT NULL THEN
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

  -- Where the employee is relative to the office / the site (newest good fix only).
  IF v_quality = 'RELIABLE' THEN
    IF v_visit_id IS NOT NULL THEN
      v_relation := public.hrms_site_relation(v_visit_id, p_latitude, p_longitude, p_accuracy_m);
      UPDATE public.tracking_sessions
      SET field_visit_id = v_visit_id,
          site_state = v_relation->>'state', site_distance_m = (v_relation->>'distance_m')::double precision,
          office_state = NULL, office_distance_m = NULL, relation_at = v_seen
      WHERE id = v_session_id AND last_fix_at = v_seen;
    ELSE
      SELECT a.office_id INTO v_office_id
      FROM public.tracking_sessions s JOIN public.attendance_logs a ON a.id = s.attendance_log_id
      WHERE s.id = v_session_id;
      IF v_office_id IS NOT NULL THEN
        v_relation := public.hrms_office_relation(v_office_id, p_latitude, p_longitude, p_accuracy_m);
        UPDATE public.tracking_sessions
        SET office_id = v_office_id,
            office_state = v_relation->>'state', office_distance_m = (v_relation->>'distance_m')::double precision,
            site_state = NULL, site_distance_m = NULL, relation_at = v_seen
        WHERE id = v_session_id AND last_fix_at = v_seen;
      END IF;
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object(
    'quality_status', v_quality,
    'health_warning', CASE WHEN v_quality = 'RELIABLE' THEN NULL ELSE v_quality END,
    'stored', v_stored,
    'stored_reason', CASE WHEN v_stored THEN NULL ELSE 'NO_MOVEMENT' END,
    'relation', v_relation);
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

-- ─── 4. Office exit cycle: "back inside" needs an INSIDE reading ─────────────
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.hrms_evaluate_office_geofence(uuid)') IS NOT NULL THEN
    v_def := pg_get_functiondef('public.hrms_evaluate_office_geofence(uuid)'::regprocedure);
    v_new := replace(v_def,
      'ELSIF v_event.id IS NOT NULL AND v_event.status = ''POTENTIAL_EXIT'' THEN',
      'ELSIF v_event.id IS NOT NULL AND v_event.status = ''POTENTIAL_EXIT''
        AND v_distance - least(coalesce(v_ping.accuracy, 100), 50) <= v_radius THEN');
    IF v_new <> v_def THEN EXECUTE v_new;
    ELSIF position('least(coalesce(v_ping.accuracy, 100), 50) <= v_radius' IN v_def) = 0 THEN
      RAISE WARNING 'hrms_evaluate_office_geofence: return-inside expression not found';
    END IF;
  END IF;
  IF to_regprocedure('public.hrms_geofence_sweep()') IS NOT NULL THEN
    v_def := pg_get_functiondef('public.hrms_geofence_sweep()'::regprocedure);
    v_new := replace(v_def,
      'ELSIF NOT v_outside THEN',
      'ELSIF v_distance - least(coalesce(v_fix.last_fix_accuracy_m, 100), 50) <= v_radius THEN');
    IF v_new <> v_def THEN EXECUTE v_new;
    ELSIF position('least(coalesce(v_fix.last_fix_accuracy_m, 100), 50) <= v_radius' IN v_def) = 0 THEN
      RAISE WARNING 'hrms_geofence_sweep: return-inside expression not found (run 20261008180000 first)';
    END IF;
  END IF;
END $$;

-- ─── 5. Automatic site arrival / departure: GPS error + 2-minute dwell ───────
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regproc('public.record_location_ping_unscoped_20260725') IS NULL THEN RETURN; END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_location_ping_unscoped_20260725' LIMIT 1;
  v_new := v_def;
  v_new := replace(v_new,
    'if v_visit.arrived_at is null and v_distance <= v_arrival_radius',
    'if v_visit.arrived_at is null and v_distance - least(coalesce(p_accuracy_m, 100), 50) <= v_arrival_radius');
  v_new := regexp_replace(v_new,
    'returning arrival_confirmation_count into v_rows;(\s*)if v_rows >= 2 then',
    'returning arrival_confirmation_count into v_rows;\1if v_rows >= 2 and public.hrms_visit_dwell_ok(v_visit.id, v_latitude, v_longitude, v_arrival_radius, p_recorded_at) then');
  v_new := replace(v_new,
    'and v_distance > v_arrival_radius + 100 then',
    'and v_distance - coalesce(p_accuracy_m, 0) > v_arrival_radius + 100 then');
  IF v_new <> v_def THEN
    EXECUTE v_new;
  ELSIF position('hrms_visit_dwell_ok' IN v_def) = 0 THEN
    RAISE WARNING 'site arrival expressions not found - check record_location_ping_unscoped_20260725';
  END IF;
END $$;

-- ─── 6. Site check-in allows for GPS error ───────────────────────────────────
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.rpc_mutate_own_field_visit__core(text, uuid, jsonb)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.rpc_mutate_own_field_visit__core(text, uuid, jsonb)'::regprocedure);
  v_new := replace(v_def, 'if v_distance>v_radius then',
                          'if v_distance-least(coalesce(v_accuracy,100),50)>v_radius then');
  IF v_new <> v_def THEN EXECUTE v_new;
  ELSIF position('least(coalesce(v_accuracy,100),50)>v_radius' IN v_def) = 0 THEN
    RAISE WARNING 'site check-in distance test not found';
  END IF;
END $$;

-- ─── 7. Location evidence of a visit ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hrms_field_visit_location_evidence(p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site record;
  v_stats record;
  v_level text;
  v_flags text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_site FROM public.hrms_field_visit_site(p_visit_id);

  WITH pts AS (
    SELECT public.hrms_timestamp(lt.recorded_at) AS t,
           coalesce(lt.quality_status, 'RELIABLE') AS q,
           lt.accuracy AS a,
           CASE WHEN v_site.latitude IS NULL THEN NULL
                ELSE public.tracking_distance_metres(v_site.latitude, v_site.longitude, lt.latitude, lt.longitude) END AS d
    FROM public.location_tracking lt
    WHERE lt.field_visit_id = p_visit_id
  ), good AS (
    SELECT t, a, d, (d - least(coalesce(a, 100), 50) <= v_site.radius_m) AS inside,
           lead(t) OVER (ORDER BY t) AS next_t,
           lead(d - least(coalesce(a, 100), 50) <= v_site.radius_m) OVER (ORDER BY t) AS next_inside
    FROM pts WHERE q IN ('RELIABLE', 'STALE')
  ), gaps AS (
    SELECT t, lead(t) OVER (ORDER BY t) AS next_t FROM pts
  )
  SELECT
    (SELECT count(*) FROM pts) AS total_points,
    (SELECT count(*) FROM good) AS good_points,
    (SELECT count(*) FROM pts WHERE q = 'LOW_ACCURACY') AS low_accuracy_points,
    (SELECT count(*) FROM pts WHERE q = 'IMPOSSIBLE_SPEED') AS jump_points,
    (SELECT count(*) FROM pts WHERE q = 'MOCKED') AS mocked_points,
    (SELECT min(t) FROM pts) AS first_point_at,
    (SELECT max(t) FROM pts) AS last_point_at,
    (SELECT count(*) FROM good WHERE inside) AS points_at_site,
    (SELECT min(t) FROM good WHERE inside) AS first_at_site,
    (SELECT max(t) FROM good WHERE inside) AS last_at_site,
    (SELECT round(min(d)::numeric) FROM good) AS closest_m,
    (SELECT round(min(a)::numeric) FROM good) AS best_accuracy_m,
    -- time at site: gaps between consecutive good points (<= 15 min), full when
    -- both inside, half when only one is
    (SELECT round(coalesce(sum(
        extract(epoch FROM least(next_t - t, interval '15 minutes')) / 60
        * CASE WHEN inside AND next_inside THEN 1 WHEN inside OR next_inside THEN 0.5 ELSE 0 END), 0)::numeric)
     FROM good WHERE next_t IS NOT NULL) AS minutes_at_site,
    (SELECT round(coalesce(max(extract(epoch FROM next_t - t)) / 60, 0)::numeric) FROM gaps WHERE next_t IS NOT NULL) AS longest_gap_min
  INTO v_stats;

  v_level := CASE
    WHEN v_stats.good_points = 0 THEN 'NONE'
    WHEN v_stats.points_at_site = 0 THEN 'NOT_AT_SITE'
    WHEN v_stats.points_at_site >= 2 AND v_stats.minutes_at_site >= 5 THEN 'STRONG'
    ELSE 'PARTIAL' END;
  IF v_stats.mocked_points > 0 THEN v_flags := v_flags || 'MOCKED_POINTS'; END IF;
  IF v_stats.jump_points > 0 THEN v_flags := v_flags || 'GPS_JUMPS'; END IF;
  IF v_stats.longest_gap_min > 30 THEN v_flags := v_flags || 'LONG_GAP'; END IF;
  IF v_site.latitude IS NULL THEN v_flags := v_flags || 'SITE_HAS_NO_COORDINATES'; END IF;

  RETURN jsonb_build_object(
    'level', v_level,
    'flags', to_jsonb(v_flags),
    'site_radius_m', v_site.radius_m,
    'total_points', v_stats.total_points,
    'good_points', v_stats.good_points,
    'low_accuracy_points', v_stats.low_accuracy_points,
    'jump_points', v_stats.jump_points,
    'mocked_points', v_stats.mocked_points,
    'points_at_site', v_stats.points_at_site,
    'first_point_at', v_stats.first_point_at,
    'last_point_at', v_stats.last_point_at,
    'first_at_site', v_stats.first_at_site,
    'last_at_site', v_stats.last_at_site,
    'minutes_at_site', v_stats.minutes_at_site,
    'closest_m', v_stats.closest_m,
    'best_accuracy_m', v_stats.best_accuracy_m,
    'longest_gap_min', v_stats.longest_gap_min,
    'computed_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_field_visit_location_evidence(uuid) FROM public, anon, authenticated;

-- Snapshot when the visit ends (completed by the employee or closed by the job).
CREATE OR REPLACE FUNCTION public.hrms_snapshot_visit_location_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF new.status IN ('COMPLETED', 'MISSED') AND old.status IS DISTINCT FROM new.status THEN
    BEGIN
      new.location_evidence := public.hrms_field_visit_location_evidence(new.id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'visit location evidence skipped: %', SQLERRM;
    END;
  END IF;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS z_hrms_snapshot_visit_location_evidence ON public.field_visits;
CREATE TRIGGER z_hrms_snapshot_visit_location_evidence
BEFORE UPDATE OF status ON public.field_visits
FOR EACH ROW EXECUTE FUNCTION public.hrms_snapshot_visit_location_evidence();

-- Reviewers / observers: live evidence for a visit they may see.
CREATE OR REPLACE FUNCTION public.rpc_field_visit_location_evidence(p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT user_id INTO v_owner FROM public.field_visits WHERE id = p_visit_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'FIELD_VISIT_NOT_FOUND'; END IF;
  IF NOT (public.hrms_is_admin_user(v_uid) OR public.can_view_tracking_user(v_owner)) THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN public.hrms_field_visit_location_evidence(p_visit_id);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_field_visit_location_evidence(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_field_visit_location_evidence(uuid) TO authenticated;

-- ─── 8. Heartbeats with office / site relationship ───────────────────────────
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
  relation_at timestamptz
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
           s.office_state, s.office_distance_m, s.site_state, s.site_distance_m, s.relation_at
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

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- SELECT p.name, s.office_state, round(s.office_distance_m) office_m, s.site_state, round(s.site_distance_m) site_m,
--        s.relation_at AT TIME ZONE 'Asia/Kolkata' AS at_ist
-- FROM tracking_sessions s JOIN profiles p ON p.id = s.user_id
-- WHERE s.status = 'ACTIVE' ORDER BY s.relation_at DESC NULLS LAST LIMIT 20;
