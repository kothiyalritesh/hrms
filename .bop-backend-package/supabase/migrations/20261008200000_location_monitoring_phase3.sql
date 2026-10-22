-- =============================================================================
-- 20261008200000_location_monitoring_phase3.sql
--
-- Location tracking — Phase 3 (real-time monitoring), see
-- docs/LOCATION_TRACKING_AUDIT_2026-10-08.md. Run after 20261008190000.
--
--  1. One freshness rule everywhere: LIVE <= 5 min, RECENT <= 15 min,
--     STALE > 15 min (hrms_location_freshness). The Site Visit Observer used
--     5 / 30 min; it now says "no signal" after 15 minutes like Live Tracking.
--  2. Site Visit Observer stays current for someone standing still at a site:
--     heartbeat fixes (not stored as new rows) refresh the observer's live row.
--  3. One access rule for location views (hrms_can_view_location): self,
--     admins / global viewers, scoped viewers, and the whole reporting tree of
--     a team head (not only direct reports).
--  4. rpc_latest_locations_for_users: newest good position + heartbeat +
--     office/site relationship for a list of people (My Team). Times are real
--     timestamps (the screen used to read zone-less values and a UTC window).
--  5. rpc_location_timeline: the day as a story — stays (with office / site
--     name), trips (distance, duration), gaps without data, check-in / out
--     events (never drawn as GPS points), plus the raw points with quality.
-- Idempotent.
-- =============================================================================

SET statement_timeout = '15min';

