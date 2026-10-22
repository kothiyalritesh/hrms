-- =============================================================================
-- 20261008105000_compliance_and_geofence_tables.sql
--
-- Prerequisite for 20261008110000 / 20261008120000.
-- Production never received 20260925010000 (compliance score) and possibly
-- not 20260921000000 (geofence ledger). This creates only the tables they need
-- (no old functions). Safe to run when the tables already exist.
-- =============================================================================

-- ─── Compliance score ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compliance_score_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_type text NOT NULL UNIQUE,
  default_deduction_amount int NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.compliance_score_config (violation_type, default_deduction_amount, description)
VALUES ('GEOFENCE_VIOLATION_REJECTED', 5, 'Deduction when a reason for leaving the office is rejected')
ON CONFLICT (violation_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.employee_compliance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  score_month date NOT NULL,
  current_score int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, score_month)
);

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
CREATE INDEX IF NOT EXISTS compliance_score_deductions_user_month
  ON public.compliance_score_deductions (user_id, score_month);
CREATE INDEX IF NOT EXISTS compliance_score_deductions_source
  ON public.compliance_score_deductions (source_table, source_id);

ALTER TABLE public.compliance_score_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_compliance_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_score_deductions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.compliance_score_config,
  public.employee_compliance_scores, public.compliance_score_deductions FROM anon, authenticated;
GRANT SELECT ON public.compliance_score_config, public.employee_compliance_scores,
  public.compliance_score_deductions TO authenticated;

DROP POLICY IF EXISTS compliance_config_read ON public.compliance_score_config;
CREATE POLICY compliance_config_read ON public.compliance_score_config
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS compliance_scores_read ON public.employee_compliance_scores;
CREATE POLICY compliance_scores_read ON public.employee_compliance_scores
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_profile_admin() OR public.can_access_user_data(user_id, 'employees.view'));
DROP POLICY IF EXISTS compliance_deductions_read ON public.compliance_score_deductions;
CREATE POLICY compliance_deductions_read ON public.compliance_score_deductions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_profile_admin() OR public.can_access_user_data(user_id, 'employees.view'));

-- ─── Geofence ledger (office exits) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geofence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id uuid NOT NULL UNIQUE,
  violation_cycle_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  attendance_id uuid NOT NULL REFERENCES public.attendance_logs(id),
  geofence_type text NOT NULL CHECK (geofence_type IN ('OFFICE', 'FIELD_VISIT')),
  geofence_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('OFFICE_EXIT', 'OFFICE_RETURN', 'FIELD_EXIT', 'FIELD_RETURN')),
  latitude numeric(10,7) NOT NULL,
  longitude numeric(10,7) NOT NULL,
  accuracy_m numeric,
  accuracy_class text NOT NULL CHECK (accuracy_class IN ('GOOD', 'UNCERTAIN', 'INVALID')),
  calculated_distance_m numeric,
  event_source text NOT NULL CHECK (event_source IN ('OS_GEOFENCE', 'BACKGROUND_LOCATION', 'FOREGROUND_LOCATION', 'SERVER_REEVALUATION', 'MANUAL_RECONCILIATION')),
  detected_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  notification_sent_at timestamptz,
  status text NOT NULL DEFAULT 'POTENTIAL_EXIT' CHECK (status IN ('POTENTIAL_EXIT', 'CONFIRMED_EXIT', 'NOTIFICATION_SENT', 'PENDING_REASON', 'REASON_SUBMITTED', 'RETURNED_INSIDE', 'CLOSED')),
  UNIQUE (attendance_id, geofence_type, geofence_id, violation_cycle_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS geofence_events_one_active_cycle
  ON public.geofence_events (attendance_id, geofence_type, geofence_id)
  WHERE status NOT IN ('RETURNED_INSIDE', 'CLOSED');
CREATE INDEX IF NOT EXISTS geofence_events_user_status ON public.geofence_events (user_id, status);

CREATE TABLE IF NOT EXISTS public.geofence_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geofence_event_id uuid NOT NULL REFERENCES public.geofence_events(id),
  submitted_by uuid NOT NULL REFERENCES public.profiles(id),
  reason text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.geofence_reason_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geofence_reason_id uuid NOT NULL REFERENCES public.geofence_reasons(id),
  reviewed_by uuid NOT NULL REFERENCES public.profiles(id),
  review_status text NOT NULL CHECK (review_status IN ('ACCEPTED', 'REJECTED', 'WAIVED')),
  review_comment text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.geofence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofence_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofence_reason_reviews ENABLE ROW LEVEL SECURITY;
-- All writes go through SECURITY DEFINER functions.
REVOKE INSERT, UPDATE, DELETE ON public.geofence_events, public.geofence_reasons,
  public.geofence_reason_reviews FROM anon, authenticated;
GRANT SELECT ON public.geofence_events, public.geofence_reasons, public.geofence_reason_reviews TO authenticated;

DROP POLICY IF EXISTS geofence_events_scoped_read ON public.geofence_events;
CREATE POLICY geofence_events_scoped_read ON public.geofence_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_profile_admin() OR public.can_access_user_data(user_id, 'live_tracking.view'));
DROP POLICY IF EXISTS geofence_reasons_scoped_read ON public.geofence_reasons;
CREATE POLICY geofence_reasons_scoped_read ON public.geofence_reasons
  FOR SELECT TO authenticated
  USING (submitted_by = auth.uid() OR public.is_profile_admin() OR public.can_access_user_data(submitted_by, 'live_tracking.view'));
DROP POLICY IF EXISTS geofence_reviews_scoped_read ON public.geofence_reason_reviews;
CREATE POLICY geofence_reviews_scoped_read ON public.geofence_reason_reviews
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.geofence_reasons r WHERE r.id = geofence_reason_id
                 AND (r.submitted_by = auth.uid() OR public.is_profile_admin()
                      OR public.can_access_user_data(r.submitted_by, 'live_tracking.view'))));

NOTIFY pgrst, 'reload schema';

-- Check:
-- SELECT to_regclass('public.compliance_score_config') IS NOT NULL AS compliance,
--        to_regclass('public.geofence_events') IS NOT NULL AS geofence;   -- true, true
