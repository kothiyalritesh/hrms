-- =============================================================================
-- 2026-10-22 Site check-in from Home + office return ends the site visit.
--
-- Root cause (audit): a visit is "active" purely by status CHECKED_IN. When the
-- employee leaves the site the server sets departed_at / journey_status
-- DEPARTED, but the status stays CHECKED_IN until the employee taps visit
-- checkout or the 20:00 job closes it. Nothing compared it with a later office
-- punch, so Attendance Control, live tracking, the location ping logic and the
-- Location Monitor kept showing the site. A stuck visit also blocks starting
-- another visit (ANOTHER_VISIT_IN_PROGRESS).
--
--  1. Office return: a biometric punch from a device mapped to an office, later
--     than a checked-in visit of that day, closes the visit exactly like the
--     existing closers (COMPLETED, auto_closed) + auto_close_reason
--     'OFFICE_RETURN_BIOMETRIC' and checkout_office_id. The visit ends when GPS
--     saw the employee leave (departed_at) if known, else at the punch. The
--     workday is NOT checked out (a visit checkout never ends the day) and
--     attendance_state goes back to WORKING, as on a normal visit checkout.
--     Punches older than the visit (late imports) never close it. Runs inside
--     the punch import, guarded so it can never fail the import.
--  2. rpc_checkin_sites_nearby: active predefined sites the employee is at.
--  3. rpc_attendance_checkin_at_site: the Home Check-In at a predefined site.
--     Creates a checked-in site visit and links the day's attendance through
--     the existing sync_field_visit_arrival_attendance (one attendance row per
--     day; starts the day if none, otherwise switches the work context).
--     Same per-employee-per-day lock as office check-in; repeated taps return
--     the existing visit.
--  4. Location Monitor: a visit the employee has left (departed_at) is no
--     longer the reference place; it is reported as "left site at".
--  5. Screen entry unchanged; no new tables. Safe to run twice.
-- Needs 20261021120000 (rpc_location_monitor) and the field-visit engine.
-- =============================================================================

ALTER TABLE public.field_visits ADD COLUMN IF NOT EXISTS auto_close_reason text;

