-- ======================================================================================
-- HRMS Location Tracking, Geofencing & Field Visit Monitoring - RPCs
-- ======================================================================================

CREATE OR REPLACE FUNCTION public.rpc_ingest_location_observation(
    p_user_id uuid,
    p_client_event_id uuid,
    p_latitude numeric,
    p_longitude numeric,
    p_accuracy_m numeric,
    p_detected_at timestamptz,
    p_event_source text,
    p_geofence_type text,
    p_geofence_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_attendance_id uuid;
    v_tracking_mode text;
    v_tracking_version int;
    v_ref_lat numeric;
    v_ref_lon numeric;
    v_radius_m numeric;
    v_distance_m numeric;
    v_accuracy_class text;
    v_status text;
    v_active_cycle_id uuid;
    v_is_new_cycle boolean := false;
    v_event_id uuid;
BEGIN
    -- 1. Authenticate caller (allow service_role or matching user)
    IF auth.role() = 'authenticated' AND auth.uid() != p_user_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
    END IF;

    -- 2. Idempotency Check
    IF EXISTS (SELECT 1 FROM public.geofence_events WHERE client_event_id = p_client_event_id) THEN
        RETURN jsonb_build_object('status', 'IDEMPOTENT_OK');
    END IF;

    -- 3. Validate Attendance
    SELECT id INTO v_attendance_id
    FROM public.attendance_logs
    WHERE user_id = p_user_id AND checkout_time IS NULL
    ORDER BY checkin_time DESC LIMIT 1;
    
    IF v_attendance_id IS NULL THEN
        INSERT INTO public.location_event_rejections (client_event_id, user_id, rejection_reason)
        VALUES (p_client_event_id, p_user_id, 'NO_ACTIVE_ATTENDANCE');
        RETURN jsonb_build_object('status', 'REJECTED', 'reason', 'NO_ACTIVE_ATTENDANCE');
    END IF;
    
    -- 4. Timestamp Validation
    IF p_detected_at > now() + interval '5 minutes' THEN
        INSERT INTO public.location_event_rejections (client_event_id, user_id, rejection_reason)
        VALUES (p_client_event_id, p_user_id, 'FUTURE_TIMESTAMP');
        RETURN jsonb_build_object('status', 'REJECTED', 'reason', 'FUTURE_TIMESTAMP');
    END IF;

    -- 5. Classify accuracy
    IF p_accuracy_m <= 100 THEN
        v_accuracy_class := 'GOOD';
    ELSIF p_accuracy_m <= 1000 THEN
        v_accuracy_class := 'UNCERTAIN';
    ELSE
        v_accuracy_class := 'INVALID';
    END IF;

    -- 6. Resolve Tracking State (Optimistic lock setup)
    -- We use FOR UPDATE to serialize ingestions for the same user attendance
    SELECT tracking_mode, version INTO v_tracking_mode, v_tracking_version
    FROM public.tracking_state
    WHERE user_id = p_user_id AND attendance_id = v_attendance_id AND ended_at IS NULL
    FOR UPDATE; 
    
    IF v_tracking_mode IS NULL THEN
        -- Insert a default state if it doesn't exist yet
        INSERT INTO public.tracking_state (user_id, attendance_id, tracking_mode, state)
        VALUES (p_user_id, v_attendance_id, 'ATTENDANCE_NORMAL', 'ACTIVE')
        ON CONFLICT (user_id, attendance_id) DO NOTHING;
        v_tracking_mode := 'ATTENDANCE_NORMAL';
    END IF;

    -- 7. Get Reference Coordinates & Calculate Distance
    IF p_geofence_type = 'OFFICE' THEN
        SELECT latitude, longitude, coalesce(radius_m, 1000) INTO v_ref_lat, v_ref_lon, v_radius_m
        FROM public.offices WHERE id = p_geofence_id;
    ELSIF p_geofence_type = 'FIELD_VISIT' THEN
        SELECT dest_lat, dest_lon, coalesce(allowed_radius_m, 1000) INTO v_ref_lat, v_ref_lon, v_radius_m
        FROM public.field_visits WHERE id = p_geofence_id;
    END IF;

    IF v_ref_lat IS NOT NULL AND v_ref_lon IS NOT NULL THEN
        v_distance_m := ST_DistanceSphere(
            ST_SetSRID(ST_MakePoint(v_ref_lon, v_ref_lat), 4326),
            ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)
        );
    ELSE
        INSERT INTO public.location_event_rejections (client_event_id, user_id, rejection_reason)
        VALUES (p_client_event_id, p_user_id, 'INVALID_GEOFENCE_REFERENCE');
        RETURN jsonb_build_object('status', 'REJECTED', 'reason', 'INVALID_GEOFENCE_REFERENCE');
    END IF;
    
    -- 8. Evaluate State Machine
    -- Find active violation cycle
    SELECT violation_cycle_id, status INTO v_active_cycle_id, v_status
    FROM public.geofence_events
    WHERE attendance_id = v_attendance_id AND geofence_type = p_geofence_type AND geofence_id = p_geofence_id
      AND status NOT IN ('RETURNED_INSIDE', 'CLOSED')
    ORDER BY detected_at DESC LIMIT 1;
    
    IF v_active_cycle_id IS NULL THEN
        -- No active cycle
        IF v_distance_m > v_radius_m THEN
            v_active_cycle_id := gen_random_uuid();
            v_is_new_cycle := true;
            v_status := 'POTENTIAL_EXIT'; -- Always debounce first
        ELSE
            -- Inside geofence, no violation.
            RETURN jsonb_build_object('status', 'INSIDE_OK');
        END IF;
    ELSE
        -- Active cycle exists
        IF v_distance_m <= v_radius_m AND v_accuracy_class = 'GOOD' THEN
            v_status := 'RETURNED_INSIDE';
        ELSIF v_distance_m > v_radius_m AND v_accuracy_class = 'GOOD' AND v_status = 'POTENTIAL_EXIT' THEN
            v_status := 'CONFIRMED_EXIT';
        END IF;
    END IF;

    -- 9. Insert Geofence Event
    IF v_is_new_cycle OR v_status != (SELECT status FROM public.geofence_events WHERE violation_cycle_id = v_active_cycle_id ORDER BY detected_at DESC LIMIT 1) THEN
        INSERT INTO public.geofence_events (
            client_event_id, violation_cycle_id, user_id, attendance_id,
            geofence_type, geofence_id, event_type, latitude, longitude,
            accuracy_m, accuracy_class, calculated_distance_m, event_source,
            detected_at, processed_at, status
        ) VALUES (
            p_client_event_id, v_active_cycle_id, p_user_id, v_attendance_id,
            p_geofence_type, p_geofence_id, 
            CASE WHEN p_geofence_type = 'OFFICE' THEN 'OFFICE_EXIT' ELSE 'FIELD_EXIT' END, 
            p_latitude, p_longitude, p_accuracy_m, v_accuracy_class, v_distance_m,
            p_event_source, p_detected_at, now(), v_status
        ) RETURNING id INTO v_event_id;
        
        -- 11. Notification Outbox
        IF v_status = 'CONFIRMED_EXIT' THEN
            INSERT INTO public.notification_outbox (geofence_event_id, recipient_user_id, notification_type, payload)
            VALUES (
                v_event_id,
                p_user_id,
                'GEOFENCE_VIOLATION_EMPLOYEE',
                jsonb_build_object('distance_m', v_distance_m, 'radius_m', v_radius_m)
            );
        END IF;
    ELSE
        RETURN jsonb_build_object('status', 'STATE_UNCHANGED');
    END IF;

    -- 10. Update tracking state version
    UPDATE public.tracking_state
    SET version = version + 1, updated_at = now()
    WHERE user_id = p_user_id AND attendance_id = v_attendance_id;

    RETURN jsonb_build_object('status', 'SUCCESS', 'new_state', v_status);
