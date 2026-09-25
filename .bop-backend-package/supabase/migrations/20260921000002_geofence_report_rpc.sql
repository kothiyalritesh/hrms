CREATE OR REPLACE FUNCTION public.rpc_geofence_report(
    p_start_date date,
    p_end_date date,
    p_user_id uuid DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_review_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_role text;
    v_results jsonb;
BEGIN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    
    WITH raw_data AS (
        SELECT 
            e.id as event_id,
            e.detected_at,
            e.event_type,
            e.latitude,
            e.longitude,
            e.calculated_distance_m as distance_from_reference,
            e.status,
            CASE WHEN e.geofence_type = 'OFFICE' THEN e.geofence_id ELSE NULL END as office_id,
            CASE WHEN e.geofence_type = 'FIELD_VISIT' THEN e.geofence_id ELSE NULL END as field_visit_id,
            e.received_at as created_at,
            p.id as user_id,
            p.full_name as employee_name,
            p.employee_number as employee_id,
            o.name as office_name,
            r.id as reason_id,
            r.reason as submitted_reason,
            rr.review_status,
            reviewer.full_name as reviewed_by_name
        FROM public.geofence_events e
        JOIN public.profiles p ON e.user_id = p.id
        LEFT JOIN public.offices o ON (e.geofence_id = o.id AND e.geofence_type = 'OFFICE')
        LEFT JOIN public.geofence_reasons r ON r.geofence_event_id = e.id
        LEFT JOIN public.geofence_reason_reviews rr ON rr.geofence_reason_id = r.id
        LEFT JOIN public.profiles reviewer ON rr.reviewed_by = reviewer.id
        WHERE e.detected_at >= p_start_date
          AND e.detected_at < (p_end_date + INTERVAL '1 day')
          AND (p_user_id IS NULL OR e.user_id = p_user_id)
          AND (p_status IS NULL OR e.status = p_status)
          AND (p_review_status IS NULL OR rr.review_status = p_review_status)
    )
    SELECT COALESCE(jsonb_agg(row_to_json(raw_data)), '[]'::jsonb)
    INTO v_results
    FROM raw_data;

    RETURN v_results;
END;
$$;
