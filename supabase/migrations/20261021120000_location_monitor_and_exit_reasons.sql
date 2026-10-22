-- =============================================================================
-- 2026-10-21 Office exit reasons end to end + HR location monitor.
--
--  1. rpc_my_open_geofence_event: the office exit the employee can explain now
--     (opened by tapping the alert). An employee may explain as soon as they
--     leave (POTENTIAL_EXIT), not only after the 10-minute confirmation.
--  2. A second exit on the same day is detected: an exit that was confirmed
--     (PENDING_REASON / REASON_SUBMITTED) is marked returned_at when the
--     employee is back inside, so it no longer blocks a new cycle. It stays in
--     the review queue until reviewed.
--  3. rpc_location_monitor: every checked-in employee the viewer can track,
--     classified against their office or active field-visit site:
--       OUTSIDE · NEAR · INSIDE · TRAVELLING (on the way to a visit)
--       NO_RECENT_LOCATION (last good fix > 15 min old: last known shown)
--       NO_LOCATION (no good fix today) · NO_REFERENCE (no coordinates set)
--     with last known position, time, accuracy, login phone and open exit.
--  4. rpc_geofence_review_queue also returns returned_at and the phone.
--  5. Screen entry "LocationMonitor" (live_tracking.view).
-- Needs 20261008100000, 20261008180000, 20261008190000, 20261020100000.
-- Safe to run twice.
-- =============================================================================

