-- =============================================================================
-- Migration: 20260912000000_field_visit_timestamp_utc_migration.sql
-- Purpose  : Convert field_visits timestamp columns from TIMESTAMP WITHOUT
--            TIME ZONE (legacy UTC-naive) to TIMESTAMPTZ.
--
-- Root cause of the original error:
--   v_attendance_daily_canonical references field_visits.checkin_time via
--   hrms_timestamp(). PostgreSQL blocks ALTER COLUMN TYPE when any view
--   depends on that column. This migration drops the view, converts the
--   columns, then recreates the view identically.
--
-- SAFETY CONTRACT
--   • Single transaction — any failure rolls back everything.
--   • Snapshots every affected row before touching data.
--   • Verifies the invariant (instant unchanged) before committing.
--   • Audit table _mig_fv_ts_audit is left in place for post-deploy checks.
--
-- PREREQUISITE — run this manually first and confirm delta_sec ≈ 0:
--   SELECT id, checkin_time, created_at,
--     EXTRACT(EPOCH FROM (created_at - checkin_time::timestamptz)) AS delta_sec
--   FROM field_visits WHERE checkin_time IS NOT NULL
--   ORDER BY created_at DESC LIMIT 50;
--   If delta_sec ≈ 19800 the values are IST-naive — change 'UTC' to
--   'Asia/Kolkata' in the two USING clauses in STEP 3 below.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- STEP 1 — Snapshot every affected row BEFORE any conversion
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public._mig_fv_ts_audit;
CREATE TABLE public._mig_fv_ts_audit (
  id                     uuid        NOT NULL,
  date                   date,
  checkin_time_raw       text,
  checkout_time_raw      text,
  expected_checkin_ist   text,
  expected_checkout_ist  text,
  snapshotted_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public._mig_fv_ts_audit (
  id, date,
  checkin_time_raw,
  checkout_time_raw,
  expected_checkin_ist,
  expected_checkout_ist
)
SELECT
  fv.id,
  fv.date,
  fv.checkin_time::text,
  fv.checkout_time::text,
  to_char(
    fv.checkin_time,
    'YYYY-MM-DD HH12:MI:SS AM'
  ),
  to_char(
    fv.checkout_time,
    'YYYY-MM-DD HH12:MI:SS AM'
  )
FROM public.field_visits fv
WHERE fv.checkin_time IS NOT NULL
   OR fv.checkout_time IS NOT NULL;

-- ---------------------------------------------------------------------------
-- STEP 2 — Drop the full dependency chain via CASCADE
--          This drops all dependent views and functions automatically.
-- ---------------------------------------------------------------------------

-- The primary blocking view. CASCADE automatically drops v_attendance_daily_enterprise,
-- v_attendance_daily_enterprise_v5, and all the RPC functions that return them.
DROP VIEW IF EXISTS public.v_attendance_daily_canonical CASCADE;

-- Legacy views that directly reference field_visits timestamp columns.
DROP VIEW IF EXISTS public.employee_live_status CASCADE;
DROP VIEW IF EXISTS public.v_field_visit_summary CASCADE;
DROP VIEW IF EXISTS public.v_live_attendance CASCADE;
DROP VIEW IF EXISTS public.v_admin_daily_log CASCADE;
DROP VIEW IF EXISTS public.attendance_reconciliation CASCADE;
DROP VIEW IF EXISTS public.attendance_reconciliation_v2 CASCADE;

-- Drop trigger that explicitly depends on checkin_time
DROP TRIGGER IF EXISTS field_visits_business_date_trg ON public.field_visits;


-- ---------------------------------------------------------------------------
-- STEP 3 — Convert the columns
--          USING clause treats the existing naive value as UTC wall-clock.
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_visits
  ALTER COLUMN checkin_time  TYPE TIMESTAMPTZ
    USING checkin_time  AT TIME ZONE 'Asia/Kolkata',
  ALTER COLUMN checkout_time TYPE TIMESTAMPTZ
    USING checkout_time AT TIME ZONE 'Asia/Kolkata';

-- Recreate trigger that was dropped to allow the alter column
CREATE TRIGGER field_visits_business_date_trg
BEFORE INSERT OR UPDATE OF checkin_time ON public.field_visits
FOR EACH ROW EXECUTE FUNCTION public.set_field_visit_business_date();

-- Convert optional event columns if they exist and are still naive
DO $$
DECLARE
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY[
    'arrived_at','departed_at','tracking_started_at',
    'approach_1km_notified_at','approach_500m_notified_at','last_distance_at'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'field_visits'
        AND column_name = v_col
        AND data_type   = 'timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.field_visits ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''Asia/Kolkata''',
        v_col, v_col
      );
      RAISE NOTICE 'Converted field_visits.% to TIMESTAMPTZ', v_col;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 4 — Invariant verification
--          Rolls back the entire transaction if any row mismatches.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mismatch  INT;
  v_null_loss INT;
  v_total     INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public._mig_fv_ts_audit;
  RAISE NOTICE 'Audit snapshot: % rows', v_total;

  -- No row should have lost a checkin_time that previously existed
  SELECT COUNT(*) INTO v_null_loss
  FROM public._mig_fv_ts_audit a
  JOIN public.field_visits fv ON fv.id = a.id
  WHERE a.checkin_time_raw IS NOT NULL AND fv.checkin_time IS NULL;

  IF v_null_loss > 0 THEN
    RAISE EXCEPTION
      'MIGRATION_INVARIANT_FAILED: % rows lost checkin_time during conversion',
      v_null_loss;
  END IF;

  -- IST display must exactly match pre-computed expectation
  SELECT COUNT(*) INTO v_mismatch
  FROM public._mig_fv_ts_audit a
  JOIN public.field_visits fv ON fv.id = a.id
  WHERE fv.checkin_time IS NOT NULL
    AND a.expected_checkin_ist IS NOT NULL
    AND to_char(fv.checkin_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH12:MI:SS AM') != a.expected_checkin_ist;

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION
      'MIGRATION_INVARIANT_FAILED: % checkin_time rows mismatched. Rolled back.',
      v_mismatch;
  END IF;

  SELECT COUNT(*) INTO v_mismatch
  FROM public._mig_fv_ts_audit a
  JOIN public.field_visits fv ON fv.id = a.id
  WHERE fv.checkout_time IS NOT NULL
    AND a.expected_checkout_ist IS NOT NULL
    AND to_char(fv.checkout_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH12:MI:SS AM') != a.expected_checkout_ist;

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION
      'MIGRATION_INVARIANT_FAILED: % checkout_time rows mismatched. Rolled back.',
      v_mismatch;
  END IF;


  RAISE NOTICE 'Invariant check PASSED: all % rows converted correctly', v_total;
END $$;


-- ---------------------------------------------------------------------------
-- STEP 5 — Recreate v_attendance_daily_canonical
--          Exact copy from migration 20260806010000. The view body is
--          unchanged — hrms_timestamp() already handles both TIMESTAMPTZ
--          (passthrough) and TIMESTAMP WITHOUT TIME ZONE (IST conversion),
--          so no logic change is needed inside the view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_attendance_daily_canonical
WITH (security_invoker=true) AS
WITH employee_days AS (
  SELECT p.id user_id, day::date work_date, p.name employee_name, p.employee_number,
    p.office_id, o.name office_name, p.team_id, COALESCE(t.name,p.team) team_name,
    p.reports_to team_head_id, manager.name team_head_name, p.role, p.show_on_tv,
    p.joining_date, p.is_active
  FROM public.profiles p
  LEFT JOIN public.offices o ON o.id=p.office_id
  LEFT JOIN public.teams t ON t.id=p.team_id
  LEFT JOIN public.profiles manager ON manager.id=p.reports_to
  CROSS JOIN LATERAL generate_series(
    greatest(COALESCE(p.joining_date,(p.created_at AT TIME ZONE 'Asia/Kolkata')::date), date '2020-01-01'),
    least(COALESCE(p.last_working_date,(now() AT TIME ZONE 'Asia/Kolkata')::date),(now() AT TIME ZONE 'Asia/Kolkata')::date),
    INTERVAL '1 day') day
  WHERE p.attendance_reporting_enabled
    AND (day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR p.is_active)
), evidence AS (
SELECT employee.*,
  attendance.id attendance_log_id,
  COALESCE(attendance.app_checkin_time,
    CASE WHEN upper(COALESCE(attendance.checkin_source,attendance.attendance_type,'')) LIKE 'APP%'
         THEN attendance.checkin_time END) app_first_in,
  COALESCE(attendance.biometric_first_punch,biometric.first_punch) biometric_first_in,
  visit.first_in field_visit_first_in,
  attendance.checkout_time raw_checkout,
  CASE WHEN upper(COALESCE(attendance.checkout_source,''))
         NOT IN ('ADMIN','REGULARIZATION','SYSTEM','BIOMETRIC','FIELD_VISIT')
       THEN attendance.checkout_time END app_checkout,
  regularization.requested_checkout approved_regularization_checkout,
  CASE WHEN regularization.id IS NULL
         AND upper(COALESCE(attendance.checkout_source,''))='ADMIN'
       THEN attendance.checkout_time END admin_corrected_checkout,
  COALESCE(attendance.biometric_last_punch,biometric.last_punch) biometric_last_punch_evidence,
  visit.last_out field_visit_checkout, visit.has_visit, visit.active_id, visit.active_name,
  visit.distance_m,
  policy.late_checkin_time, policy.allow_field_visit_checkout, policy.policy_id,
  calendar.value calendar_value, leave_request.leave_type,
  attendance.warning attendance_warning,
  ping.recorded_at latest_ping_at, ping.accuracy latest_accuracy_m,
  ping.status latest_tracking_status,
  ping.distance_from_base distance_from_office_m,
  session.status tracking_session_status,
  health.reason tracking_health_reason,
  settings.tv_tracking_stale_minutes
FROM employee_days employee
LEFT JOIN LATERAL (
  SELECT a.* FROM public.attendance_logs a
  WHERE a.user_id=employee.user_id AND a.date=employee.work_date
  ORDER BY a.created_at, a.id LIMIT 1) attendance ON true
LEFT JOIN LATERAL (
  SELECT
    min(COALESCE(d.log_date,(d.log_date_only::text||' '||d.log_time::text)::timestamp AT TIME ZONE 'Asia/Kolkata')) first_punch,
    max(COALESCE(d.log_date,(d.log_date_only::text||' '||d.log_time::text)::timestamp AT TIME ZONE 'Asia/Kolkata')) last_punch
  FROM public.smartoffice_device_logs d
  WHERE d.user_id=employee.user_id AND d.log_date_only=employee.work_date) biometric ON true
LEFT JOIN LATERAL (
  SELECT
    min(public.hrms_timestamp(v.checkin_time))  first_in,
    max(public.hrms_timestamp(v.checkout_time)) last_out,
    bool_or(v.checkin_time IS NOT NULL) has_visit,
    (array_agg(v.id ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_id,
    (array_agg(COALESCE(v.project_name,v.location_name)
      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_name,
    (array_agg(v.last_distance_m ORDER BY v.last_distance_at DESC NULLS LAST))[1] distance_m
  FROM public.field_visits v
  WHERE v.user_id=employee.user_id AND v.date=employee.work_date
    AND COALESCE(v.verification_status,'PENDING') <> 'REJECTED') visit ON true
LEFT JOIN LATERAL (
  SELECT r.id, r.requested_checkout
  FROM public.attendance_regularization_requests r
  WHERE r.attendance_id=attendance.id AND r.status='APPROVED'
  ORDER BY r.reviewed_at DESC NULLS LAST, r.created_at DESC LIMIT 1) regularization ON true
LEFT JOIN LATERAL (
  SELECT p.id policy_id, p.late_checkin_time, p.allow_field_visit_checkout
  FROM public.attendance_policies p
  WHERE p.is_active
    AND employee.work_date BETWEEN p.effective_from AND COALESCE(p.effective_to,'infinity'::date)
    AND (p.office_id=employee.office_id OR p.office_id IS NULL)
    AND lower(COALESCE(p.role,'all')) IN (lower(COALESCE(employee.role,'')),'all')
  ORDER BY CASE
    WHEN p.office_id=employee.office_id AND lower(p.role)=lower(COALESCE(employee.role,'')) THEN 1
    WHEN p.office_id=employee.office_id AND lower(COALESCE(p.role,'all'))='all' THEN 2
    WHEN p.office_id IS NULL AND lower(p.role)=lower(COALESCE(employee.role,'')) THEN 3
    ELSE 4 END
  LIMIT 1) policy ON true
LEFT JOIN LATERAL (
  SELECT public.resolve_hrms_calendar_day(employee.user_id,employee.work_date) value) calendar ON true
LEFT JOIN LATERAL (
  SELECT l.leave_type FROM public.leave_requests l
  WHERE l.user_id=employee.user_id AND lower(l.status)='approved'
    AND employee.work_date BETWEEN l.start_date AND l.end_date
  ORDER BY l.created_at LIMIT 1) leave_request ON true
LEFT JOIN LATERAL (
  SELECT l.recorded_at, l.accuracy, l.status, l.distance_from_base
  FROM public.location_tracking l
  WHERE l.user_id=employee.user_id AND l.date=employee.work_date
  ORDER BY l.recorded_at DESC LIMIT 1) ping ON true
LEFT JOIN LATERAL (
  SELECT s.status FROM public.tracking_sessions s
  WHERE s.user_id=employee.user_id AND s.attendance_log_id=attendance.id
  ORDER BY s.created_at DESC LIMIT 1) session ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(j.metadata->>'reason',
    CASE j.event_type
      WHEN 'GPS_OFF'           THEN 'GPS disabled'
      WHEN 'PERMISSION_REVOKED' THEN 'Background permission denied'
      WHEN 'LOCATION_STALE'    THEN 'Last ping is stale'
    END) reason
  FROM public.journey_events j
  WHERE j.user_id=employee.user_id AND j.attendance_log_id=attendance.id
  ORDER BY j.occurred_at DESC LIMIT 1) health ON true
CROSS JOIN public.attendance_runtime_settings settings
), official AS (
SELECT evidence.*,
  least(app_first_in, biometric_first_in, field_visit_first_in) official_first_in,
  CASE
    WHEN approved_regularization_checkout IS NOT NULL THEN approved_regularization_checkout
    WHEN admin_corrected_checkout IS NOT NULL         THEN admin_corrected_checkout
    WHEN app_checkout IS NOT NULL                     THEN app_checkout
    WHEN allow_field_visit_checkout                   THEN field_visit_checkout
  END official_last_out
FROM evidence
)
SELECT
  user_id, work_date, employee_name, employee_number, office_id, office_name,
  team_id, team_name, team_head_id, team_head_name, role,
  app_first_in, biometric_first_in, field_visit_first_in, official_first_in,
  CASE
    WHEN official_first_in IS NULL THEN 'NO_DATA'
    WHEN num_nonnulls(
      CASE WHEN app_first_in=official_first_in         THEN app_first_in END,
      CASE WHEN biometric_first_in=official_first_in   THEN biometric_first_in END,
      CASE WHEN field_visit_first_in=official_first_in THEN field_visit_first_in END
    ) > 1 THEN 'MULTIPLE'
    WHEN app_first_in=official_first_in         THEN 'APP'
    WHEN biometric_first_in=official_first_in   THEN 'BIOMETRIC'
    ELSE 'FIELD_VISIT'
  END first_in_source,
  app_checkout, approved_regularization_checkout, admin_corrected_checkout,
  official_last_out,
  CASE
    WHEN approved_regularization_checkout IS NOT NULL THEN 'REGULARIZATION'
    WHEN admin_corrected_checkout IS NOT NULL         THEN 'ADMIN_CORRECTED'
    WHEN app_checkout IS NOT NULL                     THEN 'APP'
    WHEN allow_field_visit_checkout AND field_visit_checkout IS NOT NULL THEN 'FIELD_VISIT'
    ELSE 'NO_DATA'
  END last_out_source,
  biometric_last_punch_evidence, field_visit_checkout,
  CASE
    WHEN official_first_in IS NULL THEN 'NO_DATA'
    WHEN num_nonnulls(app_first_in,biometric_first_in,field_visit_first_in) > 1 THEN 'MULTIPLE'
    WHEN app_first_in IS NOT NULL         THEN 'APP'
    WHEN biometric_first_in IS NOT NULL   THEN 'BIOMETRIC'
    ELSE 'FIELD_VISIT'
  END presence_source,
  CASE
    WHEN policy_id IS NULL OR office_id IS NULL THEN 'CONFIG_REQUIRED'
    WHEN leave_type IS NOT NULL                 THEN 'ON_LEAVE'
    WHEN calendar_value->>'kind'='HOLIDAY'      THEN 'HOLIDAY'
    WHEN calendar_value->>'kind'='WEEKLY_OFF'   THEN 'WEEKLY_OFF'
    WHEN official_first_in IS NULL              THEN 'ABSENT'
    WHEN official_last_out IS NOT NULL          THEN 'CHECKED_OUT'
    WHEN has_visit                              THEN 'FIELD_VISIT'
    WHEN late_checkin_time IS NOT NULL
      AND (official_first_in AT TIME ZONE 'Asia/Kolkata')::time >= late_checkin_time THEN 'LATE'
    ELSE 'PRESENT'
  END attendance_status,
  COALESCE(
    official_first_in IS NOT NULL
    AND late_checkin_time IS NOT NULL
    AND (official_first_in AT TIME ZONE 'Asia/Kolkata')::time >= late_checkin_time,
    false
  ) is_late,
  CASE
    WHEN official_first_in IS NOT NULL AND official_last_out IS NOT NULL
    THEN greatest(0, floor(EXTRACT(EPOCH FROM (official_last_out - official_first_in)) / 60))::integer
  END working_minutes,
  CASE
    WHEN policy_id IS NULL              THEN 'Attendance policy configuration required'
    WHEN office_id IS NULL              THEN 'Office assignment required'
    WHEN tracking_health_reason IS NOT NULL THEN tracking_health_reason
    WHEN attendance_warning             THEN 'Attendance evidence warning'
    WHEN official_first_in IS NOT NULL AND official_last_out IS NULL THEN 'No checkout'
  END warning,
  COALESCE(has_visit, false) has_field_visit,
  (policy_id IS NOT NULL AND office_id IS NOT NULL) history_verified,
  show_on_tv, latest_ping_at, latest_accuracy_m, latest_tracking_status,
  tracking_health_reason,
  COALESCE(
    latest_ping_at IS NULL
    OR latest_ping_at < now() - make_interval(mins => tv_tracking_stale_minutes),
    true
  ) ping_is_stale,
  active_id active_field_visit_id,
  active_name active_field_visit_name,
  distance_m distance_from_destination_m,
  distance_from_office_m,
  tracking_session_status,
  attendance_log_id
FROM official;

REVOKE ALL ON public.v_attendance_daily_canonical FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP 5b — Recreate rpc_admin_attendance_daily_v3 and rpc_my_attendance_daily_v3
--           (dropped in STEP 2 because they return setof v_attendance_daily_canonical)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_attendance_daily_v3(
  p_start date, p_end date, p_offset integer DEFAULT 0, p_limit integer DEFAULT 500
) RETURNS SETOF public.v_attendance_daily_canonical
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.require_profile_admin();
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 366
    OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset < 0
    OR p_end > (now() AT TIME ZONE 'Asia/Kolkata')::date
  THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_REPORT_RANGE'; END IF;
  RETURN QUERY
    SELECT * FROM public.v_attendance_daily_canonical r
    WHERE r.work_date BETWEEN p_start AND p_end
    ORDER BY r.work_date DESC, r.employee_number NULLS LAST, r.user_id
    OFFSET p_offset LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.rpc_admin_attendance_daily_v3(date,date,integer,integer) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_attendance_daily_v3(date,date,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_my_attendance_daily_v3(p_start date, p_end date)
RETURNS SETOF public.v_attendance_daily_canonical
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM public.v_attendance_daily_canonical r
  WHERE r.user_id = auth.uid() AND r.work_date BETWEEN p_start AND p_end
  ORDER BY r.work_date DESC LIMIT 367;
$$;
REVOKE ALL ON FUNCTION public.rpc_my_attendance_daily_v3(date,date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_my_attendance_daily_v3(date,date) TO authenticated;

-- ---------------------------------------------------------------------------
-- STEP 5c — Recreate v_attendance_daily_enterprise
--           Exact copy from migration 20260817030000.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_attendance_daily_enterprise
WITH (security_invoker = true) AS
WITH historical AS (
  SELECT
    canonical.*,
    assignment.employee_name historical_employee_name,
    assignment.employee_number historical_employee_number,
    assignment.office_id historical_office_id,
    assignment.office_name historical_office_name,
    assignment.team historical_team_name,
    assignment.reports_to historical_team_head_id,
    assignment.manager_name historical_team_head_name,
    assignment.role historical_role,
    COALESCE(assignment.verified, false) assignment_verified,
    resolved_team.id historical_team_id,
    policy.late_checkin_time historical_late_checkin_time,
    COALESCE(policy.verified, false) policy_verified,
    public.resolve_hrms_calendar_day_at_assignment(
      canonical.user_id, assignment.office_id, resolved_team.id, canonical.work_date
    ) calendar_value,
    leave_request.leave_type,
    fraud.severity fraud_severity,
    fraud.score fraud_score,
    fraud.reasons fraud_reasons
  FROM public.v_attendance_daily_canonical canonical
  LEFT JOIN LATERAL (
    SELECT history.*
    FROM public.employee_assignment_history history
    WHERE history.profile_id = canonical.user_id
      AND canonical.work_date >= history.effective_from
      AND (history.effective_to IS NULL OR canonical.work_date <= history.effective_to)
    ORDER BY history.verified DESC, history.effective_from DESC,
      history.recorded_at DESC, history.id
    LIMIT 1
  ) assignment ON true
  LEFT JOIN public.teams resolved_team
    ON lower(btrim(resolved_team.name)) = lower(btrim(assignment.team))
  LEFT JOIN LATERAL (
    SELECT history.late_checkin_time, history.verified
    FROM public.attendance_policy_history history
    WHERE history.office_id = assignment.office_id
      AND lower(history.role) IN (lower(COALESCE(assignment.role,'')), 'all')
      AND canonical.work_date >= history.effective_from
      AND (history.effective_to IS NULL OR canonical.work_date <= history.effective_to)
    ORDER BY
      CASE WHEN lower(history.role) = lower(COALESCE(assignment.role,'')) THEN 0 ELSE 1 END,
      history.verified DESC, history.effective_from DESC, history.id
    LIMIT 1
  ) policy ON true
  LEFT JOIN LATERAL (
    SELECT request.leave_type
    FROM public.leave_requests request
    WHERE request.user_id = canonical.user_id
      AND lower(request.status) = 'approved'
      AND canonical.work_date BETWEEN request.start_date AND request.end_date
    ORDER BY request.created_at, request.id
    LIMIT 1
  ) leave_request ON true
  LEFT JOIN LATERAL (
    SELECT event.severity, event.score, event.reasons
    FROM public.attendance_fraud_events event
    WHERE event.attendance_id = canonical.attendance_log_id
    ORDER BY event.created_at DESC, event.id
    LIMIT 1
  ) fraud ON true
), classified AS (
  SELECT historical.*,
    historical.assignment_verified AND historical.policy_verified
      AND historical.historical_office_id IS NOT NULL AS enterprise_history_verified,
    CASE
      WHEN NOT historical.assignment_verified THEN 'ASSIGNMENT_HISTORY_NOT_VERIFIED'
      WHEN historical.historical_office_id IS NULL THEN 'HISTORICAL_OFFICE_NOT_ASSIGNED'
      WHEN NOT historical.policy_verified THEN 'POLICY_HISTORY_NOT_VERIFIED'
      ELSE NULL
    END configuration_issue
  FROM historical
)
SELECT
  attendance_log_id, user_id, work_date,
  COALESCE(historical_employee_name, employee_name) employee_name,
  COALESCE(historical_employee_number, employee_number) employee_number,
  historical_office_id office_id, historical_office_name office_name,
  historical_team_id team_id, historical_team_name team_name,
  historical_team_head_id team_head_id, historical_team_head_name team_head_name,
  historical_role role,
  app_first_in, biometric_first_in, field_visit_first_in, official_first_in, first_in_source,
  app_checkout, approved_regularization_checkout, admin_corrected_checkout,
  official_last_out, last_out_source, biometric_last_punch_evidence, field_visit_checkout,
  presence_source,
  CASE
    WHEN NOT enterprise_history_verified THEN 'CONFIG_REQUIRED'
    WHEN leave_type IS NOT NULL THEN 'ON_LEAVE'
    WHEN calendar_value->>'kind' = 'HOLIDAY' THEN 'HOLIDAY'
    WHEN calendar_value->>'kind' = 'WEEKLY_OFF' THEN 'WEEKLY_OFF'
    WHEN official_first_in IS NULL THEN 'ABSENT'
    WHEN official_last_out IS NOT NULL THEN 'CHECKED_OUT'
    WHEN has_field_visit THEN 'FIELD_VISIT'
    WHEN historical_late_checkin_time IS NOT NULL
      AND (official_first_in AT TIME ZONE 'Asia/Kolkata')::time >= historical_late_checkin_time THEN 'LATE'
    ELSE 'PRESENT'
  END attendance_status,
  enterprise_history_verified
    AND official_first_in IS NOT NULL
    AND historical_late_checkin_time IS NOT NULL
    AND (official_first_in AT TIME ZONE 'Asia/Kolkata')::time >= historical_late_checkin_time AS is_late,
  working_minutes,
  CASE
    WHEN configuration_issue IS NOT NULL THEN configuration_issue
    WHEN tracking_health_reason IS NOT NULL THEN tracking_health_reason
    WHEN warning IS NOT NULL THEN warning::text
    WHEN official_first_in IS NOT NULL AND official_last_out IS NULL THEN 'No checkout'
    ELSE NULL
  END warning,
  has_field_visit, enterprise_history_verified history_verified, show_on_tv,
  latest_ping_at, latest_accuracy_m, latest_tracking_status, tracking_health_reason,
  ping_is_stale, active_field_visit_id, active_field_visit_name,
  distance_from_destination_m, distance_from_office_m, tracking_session_status,
  fraud_severity, fraud_score, fraud_reasons, configuration_issue
FROM classified;

REVOKE ALL ON public.v_attendance_daily_enterprise FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_admin_attendance_report_v4(
  p_start date, p_end date,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 500,
  p_office_names text[] DEFAULT NULL, p_team_names text[] DEFAULT NULL,
  p_head_names text[] DEFAULT NULL, p_roles text[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL, p_sources text[] DEFAULT NULL,
  p_search text DEFAULT NULL, p_exceptions_only boolean DEFAULT false
) RETURNS SETOF public.v_attendance_daily_enterprise
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.require_profile_admin();
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start
    OR p_end > (now() AT TIME ZONE 'Asia/Kolkata')::date
    OR p_end - p_start > 366 OR p_offset < 0 OR p_limit < 1 OR p_limit > 1000
  THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_REPORT_RANGE'; END IF;
  RETURN QUERY
  SELECT report.* FROM public.v_attendance_daily_enterprise report
  WHERE report.work_date BETWEEN p_start AND p_end
    AND (COALESCE(cardinality(p_office_names),0)=0 OR regexp_replace(lower(btrim(report.office_name)),'\\s+office$','') = ANY(SELECT regexp_replace(lower(btrim(value)),'\\s+office$','') FROM unnest(p_office_names) value))
    AND (COALESCE(cardinality(p_team_names),0)=0 OR regexp_replace(lower(btrim(report.team_name)),'\\s+team$','') = ANY(SELECT regexp_replace(lower(btrim(value)),'\\s+team$','') FROM unnest(p_team_names) value))
    AND (COALESCE(cardinality(p_head_names),0)=0 OR lower(btrim(report.team_head_name)) = ANY(SELECT lower(btrim(value)) FROM unnest(p_head_names) value))
    AND (COALESCE(cardinality(p_roles),0)=0 OR replace(upper(btrim(report.role)),'_',' ') = ANY(SELECT replace(upper(btrim(value)),'_',' ') FROM unnest(p_roles) value))
    AND (COALESCE(cardinality(p_sources),0)=0 OR upper(report.presence_source) = ANY(SELECT upper(btrim(value)) FROM unnest(p_sources) value))
    AND (nullif(btrim(p_search),'') IS NULL OR report.employee_name ILIKE '%'||btrim(p_search)||'%' OR COALESCE(report.employee_number,'') ILIKE '%'||btrim(p_search)||'%')
    AND (COALESCE(cardinality(p_statuses),0)=0 OR EXISTS(SELECT 1 FROM unnest(p_statuses) requested(value) WHERE (upper(btrim(requested.value))=upper(report.attendance_status)) OR (upper(btrim(requested.value))='NO_CHECKOUT' AND report.official_first_in IS NOT NULL AND report.official_last_out IS NULL) OR (upper(btrim(requested.value))='FIELD_VISIT' AND report.has_field_visit) OR (upper(btrim(requested.value))='SUSPICIOUS_GPS' AND (upper(COALESCE(report.fraud_severity,''))='SUSPICIOUS' OR report.tracking_health_reason IS NOT NULL OR report.ping_is_stale))))
    AND (NOT p_exceptions_only OR report.attendance_status IN ('ABSENT','LATE','CONFIG_REQUIRED') OR (report.official_first_in IS NOT NULL AND report.official_last_out IS NULL) OR upper(COALESCE(report.fraud_severity,'')) IN ('WARNING','SUSPICIOUS') OR report.tracking_health_reason IS NOT NULL)
  ORDER BY report.work_date DESC, report.employee_number NULLS LAST, report.user_id
  OFFSET p_offset LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.rpc_admin_attendance_report_v4(date,date,integer,integer,text[],text[],text[],text[],text[],text[],text,boolean) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_attendance_report_v4(date,date,integer,integer,text[],text[],text[],text[],text[],text[],text,boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- STEP 5d — Recreate v_attendance_daily_enterprise_v5 and rpc_admin_attendance_report_v5
--           Exact copy from migration 20260817040000.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_attendance_daily_enterprise_v5
WITH (security_invoker = true) AS
WITH enriched AS (
  SELECT
    report.*,
    public.resolve_hrms_calendar_day_at_assignment(
      report.user_id, report.office_id, report.team_id, report.work_date
    ) calendar_value,
    (
      nullif(btrim(profile.smartoffice_employee_code), '') IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.employee_biometric_mappings mapping
        WHERE mapping.user_id = report.user_id AND mapping.is_active
      )
    ) has_biometric_mapping,
    (
      EXISTS (SELECT 1 FROM public.smartoffice_device_logs device_log WHERE device_log.log_date_only = report.work_date)
      OR EXISTS (SELECT 1 FROM public.biometric_device_punches punch WHERE punch.attendance_date = report.work_date)
    ) biometric_day_covered
  FROM public.v_attendance_daily_enterprise report
  JOIN public.profiles profile ON profile.id = report.user_id
), resolved AS (
  SELECT enriched.*,
    CASE
      WHEN NOT enriched.history_verified THEN 'CONFIG_REQUIRED'
      WHEN enriched.attendance_status = 'ON_LEAVE' THEN 'ON_LEAVE'
      WHEN enriched.official_first_in IS NULL AND enriched.calendar_value->>'kind' = 'HOLIDAY' THEN 'HOLIDAY'
      WHEN enriched.official_first_in IS NULL AND enriched.calendar_value->>'kind' = 'WEEKLY_OFF' THEN 'WEEKLY_OFF'
      WHEN enriched.official_first_in IS NULL AND NOT enriched.biometric_day_covered THEN 'DATA_NOT_SYNCED'
      WHEN enriched.official_first_in IS NULL AND NOT enriched.has_biometric_mapping THEN 'MAPPING_REQUIRED'
      WHEN enriched.official_first_in IS NULL THEN 'ABSENT'
      WHEN enriched.calendar_value->>'kind' = 'HOLIDAY' THEN 'WORKED_HOLIDAY'
      WHEN enriched.calendar_value->>'kind' = 'WEEKLY_OFF' THEN 'WORKED_WEEKLY_OFF'
      WHEN enriched.is_late THEN 'LATE'
      WHEN enriched.has_field_visit THEN 'FIELD_VISIT'
      ELSE 'PRESENT'
    END resolved_attendance_status
  FROM enriched
)
SELECT
  resolved.*,
  CASE
    WHEN resolved.calendar_value->>'kind' IN ('HOLIDAY','WEEKLY_OFF') OR resolved.attendance_status = 'ON_LEAVE' THEN 'NOT_REQUIRED'
    WHEN resolved.biometric_day_covered THEN 'COMPLETE'
    WHEN resolved.official_first_in IS NOT NULL THEN 'PARTIAL_EVIDENCE'
    ELSE 'NOT_SYNCED'
  END source_coverage_status,
  CASE
    WHEN resolved.configuration_issue IS NOT NULL THEN resolved.configuration_issue
    WHEN resolved.resolved_attendance_status = 'DATA_NOT_SYNCED' THEN 'ATTENDANCE_SOURCE_NOT_SYNCED'
    WHEN resolved.resolved_attendance_status = 'MAPPING_REQUIRED' THEN 'BIOMETRIC_MAPPING_REQUIRED'
    ELSE NULL
  END resolution_issue,
  resolved.calendar_value->>'kind' calendar_kind
FROM resolved;

REVOKE ALL ON public.v_attendance_daily_enterprise_v5 FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_admin_attendance_report_v5(
  p_start date, p_end date,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 500,
  p_office_names text[] DEFAULT NULL, p_team_names text[] DEFAULT NULL,
  p_head_names text[] DEFAULT NULL, p_roles text[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL, p_sources text[] DEFAULT NULL,
  p_search text DEFAULT NULL, p_exceptions_only boolean DEFAULT false
) RETURNS SETOF public.v_attendance_daily_enterprise_v5
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.require_profile_admin();
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start
    OR p_end > (now() AT TIME ZONE 'Asia/Kolkata')::date
    OR p_end - p_start > 366 OR p_offset < 0 OR p_limit < 1 OR p_limit > 1000
  THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_REPORT_RANGE'; END IF;
  RETURN QUERY
  SELECT report.* FROM public.v_attendance_daily_enterprise_v5 report
  WHERE report.work_date BETWEEN p_start AND p_end
    AND (COALESCE(cardinality(p_office_names),0)=0 OR regexp_replace(lower(btrim(report.office_name)),'\\s+office$','') = ANY(SELECT regexp_replace(lower(btrim(value)),'\\s+office$','') FROM unnest(p_office_names) value))
    AND (COALESCE(cardinality(p_team_names),0)=0 OR regexp_replace(lower(btrim(report.team_name)),'\\s+team$','') = ANY(SELECT regexp_replace(lower(btrim(value)),'\\s+team$','') FROM unnest(p_team_names) value))
    AND (COALESCE(cardinality(p_head_names),0)=0 OR lower(btrim(report.team_head_name)) = ANY(SELECT lower(btrim(value)) FROM unnest(p_head_names) value))
    AND (COALESCE(cardinality(p_roles),0)=0 OR replace(upper(btrim(report.role)),'_',' ') = ANY(SELECT replace(upper(btrim(value)),'_',' ') FROM unnest(p_roles) value))
    AND (COALESCE(cardinality(p_sources),0)=0 OR upper(report.presence_source) = ANY(SELECT upper(btrim(value)) FROM unnest(p_sources) value))
    AND (nullif(btrim(p_search),'') IS NULL OR report.employee_name ILIKE '%'||btrim(p_search)||'%' OR COALESCE(report.employee_number,'') ILIKE '%'||btrim(p_search)||'%')
    AND (COALESCE(cardinality(p_statuses),0)=0 OR EXISTS(SELECT 1 FROM unnest(p_statuses) requested(value) WHERE upper(btrim(requested.value))=upper(report.resolved_attendance_status) OR (upper(btrim(requested.value))='LATE' AND report.is_late) OR (upper(btrim(requested.value))='PRESENT' AND report.official_first_in IS NOT NULL) OR (upper(btrim(requested.value))='NO_CHECKOUT' AND report.official_first_in IS NOT NULL AND report.official_last_out IS NULL) OR (upper(btrim(requested.value))='FIELD_VISIT' AND report.has_field_visit) OR (upper(btrim(requested.value))='SUSPICIOUS_GPS' AND (upper(COALESCE(report.fraud_severity,''))='SUSPICIOUS' OR report.tracking_health_reason IS NOT NULL OR report.ping_is_stale))))
    AND (NOT p_exceptions_only OR report.resolved_attendance_status IN ('ABSENT','LATE','CONFIG_REQUIRED','DATA_NOT_SYNCED','MAPPING_REQUIRED') OR (report.official_first_in IS NOT NULL AND report.official_last_out IS NULL) OR upper(COALESCE(report.fraud_severity,'')) IN ('WARNING','SUSPICIOUS') OR report.tracking_health_reason IS NOT NULL)
  ORDER BY report.work_date DESC, report.employee_number NULLS LAST, report.user_id
  OFFSET p_offset LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.rpc_admin_attendance_report_v5(date,date,integer,integer,text[],text[],text[],text[],text[],text[],text,boolean) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_attendance_report_v5(date,date,integer,integer,text[],text[],text[],text[],text[],text[],text,boolean) TO authenticated;


-- ---------------------------------------------------------------------------
-- STEP 6 — Rebuild generate_site_visit_report
--          checkin_time / checkout_time are now TIMESTAMPTZ: direct IST
--          conversion, no double-hop, duration arithmetic is correct.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.generate_site_visit_report(date, date);

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
    jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'records_count',v_record_count)
  );

  RETURN QUERY
  SELECT
    p.name,
    p.employee_number,
    p.department,
    COALESCE(off.name, 'Main Office'),
    fv.date,
    to_char(fv.date, 'FMDay'),
    -- TIMESTAMPTZ: direct IST conversion
    COALESCE(to_char(fv.checkin_time  AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), '—'),
    COALESCE(to_char(fv.checkout_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), '—'),
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

-- ---------------------------------------------------------------------------
-- STEP 7 — Rebuild get_site_visit_observer_data
--          Passes TIMESTAMPTZ values through as ISO 8601 with UTC offset.
--          Frontend formatFieldVisitTime() handles IST display.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_site_visit_observer_data(date, uuid, uuid);

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
      fv.checkin_time,   -- TIMESTAMPTZ — ISO 8601 with offset via PostgREST
      fv.checkout_time,  -- TIMESTAMPTZ
      fv.visit_type,
      (fv.destination_coords->>'latitude')::double precision  AS dest_lat,
      (fv.destination_coords->>'longitude')::double precision AS dest_lon,
      COALESCE(fv.client_name,fv.contact_name)   AS client_name,
      COALESCE(fv.client_phone,fv.contact_phone) AS client_phone,
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
    'summary',   COALESCE(v_summary,'{}'::jsonb),
    'employees', COALESCE(v_employees,'[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- STEP 8 — Post-migration verification view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public._mig_fv_ts_verify AS
SELECT
  fv.id,
  fv.date,
  a.checkin_time_raw                                                          AS original_raw,
  fv.checkin_time                                                             AS converted_timestamptz,
  to_char(fv.checkin_time AT TIME ZONE 'Asia/Kolkata','DD Mon YYYY HH12:MI AM') AS ist_display,
  a.expected_checkin_ist                                                      AS expected_ist,
  CASE
    WHEN fv.checkin_time IS NULL THEN 'NULL'
    WHEN to_char(fv.checkin_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH12:MI:SS AM') = a.expected_checkin_ist THEN 'OK'
    ELSE 'MISMATCH'
  END AS status
FROM public.field_visits fv
LEFT JOIN public._mig_fv_ts_audit a ON a.id = fv.id
ORDER BY fv.created_at DESC;

GRANT SELECT ON public._mig_fv_ts_verify TO authenticated;

-- ---------------------------------------------------------------------------
-- STEP 9 — Schema reload and commit
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION (run these manually after applying)
-- =============================================================================
--
-- 1. All rows should show 'OK' or 'NULL', zero 'MISMATCH':
--    SELECT status, COUNT(*) FROM public._mig_fv_ts_verify GROUP BY status;
--
-- 2. Spot-check IST display:
--    SELECT original_raw, ist_display, expected_ist, status
--    FROM public._mig_fv_ts_verify LIMIT 20;
--
-- 3. Confirm column types:
--    SELECT column_name, data_type
--    FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='field_visits'
--      AND column_name IN ('checkin_time','checkout_time')
--    ORDER BY column_name;
--    -- Must show: timestamp with time zone
--
-- 4. Test report RPC (times should be "01:14 PM" style IST):
--    SELECT check_in_time, check_out_time
--    FROM generate_site_visit_report(CURRENT_DATE-7, CURRENT_DATE) LIMIT 5;
--
-- 5. Test observer RPC (checkin_time should have +00:00 offset):
--    SELECT jsonb_pretty(get_site_visit_observer_data(CURRENT_DATE));
--
-- 6. Clean up after you are satisfied:
--    DROP VIEW  IF EXISTS public._mig_fv_ts_verify;
--    DROP TABLE IF EXISTS public._mig_fv_ts_audit;
--
-- =============================================================================
-- ROLLBACK (only if audit table still exists)
-- =============================================================================
--
--    BEGIN;
--    DROP VIEW IF EXISTS public.v_attendance_daily_canonical;
--    ALTER TABLE public.field_visits
--      ALTER COLUMN checkin_time  TYPE TIMESTAMP WITHOUT TIME ZONE
--        USING checkin_time  AT TIME ZONE 'UTC',
--      ALTER COLUMN checkout_time TYPE TIMESTAMP WITHOUT TIME ZONE
--        USING checkout_time AT TIME ZONE 'UTC';
--    -- then re-run CREATE OR REPLACE VIEW v_attendance_daily_canonical
--    -- from migration 20260806010000_canonical_attendance_calendar_tracking.sql
--    COMMIT;
--
-- =============================================================================






