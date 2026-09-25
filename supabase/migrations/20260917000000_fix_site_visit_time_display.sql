-- =============================================================================
-- Migration: 20260917000000_fix_site_visit_time_display.sql
-- Purpose  : Fix site visit check-in/check-out times showing 5h30m too early.
--
-- Root cause: checkin_time / checkout_time are TIMESTAMP WITHOUT TIME ZONE
--   storing UTC values. Using `AT TIME ZONE 'Asia/Kolkata'` on a naive
--   timestamp tells Postgres "this value IS in Kolkata — convert it to UTC",
--   which shifts the display 5h30m in the wrong direction.
--   The fix is the two-step form: (col AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'
--   which correctly reads the naive value as UTC then converts to IST.
-- =============================================================================

-- generate_site_visit_report
CREATE OR REPLACE FUNCTION public.generate_site_visit_report(
  p_start_date date,
  p_end_date   date
)
RETURNS TABLE (
  employee_name         text,
  employee_no           text,
  department            text,
  branch                text,
  visit_date            date,
  day_of_week           text,
  check_in_time         text,
  check_out_time        text,
  project_name          text,
  client_name           text,
  client_phone          text,
  visit_type            text,
  visit_status          text,
  duration_minutes      int,
  distance_travelled_km double precision,
  tracking_status       text,
  gps_point_count       int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid    := auth.uid();
  v_is_admin     boolean := false;
  v_record_count int     := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE';
  END IF;
  IF (p_end_date - p_start_date) > 90 THEN
    RAISE EXCEPTION 'Please select a maximum 90-day range.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_uid AND role IN ('SYSTEM_ADMIN','ADMIN')
  ) INTO v_is_admin;

  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.user_permissions
    WHERE user_id = v_uid AND permission = 'view_location_reports' AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  SELECT COUNT(*) INTO v_record_count
  FROM public.field_visits fv
  WHERE fv.date BETWEEN p_start_date AND p_end_date
    AND (v_is_admin OR public.can_access_user_data(fv.user_id, 'view_location_reports'));

  PERFORM public.log_audit_event(
    'LOCATION_REPORT_EXPORTED', 'field_visits', NULL, NULL,
    jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date, 'records_count', v_record_count)
  );

  RETURN QUERY
  SELECT
    p.name,
    p.employee_number,
    p.department,
    COALESCE(off.name, 'Main Office'),
    fv.date,
    to_char(fv.date, 'FMDay'),
    -- Two-step: read naive value as UTC, then convert to IST
    COALESCE(to_char((fv.checkin_time  AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), '—'),
    COALESCE(to_char((fv.checkout_time AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), '—'),
    COALESCE(fv.project_name, fv.location_name, 'Site'),
    COALESCE(fv.client_name,  fv.contact_name),
    COALESCE(fv.client_phone, fv.contact_phone),
    fv.visit_type,
    fv.status,
    CASE
      WHEN fv.checkout_time IS NOT NULL AND fv.checkin_time IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (fv.checkout_time - fv.checkin_time))::int / 60)
      ELSE NULL
    END,
    COALESCE(ROUND((fv.last_distance_m / 1000.0)::numeric, 2)::double precision, 0.0),
    COALESCE(svl.tracking_status, 'COMPLETED'),
    COALESCE(pts.cnt, 0)::int
  FROM public.field_visits fv
  JOIN public.profiles p ON p.id = fv.user_id
  LEFT JOIN public.offices off ON off.id = p.office_id
  LEFT JOIN public.site_visit_live_locations svl ON svl.field_visit_id = fv.id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS cnt
    FROM public.site_visit_location_history h WHERE h.field_visit_id = fv.id
  ) pts ON true
  WHERE fv.date BETWEEN p_start_date AND p_end_date
    AND (v_is_admin OR public.can_access_user_data(fv.user_id, 'view_location_reports'))
  ORDER BY fv.date DESC, p.name ASC, fv.created_at ASC;
END $$;