END;
$$ ;


-- ======================================================================================
-- rpc_submit_geofence_reason
-- ======================================================================================
CREATE OR REPLACE FUNCTION public.rpc_submit_geofence_reason(
    p_event_id uuid,
    p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    SELECT user_id INTO v_user_id FROM public.geofence_events WHERE id = p_event_id;
    
    IF auth.role() = 'authenticated' AND auth.uid() != v_user_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
    END IF;

    -- Insert immutable reason
    INSERT INTO public.geofence_reasons (geofence_event_id, submitted_by, reason)
    VALUES (p_event_id, v_user_id, p_reason);

    -- Update event state
    UPDATE public.geofence_events
    SET status = 'REASON_SUBMITTED'
    WHERE id = p_event_id AND status = 'PENDING_REASON';

    RETURN jsonb_build_object('status', 'SUCCESS');
END;
$$ ;


-- ======================================================================================
-- rpc_review_geofence_reason
-- ======================================================================================
CREATE OR REPLACE FUNCTION public.rpc_review_geofence_reason(
    p_reason_id uuid,
    p_review_status text,
    p_review_comment text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Simplistic auth check (in real prod, verify team head / HR)
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD'))) THEN
        -- TODO: Check team hierarchy logic for Team Heads
        RAISE EXCEPTION 'UNAUTHORIZED';
    END IF;

    INSERT INTO public.geofence_reason_reviews (geofence_reason_id, reviewed_by, review_status, review_comment)
    VALUES (p_reason_id, auth.uid(), p_review_status, p_review_comment);

    RETURN jsonb_build_object('status', 'SUCCESS');
END;
$$ ;