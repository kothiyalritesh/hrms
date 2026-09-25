-- ==============================================================================
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
    p.name::text,
    p.employee_number::text,
    p.department::text,
    COALESCE(off.name, 'Main Office')::text,
    fv.date,
    to_char(fv.date, 'FMDay')::text,
    COALESCE(to_char(fv.checkin_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), '-')::text,
    COALESCE(to_char(fv.checkout_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), '-')::text,
    COALESCE(fv.project_name, fv.location_name, 'Site')::text,
    COALESCE(fv.client_name,  fv.contact_name)::text,
    COALESCE(fv.client_phone, fv.contact_phone)::text,
    fv.visit_type::text,
    fv.status::text,
    (CASE
      WHEN fv.checkout_time IS NOT NULL AND fv.checkin_time IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (fv.checkout_time - fv.checkin_time))::int / 60)
      ELSE NULL
    END)::int,
    COALESCE(sum.travel_distance_km::double precision, 0.0),
    COALESCE(svl.tracking_status, 'COMPLETED')::text,
    COALESCE(pts.cnt, 0)::int
  FROM public.field_visits fv
  JOIN public.profiles p ON p.id = fv.user_id
  LEFT JOIN public.offices off ON off.id = p.office_id
  LEFT JOIN public.site_visit_live_locations svl ON svl.field_visit_id = fv.id
  LEFT JOIN public.site_visit_summaries sum ON sum.field_visit_id = fv.id
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




