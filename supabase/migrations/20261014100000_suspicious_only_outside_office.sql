-- Suspicious attendance = a check-in attempted from OUTSIDE the office area.
--
-- Before: the app called rpc_analyze_attendance_fraud after every check-in,
-- and that function always inserted a row into attendance_fraud_events (even
-- with score 0 / NORMAL), so every check-in showed up under Suspicious
-- Attendance. Attempts from outside the office radius, the case HR actually
-- cares about, were blocked on the phone and never recorded.
--
-- After:
--   1. rpc_analyze_attendance_fraud records nothing (old APKs still call it).
--   2. A check-in attempt whose GPS reading is farther from the office than
--      the office's allowed radius (allowed_radius_meters, else
--      attendance_radius; 100 m by default) records one OUTSIDE_OFFICE_RADIUS
--      signal per employee per day, through the existing
--      hrms_record_fraud_signal (which also alerts the manager and HR).
--      Server side in rpc_attendance_checkin_v2, and through the new
--      rpc_report_outside_office_checkin which the app calls when it blocks
--      the attempt itself.
--   3. The manager "checked in N m away" warning uses the office radius
--      instead of a fixed 50 m, so normal check-ins inside the area no longer
--      raise it.
--   4. checkin_attempts accepts the 'geo_fence_blocked' status that
--      rpc_attendance_checkin_v2 writes (an older CHECK constraint only
--      allowed success/failed/blocked, which made that insert fail).
-- No existing rows are changed or deleted. Old per-check-in analysis rows
-- (event_type CHECKIN/CHECKOUT) stay in the table; the screen hides them.

-- 1 ---------------------------------------------------------------------------
DO $$
DECLARE
  v_con record;
  v_values text[];
BEGIN
  IF to_regclass('public.checkin_attempts') IS NULL THEN RETURN; END IF;
  FOR v_con IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.checkin_attempts'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ~* '\mstatus\M'
      AND pg_get_constraintdef(oid) NOT ILIKE '%geo_fence_blocked%'
  LOOP
    -- Keep every value the old constraint allowed and add the new one.
    SELECT array_agg(DISTINCT m[1]) INTO v_values
    FROM regexp_matches(v_con.def, '''([^'']+)''', 'g') AS m;
    v_values := array_append(coalesce(v_values, ARRAY[]::text[]), 'geo_fence_blocked');
    EXECUTE format('ALTER TABLE public.checkin_attempts DROP CONSTRAINT %I', v_con.conname);
    EXECUTE format('ALTER TABLE public.checkin_attempts ADD CONSTRAINT %I CHECK (status = ANY (%L::text[]))',
                   v_con.conname, v_values);
  END LOOP;
END $$;