-- ─── 1. Freshness ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hrms_location_freshness(p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_at IS NULL THEN 'NONE'
    WHEN p_at >= now() - interval '5 minutes' THEN 'LIVE'
    WHEN p_at >= now() - interval '15 minutes' THEN 'RECENT'
    ELSE 'STALE' END;
$$;
GRANT EXECUTE ON FUNCTION public.hrms_location_freshness(timestamptz) TO authenticated;

DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
BEGIN
  FOR v_oid IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_site_visit_observer_data'
  LOOP
    v_def := pg_get_functiondef(v_oid);
    v_new := replace(v_def,
      'pe.last_ping_at < now() - interval ''30 minutes'' THEN ''SIGNAL_LOST''',
      'pe.last_ping_at < now() - interval ''15 minutes'' THEN ''SIGNAL_LOST''');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END $$;

-- ─── 2. Observer live row follows the heartbeat ──────────────────────────────
CREATE OR REPLACE FUNCTION public.hrms_heartbeat_to_site_live_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF new.field_visit_id IS NULL OR new.site_state IS NULL OR new.last_fix_at IS NULL
     OR new.relation_at IS NOT DISTINCT FROM old.relation_at THEN
    RETURN new;
  END IF;
  UPDATE public.site_visit_live_locations l
  SET latitude = new.last_fix_latitude,
      longitude = new.last_fix_longitude,
      accuracy_m = new.last_fix_accuracy_m,
      speed_mps = new.last_fix_speed_mps,
      recorded_at = new.last_fix_at,
      last_location_at = new.last_fix_at,
      last_uploaded_at = now(),
      updated_at = now(),
      gps_quality = CASE WHEN coalesce(new.last_fix_accuracy_m, 999) <= 25 THEN 'HIGH'
                         WHEN new.last_fix_accuracy_m <= 60 THEN 'ACCEPTABLE'
                         WHEN new.last_fix_accuracy_m <= 100 THEN 'WEAK' ELSE 'INVALID' END
  WHERE l.field_visit_id = new.field_visit_id
    AND coalesce(l.last_location_at, l.recorded_at) < new.last_fix_at;
  RETURN new;
EXCEPTION WHEN others THEN
  RAISE WARNING 'observer heartbeat skipped: %', SQLERRM;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS hrms_heartbeat_to_site_live_location_trg ON public.tracking_sessions;
CREATE TRIGGER hrms_heartbeat_to_site_live_location_trg
AFTER UPDATE OF relation_at ON public.tracking_sessions
FOR EACH ROW EXECUTE FUNCTION public.hrms_heartbeat_to_site_live_location();

-- ─── 3. Who may see whose location ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hrms_can_view_location(p_target uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_target IS NULL THEN RETURN false; END IF;
  IF p_target = v_uid OR public.hrms_is_admin_user(v_uid) THEN RETURN true; END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_permissions up
    WHERE up.user_id = v_uid AND up.revoked_at IS NULL AND (up.expires_at IS NULL OR up.expires_at > now())
      AND up.scope::text = 'GLOBAL' AND up.permission IN ('live_tracking.view', 'attendance.view')) THEN
    RETURN true;
  END IF;
  IF public.can_view_tracking_user(p_target) THEN RETURN true; END IF;
  -- Anyone below the caller in the reporting tree.
  IF EXISTS (
    WITH RECURSIVE chain AS (
      SELECT p.id, p.reports_to, 1 AS depth FROM public.profiles p WHERE p.id = p_target
      UNION ALL
      SELECT m.id, m.reports_to, c.depth + 1
      FROM chain c JOIN public.profiles m ON m.id = c.reports_to
      WHERE c.depth < 12
    )
    SELECT 1 FROM chain WHERE reports_to = v_uid
  ) THEN
    RETURN true;
  END IF;
  RETURN p_target IN (SELECT public.authorized_user_ids('live_tracking.view'))
      OR p_target IN (SELECT public.authorized_user_ids('attendance.view'));
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_can_view_location(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_can_view_location(uuid) TO authenticated;

-- ─── 4. Latest location for a list of people (My Team) ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_latest_locations_for_users(p_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  latitude double precision,
  longitude double precision,
  recorded_at timestamptz,
  accuracy double precision,
  quality_status text,
  speed double precision,
  freshness text,
  last_seen_at timestamptz,
  office_state text,
  office_distance_m double precision,
  site_state text,
  site_distance_m double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_from timestamptz := (v_day::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    WITH ids AS (
      SELECT DISTINCT u AS id FROM unnest(coalesce(p_user_ids, ARRAY[]::uuid[])) u
      WHERE public.hrms_can_view_location(u)
      LIMIT 2000
    )
    SELECT i.id,
           CASE WHEN hb.newer THEN hb.last_fix_latitude ELSE l.latitude END,
           CASE WHEN hb.newer THEN hb.last_fix_longitude ELSE l.longitude END,
           CASE WHEN hb.newer THEN hb.last_fix_at ELSE l.at END,
           CASE WHEN hb.newer THEN hb.last_fix_accuracy_m ELSE l.accuracy END,
           CASE WHEN hb.newer THEN 'RELIABLE' ELSE l.quality_status END,
           CASE WHEN hb.newer THEN hb.last_fix_speed_mps ELSE l.speed END,
           public.hrms_location_freshness(CASE WHEN hb.newer THEN hb.last_fix_at ELSE l.at END),
           hb.last_seen_at, hb.office_state, hb.office_distance_m, hb.site_state, hb.site_distance_m
    FROM ids i
    LEFT JOIN LATERAL (
      SELECT lt.latitude::double precision AS latitude, lt.longitude::double precision AS longitude,
             public.hrms_timestamp(lt.recorded_at) AS at, lt.accuracy::double precision AS accuracy,
             coalesce(lt.quality_status, 'RELIABLE') AS quality_status, lt.speed::double precision AS speed
      FROM public.location_tracking lt
      WHERE lt.user_id = i.id
        AND lt.recorded_at >= v_from - interval '1 day'
        AND public.hrms_timestamp(lt.recorded_at) >= v_from
        AND coalesce(lt.quality_status, 'RELIABLE') <> 'MOCKED'
      ORDER BY (coalesce(lt.quality_status, 'RELIABLE') = 'RELIABLE') DESC, lt.recorded_at DESC
      LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT s.last_seen_at, s.last_fix_at, s.last_fix_latitude, s.last_fix_longitude,
             s.last_fix_accuracy_m, s.last_fix_speed_mps,
             s.office_state, s.office_distance_m, s.site_state, s.site_distance_m,
             (s.last_fix_at IS NOT NULL AND s.last_fix_at >= v_from
              AND (l.at IS NULL OR l.quality_status <> 'RELIABLE' OR s.last_fix_at > l.at)) AS newer
      FROM public.tracking_sessions s
      WHERE s.user_id = i.id AND s.started_at >= v_from - interval '1 day'
      ORDER BY coalesce(s.last_seen_at, s.started_at) DESC
      LIMIT 1
    ) hb ON true
    WHERE l.at IS NOT NULL OR hb.last_seen_at IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_latest_locations_for_users(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_latest_locations_for_users(uuid[]) TO authenticated;

-- ─── 5. The day as a story ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_location_timeline(p_user_id uuid, p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := coalesce(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_from timestamptz := (v_day::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_to timestamptz := ((v_day + 1)::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
  c_gap constant interval := interval '20 minutes';
  c_stay constant interval := interval '5 minutes';
  -- good points
  t timestamptz[] := '{}'; la double precision[] := '{}'; lo double precision[] := '{}'; ac double precision[] := '{}';
  n integer := 0;
  -- clusters
  cs integer[] := '{}'; ce integer[] := '{}'; cgap boolean[] := '{}';
  clat double precision[] := '{}'; clng double precision[] := '{}';
  k integer := 0;
  sum_lat double precision; sum_lng double precision; cnt integer;
  r record;
  i integer; j integer;
  v_gap boolean;
  v_dist double precision;
  -- story
  v_segments jsonb := '[]'::jsonb;
  v_points jsonb;
  v_events jsonb;
  v_prev_stay boolean := false;
  v_trip_from integer; v_trip_to integer;
  v_place text;
  v_trip_m double precision;
  v_total_m double precision := 0;
  v_moving_min double precision := 0;
  v_stay_min double precision := 0;
  v_gap_min double precision := 0;
  v_flagged integer; v_low integer; v_all integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT public.hrms_can_view_location(p_user_id) THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  -- All points of the day (for the map / log), with quality.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'latitude', x.latitude, 'longitude', x.longitude, 'recorded_at', x.at,
           'accuracy', x.accuracy, 'quality', x.q, 'speed', x.speed) ORDER BY x.at), '[]'::jsonb),
         count(*) FILTER (WHERE x.q IN ('IMPOSSIBLE_SPEED', 'MOCKED')),
         count(*) FILTER (WHERE x.q = 'LOW_ACCURACY'),
         count(*)
  INTO v_points, v_flagged, v_low, v_all
  FROM (
    SELECT lt.latitude, lt.longitude, public.hrms_timestamp(lt.recorded_at) AS at, lt.accuracy,
           coalesce(lt.quality_status, 'RELIABLE') AS q, lt.speed
    FROM public.location_tracking lt
    WHERE lt.user_id = p_user_id
      AND lt.recorded_at >= v_from - interval '1 day' AND lt.recorded_at < v_to + interval '1 day'
      AND public.hrms_timestamp(lt.recorded_at) >= v_from AND public.hrms_timestamp(lt.recorded_at) < v_to
    ORDER BY lt.recorded_at
    LIMIT 3000
  ) x;

  FOR r IN
    SELECT public.hrms_timestamp(lt.recorded_at) AS at, lt.latitude, lt.longitude, lt.accuracy
    FROM public.location_tracking lt
    WHERE lt.user_id = p_user_id
      AND lt.recorded_at >= v_from - interval '1 day' AND lt.recorded_at < v_to + interval '1 day'
      AND public.hrms_timestamp(lt.recorded_at) >= v_from AND public.hrms_timestamp(lt.recorded_at) < v_to
      AND coalesce(lt.quality_status, 'RELIABLE') IN ('RELIABLE', 'STALE')
    ORDER BY lt.recorded_at
    LIMIT 3000
  LOOP
    n := n + 1;
    t[n] := r.at; la[n] := r.latitude; lo[n] := r.longitude; ac[n] := r.accuracy;
  END LOOP;

  -- Pass 1: clusters of points that stay within GPS noise of each other.
  FOR i IN 1..n LOOP
    v_gap := i > 1 AND t[i] - t[i - 1] > c_gap;
    IF k > 0 AND NOT v_gap
       AND public.tracking_distance_metres(sum_lat / cnt, sum_lng / cnt, la[i], lo[i])
           <= greatest(75, least(coalesce(ac[i], 100), 100)) THEN
      ce[k] := i; sum_lat := sum_lat + la[i]; sum_lng := sum_lng + lo[i]; cnt := cnt + 1;
    ELSE
      IF k > 0 THEN clat[k] := sum_lat / cnt; clng[k] := sum_lng / cnt; END IF;
      k := k + 1; cs[k] := i; ce[k] := i; cgap[k] := v_gap;
      sum_lat := la[i]; sum_lng := lo[i]; cnt := 1;
    END IF;
  END LOOP;
  IF k > 0 THEN clat[k] := sum_lat / cnt; clng[k] := sum_lng / cnt; END IF;

  -- Pass 2: stays (>= 5 min in one place), trips between them, gaps.
  FOR j IN 1..k LOOP
    IF cgap[j] THEN
      IF v_trip_from IS NOT NULL THEN
        v_trip_m := 0;
        FOR i IN v_trip_from..v_trip_to - 1 LOOP
          v_trip_m := v_trip_m + public.tracking_distance_metres(la[i], lo[i], la[i + 1], lo[i + 1]);
        END LOOP;
        v_segments := v_segments || jsonb_build_object('type', 'TRIP', 'start', t[v_trip_from], 'end', t[v_trip_to],
          'minutes', round(extract(epoch FROM t[v_trip_to] - t[v_trip_from]) / 60), 'distance_m', round(v_trip_m),
          'points', v_trip_to - v_trip_from + 1);
        v_total_m := v_total_m + v_trip_m;
        v_moving_min := v_moving_min + extract(epoch FROM t[v_trip_to] - t[v_trip_from]) / 60;
        v_trip_from := NULL; v_trip_to := NULL;
      END IF;
      v_segments := v_segments || jsonb_build_object('type', 'GAP', 'start', t[cs[j] - 1], 'end', t[cs[j]],
        'minutes', round(extract(epoch FROM t[cs[j]] - t[cs[j] - 1]) / 60));
      v_gap_min := v_gap_min + extract(epoch FROM t[cs[j]] - t[cs[j] - 1]) / 60;
      v_prev_stay := false;
    END IF;

    IF t[ce[j]] - t[cs[j]] >= c_stay THEN
      -- A trip ends where this stay begins.
      IF v_trip_from IS NULL AND v_prev_stay AND NOT cgap[j] THEN
        v_trip_from := cs[j] - 1;
      END IF;
      IF v_trip_from IS NOT NULL THEN
        IF NOT cgap[j] THEN v_trip_to := cs[j]; END IF;
        v_trip_m := 0;
        FOR i IN v_trip_from..v_trip_to - 1 LOOP
          v_trip_m := v_trip_m + public.tracking_distance_metres(la[i], lo[i], la[i + 1], lo[i + 1]);
        END LOOP;
        IF v_trip_to > v_trip_from THEN
          v_segments := v_segments || jsonb_build_object('type', 'TRIP', 'start', t[v_trip_from], 'end', t[v_trip_to],
            'minutes', round(extract(epoch FROM t[v_trip_to] - t[v_trip_from]) / 60), 'distance_m', round(v_trip_m),
            'points', v_trip_to - v_trip_from + 1);
          v_total_m := v_total_m + v_trip_m;
          v_moving_min := v_moving_min + extract(epoch FROM t[v_trip_to] - t[v_trip_from]) / 60;
        END IF;
        v_trip_from := NULL; v_trip_to := NULL;
      END IF;

      -- Name the place: an office or one of the day's visit sites.
      SELECT 'Office: ' || o.name INTO v_place
      FROM public.offices o
      WHERE o.latitude IS NOT NULL AND o.longitude IS NOT NULL
        AND public.tracking_distance_metres(o.latitude, o.longitude, clat[j], clng[j])
            <= greatest(coalesce(o.allowed_radius_meters, o.attendance_radius, 100), 100) + 50
      ORDER BY public.tracking_distance_metres(o.latitude, o.longitude, clat[j], clng[j])
      LIMIT 1;
      IF v_place IS NULL THEN
        SELECT 'Site: ' || coalesce(fv.project_name, fv.location_name, 'visit') INTO v_place
        FROM public.field_visits fv
        CROSS JOIN LATERAL public.hrms_field_visit_site(fv.id) s
        WHERE fv.user_id = p_user_id AND fv.date = v_day AND s.latitude IS NOT NULL
          AND public.tracking_distance_metres(s.latitude, s.longitude, clat[j], clng[j]) <= s.radius_m + 50
        ORDER BY public.tracking_distance_metres(s.latitude, s.longitude, clat[j], clng[j])
        LIMIT 1;
      END IF;

      v_segments := v_segments || jsonb_build_object('type', 'STAY', 'start', t[cs[j]], 'end', t[ce[j]],
        'minutes', round(extract(epoch FROM t[ce[j]] - t[cs[j]]) / 60),
        'latitude', clat[j], 'longitude', clng[j], 'place', v_place, 'points', ce[j] - cs[j] + 1);
      v_stay_min := v_stay_min + extract(epoch FROM t[ce[j]] - t[cs[j]]) / 60;
      v_place := NULL;
      v_prev_stay := true;
    ELSE
      -- Moving: extend (or start) the current trip.
      IF v_trip_from IS NULL THEN
        v_trip_from := CASE WHEN v_prev_stay AND NOT cgap[j] THEN cs[j] - 1 ELSE cs[j] END;
      END IF;
      v_trip_to := ce[j];
      v_prev_stay := false;
    END IF;
  END LOOP;
  IF v_trip_from IS NOT NULL AND v_trip_to > v_trip_from THEN
    v_trip_m := 0;
    FOR i IN v_trip_from..v_trip_to - 1 LOOP
      v_trip_m := v_trip_m + public.tracking_distance_metres(la[i], lo[i], la[i + 1], lo[i + 1]);
    END LOOP;
    v_segments := v_segments || jsonb_build_object('type', 'TRIP', 'start', t[v_trip_from], 'end', t[v_trip_to],
      'minutes', round(extract(epoch FROM t[v_trip_to] - t[v_trip_from]) / 60), 'distance_m', round(v_trip_m),
      'points', v_trip_to - v_trip_from + 1);
    v_total_m := v_total_m + v_trip_m;
    v_moving_min := v_moving_min + extract(epoch FROM t[v_trip_to] - t[v_trip_from]) / 60;
  END IF;

  -- Check-in / check-out events (attendance and visits): events, not GPS points.
  SELECT coalesce(jsonb_agg(e ORDER BY e->>'at'), '[]'::jsonb) INTO v_events
  FROM (
    SELECT jsonb_build_object('type', 'OFFICE_CHECK_IN', 'at', public.hrms_timestamp(a.checkin_time),
                              'label', 'Checked in') AS e
    FROM public.attendance_logs a WHERE a.user_id = p_user_id AND a.date = v_day AND a.checkin_time IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('type', 'OFFICE_CHECK_OUT', 'at', public.hrms_timestamp(a.checkout_time), 'label', 'Checked out')
    FROM public.attendance_logs a WHERE a.user_id = p_user_id AND a.date = v_day AND a.checkout_time IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('type', 'SITE_CHECK_IN', 'at', public.hrms_timestamp(fv.checkin_time),
                              'label', 'Site check-in · ' || coalesce(fv.project_name, fv.location_name, 'visit'))
    FROM public.field_visits fv WHERE fv.user_id = p_user_id AND fv.date = v_day AND fv.checkin_time IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('type', 'SITE_CHECK_OUT', 'at', public.hrms_timestamp(fv.checkout_time),
                              'label', 'Site check-out · ' || coalesce(fv.project_name, fv.location_name, 'visit'))
    FROM public.field_visits fv WHERE fv.user_id = p_user_id AND fv.date = v_day AND fv.checkout_time IS NOT NULL
  ) ev;

  RETURN jsonb_build_object(
    'date', v_day,
    'segments', v_segments,
    'events', v_events,
    'points', v_points,
    'summary', jsonb_build_object(
      'first_fix', CASE WHEN n > 0 THEN t[1] END,
      'last_fix', CASE WHEN n > 0 THEN t[n] END,
      'good_points', n,
      'all_points', v_all,
      'flagged_points', v_flagged,
      'low_accuracy_points', v_low,
      'distance_km', round((v_total_m / 1000)::numeric, 2),
      'moving_minutes', round(v_moving_min),
      'stationary_minutes', round(v_stay_min),
      'gap_minutes', round(v_gap_min)));
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_location_timeline(uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_location_timeline(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