REVOKE ALL ON FUNCTION public.generate_site_visit_report(date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.generate_site_visit_report(date, date) TO authenticated;

-- get_site_visit_observer_data
CREATE OR REPLACE FUNCTION public.get_site_visit_observer_data(
  p_date        date,
  p_employee_id uuid DEFAULT NULL,
  p_visit_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid    := auth.uid();
  v_today     date    := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_is_live   boolean := (p_date = v_today);
  v_is_admin  boolean := false;
  v_summary   jsonb;
  v_employees jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'AUTHENTICATION_REQUIRED');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_uid AND role IN ('SYSTEM_ADMIN','ADMIN')
  ) INTO v_is_admin;

  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.user_permissions
    WHERE user_id = v_uid AND permission = 'view_site_visit_observer' AND revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'PERMISSION_DENIED');
  END IF;

  WITH visits_universe AS (
    SELECT fv.id AS visit_id, fv.user_id, fv.status AS visit_status, svl.updated_at AS last_ping_at
    FROM public.field_visits fv
    JOIN public.profiles p ON p.id = fv.user_id
    LEFT JOIN public.site_visit_live_locations svl ON svl.user_id = fv.user_id
    WHERE fv.date = p_date
      AND COALESCE(fv.verification_status,'PENDING') <> 'REJECTED'
      AND (p_employee_id IS NULL OR fv.user_id = p_employee_id)
      AND (p_visit_id    IS NULL OR fv.id      = p_visit_id)
      AND (v_is_admin OR public.can_access_user_data(fv.user_id,'view_site_visit_observer'))
  ),
  counts AS (
    SELECT
      COUNT(*)::int AS total_visits,
      COUNT(*) FILTER (WHERE visit_status='IN_TRANSIT')::int AS in_transit,
      COUNT(*) FILTER (WHERE visit_status='CHECKED_IN')::int AS at_site,
      COUNT(*) FILTER (WHERE visit_status IN ('COMPLETED','MISSED'))::int AS completed,
      COUNT(DISTINCT user_id) FILTER (
        WHERE v_is_live AND visit_status IN ('IN_TRANSIT','CHECKED_IN')
          AND (last_ping_at IS NULL OR last_ping_at < now() - INTERVAL '5 minutes')
      )::int AS signal_lost
    FROM visits_universe
  )
  SELECT jsonb_build_object(
    'total_visits', COALESCE(c.total_visits,0),
    'in_transit',   COALESCE(c.in_transit,0),
    'at_site',      COALESCE(c.at_site,0),
    'completed',    COALESCE(c.completed,0),
    'signal_lost',  COALESCE(c.signal_lost,0)
  ) INTO v_summary FROM counts c;

  WITH relevant_visits AS (
    SELECT
      fv.id AS visit_id, fv.user_id, fv.status AS visit_status,
      fv.location_name, fv.project_name,
      -- Emit as ISO 8601 with explicit +05:30 so the frontend needs no guessing
      to_char((fv.checkin_time  AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata',
              'YYYY-MM-DD"T"HH24:MI:SS+05:30') AS checkin_time,
      to_char((fv.checkout_time AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata',
              'YYYY-MM-DD"T"HH24:MI:SS+05:30') AS checkout_time,
      fv.visit_type,
      (fv.destination_coords->>'latitude')::double precision  AS dest_lat,
      (fv.destination_coords->>'longitude')::double precision AS dest_lon,
      COALESCE(fv.client_name,  fv.contact_name)  AS client_name,
      COALESCE(fv.client_phone, fv.contact_phone) AS client_phone,
      fv.created_at
    FROM public.field_visits fv
    WHERE fv.date = p_date
      AND COALESCE(fv.verification_status,'PENDING') <> 'REJECTED'
      AND (p_employee_id IS NULL OR fv.user_id = p_employee_id)
      AND (p_visit_id    IS NULL OR fv.id      = p_visit_id)
      AND (v_is_admin OR public.can_access_user_data(fv.user_id,'view_site_visit_observer'))
  ),
  distinct_employees AS (SELECT DISTINCT user_id FROM relevant_visits),
  employee_cards AS (
    SELECT
      p.id AS employee_id, p.name, p.employee_number AS employee_no,
      p.role, p.department, off.name AS office_name,
      CASE
        WHEN NOT v_is_live THEN 'COMPLETED'
        WHEN has_active.val AND (svl.updated_at IS NULL OR svl.updated_at < now()-INTERVAL '5 minutes') THEN 'SIGNAL_LOST'
        WHEN svl.tracking_status='AT_SITE'    THEN 'AT_SITE'
        WHEN svl.tracking_status='IN_TRANSIT' THEN 'IN_TRANSIT'
        WHEN has_active.val THEN 'IN_TRANSIT'
        ELSE 'COMPLETED'
      END AS computed_status,
      CASE
        WHEN NOT v_is_live THEN 'COMPLETED'
        WHEN svl.updated_at IS NULL OR svl.updated_at < now()-INTERVAL '5 minutes' THEN 'SIGNAL_LOST'
        WHEN svl.updated_at < now()-INTERVAL '2 minutes' THEN 'DELAYED'
        ELSE 'LIVE'
      END AS computed_signal_status,
      svl.latitude, svl.longitude, svl.accuracy_m, svl.battery_level,
      svl.speed_mps, svl.source, svl.updated_at AS ping_updated_at,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'visit_id',        rv.visit_id,
          'status',          rv.visit_status,
          'location_name',   rv.location_name,
          'project_name',    rv.project_name,
          'checkin_time',    rv.checkin_time,
          'checkout_time',   rv.checkout_time,
          'visit_type',      rv.visit_type,
          'destination_lat', rv.dest_lat,
          'destination_lon', rv.dest_lon,
          'client_name',     rv.client_name,
          'client_phone',    rv.client_phone
        ) ORDER BY rv.created_at ASC)
        FROM relevant_visits rv WHERE rv.user_id = p.id
      ) AS visits_json
    FROM distinct_employees de
    JOIN public.profiles p ON p.id = de.user_id
    LEFT JOIN public.offices off ON off.id = p.office_id
    LEFT JOIN public.site_visit_live_locations svl ON svl.user_id = p.id AND v_is_live
    CROSS JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM relevant_visits v
        WHERE v.user_id = p.id AND v.visit_status IN ('IN_TRANSIT','CHECKED_IN')
      ) AS val
    ) has_active
    ORDER BY p.name ASC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'employee_id',   ec.employee_id,
    'name',          ec.name,
    'employee_no',   ec.employee_no,
    'role',          ec.role,
    'department',    ec.department,
    'office_name',   ec.office_name,
    'tracking', jsonb_build_object(
      'status',        ec.computed_status,
      'signal_status', ec.computed_signal_status,
      'latitude',      ec.latitude,
      'longitude',     ec.longitude,
      'accuracy',      ec.accuracy_m,
      'battery_level', ec.battery_level,
      'speed_mps',     ec.speed_mps,
      'source',        ec.source,
      'updated_at',    ec.ping_updated_at
    ),
    'visits', COALESCE(ec.visits_json,'[]'::jsonb)
  )), '[]'::jsonb) INTO v_employees
  FROM employee_cards ec;

  RETURN jsonb_build_object(
    'date',      p_date::text,
    'is_live',   v_is_live,
    'summary',   COALESCE(v_summary,  '{}'::jsonb),
    'employees', COALESCE(v_employees,'[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
