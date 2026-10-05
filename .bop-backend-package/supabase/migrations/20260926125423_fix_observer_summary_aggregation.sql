CREATE OR REPLACE FUNCTION public.get_site_visit_observer_data(
  p_date        date,
  p_employee_id uuid DEFAULT NULL,
  p_visit_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_live   boolean;
  v_is_admin  boolean;
  v_summary   jsonb;
  v_employees jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'AUTHENTICATION_REQUIRED');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')) INTO v_is_admin;
  v_is_live  := (p_date = CURRENT_DATE);

  IF NOT v_is_admin THEN
    IF NOT EXISTS(SELECT 1 FROM public.user_permissions WHERE user_id = auth.uid() AND permission = 'view_site_visit_observer' AND revoked_at IS NULL) THEN
      RETURN jsonb_build_object('error', 'PERMISSION_DENIED');
    END IF;
  END IF;

  WITH relevant_visits AS (
    SELECT fv.id AS visit_id, fv.user_id, fv.status AS visit_status, 
           fv.location_name, fv.project_name,
           to_char(fv.checkin_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS checkin_time,
           to_char(fv.checkout_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS checkout_time,
           fv.visit_type, (fv.destination_coords->>'latitude')::double precision AS dest_lat, (fv.destination_coords->>'longitude')::double precision AS dest_lon, COALESCE(fv.client_name, fv.contact_name) AS client_name, COALESCE(fv.client_phone, fv.contact_phone) AS client_phone,
           svl.updated_at AS last_ping_at,
           svl.tracking_status AS svl_tracking_status
    FROM public.field_visits fv
    LEFT JOIN LATERAL (
      SELECT updated_at, tracking_status FROM public.site_visit_live_locations s WHERE s.user_id = fv.user_id ORDER BY updated_at DESC LIMIT 1
    ) svl ON true
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
      CASE
        WHEN NOT v_is_live THEN 'STALE'
        WHEN svl.last_uploaded_at IS NULL OR svl.last_uploaded_at < now()-INTERVAL '60 seconds' THEN 'STALE'
        WHEN svl.last_uploaded_at < now()-INTERVAL '15 seconds' THEN 'DELAYED'
        ELSE 'ACTIVE'
      END AS computed_tracking_health,
      COALESCE(svl.gps_quality,'HIGH') AS computed_gps_quality,
      svl.latitude, svl.longitude, svl.accuracy_m, svl.battery_level,
      svl.speed_mps, svl.source, svl.last_location_at, svl.last_uploaded_at,
      COALESCE(svl.pending_ping_count,0) AS pending_ping_count,
      svl.updated_at AS ping_updated_at,
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
        ) ORDER BY rv.visit_status ASC)
        FROM relevant_visits rv WHERE rv.user_id = p.id
      ) AS visits_json
    FROM distinct_employees de
    JOIN public.profiles p ON p.id = de.user_id
    LEFT JOIN public.offices off ON off.id = p.office_id
    LEFT JOIN LATERAL (
      SELECT * FROM public.site_visit_live_locations s WHERE s.user_id = p.id ORDER BY updated_at DESC LIMIT 1
    ) svl ON v_is_live
    CROSS JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM relevant_visits v
        WHERE v.user_id = p.id AND v.visit_status IN ('IN_TRANSIT','CHECKED_IN')
      ) AS val
    ) has_active
    ORDER BY p.name ASC
  )
  SELECT jsonb_build_object(
    'total_visits', COALESCE(COUNT(*)::int, 0),
    'in_transit',   COALESCE(COUNT(*) FILTER (WHERE computed_status = 'IN_TRANSIT')::int, 0),
    'at_site',      COALESCE(COUNT(*) FILTER (WHERE computed_status = 'AT_SITE')::int, 0),
    'completed',    COALESCE(COUNT(*) FILTER (WHERE computed_status = 'COMPLETED')::int, 0),
    'signal_lost',  COALESCE(COUNT(*) FILTER (WHERE computed_status = 'SIGNAL_LOST')::int, 0)
  ) INTO v_summary
  FROM employee_cards;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'employee_id',     ec.employee_id,
    'name',            ec.name,
    'employee_no',     ec.employee_no,
    'role',            ec.role,
    'department',      ec.department,
    'office_name',     ec.office_name,
    'tracking', jsonb_build_object(
      'status',             ec.computed_status,
      'signal_status',      ec.computed_signal_status,
      'tracking_health',    ec.computed_tracking_health,
      'gps_quality',        ec.computed_gps_quality,
      'latitude',           ec.latitude,
      'longitude',          ec.longitude,
      'accuracy',           ec.accuracy_m,
      'battery_level',      ec.battery_level,
      'speed_mps',          ec.speed_mps,
      'source',             ec.source,
      'last_location_at',   ec.last_location_at,
      'last_uploaded_at',   ec.last_uploaded_at,
      'pending_ping_count', ec.pending_ping_count,
      'updated_at',         ec.ping_updated_at
    ),
    'visits',          COALESCE(ec.visits_json,'[]'::jsonb),
    'latest_lat',      ec.latitude,
    'latest_lon',      ec.longitude,
    'tracking_status', ec.computed_status,
    'updated_at',      ec.ping_updated_at
  )), '[]'::jsonb) INTO v_employees
  FROM employee_cards ec;

  RETURN jsonb_build_object(
    'date',      p_date::text,
    'mode',      CASE WHEN v_is_live THEN 'LIVE' ELSE 'HISTORICAL' END,
    'is_live',   v_is_live,
    'summary',   COALESCE(v_summary, '{}'::jsonb),
    'employees', COALESCE(v_employees,'[]'::jsonb)
  );
END;
$$;
