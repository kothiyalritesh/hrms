-- =============================================================================
-- 2026-10-22 One story per employee-day: every attendance interaction from
-- every source, in time order (read-only).
--   app / biometric / site check-in and check-out, each biometric punch with
--   its office (or "device not linked"), leaving a site (GPS), visit ended
--   (office return, next site, automatic), leaving / returning to the office
--   area, reason given, event check-in/out, approved regularization, and
--   location gaps of 30+ min while checked in (ranges up to 7 days).
-- Same visibility as attendance (attendance.view scope, admins, self).
-- No new tables; nothing is changed.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.rpc_attendance_day_events(
  p_from date, p_to date, p_user_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_from timestamptz;
  v_to timestamptz;
  v_gaps boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE';
  END IF;
  v_from := (p_from::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_to := ((p_to + 1)::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_gaps := p_to - p_from <= 6;

  WITH vis AS (
    SELECT p.id FROM public.profiles p WHERE public.is_profile_admin()
    UNION SELECT public.authorized_user_ids('attendance.view')
    UNION SELECT v_uid
  ),
  who AS (
    SELECT v.id FROM vis v WHERE p_user_ids IS NULL OR v.id = ANY (p_user_ids)
  ),
  att AS (
    SELECT a.*, o.name AS office_name
    FROM public.attendance_logs a
    JOIN who ON who.id = a.user_id
    LEFT JOIN public.offices o ON o.id = a.office_id
    WHERE a.date BETWEEN p_from AND p_to
  ),
  ev AS (
    -- day start (whatever started it)
    SELECT a.user_id, a.date AS day, public.hrms_timestamp(a.checkin_time) AS at, 'CHECK_IN'::text AS type,
           'Day started'::text AS title, coalesce(a.checkin_location_name, a.office_name) AS place,
           upper(coalesce(a.checkin_source, a.attendance_type, 'APP')) AS source, true AS verified, NULL::text AS detail
    FROM att a WHERE a.checkin_time IS NOT NULL
    UNION ALL
    -- app check-in after another source started the day
    SELECT a.user_id, a.date, public.hrms_timestamp(a.app_checkin_time), 'APP_CHECK_IN', 'App check-in',
           coalesce(a.checkin_location_name, a.office_name), 'APP', true, NULL
    FROM att a
    WHERE a.app_checkin_time IS NOT NULL AND a.checkin_time IS NOT NULL
      AND abs(extract(epoch FROM (public.hrms_timestamp(a.app_checkin_time) - public.hrms_timestamp(a.checkin_time)))) > 60
    UNION ALL
    SELECT a.user_id, a.date, public.hrms_timestamp(a.checkout_time), 'CHECK_OUT',
           CASE WHEN coalesce(a.auto_closed, false) OR upper(coalesce(a.checkout_source, '')) IN ('SYSTEM', 'AUTO')
                THEN 'Checked out automatically' ELSE 'Checked out' END,
           coalesce(a.checkout_location_name, a.office_name), upper(coalesce(a.checkout_source, 'APP')), true, NULL
    FROM att a WHERE a.checkout_time IS NOT NULL
    UNION ALL
    -- every biometric punch, with the office of its machine
    SELECT l.user_id, l.log_date_only, l.log_date, 'BIO_PUNCH', 'Biometric punch',
           coalesce(o.name, 'Device ' || coalesce(l.serial_number, '?') || ' (office not linked)'),
           'BIOMETRIC', l.office_id IS NOT NULL, l.serial_number
    FROM public.smartoffice_device_logs l
    JOIN who ON who.id = l.user_id
    LEFT JOIN public.offices o ON o.id = l.office_id
    WHERE l.log_date_only BETWEEN p_from AND p_to AND l.log_date IS NOT NULL
    UNION ALL
    -- site / field visits
    SELECT v.user_id, v.date, public.hrms_timestamp(v.checkin_time), 'SITE_IN',
           CASE WHEN v.journey_status = 'SITE_CHECKED_IN' OR v.visit_type = 'site' THEN 'Site check-in' ELSE 'Field visit check-in' END,
           coalesce(v.project_name, v.location_name), 'SITE', true, NULL
    FROM public.field_visits v JOIN who ON who.id = v.user_id
    WHERE v.date BETWEEN p_from AND p_to AND v.checkin_time IS NOT NULL AND v.status <> 'MISSED'
    UNION ALL
    SELECT v.user_id, v.date, public.hrms_timestamp(v.departed_at), 'SITE_LEFT', 'Left the site (GPS)',
           coalesce(v.project_name, v.location_name), 'GPS', true, NULL
    FROM public.field_visits v JOIN who ON who.id = v.user_id
    WHERE v.date BETWEEN p_from AND p_to AND v.departed_at IS NOT NULL AND v.checkin_time IS NOT NULL
      AND (v.checkout_time IS NULL
           OR public.hrms_timestamp(v.departed_at) < public.hrms_timestamp(v.checkout_time) - interval '1 minute')
    UNION ALL
    SELECT v.user_id, v.date, public.hrms_timestamp(v.checkout_time), 'SITE_OUT',
           CASE v.auto_close_reason
             WHEN 'OFFICE_RETURN_BIOMETRIC' THEN 'Site visit ended (back at office)'
             WHEN 'SITE_CHANGE' THEN 'Site visit ended (moved to next site)'
             ELSE CASE WHEN coalesce(v.auto_closed, false) THEN 'Site visit closed automatically' ELSE 'Site check-out' END
           END,
           coalesce(v.project_name, v.location_name), 'SITE', true, v.auto_close_reason
    FROM public.field_visits v JOIN who ON who.id = v.user_id
    WHERE v.date BETWEEN p_from AND p_to AND v.checkout_time IS NOT NULL AND v.status <> 'MISSED'
    UNION ALL
    -- office area: confirmed exits (10+ min), return, reason
    SELECT g.user_id, a.date, g.detected_at, 'OFFICE_EXIT', 'Left the office area',
           o.name, 'GPS', true,
           CASE WHEN g.calculated_distance_m IS NOT NULL THEN round(g.calculated_distance_m)::text || ' m away' END
    FROM public.geofence_events g
    JOIN att a ON a.id = g.attendance_id
    LEFT JOIN public.offices o ON o.id = g.geofence_id
    WHERE g.status IN ('PENDING_REASON', 'REASON_SUBMITTED', 'CLOSED')
      AND coalesce(g.resolution, '') NOT IN ('UNVERIFIED_NO_DATA', 'CHECKED_OUT')
    UNION ALL
    SELECT g.user_id, a.date, g.returned_at, 'OFFICE_RETURN', 'Back in the office area', o.name, 'GPS', true, NULL
    FROM public.geofence_events g
    JOIN att a ON a.id = g.attendance_id
    LEFT JOIN public.offices o ON o.id = g.geofence_id
    WHERE g.returned_at IS NOT NULL
    UNION ALL
    SELECT g.user_id, a.date, gr.submitted_at, 'EXIT_REASON', 'Reason given for leaving', NULL, 'APP', true,
           left(gr.reason, 140)
    FROM public.geofence_events g
    JOIN att a ON a.id = g.attendance_id
    JOIN public.geofence_reasons gr ON gr.geofence_event_id = g.id
    UNION ALL
    -- company events
    SELECT c.user_id, (c.checkin_time AT TIME ZONE 'Asia/Kolkata')::date, c.checkin_time, 'EVENT_IN', 'Event check-in',
           coalesce(to_jsonb(e)->>'title', to_jsonb(e)->>'name', 'Event'), 'EVENT', true, NULL
    FROM public.event_checkins c JOIN who ON who.id = c.user_id
    LEFT JOIN public.events e ON e.id = c.event_id
    WHERE c.checkin_time >= v_from AND c.checkin_time < v_to
    UNION ALL
    SELECT c.user_id, (c.checkout_time AT TIME ZONE 'Asia/Kolkata')::date, c.checkout_time, 'EVENT_OUT', 'Event check-out',
           coalesce(to_jsonb(e)->>'title', to_jsonb(e)->>'name', 'Event'), 'EVENT', true, NULL
    FROM public.event_checkins c JOIN who ON who.id = c.user_id
    LEFT JOIN public.events e ON e.id = c.event_id
    WHERE c.checkout_time >= v_from AND c.checkout_time < v_to
    UNION ALL
    -- approved regularization
    SELECT r.user_id, a.date, r.reviewed_at, 'REGULARIZED', 'Attendance corrected (regularization)', NULL, 'HR', true,
           CASE WHEN r.requested_checkout IS NOT NULL
                THEN 'checkout set to ' || to_char(r.requested_checkout AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') END
    FROM public.attendance_regularization_requests r
    JOIN att a ON a.id = r.attendance_id
    WHERE upper(r.status) = 'APPROVED' AND r.reviewed_at IS NOT NULL
  ),
  gaps AS (
    -- 30+ min without a good GPS point while checked in (short ranges only)
    SELECT x.user_id, x.day, x.prev_at AS at, x.at AS until
    FROM (
      SELECT a.user_id, a.date AS day, public.hrms_timestamp(t.recorded_at) AS at,
             lag(public.hrms_timestamp(t.recorded_at)) OVER (PARTITION BY a.id ORDER BY t.recorded_at) AS prev_at
      FROM att a
      JOIN public.location_tracking t ON t.user_id = a.user_id
      WHERE v_gaps AND a.checkin_time IS NOT NULL
        AND t.recorded_at >= v_from - interval '1 day' AND t.recorded_at < v_to + interval '1 day'
        AND public.hrms_timestamp(t.recorded_at) >= public.hrms_timestamp(a.checkin_time)
        AND public.hrms_timestamp(t.recorded_at) <= coalesce(public.hrms_timestamp(a.checkout_time), now())
        AND coalesce(t.quality_status, 'RELIABLE') = 'RELIABLE'
    ) x
    WHERE x.prev_at IS NOT NULL AND x.at - x.prev_at >= interval '30 minutes'
  ),
  all_ev AS (
    SELECT * FROM ev WHERE at IS NOT NULL AND day BETWEEN p_from AND p_to
    UNION ALL
    SELECT g.user_id, g.day, g.at, 'GPS_GAP',
           'No location for ' || round(extract(epoch FROM (g.until - g.at)) / 60)::text || ' min', NULL, 'GPS', false,
           to_char(g.until AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')
    FROM gaps g
  ),
  per_day AS (
    SELECT e.user_id, e.day,
           jsonb_agg(jsonb_build_object('at', e.at, 'type', e.type, 'title', e.title, 'place', e.place,
                                        'source', e.source, 'verified', e.verified, 'detail', e.detail)
                     ORDER BY e.at,
                       -- same instant: day start, then what ended, then what began
                       CASE e.type WHEN 'CHECK_IN' THEN 0 WHEN 'SITE_OUT' THEN 1 WHEN 'SITE_LEFT' THEN 1
                                   WHEN 'SITE_IN' THEN 2 WHEN 'BIO_PUNCH' THEN 3 ELSE 4 END) AS events
    FROM (SELECT DISTINCT * FROM all_ev) e
    GROUP BY e.user_id, e.day
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', d.user_id, 'date', d.day, 'events', d.events)
                            ORDER BY d.day, d.user_id), '[]'::jsonb)
  INTO v_result
  FROM per_day d;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_attendance_day_events(date, date, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_day_events(date, date, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