-- ─── 1. Office return closes the visit ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hrms_close_visits_on_office_return(p_user_id uuid, p_day date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_punch_at timestamptz;
  v_office uuid;
  v_end timestamptz;
  v_count integer := 0;
  v_prev text := coalesce(current_setting('app.current_location_server', true), '');
BEGIN
  FOR r IN
    SELECT v.id, public.hrms_timestamp(v.checkin_time) AS started, public.hrms_timestamp(v.departed_at) AS departed
    FROM public.field_visits v
    WHERE v.user_id = p_user_id AND v.date = p_day
      AND v.status = 'CHECKED_IN' AND v.checkout_time IS NULL AND v.checkin_time IS NOT NULL
    FOR UPDATE
  LOOP
    -- First office punch clearly after the site check-in.
    SELECT l.log_date, l.office_id INTO v_punch_at, v_office
    FROM public.smartoffice_device_logs l
    WHERE l.user_id = p_user_id AND l.log_date_only = p_day AND l.office_id IS NOT NULL
      AND l.log_date > r.started + interval '2 minutes'
    ORDER BY l.log_date
    LIMIT 1;
    CONTINUE WHEN v_punch_at IS NULL;

    v_end := CASE WHEN r.departed IS NOT NULL AND r.departed > r.started AND r.departed <= v_punch_at
                  THEN r.departed ELSE v_punch_at END;
    PERFORM set_config('app.current_location_server', 'on', true);
    UPDATE public.field_visits
    SET checkout_time = v_end, checkout_office_id = v_office,
        status = 'COMPLETED', visit_state = 'COMPLETED', journey_status = 'COMPLETED',
        auto_closed = true, auto_close_reason = 'OFFICE_RETURN_BIOMETRIC'
    WHERE id = r.id AND status = 'CHECKED_IN';
    PERFORM set_config('app.current_location_server', v_prev, true);
    PERFORM public.hrms_apply_field_visit_risk(r.id);
    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 AND NOT EXISTS (
    SELECT 1 FROM public.field_visits
    WHERE user_id = p_user_id AND date = p_day AND status = 'CHECKED_IN' AND checkout_time IS NULL
  ) THEN
    UPDATE public.attendance_logs SET attendance_state = 'WORKING', updated_at = now()
    WHERE user_id = p_user_id AND date = p_day AND checkout_time IS NULL
      AND attendance_state = 'ON_FIELD_VISIT';
  END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_close_visits_on_office_return(uuid, date) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hrms_office_return_after_punches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT n.user_id, n.log_date_only FROM new_punches n
    WHERE n.user_id IS NOT NULL AND n.office_id IS NOT NULL AND n.log_date_only IS NOT NULL
  LOOP
    BEGIN
      PERFORM public.hrms_close_visits_on_office_return(r.user_id, r.log_date_only);
    EXCEPTION WHEN others THEN
      -- Never block the punch import (one failure used to stop every punch).
      RAISE WARNING 'office return reconciliation skipped for %: %', r.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS hrms_office_return_after_punches ON public.smartoffice_device_logs;
CREATE TRIGGER hrms_office_return_after_punches
AFTER INSERT ON public.smartoffice_device_logs
REFERENCING NEW TABLE AS new_punches
FOR EACH STATEMENT EXECUTE FUNCTION public.hrms_office_return_after_punches();

-- ─── 2. Sites the employee is at ─────────────────────────────────────────────
-- Same rule as site check-in: within the radius allowing up to 50 m GPS error.
CREATE OR REPLACE FUNCTION public.hrms_site_checkin_radius(p_radius double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS
$$ SELECT greatest(25, least(coalesce(p_radius, 100), 1000)) $$;

CREATE OR REPLACE FUNCTION public.rpc_checkin_sites_nearby(p_location jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lat double precision;
  v_lon double precision;
  v_acc double precision;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  BEGIN
    v_lat := (p_location->>'latitude')::double precision;
    v_lon := (p_location->>'longitude')::double precision;
    v_acc := greatest(0, coalesce((p_location->>'accuracy')::double precision, 0));
  EXCEPTION WHEN others THEN
    RETURN '[]'::jsonb;
  END;
  IF v_lat IS NULL OR v_lon IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.site_label, 'project_name', s.project_name,
                                        'address', s.address, 'distance_m', round(s.d::numeric), 'radius_m', s.r)
                     ORDER BY s.d)
    FROM (
      SELECT ps.id, ps.site_label, ps.project_name, ps.address,
             public.field_visit_distance_metres(ps.latitude, ps.longitude, v_lat, v_lon) AS d,
             public.hrms_site_checkin_radius(ps.checkin_radius_m) AS r
      FROM public.predefined_sites ps
      WHERE ps.is_active AND ps.latitude IS NOT NULL AND ps.longitude IS NOT NULL
    ) s
    WHERE s.d - least(v_acc, 50) <= s.r
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_checkin_sites_nearby(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_checkin_sites_nearby(jsonb) TO authenticated;

-- ─── 3. Check in at a predefined site from Home ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_attendance_checkin_at_site(p_site_id uuid, p_location jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_now timestamptz := clock_timestamp();
  v_site public.predefined_sites%rowtype;
  v_att public.attendance_logs%rowtype;
  v_existing public.field_visits%rowtype;
  v_lat double precision;
  v_lon double precision;
  v_acc double precision;
  v_captured timestamptz;
  v_distance double precision;
  v_radius double precision;
  v_visit_id uuid;
  v_attendance_id uuid;
  v_mode text;
  v_closed integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', 'Sign in again.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_active) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_INACTIVE', 'message', 'Your account is inactive.');
  END IF;

  BEGIN
    v_lat := (p_location->>'latitude')::double precision;
    v_lon := (p_location->>'longitude')::double precision;
    v_acc := greatest(0, (p_location->>'accuracy')::double precision);
    v_captured := coalesce((p_location->>'capturedAt')::timestamptz, (p_location->>'captured_at')::timestamptz);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_GPS', 'message', 'A valid precise GPS reading is required.');
  END;
  -- Same trust rules as office check-in (rpc_attendance_checkin_v2).
  IF v_lat IS NULL OR v_lon IS NULL OR v_lat = 0 OR v_lon = 0
     OR v_lat NOT BETWEEN -90 AND 90 OR v_lon NOT BETWEEN -180 AND 180
     OR v_acc IS NULL OR v_acc > 100
     OR lower(coalesce(p_location->>'mocked', 'false')) = 'true'
     OR v_captured IS NULL OR v_captured < now() - interval '60 seconds' OR v_captured > now() + interval '10 seconds' THEN
    RETURN jsonb_build_object('success', false, 'error', 'GPS_NOT_TRUSTED',
      'message', 'The GPS reading is inaccurate, old or from a mock-location app. Move outdoors and try again.');
  END IF;

  SELECT * INTO v_site FROM public.predefined_sites
  WHERE id = p_site_id AND is_active AND latitude IS NOT NULL AND longitude IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SITE_NOT_AVAILABLE', 'message', 'This site is not active.');
  END IF;
  v_radius := public.hrms_site_checkin_radius(v_site.checkin_radius_m);
  v_distance := public.field_visit_distance_metres(v_site.latitude, v_site.longitude, v_lat, v_lon);
  IF v_distance - least(v_acc, 50) > v_radius THEN
    RETURN jsonb_build_object('success', false, 'error', 'OUTSIDE_SITE_RADIUS',
      'message', format('You are %s m from %s (allowed %s m). Move closer and try again.',
                        round(v_distance), v_site.site_label, round(v_radius)),
      'distance_metres', round(v_distance), 'radius_metres', v_radius);
  END IF;

  -- Same lock as office check-in and visit arrival: one decision at a time per employee-day.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_today::text, 0));
  PERFORM public.hrms_close_open_field_visits_before_today(v_uid);

  SELECT * INTO v_att FROM public.attendance_logs
  WHERE user_id = v_uid AND date = v_today ORDER BY checkin_time NULLS LAST LIMIT 1;
  IF FOUND AND v_att.checkout_time IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_OUT',
      'message', 'You have already checked out for today.');
  END IF;
  v_mode := CASE WHEN FOUND AND v_att.checkin_time IS NOT NULL THEN 'SWITCHED_TO_SITE' ELSE 'STARTED_DAY' END;

  -- Already checked in at this site: same answer, nothing new (repeated taps, retries).
  SELECT * INTO v_existing FROM public.field_visits
  WHERE user_id = v_uid AND date = v_today AND status = 'CHECKED_IN' AND checkout_time IS NULL
    AND predefined_site_id = p_site_id
  ORDER BY checkin_time DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'existing', true, 'mode', 'ALREADY_AT_SITE',
      'visit_id', v_existing.id, 'attendance_id', v_att.id, 'site_name', v_site.site_label,
      'checkin_time', coalesce(v_att.checkin_time, v_existing.checkin_time),
      'message', format('You are already checked in at %s.', v_site.site_label));
  END IF;

  -- One active place at a time: another open visit of today ends now.
  PERFORM set_config('app.current_location_server', 'on', true);
  UPDATE public.field_visits
  SET checkout_time = v_now, status = 'COMPLETED', visit_state = 'COMPLETED', journey_status = 'COMPLETED',
      auto_closed = true, auto_close_reason = 'SITE_CHANGE'
  WHERE user_id = v_uid AND date = v_today AND status = 'CHECKED_IN' AND checkout_time IS NULL;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  INSERT INTO public.field_visits (
    user_id, predefined_site_id, visit_type, location_name, location_address, destination_coords,
    checkin_radius_m, project_name, notes, checkin_time, checkin_location,
    arrival_latitude, arrival_longitude, arrival_accuracy_metres, arrival_distance_metres,
    status, visit_state, arrived_at, journey_status, date
  ) VALUES (
    v_uid, v_site.id, 'site', v_site.site_label, v_site.address,
    jsonb_build_object('latitude', v_site.latitude, 'longitude', v_site.longitude),
    v_site.checkin_radius_m, v_site.project_name,
    format('Site check-in from Home · %s m from site', round(v_distance)),
    v_now,
    jsonb_build_object('latitude', v_lat, 'longitude', v_lon, 'accuracy', v_acc, 'captured_at', v_captured,
                       'provider', 'home-site-checkin', 'distance_metres', round(v_distance)),
    v_lat, v_lon, v_acc, v_distance,
    'CHECKED_IN', 'ARRIVED', v_now, 'SITE_CHECKED_IN', v_today
  ) RETURNING id INTO v_visit_id;
  PERFORM set_config('app.current_location_server', '', true);

  -- Existing daily attendance link: creates the day (FIELD_VISIT) or sets the context.
  v_attendance_id := public.sync_field_visit_arrival_attendance(v_visit_id);

  INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, new_values, source)
  VALUES (v_uid, v_uid, 'SITE_CHECKIN_FROM_HOME', 'field_visit', v_visit_id,
          jsonb_build_object('site_id', v_site.id, 'site', v_site.site_label, 'mode', v_mode,
                             'distance_metres', round(v_distance), 'accuracy_metres', v_acc,
                             'closed_other_visits', v_closed), 'HOME_CHECKIN');

  SELECT * INTO v_att FROM public.attendance_logs WHERE id = v_attendance_id;
  RETURN jsonb_build_object('success', true, 'existing', false, 'mode', v_mode,
    'visit_id', v_visit_id, 'attendance_id', v_attendance_id, 'site_name', v_site.site_label,
    'distance_metres', round(v_distance), 'checkin_time', v_att.checkin_time, 'server_now', v_now,
    'message', CASE WHEN v_mode = 'STARTED_DAY'
                    THEN format('Checked in at %s.', v_site.site_label)
                    ELSE format('You are now working at %s.', v_site.site_label) END);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_attendance_checkin_at_site(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_checkin_at_site(uuid, jsonb) TO authenticated;

-- ─── 4. Location Monitor: a left site is not the reference place ─────────────
CREATE OR REPLACE FUNCTION public.rpc_location_monitor()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;

  WITH vis AS (
    SELECT p.id FROM public.profiles p WHERE public.is_profile_admin()
    UNION
    SELECT public.authorized_user_ids('live_tracking.view')
  ),
  att AS (
    SELECT DISTINCT ON (a.user_id) a.id, a.user_id, a.office_id, a.checkin_time
    FROM public.attendance_logs a
    JOIN vis ON vis.id = a.user_id
    WHERE a.date = v_today AND a.checkin_time IS NOT NULL AND a.checkout_time IS NULL
    ORDER BY a.user_id, a.checkin_time DESC
  ),
  fix AS (
    SELECT f.* FROM public.rpc_latest_location_pings(v_today) f
    WHERE f.user_id IN (SELECT user_id FROM att)
  ),
  base AS (
    SELECT att.*, p.name, p.employee_number, nullif(btrim(coalesce(p.phone, '')), '') AS phone, p.role,
           o.name AS office_name,
           v.id AS visit_id, v.status AS visit_status, v.location_name AS visit_name,
           ls.location_name AS left_site_name, ls.departed_at AS left_site_at,
           f.latitude, f.longitude, f.accuracy, f.recorded_at AS fix_at, f.last_seen_at,
           s.status AS session_status, s.last_quality_status,
           CASE WHEN f.recorded_at IS NULL THEN NULL
                ELSE extract(epoch FROM (now() - f.recorded_at)) / 60 END AS age_min,
           CASE WHEN v.id IS NOT NULL THEN
                  public.hrms_site_relation(v.id, f.latitude, f.longitude, f.accuracy)
                WHEN coalesce(att.office_id, p.office_id) IS NOT NULL THEN
                  public.hrms_office_relation(coalesce(att.office_id, p.office_id), f.latitude, f.longitude, f.accuracy)
           END AS relation,
           ev.id AS exit_id, ev.status AS exit_status, ev.detected_at AS exit_at, ev.returned_at AS exit_returned_at,
           ev.has_reason AS exit_has_reason
    FROM att
    JOIN public.profiles p ON p.id = att.user_id
    -- a day started at a site has no office on the attendance row: use the employee's office
    LEFT JOIN public.offices o ON o.id = coalesce(att.office_id, p.office_id)
    LEFT JOIN fix f ON f.user_id = att.user_id
    LEFT JOIN LATERAL (
      -- the place they are working at now: on the way to it, or at it and not left
      SELECT fv.id, fv.status, fv.location_name
      FROM public.field_visits fv
      WHERE fv.user_id = att.user_id AND fv.date = v_today
        AND fv.status IN ('IN_TRANSIT', 'CHECKED_IN') AND fv.destination_coords IS NOT NULL
        AND fv.departed_at IS NULL
      ORDER BY (fv.status = 'CHECKED_IN') DESC, fv.created_at DESC
      LIMIT 1
    ) v ON true
    LEFT JOIN LATERAL (
      -- a visit still open although GPS saw them leave the site
      SELECT fv.location_name, fv.departed_at
      FROM public.field_visits fv
      WHERE fv.user_id = att.user_id AND fv.date = v_today
        AND fv.status = 'CHECKED_IN' AND fv.departed_at IS NOT NULL
      ORDER BY fv.departed_at DESC
      LIMIT 1
    ) ls ON true
    LEFT JOIN LATERAL (
      SELECT ts.status, ts.last_quality_status
      FROM public.tracking_sessions ts
      WHERE ts.attendance_log_id = att.id
      ORDER BY (ts.status = 'ACTIVE') DESC, ts.last_seen_at DESC NULLS LAST
      LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT g.id, g.status, g.detected_at, g.returned_at,
             EXISTS (SELECT 1 FROM public.geofence_reasons gr WHERE gr.geofence_event_id = g.id) AS has_reason
      FROM public.geofence_events g
      WHERE g.attendance_id = att.id AND g.status IN ('POTENTIAL_EXIT', 'PENDING_REASON', 'REASON_SUBMITTED')
      ORDER BY g.detected_at DESC
      LIMIT 1
    ) ev ON true
  ),
  classified AS (
    SELECT b.*,
           b.relation->>'state' AS place_state,
           CASE
             WHEN b.fix_at IS NULL THEN 'NO_LOCATION'
             WHEN b.age_min > 15 THEN 'NO_RECENT_LOCATION'
             WHEN b.relation->>'state' IN ('INSIDE', 'AT_SITE') THEN 'INSIDE'
             WHEN b.relation->>'state' IN ('NEAR', 'NEAR_SITE') THEN 'NEAR'
             WHEN b.relation->>'state' = 'OUTSIDE' THEN 'OUTSIDE'
             WHEN b.relation->>'state' IN ('LEFT_SITE', 'APPROACHING') THEN
               CASE WHEN b.visit_status = 'IN_TRANSIT' THEN 'TRAVELLING' ELSE 'OUTSIDE' END
             ELSE 'NO_REFERENCE'
           END AS monitor_status
    FROM base b
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', c.user_id,
           'name', c.name,
           'employee_number', c.employee_number,
           'phone', c.phone,
           'role', c.role,
           'attendance_id', c.id,
           'checkin_time', c.checkin_time,
           'status', c.monitor_status,
           'reference_kind', CASE WHEN c.visit_id IS NOT NULL THEN 'SITE' ELSE 'OFFICE' END,
           'reference_name', CASE WHEN c.visit_id IS NOT NULL THEN coalesce(c.visit_name, 'Field visit') ELSE c.office_name END,
           'visit_status', c.visit_status,
           'left_site_name', c.left_site_name,
           'left_site_at', c.left_site_at,
           'place_state', c.place_state,
           'distance_m', (c.relation->>'distance_m')::double precision,
           'radius_m', (c.relation->>'radius_m')::double precision,
           'latitude', c.latitude,
           'longitude', c.longitude,
           'accuracy_m', c.accuracy,
           'location_at', c.fix_at,
           'location_age_min', round(c.age_min::numeric, 1),
           'last_seen_at', c.last_seen_at,
           'session_status', c.session_status,
           'last_quality_status', c.last_quality_status,
           'exit_event_id', c.exit_id,
           'exit_status', c.exit_status,
           'exit_detected_at', c.exit_at,
           'exit_returned_at', c.exit_returned_at,
           'exit_has_reason', coalesce(c.exit_has_reason, false)
         ) ORDER BY
           CASE c.monitor_status
             WHEN 'OUTSIDE' THEN 0 WHEN 'NO_RECENT_LOCATION' THEN 1 WHEN 'NO_LOCATION' THEN 2
             WHEN 'NEAR' THEN 3 WHEN 'TRAVELLING' THEN 4 WHEN 'NO_REFERENCE' THEN 5 ELSE 6 END,
           (c.relation->>'distance_m')::double precision DESC NULLS LAST,
           c.name), '[]'::jsonb)
  INTO v_rows
  FROM classified c;

  RETURN jsonb_build_object('generated_at', now(), 'business_date', v_today,
                            'fresh_minutes', 15, 'employees', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_location_monitor() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_location_monitor() TO authenticated;

NOTIFY pgrst, 'reload schema';