-- 2 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_analyze_attendance_fraud(
  p_user_id UUID,
  p_attendance_id UUID,
  p_event_type TEXT,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_accuracy_m DOUBLE PRECISION DEFAULT NULL,
  p_is_mocked BOOLEAN DEFAULT FALSE,
  p_developer_mode BOOLEAN DEFAULT FALSE,
  p_ip_latitude DOUBLE PRECISION DEFAULT NULL,
  p_ip_longitude DOUBLE PRECISION DEFAULT NULL,
  p_office_distance_m INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'FORBIDDEN');
  END IF;
  -- Successful check-ins are inside the office area and are not suspicious.
  -- Outside-area attempts and fake GPS are recorded where they happen.
  RETURN jsonb_build_object('success', TRUE, 'score', 0, 'severity', 'NORMAL',
                            'reasons', '[]'::jsonb, 'recorded', FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_analyze_attendance_fraud(uuid, uuid, text, double precision, double precision,
  double precision, boolean, boolean, double precision, double precision, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_analyze_attendance_fraud(uuid, uuid, text, double precision, double precision,
  double precision, boolean, boolean, double precision, double precision, integer) TO authenticated;

-- 3 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_report_outside_office_checkin(
  p_office_id uuid,
  p_location jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_office public.offices%rowtype;
  v_radius double precision;
  v_lat double precision;
  v_lon double precision;
  v_accuracy double precision;
  v_distance double precision;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
  END IF;
  BEGIN
    v_lat := (p_location->>'latitude')::double precision;
    v_lon := (p_location->>'longitude')::double precision;
    v_accuracy := greatest(0, coalesce((p_location->>'accuracy')::double precision, 0));
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_GPS');
  END;
  -- An imprecise reading cannot show where the employee really was.
  IF v_lat IS NULL OR v_lon IS NULL OR v_lat = 0 OR v_lon = 0
     OR v_lat NOT BETWEEN -90 AND 90 OR v_lon NOT BETWEEN -180 AND 180 OR v_accuracy > 100 THEN
    RETURN jsonb_build_object('success', true, 'recorded', false, 'reason', 'GPS_NOT_PRECISE');
  END IF;

  SELECT * INTO v_office FROM public.offices WHERE id = p_office_id AND coalesce(is_active, true);
  IF v_office.id IS NULL OR v_office.latitude IS NULL OR v_office.longitude IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'OFFICE_LOCATION_UNAVAILABLE');
  END IF;
  v_radius := coalesce(v_office.allowed_radius_meters, v_office.attendance_radius);
  IF v_radius IS NULL OR v_radius < 10 OR v_radius > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'OFFICE_RADIUS_NOT_CONFIGURED');
  END IF;

  -- Distance is computed here, not taken from the phone.
  v_distance := public.field_visit_distance_metres(v_office.latitude, v_office.longitude, v_lat, v_lon);
  IF v_distance <= v_radius THEN
    RETURN jsonb_build_object('success', true, 'recorded', false,
                              'distance_metres', round(v_distance), 'allowed_radius_metres', v_radius);
  END IF;

  v_id := public.hrms_record_fraud_signal(v_uid, 'OUTSIDE_OFFICE_RADIUS', 'SUSPICIOUS', 80,
    jsonb_build_array(format('Tried to check in %s m from %s (allowed %s m)',
                             round(v_distance), v_office.name, round(v_radius))),
    v_lat, v_lon, v_accuracy, false);
  RETURN jsonb_build_object('success', true, 'recorded', v_id IS NOT NULL,
                            'distance_metres', round(v_distance), 'allowed_radius_metres', v_radius);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_report_outside_office_checkin(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_report_outside_office_checkin(uuid, jsonb) TO authenticated;

-- 4 ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_new text;
  v_pattern text := $r$(\n\s*)return jsonb_build_object\(\s*'success', false, 'error', 'OUTSIDE_OFFICE_RADIUS',$r$;
BEGIN
  IF to_regprocedure('public.rpc_attendance_checkin_v2(uuid,jsonb)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.rpc_attendance_checkin_v2(uuid,jsonb)'::regprocedure);
  IF position('HRMS_OUTSIDE_RADIUS_SIGNAL' IN v_def) > 0 THEN RETURN; END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, v_pattern, 'g')) <> 1 THEN
    RAISE EXCEPTION 'rpc_attendance_checkin_v2: OUTSIDE_OFFICE_RADIUS branch not found exactly once';
  END IF;
  v_new := regexp_replace(v_def, v_pattern, $x$\1-- HRMS_OUTSIDE_RADIUS_SIGNAL: suspicious only when the reading is outside the area\1if v_distance > v_radius then
      perform public.hrms_record_fraud_signal(v_uid, 'OUTSIDE_OFFICE_RADIUS', 'SUSPICIOUS', 80,
        jsonb_build_array(format('Tried to check in %s m from %s (allowed %s m)',
                                 round(v_distance), v_office.name, round(v_radius))),
        v_lat, v_lon, v_accuracy, false);
    end if;\1return jsonb_build_object('success', false, 'error', 'OUTSIDE_OFFICE_RADIUS',$x$);
  EXECUTE v_new;
END $$;

-- 5 ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_anchor text := 'v_office_distance > 50';
BEGIN
  IF to_regprocedure('public.rpc_attendance_checkin_v3(uuid,jsonb)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.rpc_attendance_checkin_v3(uuid,jsonb)'::regprocedure);
  IF position('HRMS_RADIUS_MANAGER_WARNING' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'rpc_attendance_checkin_v3: manager distance check not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_anchor,
    '/* HRMS_RADIUS_MANAGER_WARNING */ v_office_distance > coalesce(v_office.allowed_radius_meters, v_office.attendance_radius, 100)');
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- SELECT position('HRMS_OUTSIDE_RADIUS_SIGNAL' IN pg_get_functiondef('public.rpc_attendance_checkin_v2(uuid,jsonb)'::regprocedure)) > 0 AS v2_ok,
--        position('HRMS_RADIUS_MANAGER_WARNING' IN pg_get_functiondef('public.rpc_attendance_checkin_v3(uuid,jsonb)'::regprocedure)) > 0 AS v3_ok,
--        to_regprocedure('public.rpc_report_outside_office_checkin(uuid,jsonb)') IS NOT NULL AS report_ok;
-- SELECT event_type, severity, count(*) FROM attendance_fraud_events
--  WHERE created_at > now() - interval '1 day' GROUP BY 1, 2;   -- no new CHECKIN rows after deploy