-- ─── 1. Employee: the exit to explain now ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_my_open_geofence_event(p_event_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;

  -- The tapped event, if it is this employee's and already answered.
  IF p_event_id IS NOT NULL THEN
    SELECT g.id, gr.reason INTO v_row
    FROM public.geofence_events g
    JOIN public.geofence_reasons gr ON gr.geofence_event_id = g.id
    WHERE g.id = p_event_id AND g.user_id = v_uid
    ORDER BY gr.submitted_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('id', v_row.id, 'answered', true, 'reason', v_row.reason);
    END IF;
  END IF;

  SELECT g.id, g.status, coalesce(g.calculated_distance_m, 0) AS distance, g.detected_at, o.name AS office_name
  INTO v_row
  FROM public.geofence_events g
  LEFT JOIN public.offices o ON o.id = g.geofence_id
  WHERE g.user_id = v_uid
    AND g.status IN ('POTENTIAL_EXIT', 'PENDING_REASON')
    AND g.detected_at >= now() - interval '1 day'
    AND NOT EXISTS (SELECT 1 FROM public.geofence_reasons gr WHERE gr.geofence_event_id = g.id)
  ORDER BY (g.id = p_event_id) DESC NULLS LAST, (g.status = 'PENDING_REASON') DESC, g.detected_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status, 'distance', v_row.distance,
                            'detected_at', v_row.detected_at, 'office_name', v_row.office_name,
                            'answered', false);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_my_open_geofence_event(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_my_open_geofence_event(uuid) TO authenticated;

-- ─── 2. Repeat exits on the same day ─────────────────────────────────────────
ALTER TABLE public.geofence_events ADD COLUMN IF NOT EXISTS returned_at timestamptz;

-- One OPEN cycle per attendance: a confirmed exit the employee came back from
-- no longer counts as open.
DROP INDEX IF EXISTS public.geofence_events_one_active_cycle;
CREATE UNIQUE INDEX geofence_events_one_active_cycle
  ON public.geofence_events (attendance_id, geofence_type, geofence_id)
  WHERE status NOT IN ('RETURNED_INSIDE', 'CLOSED') AND returned_at IS NULL;

-- Same rules as 20261008100000 + 20261008190000 (outside = beyond radius +
-- 150 m after GPS error; back inside = within the radius allowing up to 50 m
-- error), plus returned_at for confirmed exits.
CREATE OR REPLACE FUNCTION public.hrms_evaluate_office_geofence(p_client_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ping public.location_tracking%rowtype;
  v_att public.attendance_logs%rowtype;
  v_office record;
  v_radius double precision;
  v_distance double precision;
  v_outside boolean;
  v_event public.geofence_events%rowtype;
  v_at timestamptz;
BEGIN
  SELECT * INTO v_ping FROM public.location_tracking WHERE client_event_id = p_client_event_id LIMIT 1;
  IF NOT FOUND OR v_ping.quality_status <> 'RELIABLE' OR v_ping.field_visit_id IS NOT NULL THEN RETURN; END IF;
  v_at := public.hrms_timestamp(v_ping.recorded_at);

  SELECT a.* INTO v_att FROM public.tracking_sessions s
  JOIN public.attendance_logs a ON a.id = s.attendance_log_id
  WHERE s.id = v_ping.tracking_session_id;
  IF NOT FOUND OR v_att.checkout_time IS NOT NULL OR v_att.office_id IS NULL THEN RETURN; END IF;

  -- Field staff and WFH days are not office-bound.
  IF EXISTS (SELECT 1 FROM public.field_visits fv WHERE fv.user_id = v_att.user_id AND fv.date = v_att.date) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.leave_requests lr
             WHERE lr.user_id = v_att.user_id AND lower(lr.status) = 'approved'
               AND v_att.date BETWEEN lr.start_date AND lr.end_date) THEN RETURN; END IF;

  SELECT o.id, o.name, o.latitude, o.longitude, coalesce(o.allowed_radius_meters, o.attendance_radius) AS radius
  INTO v_office FROM public.offices o WHERE o.id = v_att.office_id;
  IF NOT FOUND OR v_office.latitude IS NULL OR v_office.longitude IS NULL THEN RETURN; END IF;
  v_radius := greatest(coalesce(v_office.radius, 200), 50);
  v_distance := public.tracking_distance_metres(v_office.latitude, v_office.longitude, v_ping.latitude, v_ping.longitude);
  v_outside := (v_distance - coalesce(v_ping.accuracy, 0)) > v_radius + 150;

  SELECT * INTO v_event FROM public.geofence_events
  WHERE attendance_id = v_att.id AND geofence_type = 'OFFICE' AND geofence_id = v_office.id
    AND status NOT IN ('RETURNED_INSIDE', 'CLOSED') AND returned_at IS NULL
  ORDER BY detected_at DESC LIMIT 1;

  IF v_outside THEN
    IF v_event.id IS NULL THEN
      INSERT INTO public.geofence_events (
        client_event_id, user_id, attendance_id, geofence_type, geofence_id, event_type,
        latitude, longitude, accuracy_m, accuracy_class, calculated_distance_m,
        event_source, detected_at, status
      ) VALUES (
        p_client_event_id, v_att.user_id, v_att.id, 'OFFICE', v_office.id, 'OFFICE_EXIT',
        v_ping.latitude, v_ping.longitude, v_ping.accuracy,
        CASE WHEN coalesce(v_ping.accuracy, 999) <= 50 THEN 'GOOD' ELSE 'UNCERTAIN' END,
        round(v_distance::numeric, 1), 'BACKGROUND_LOCATION', v_at, 'POTENTIAL_EXIT'
      ) ON CONFLICT DO NOTHING;
    ELSIF v_event.status = 'POTENTIAL_EXIT' AND v_at >= v_event.detected_at + interval '10 minutes' THEN
      PERFORM public.hrms_confirm_office_exit(v_event.id, v_distance);
    END IF;
  ELSIF v_event.id IS NOT NULL
        AND v_distance - least(coalesce(v_ping.accuracy, 100), 50) <= v_radius THEN
    IF v_event.status = 'POTENTIAL_EXIT' THEN
      UPDATE public.geofence_events SET status = 'RETURNED_INSIDE', processed_at = now() WHERE id = v_event.id;
    ELSE
      -- Confirmed or explained exit: keep it for review, open a new cycle.
      UPDATE public.geofence_events SET returned_at = v_at WHERE id = v_event.id AND returned_at IS NULL;
    END IF;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'office geofence skipped: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_evaluate_office_geofence(uuid) FROM public, anon, authenticated;

-- ─── 3. HR location monitor ──────────────────────────────────────────────────
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
           f.latitude, f.longitude, f.accuracy, f.recorded_at AS fix_at, f.last_seen_at,
           s.status AS session_status, s.last_quality_status,
           CASE WHEN f.recorded_at IS NULL THEN NULL
                ELSE extract(epoch FROM (now() - f.recorded_at)) / 60 END AS age_min,
           CASE WHEN v.id IS NOT NULL THEN
                  public.hrms_site_relation(v.id, f.latitude, f.longitude, f.accuracy)
                WHEN att.office_id IS NOT NULL THEN
                  public.hrms_office_relation(att.office_id, f.latitude, f.longitude, f.accuracy)
           END AS relation,
           ev.id AS exit_id, ev.status AS exit_status, ev.detected_at AS exit_at, ev.returned_at AS exit_returned_at,
           ev.has_reason AS exit_has_reason
    FROM att
    JOIN public.profiles p ON p.id = att.user_id
    LEFT JOIN public.offices o ON o.id = att.office_id
    LEFT JOIN fix f ON f.user_id = att.user_id
    LEFT JOIN LATERAL (
      SELECT fv.id, fv.status, fv.location_name
      FROM public.field_visits fv
      WHERE fv.user_id = att.user_id AND fv.date = v_today
        AND fv.status IN ('IN_TRANSIT', 'CHECKED_IN') AND fv.destination_coords IS NOT NULL
      ORDER BY (fv.status = 'CHECKED_IN') DESC, fv.created_at DESC
      LIMIT 1
    ) v ON true
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

-- ─── 4. Review queue: return time and phone ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_geofence_review_queue(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(q) ORDER BY q.detected_at DESC), '[]'::jsonb)
  FROM (
    SELECT g.id, g.user_id, p.name AS employee_name, nullif(btrim(coalesce(p.phone, '')), '') AS phone,
           o.name AS office_name, g.status,
           g.detected_at, g.returned_at, g.calculated_distance_m AS distance_m, g.accuracy_m,
           g.latitude, g.longitude,
           (SELECT gr.reason FROM public.geofence_reasons gr WHERE gr.geofence_event_id = g.id
            ORDER BY gr.submitted_at DESC LIMIT 1) AS reason,
           (SELECT gr.submitted_at FROM public.geofence_reasons gr WHERE gr.geofence_event_id = g.id
            ORDER BY gr.submitted_at DESC LIMIT 1) AS reason_at
    FROM public.geofence_events g
    JOIN public.profiles p ON p.id = g.user_id
    LEFT JOIN public.offices o ON o.id = g.geofence_id
    WHERE g.status IN ('PENDING_REASON', 'REASON_SUBMITTED')
      AND g.detected_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 60)))
      AND g.user_id <> auth.uid()
      AND (public.is_profile_admin() OR public.can_access_user_data(g.user_id, 'live_tracking.view'))
    LIMIT 200
  ) q;
$$;
REVOKE ALL ON FUNCTION public.rpc_geofence_review_queue(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_geofence_review_queue(integer) TO authenticated;

-- ─── 5. Screen ───────────────────────────────────────────────────────────────
INSERT INTO public.permission_screen_access (route, keys) VALUES
  ('LocationMonitor', ARRAY['live_tracking.view'])
ON CONFLICT (route) DO UPDATE SET keys = EXCLUDED.keys;

NOTIFY pgrst, 'reload schema';
