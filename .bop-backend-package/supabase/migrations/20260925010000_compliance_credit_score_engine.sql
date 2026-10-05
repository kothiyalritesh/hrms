-- Migration: Employee Compliance & Credit Score Engine (Module 7)
-- Description: Tracking and deducting employee credit scores based on HR rejection of geofence violations.

-- 1. Configuration Table for Deductions
CREATE TABLE IF NOT EXISTS public.compliance_score_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    violation_type text NOT NULL UNIQUE,
    default_deduction_amount int NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.compliance_score_config (violation_type, default_deduction_amount, description)
VALUES ('GEOFENCE_VIOLATION_REJECTED', 5, 'Deduction for an unapproved geofence exit during work hours')
ON CONFLICT (violation_type) DO NOTHING;

-- 2. Employee Monthly Compliance Scores
CREATE TABLE IF NOT EXISTS public.employee_compliance_scores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    score_month date NOT NULL, -- Stored as the 1st of the month (e.g. 2026-09-01)
    current_score int NOT NULL DEFAULT 100,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, score_month)
);
ALTER TABLE public.employee_compliance_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can see own score" ON public.employee_compliance_scores FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "HR can see all scores" ON public.employee_compliance_scores FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD'))));


-- 3. Deduction Ledger
CREATE TABLE IF NOT EXISTS public.compliance_score_deductions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    score_month date NOT NULL,
    deduction_amount int NOT NULL,
    reason text NOT NULL,
    source_table text,
    source_id uuid,
    deducted_by uuid REFERENCES public.profiles(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.compliance_score_deductions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can see own deductions" ON public.compliance_score_deductions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "HR can see all deductions" ON public.compliance_score_deductions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD'))));

-- 4. RPC to submit a reason for geofence violation
CREATE OR REPLACE FUNCTION public.submit_geofence_reason(
    p_geofence_event_id uuid,
    p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_event public.geofence_events%rowtype;
    v_reason_id uuid;
BEGIN
    SELECT * INTO v_event FROM public.geofence_events WHERE id = p_geofence_event_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Event not found');
    END IF;
    IF v_event.user_id != v_uid THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;
    
    INSERT INTO public.geofence_reasons (geofence_event_id, submitted_by, reason)
    VALUES (p_geofence_event_id, v_uid, p_reason)
    RETURNING id INTO v_reason_id;
    
    RETURN jsonb_build_object('success', true, 'reason_id', v_reason_id);
END $$;

-- 5. RPC to review reason and automatically deduct score if rejected
CREATE OR REPLACE FUNCTION public.resolve_geofence_violation(
    p_geofence_reason_id uuid,
    p_status text, -- 'ACCEPTED', 'REJECTED', 'WAIVED'
    p_comment text,
    p_deduction_override int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_reason public.geofence_reasons%rowtype;
    v_event public.geofence_events%rowtype;
    v_month_start date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
    v_deduction int;
BEGIN
    -- Authorization check (simplified for HR roles)
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: HR access required');
    END IF;

    SELECT * INTO v_reason FROM public.geofence_reasons WHERE id = p_geofence_reason_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Reason not found'); END IF;
    
    SELECT * INTO v_event FROM public.geofence_events WHERE id = v_reason.geofence_event_id;

    -- Insert Review
    INSERT INTO public.geofence_reason_reviews (geofence_reason_id, reviewed_by, review_status, review_comment)
    VALUES (p_geofence_reason_id, v_uid, p_status, p_comment);
    
    -- If rejected, deduct credit score
    IF p_status = 'REJECTED' THEN
        -- Get default deduction
        IF p_deduction_override IS NOT NULL THEN
            v_deduction := p_deduction_override;
        ELSE
            SELECT default_deduction_amount INTO v_deduction FROM public.compliance_score_config WHERE violation_type = 'GEOFENCE_VIOLATION_REJECTED';
            IF v_deduction IS NULL THEN v_deduction := 5; END IF;
        END IF;

        -- Ensure user has a score record for this month
        INSERT INTO public.employee_compliance_scores (user_id, score_month, current_score)
        VALUES (v_event.user_id, v_month_start, 100)
        ON CONFLICT (user_id, score_month) DO NOTHING;
        
        -- Deduct
        UPDATE public.employee_compliance_scores
        SET current_score = current_score - v_deduction,
            updated_at = now()
        WHERE user_id = v_event.user_id AND score_month = v_month_start;
        
        -- Ledger
        INSERT INTO public.compliance_score_deductions (user_id, score_month, deduction_amount, reason, source_table, source_id, deducted_by)
        VALUES (v_event.user_id, v_month_start, v_deduction, 'Geofence violation reason rejected', 'geofence_events', v_event.id, v_uid);
    END IF;
    
    RETURN jsonb_build_object('success', true);
END $$;

-- 6. Trigger to automatically close the event
CREATE OR REPLACE FUNCTION public.trg_close_geofence_event_on_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.geofence_events
    SET status = 'CLOSED'
    WHERE id = (SELECT geofence_event_id FROM public.geofence_reasons WHERE id = NEW.geofence_reason_id);
    RETURN NEW;
END $$;

CREATE TRIGGER close_geofence_event_on_review_trg
AFTER INSERT ON public.geofence_reason_reviews
FOR EACH ROW EXECUTE FUNCTION public.trg_close_geofence_event_on_review();
