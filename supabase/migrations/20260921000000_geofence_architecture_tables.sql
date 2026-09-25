-- ======================================================================================
-- HRMS Location Tracking, Geofencing & Field Visit Monitoring - v4.1 FROZEN
-- ======================================================================================

-- 1. TRACKING STATE (Active Mode Authority)
CREATE TABLE IF NOT EXISTS public.tracking_state (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     uuid NOT NULL REFERENCES public.profiles(id),
    attendance_id               uuid NOT NULL REFERENCES public.attendance_logs(id),
    tracking_mode               text NOT NULL CHECK (tracking_mode IN ('ATTENDANCE_NORMAL', 'ATTENDANCE_FIELD_VISIT', 'CHECKED_OUT')),
    office_id                   uuid REFERENCES public.offices(id),
    field_visit_id              uuid,
    state                       text NOT NULL,
    started_at                  timestamptz NOT NULL DEFAULT now(),
    ended_at                    timestamptz,
    last_location_at            timestamptz,
    last_geofence_evaluation_at timestamptz,
    version                     int NOT NULL DEFAULT 0,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, attendance_id)
);

-- Ensure only one active tracking state per user
CREATE UNIQUE INDEX IF NOT EXISTS tracking_state_one_active
    ON public.tracking_state(user_id) WHERE ended_at IS NULL;

ALTER TABLE public.tracking_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tracking state visible to owner and HR" ON public.tracking_state
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD'))));


-- 2. GEOFENCE EVENTS (Boundary Event Ledger)
CREATE TABLE IF NOT EXISTS public.geofence_events (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_event_id       uuid NOT NULL UNIQUE,
    violation_cycle_id    uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES public.profiles(id),
    attendance_id         uuid NOT NULL REFERENCES public.attendance_logs(id),
    geofence_type         text NOT NULL CHECK (geofence_type IN ('OFFICE','FIELD_VISIT')),
    geofence_id           uuid NOT NULL,  -- logically links to offices.id or field_visits.id
    event_type            text NOT NULL CHECK (event_type IN ('OFFICE_EXIT','OFFICE_RETURN','FIELD_EXIT','FIELD_RETURN')),
    
    -- Evidence (from mobile)
    latitude              numeric(10,7) NOT NULL,
    longitude             numeric(10,7) NOT NULL,
    accuracy_m            numeric,
    accuracy_class        text NOT NULL CHECK (accuracy_class IN ('GOOD','UNCERTAIN','INVALID')),
    
    -- Authoritative (from PostGIS)
    calculated_distance_m numeric,
    
    -- Source traceability
    event_source          text NOT NULL CHECK (event_source IN ('OS_GEOFENCE','BACKGROUND_LOCATION','FOREGROUND_LOCATION','SERVER_REEVALUATION','MANUAL_RECONCILIATION')),
    
    -- Three-tier timestamps
    detected_at           timestamptz NOT NULL,
    received_at           timestamptz NOT NULL DEFAULT now(),
    processed_at          timestamptz,
    notification_sent_at  timestamptz,
    
    -- Lifecycle
    status                text NOT NULL DEFAULT 'POTENTIAL_EXIT' CHECK (status IN ('POTENTIAL_EXIT','CONFIRMED_EXIT','NOTIFICATION_SENT','PENDING_REASON','REASON_SUBMITTED','RETURNED_INSIDE','CLOSED')),
    
    -- Idempotency constraint
    UNIQUE(attendance_id, geofence_type, geofence_id, violation_cycle_id)
);

-- One active cycle per attendance/geofence
CREATE UNIQUE INDEX IF NOT EXISTS geofence_events_one_active_cycle
    ON public.geofence_events(attendance_id, geofence_type, geofence_id)
    WHERE status NOT IN ('RETURNED_INSIDE','CLOSED');

ALTER TABLE public.geofence_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees can see their own events" ON public.geofence_events FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "HR can see all events" ON public.geofence_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD'))));


-- 3. GEOFENCE REASONS (Immutable Employee Submission)
CREATE TABLE IF NOT EXISTS public.geofence_reasons (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_event_id uuid NOT NULL REFERENCES public.geofence_events(id),
    submitted_by      uuid NOT NULL REFERENCES public.profiles(id),
    reason            text NOT NULL,
    submitted_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.geofence_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees can see their own reasons" ON public.geofence_reasons FOR SELECT TO authenticated USING (submitted_by = auth.uid());
CREATE POLICY "Employees can insert own reasons" ON public.geofence_reasons FOR INSERT TO authenticated WITH CHECK (submitted_by = auth.uid());
CREATE POLICY "HR can see all reasons" ON public.geofence_reasons FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD'))));


-- 4. GEOFENCE REASON REVIEWS (Mutable Manager Review Audit)
CREATE TABLE IF NOT EXISTS public.geofence_reason_reviews (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_reason_id uuid NOT NULL REFERENCES public.geofence_reasons(id),
    reviewed_by        uuid NOT NULL REFERENCES public.profiles(id),
    review_status      text NOT NULL CHECK (review_status IN ('ACCEPTED','REJECTED','WAIVED')),
    review_comment     text,
    reviewed_at        timestamptz NOT NULL DEFAULT now(),
    created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.geofence_reason_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees can see own reviews" ON public.geofence_reason_reviews FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.geofence_reasons r WHERE r.id = geofence_reason_id AND r.submitted_by = auth.uid())
);
CREATE POLICY "HR can manage reviews" ON public.geofence_reason_reviews FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')))
);


-- 5. LOCATION EVENT REJECTIONS (Rejected/Replayed Audit)
CREATE TABLE IF NOT EXISTS public.location_event_rejections (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_event_id  uuid,
    user_id          uuid,
    rejection_reason text NOT NULL,
    payload_hash     text,
    raw_payload      jsonb,
    received_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.location_event_rejections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "HR can see rejections" ON public.location_event_rejections FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')))
);


-- 6. NOTIFICATION OUTBOX (Decoupled Push Delivery)
CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_event_id uuid REFERENCES public.geofence_events(id),
    recipient_user_id uuid NOT NULL REFERENCES public.profiles(id),
    notification_type text NOT NULL,
    payload           jsonb NOT NULL,
    status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
    attempts          int NOT NULL DEFAULT 0,
    last_attempted_at timestamptz,
    sent_at           timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
-- No client access needed, Edge Function uses service role