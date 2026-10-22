-- =============================================================================
-- 20261009110000_geofence_report_fixes.sql
--
-- Geofence Events report / Download Centre (bug report 2026-10-09, section H).
--   * Employee and reviewer names were blank: the report read profiles.full_name,
--     which is empty for most employees. Now coalesce(name, full_name).
--   * The date window was midnight-to-midnight UTC (05:30 IST start). Now the
--     IST business day.
--   * Rows are returned newest first, and the distance is also returned as
--     calculated_distance_m (the name the app used).
--
-- 20261007120000_permission_delegation renamed the original function to
-- rpc_geofence_report__core and put a permission wrapper in front of it. Only
-- the core is replaced here, so the wrapper and its permission checks stay.
-- If the wrapper was never installed, the plain function is replaced instead.
-- Same signature and same return type. Idempotent.
-- =============================================================================

DO $do$
DECLARE
  v_name text := CASE
    WHEN to_regprocedure('public.rpc_geofence_report__core(date,date,uuid,text,text)') IS NOT NULL
      THEN 'rpc_geofence_report__core'
    ELSE 'rpc_geofence_report'
  END;
BEGIN
  EXECUTE format($fn$
CREATE OR REPLACE FUNCTION public.%I(
    p_start_date date,
    p_end_date date,
    p_user_id uuid DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_review_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
    v_results jsonb;
    v_from timestamptz := (p_start_date::timestamp AT TIME ZONE 'Asia/Kolkata');
    v_to   timestamptz := ((p_end_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
BEGIN
    WITH raw_data AS (
        SELECT
            e.id AS event_id,
            e.detected_at,
            e.event_type,
            e.latitude,
            e.longitude,
            e.calculated_distance_m AS distance_from_reference,
            e.calculated_distance_m,
            e.status,
            CASE WHEN e.geofence_type = 'OFFICE' THEN e.geofence_id ELSE NULL END AS office_id,
            CASE WHEN e.geofence_type = 'FIELD_VISIT' THEN e.geofence_id ELSE NULL END AS field_visit_id,
            e.received_at AS created_at,
            p.id AS user_id,
            coalesce(nullif(btrim(p.name), ''), p.full_name) AS employee_name,
            p.employee_number AS employee_id,
            o.name AS office_name,
            r.id AS reason_id,
            r.reason AS submitted_reason,
            rr.review_status,
            coalesce(nullif(btrim(reviewer.name), ''), reviewer.full_name) AS reviewed_by_name
        FROM public.geofence_events e
        JOIN public.profiles p ON e.user_id = p.id
        LEFT JOIN public.offices o ON (e.geofence_id = o.id AND e.geofence_type = 'OFFICE')
        LEFT JOIN public.geofence_reasons r ON r.geofence_event_id = e.id
        LEFT JOIN public.geofence_reason_reviews rr ON rr.geofence_reason_id = r.id
        LEFT JOIN public.profiles reviewer ON rr.reviewed_by = reviewer.id
        WHERE e.detected_at >= v_from
          AND e.detected_at < v_to
          AND (p_user_id IS NULL OR e.user_id = p_user_id)
          AND (p_status IS NULL OR e.status = p_status)
          AND (p_review_status IS NULL OR rr.review_status = p_review_status)
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(raw_data) ORDER BY raw_data.detected_at DESC), '[]'::jsonb)
    INTO v_results
    FROM raw_data;

    RETURN v_results;
END;
$body$;
$fn$, v_name);

  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(date,date,uuid,text,text) FROM public, anon', v_name);
  IF v_name = 'rpc_geofence_report' THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rpc_geofence_report(date,date,uuid,text,text) TO authenticated';
  END IF;
END
$do$;

NOTIFY pgrst, 'reload schema';
