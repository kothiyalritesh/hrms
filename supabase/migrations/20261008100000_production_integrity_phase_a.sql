-- =============================================================================
-- 20261008100000_production_integrity_phase_a.sql
--
-- Production hardening, phase A (from the 7 Oct 2026 audit, confirmed against
-- production with the read-only checks in docs/HRMS_PRODUCTION_AUDIT_2026-10-07.md).
--
--   1. Security   employees could approve their own leave / regularization and
--                 edit their own attendance through the API; anyone could mint
--                 comp-off; event checkout and evidence purge were open.
--   2. Leave      approvals store 'approved' but attendance matched 'APPROVED':
--                 approved leave showed as Absent.
--   3. Late       late from 10:33:00 IST (business decision 7 Oct 2026).
--   4. Attendance working on a weekly off / holiday shows Present and earns a
--                 comp-off; a biometric punch after 20:00 is the checkout; the
--                 shared view now follows the same checkout rule as the screens;
--                 the day-end job repairs the last 30 days, not only 2.
--   5. Biometric  the Monday-credit trigger read a column that does not exist and
--                 failed every punch insert.
--   6. Location   office staff pings were discarded and their phones told to stop
--                 tracking; site-visit pings now also feed the Site Visit Observer;
--                 office exits are detected server-side (reason + escalation).
--   7. Alerts     tracking health alerts were rejected by a lowercase-only CHECK.
--   8. Grants     expired temporary GLOBAL grants still opened attendance / GPS.
--
-- Run 20261008105000_compliance_and_geofence_tables.sql FIRST.
-- Idempotent. Run once in the Supabase SQL editor. Takes a few seconds.
-- =============================================================================

SET statement_timeout = '10min';

-- ─── 1. SECURITY ─────────────────────────────────────────────────────────────
-- Every legitimate write goes through SECURITY DEFINER RPCs (check-in/out,
-- rpc_submit_leave_request, rpc_review_leave_request, regularization RPCs,
-- biometric sync, day-end job). Direct table writes from the API are removed.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_logs', 'leave_requests', 'leaves',
                           'attendance_regularization_requests', 'on_duty_events'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- Functions that must never be callable from the API.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('grant_weekly_off_comp_off',
                        'rpc_event_check_out',
                        'purge_expired_site_visit_location_history',
                        'rpc_ingest_location_observation',
                        'check_overdue_tasks')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;

-- ─── 2. LEAVE STATUS CASE ────────────────────────────────────────────────────
-- Rewrites every function that looks up approved leave with the uppercase
-- literal. The canonical view is recreated in section 4.
DO $$
DECLARE
  f record;
  v_def text;
  v_new text;
BEGIN
  FOR f IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.prosrc ~* 'leave_requests\s+r\s+WHERE\s+r\.user_id\s*=\s*employee\.user_id\s+AND\s+r\.status\s*=\s*''APPROVED'''
  LOOP
    v_def := pg_get_functiondef(f.oid);
    v_new := regexp_replace(v_def,
      '(leave_requests\s+r\s+WHERE\s+r\.user_id\s*=\s*employee\.user_id\s+AND\s+)r\.status\s*=\s*''APPROVED''',
      '\1lower(r.status) = ''approved''', 'gi');
    IF v_new <> v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.idx_leave_requests_user_dates;
CREATE INDEX IF NOT EXISTS idx_leave_requests_user_dates_approved
  ON public.leave_requests (user_id, start_date, end_date)
  WHERE lower(status) = 'approved';

-- ─── 3. LATE FROM 10:33 ──────────────────────────────────────────────────────
ALTER TABLE public.attendance_policies ALTER COLUMN late_checkin_time SET DEFAULT '10:33:00';
UPDATE public.attendance_policies
SET late_checkin_time = '10:33:00'
WHERE late_checkin_time = '10:32:00';

-- Fallbacks hard-coded in functions (e.g. get_attendance_policy).
DO $$
DECLARE
  f record;
  v_def text;
  v_new text;
BEGIN
  FOR f IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.prosrc ~ '''10:32(:00)?'''
      AND p.prosrc ~* 'late'
  LOOP
    v_def := pg_get_functiondef(f.oid);
    v_new := regexp_replace(v_def, '''10:32(:00)?''', '''10:33:00''', 'g');
    IF v_new <> v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.set_authoritative_attendance_late_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_late_time time;
  v_local_checkin time;
BEGIN
  IF new.checkin_time IS NULL THEN
    new.is_late := false;
    new.late_by_minutes := 0;
    RETURN new;
  END IF;

  SELECT policy.late_checkin_time
  INTO v_late_time
  FROM public.profiles profile
  JOIN public.attendance_policies policy
    ON (policy.office_id = coalesce(new.office_id, profile.office_id) OR policy.office_id IS NULL)
   AND coalesce(policy.is_active, true)
   AND new.date BETWEEN coalesce(policy.effective_from, '-infinity'::date)
                    AND coalesce(policy.effective_to, 'infinity'::date)
   AND lower(coalesce(policy.role, 'all')) IN (lower(coalesce(profile.role, '')), 'all')
  WHERE profile.id = new.user_id
  ORDER BY
    CASE WHEN policy.office_id IS NOT NULL THEN 0 ELSE 1 END,
    CASE WHEN lower(coalesce(policy.role, 'all')) = lower(coalesce(profile.role, '')) THEN 0 ELSE 1 END
  LIMIT 1;

  v_late_time := coalesce(v_late_time, time '10:33:00');
  v_local_checkin := (new.checkin_time AT TIME ZONE 'Asia/Kolkata')::time;
  new.is_late := v_local_checkin >= v_late_time;
  new.late_by_minutes := CASE
    WHEN v_local_checkin >= v_late_time
      THEN greatest(0, floor(extract(epoch FROM (v_local_checkin - v_late_time)) / 60)::int)
    ELSE 0 END;
  RETURN new;
END;
$$;

-- Re-grade the current and previous month with the new threshold.
-- (Touches only is_late / late_by_minutes; other triggers do not react.)
SELECT set_config('app.suppress_attendance_outbox', 'true', true);
UPDATE public.attendance_logs a
SET is_late = ((a.checkin_time AT TIME ZONE 'Asia/Kolkata')::time >= time '10:33:00'),
    late_by_minutes = CASE
      WHEN (a.checkin_time AT TIME ZONE 'Asia/Kolkata')::time >= time '10:33:00'
        THEN floor(extract(epoch FROM ((a.checkin_time AT TIME ZONE 'Asia/Kolkata')::time - time '10:33:00')) / 60)::int
      ELSE 0 END
WHERE a.checkin_time IS NOT NULL
  AND a.date >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '1 month')::date
  AND coalesce(a.is_late, false) IS DISTINCT FROM
      ((a.checkin_time AT TIME ZONE 'Asia/Kolkata')::time >= time '10:33:00');

-- ─── 4. ATTENDANCE RULES ─────────────────────────────────────────────────────
-- Shared helpers so the view, the screens and the day-end job use one rule.
CREATE OR REPLACE FUNCTION public.hrms_biometric_checkout_from(p_date date)
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ((p_date::text || ' ' || p.biometric_checkout_from::text)::timestamp AT TIME ZONE 'Asia/Kolkata')
  FROM public.hrms_checkout_policy() p;
$$;

CREATE OR REPLACE FUNCTION public.hrms_auto_checkout_at(p_date date)
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ((p_date::text || ' ' || p.auto_checkout_at::text)::timestamp AT TIME ZONE 'Asia/Kolkata')
  FROM public.hrms_checkout_policy() p;
$$;

GRANT EXECUTE ON FUNCTION public.hrms_biometric_checkout_from(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hrms_auto_checkout_at(date) TO authenticated, service_role;

-- The view keeps exactly the same columns. Changes:
--   * approved leave matched case-insensitively
--   * a regularization counts only for its own employee
--   * biometric evidence = the latest punch (stored or device log), and it is a
--     checkout only from 18:30 IST (also after 20:00)
--   * checkout order: regularization > admin > app > biometric > stored day-end >
--     automatic 20:00 (once 20:00 has passed); a field-visit checkout ends the
--     visit, not the day
--   * presence beats weekly off and holiday (worked on an off day = present)
CREATE OR REPLACE VIEW public.v_attendance_daily_canonical
WITH (security_invoker = true) AS
WITH employee_days AS (
  SELECT p.id user_id, day::date work_date, p.name employee_name, p.employee_number,
    p.office_id, o.name office_name, p.team_id, COALESCE(t.name, p.team) team_name,
    p.reports_to team_head_id, manager.name team_head_name, p.role, p.show_on_tv,
    p.joining_date, p.is_active
  FROM public.profiles p
  LEFT JOIN public.offices o ON o.id = p.office_id
  LEFT JOIN public.teams t ON t.id = p.team_id
  LEFT JOIN public.profiles manager ON manager.id = p.reports_to
  CROSS JOIN LATERAL generate_series(
    greatest(COALESCE(p.joining_date, (p.created_at AT TIME ZONE 'Asia/Kolkata')::date), date '2024-01-01'),
    least(COALESCE(p.last_working_date, (now() AT TIME ZONE 'Asia/Kolkata')::date), (now() AT TIME ZONE 'Asia/Kolkata')::date),
    INTERVAL '1 day') day
  WHERE p.attendance_reporting_enabled
    AND (day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR p.is_active)
), evidence AS (
SELECT employee.*,
  attendance.id attendance_log_id,
  attendance.office_id check_in_office_id,
  ci_office.name check_in_office_name,
  attendance.checkin_source attendance_source,
  COALESCE(attendance.app_checkin_time,
    CASE WHEN upper(COALESCE(attendance.checkin_source, attendance.attendance_type, '')) LIKE 'APP%'
         THEN attendance.checkin_time END) app_first_in,
  COALESCE(attendance.biometric_first_punch, biometric.first_punch) biometric_first_in,
  visit.first_in field_visit_first_in,
  attendance.checkout_time raw_checkout,
  CASE WHEN upper(COALESCE(attendance.checkout_source, ''))
         NOT IN ('ADMIN', 'REGULARIZATION', 'SYSTEM', 'BIOMETRIC', 'FIELD_VISIT')
       THEN attendance.checkout_time END app_checkout,
  regularization.requested_checkout approved_regularization_checkout,
  CASE WHEN regularization.id IS NULL
         AND upper(COALESCE(attendance.checkout_source, '')) = 'ADMIN'
       THEN attendance.checkout_time END admin_corrected_checkout,
  CASE WHEN GREATEST(attendance.biometric_last_punch, biometric.last_punch)
              >= public.hrms_biometric_checkout_from(employee.work_date)
        AND GREATEST(attendance.biometric_last_punch, biometric.last_punch)
              > COALESCE(attendance.biometric_first_punch, biometric.first_punch, '-infinity'::timestamptz)
       THEN GREATEST(attendance.biometric_last_punch, biometric.last_punch) END biometric_last_punch_evidence,
  visit.last_out field_visit_checkout,
  visit.has_visit, visit.active_id, visit.active_name, visit.distance_m, visit.active_site_name,
  policy.late_checkin_time, policy.allow_field_visit_checkout, policy.policy_id,
  calendar.value calendar_value,
  leave_request.leave_type,
  attendance.warning attendance_warning,
  NULL::timestamptz latest_ping_at,
  NULL::numeric  latest_accuracy_m,
  NULL::text     latest_tracking_status,
  NULL::numeric  distance_from_office_m,
  NULL::text     tracking_session_status,
  NULL::text     tracking_health_reason,
  settings.tv_tracking_stale_minutes
FROM employee_days employee
LEFT JOIN LATERAL (
  SELECT a.* FROM public.attendance_logs a
  WHERE a.user_id = employee.user_id AND a.date = employee.work_date
  ORDER BY a.created_at, a.id LIMIT 1) attendance ON true
LEFT JOIN public.offices ci_office ON ci_office.id = attendance.office_id
LEFT JOIN LATERAL (
  SELECT min(d.log_date) first_punch, max(d.log_date) last_punch
  FROM public.smartoffice_device_logs d
  WHERE d.user_id = employee.user_id
    AND d.log_date_only = employee.work_date) biometric ON true
LEFT JOIN LATERAL (
  SELECT
    min(public.hrms_timestamp(v.checkin_time))  first_in,
    max(public.hrms_timestamp(v.checkout_time)) last_out,
    bool_or(v.checkin_time IS NOT NULL) has_visit,
    (array_agg(v.id ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN', 'IN_TRANSIT', 'PENDING')))[1] active_id,
    (array_agg(COALESCE(v.project_name, v.location_name)
      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN', 'IN_TRANSIT', 'PENDING')))[1] active_name,
    (array_agg(v.last_distance_m ORDER BY v.last_distance_at DESC NULLS LAST))[1] distance_m,
    (array_agg(COALESCE(v.project_name, v.location_name)
      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN', 'IN_TRANSIT', 'PENDING')))[1] active_site_name
  FROM public.field_visits v
  WHERE v.user_id = employee.user_id AND v.date = employee.work_date
    AND COALESCE(v.verification_status, 'PENDING') <> 'REJECTED') visit ON true
LEFT JOIN LATERAL (
  SELECT r.id, r.requested_checkout
  FROM public.attendance_regularization_requests r
  WHERE r.attendance_id = attendance.id
    AND r.user_id = employee.user_id
    AND upper(r.status) = 'APPROVED'
  ORDER BY r.reviewed_at DESC NULLS LAST, r.created_at DESC LIMIT 1) regularization ON true
LEFT JOIN LATERAL (
  SELECT p.id policy_id, p.late_checkin_time, p.allow_field_visit_checkout
  FROM public.attendance_policies p
  WHERE p.is_active
    AND employee.work_date BETWEEN p.effective_from AND COALESCE(p.effective_to, 'infinity'::date)
    AND (p.office_id = employee.office_id OR p.office_id IS NULL)
    AND lower(COALESCE(p.role, 'all')) IN (lower(COALESCE(employee.role, '')), 'all')
  ORDER BY CASE
    WHEN p.office_id = employee.office_id AND lower(p.role) = lower(COALESCE(employee.role, '')) THEN 1
    WHEN p.office_id = employee.office_id AND lower(COALESCE(p.role, 'all')) = 'all' THEN 2
    WHEN p.office_id IS NULL AND lower(p.role) = lower(COALESCE(employee.role, '')) THEN 3
    ELSE 4 END
  LIMIT 1) policy ON true
LEFT JOIN LATERAL (
  SELECT public.resolve_hrms_calendar_day(employee.user_id, employee.work_date) value) calendar ON true
LEFT JOIN LATERAL (
  SELECT r.leave_type
  FROM public.leave_requests r
  WHERE r.user_id = employee.user_id AND lower(r.status) = 'approved'
    AND employee.work_date BETWEEN r.start_date AND r.end_date
  ORDER BY r.created_at DESC LIMIT 1) leave_request ON true
CROSS JOIN (
  SELECT COALESCE(current_setting('app.tv_tracking_stale_minutes', true), '15')::integer tv_tracking_stale_minutes
) settings
), ruled AS (
SELECT e.*,
  LEAST(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) AS r_first_in,
  CASE WHEN e.raw_checkout >= public.hrms_biometric_checkout_from(e.work_date)
       THEN e.raw_checkout END AS r_stored_out,
  public.hrms_auto_checkout_at(e.work_date) AS r_auto_at
FROM evidence e
), decided AS (
SELECT r.*,
  CASE
    WHEN r.r_first_in IS NULL THEN NULL
    WHEN r.approved_regularization_checkout > r.r_first_in THEN r.approved_regularization_checkout
    WHEN r.admin_corrected_checkout > r.r_first_in         THEN r.admin_corrected_checkout
    WHEN r.app_checkout > r.r_first_in                     THEN r.app_checkout
    WHEN r.biometric_last_punch_evidence > r.r_first_in    THEN r.biometric_last_punch_evidence
    WHEN r.r_stored_out > r.r_first_in                     THEN r.r_stored_out
    WHEN now() >= r.r_auto_at AND r.r_first_in < r.r_auto_at THEN r.r_auto_at
  END AS r_out,
  CASE
    WHEN r.r_first_in IS NULL THEN 'NO_DATA'
    WHEN r.approved_regularization_checkout > r.r_first_in THEN 'REGULARIZATION'
    WHEN r.admin_corrected_checkout > r.r_first_in         THEN 'ADMIN_CORRECTED'
    WHEN r.app_checkout > r.r_first_in                     THEN 'APP'
    WHEN r.biometric_last_punch_evidence > r.r_first_in    THEN 'BIOMETRIC'
    WHEN r.r_stored_out > r.r_first_in                     THEN
      CASE WHEN r.r_stored_out = r.r_auto_at THEN 'AUTO_8PM' ELSE 'SYSTEM' END
    WHEN now() >= r.r_auto_at AND r.r_first_in < r.r_auto_at THEN 'AUTO_8PM'
    ELSE 'NO_DATA'
  END AS r_out_source
FROM ruled r
)
SELECT
  d.user_id, d.work_date, d.employee_name, d.employee_number, d.office_id, d.office_name,
  d.team_id, d.team_name, d.team_head_id, d.team_head_name, d.role, d.show_on_tv,
  d.joining_date, d.is_active, d.attendance_log_id, d.check_in_office_id,
  d.check_in_office_name, d.attendance_source, d.app_first_in, d.biometric_first_in,
  d.field_visit_first_in, d.raw_checkout, d.app_checkout, d.approved_regularization_checkout,
  d.admin_corrected_checkout, d.biometric_last_punch_evidence, d.field_visit_checkout,
  d.has_visit, d.active_id, d.active_name, d.distance_m, d.active_site_name,
  d.late_checkin_time, d.allow_field_visit_checkout, d.policy_id, d.calendar_value,
  d.leave_type, d.attendance_warning, d.latest_ping_at, d.latest_accuracy_m,
  d.latest_tracking_status, d.distance_from_office_m, d.tracking_session_status,
  d.tracking_health_reason, d.tv_tracking_stale_minutes,
  d.r_out effective_checkout,
  d.r_out official_last_out,
  d.r_out_source last_out_source,
  d.r_first_in effective_checkin,
  d.r_first_in official_first_in,
  CASE
    WHEN d.app_first_in IS NOT NULL          THEN 'APP'
    WHEN d.field_visit_first_in IS NOT NULL  THEN 'FIELD_VISIT'
    WHEN d.biometric_first_in IS NOT NULL    THEN 'BIOMETRIC'
    ELSE 'NO_DATA'
  END first_in_source,
  CASE
    WHEN d.app_first_in IS NOT NULL          THEN 'APP'
    WHEN d.biometric_first_in IS NOT NULL    THEN 'BIOMETRIC'
    WHEN d.field_visit_first_in IS NOT NULL  THEN 'FIELD_VISIT'
    ELSE 'NO_DATA'
  END presence_source,
  (CASE
    WHEN d.leave_type IS NOT NULL                    THEN 'LEAVE'
    WHEN d.r_first_in IS NOT NULL THEN
      CASE WHEN d.r_out IS NOT NULL THEN 'CHECKED_OUT' ELSE 'CHECKED_IN' END
    WHEN d.calendar_value->>'kind' = 'WEEKLY_OFF'    THEN 'WEEKLY_OFF'
    WHEN d.calendar_value->>'kind' = 'HOLIDAY'       THEN 'HOLIDAY'
    ELSE 'ABSENT'
  END) effective_status,
  (CASE
    WHEN d.leave_type IS NOT NULL                    THEN 'LEAVE'
    WHEN d.r_first_in IS NOT NULL THEN
      CASE WHEN d.r_out IS NOT NULL THEN 'CHECKED_OUT' ELSE 'CHECKED_IN' END
    WHEN d.calendar_value->>'kind' = 'WEEKLY_OFF'    THEN 'WEEKLY_OFF'
    WHEN d.calendar_value->>'kind' = 'HOLIDAY'       THEN 'HOLIDAY'
    ELSE 'ABSENT'
  END) attendance_status,
  EXISTS(
    SELECT 1 FROM public.attendance_logs a
    WHERE a.id = d.attendance_log_id AND a.auto_closed = true
  ) is_auto_closed,
  COALESCE(d.has_visit, false) has_field_visit,
  CASE WHEN d.r_first_in IS NOT NULL AND d.r_out IS NOT NULL
       THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (d.r_out - d.r_first_in)) / 60))::integer
  END working_minutes,
  CASE
    WHEN d.attendance_warning IS NOT NULL THEN d.attendance_warning::text
    WHEN d.r_out_source = 'AUTO_8PM' THEN 'Auto checkout at 8 PM (no app checkout, no biometric after 6:30 PM)'
    WHEN d.r_first_in IS NOT NULL AND d.r_out IS NULL THEN 'No checkout'
    ELSE NULL
  END warning,
  COALESCE(
    d.latest_ping_at IS NULL
    OR d.latest_ping_at < now() - make_interval(mins => d.tv_tracking_stale_minutes),
    true
  ) ping_is_stale,
  d.active_id    active_field_visit_id,
  d.active_name  active_field_visit_name,
  d.distance_m   distance_from_destination_m
FROM decided d;

-- Read-path patch: presence now also beats weekly off / holiday / absent.
CREATE OR REPLACE FUNCTION public.hrms_canonical_row_patch(r jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH pol AS (
    SELECT * FROM public.hrms_checkout_policy()
  ), v AS (
    SELECT (r->>'work_date')::date                               AS work_date,
           (r->>'app_first_in')::timestamptz                     AS app_in,
           (r->>'biometric_first_in')::timestamptz               AS bio_in,
           (r->>'field_visit_first_in')::timestamptz             AS fv_in,
           upper(coalesce(r->>'attendance_source', ''))          AS src,
           (r->>'approved_regularization_checkout')::timestamptz AS reg_out,
           (r->>'admin_corrected_checkout')::timestamptz         AS adm_out,
           (r->>'app_checkout')::timestamptz                     AS app_out,
           (r->>'biometric_last_punch_evidence')::timestamptz    AS bio_last,
           (r->>'raw_checkout')::timestamptz                     AS raw_out
  ), f AS (
    SELECT v.*,
           CASE WHEN v.src = 'ADMIN' AND v.app_in IS NOT NULL THEN v.app_in
                ELSE least(v.app_in, v.bio_in, v.fv_in) END AS first_in,
           ((v.work_date::text || ' ' || pol.biometric_checkout_from::text)::timestamp
              AT TIME ZONE 'Asia/Kolkata') AS bio_from,
           ((v.work_date::text || ' ' || pol.auto_checkout_at::text)::timestamp
              AT TIME ZONE 'Asia/Kolkata') AS auto_at
    FROM v, pol
  ), c AS (
    SELECT f.*,
      CASE
        WHEN f.reg_out IS NOT NULL AND f.reg_out > f.first_in THEN f.reg_out
        WHEN f.adm_out IS NOT NULL AND f.adm_out > f.first_in THEN f.adm_out
        WHEN f.app_out IS NOT NULL AND f.app_out > f.first_in THEN f.app_out
        WHEN f.bio_last IS NOT NULL AND f.bio_last >= f.bio_from AND f.bio_last > f.first_in THEN f.bio_last
        WHEN f.raw_out IS NOT NULL AND f.raw_out >= f.bio_from AND f.raw_out > f.first_in THEN f.raw_out
        WHEN now() >= f.auto_at AND f.first_in < f.auto_at THEN f.auto_at
      END AS last_out,
      CASE
        WHEN f.reg_out IS NOT NULL AND f.reg_out > f.first_in THEN 'REGULARIZATION'
        WHEN f.adm_out IS NOT NULL AND f.adm_out > f.first_in THEN 'ADMIN_CORRECTED'
        WHEN f.app_out IS NOT NULL AND f.app_out > f.first_in THEN 'APP'
        WHEN f.bio_last IS NOT NULL AND f.bio_last >= f.bio_from AND f.bio_last > f.first_in THEN 'BIOMETRIC'
        WHEN f.raw_out IS NOT NULL AND f.raw_out >= f.bio_from AND f.raw_out > f.first_in THEN
          CASE WHEN f.raw_out = f.auto_at THEN 'AUTO_8PM' ELSE 'SYSTEM' END
        WHEN now() >= f.auto_at AND f.first_in < f.auto_at THEN 'AUTO_8PM'
        ELSE 'NO_DATA'
      END AS last_out_source
    FROM f
  )
  SELECT CASE
    WHEN c.first_in IS NULL THEN '{}'::jsonb      -- absent / leave / off: untouched
    ELSE jsonb_build_object(
      'effective_checkin', c.first_in,
      'official_first_in', c.first_in,
      'first_in_source', CASE
          WHEN c.src = 'ADMIN' AND c.app_in IS NOT NULL THEN 'ADMIN_CORRECTED'
          WHEN c.first_in = c.app_in THEN 'APP'
          WHEN c.first_in = c.bio_in THEN 'BIOMETRIC'
          WHEN c.first_in = c.fv_in  THEN 'FIELD_VISIT'
          ELSE r->>'first_in_source' END,
      'effective_checkout', c.last_out,
      'official_last_out',  c.last_out,
      'last_out_source',    c.last_out_source,
      'working_minutes', CASE WHEN c.last_out IS NOT NULL
                              THEN floor(extract(epoch FROM (c.last_out - c.first_in)) / 60)::int END,
      'effective_status', CASE
          WHEN upper(coalesce(r->>'effective_status', '')) IN ('LEAVE', 'ON_LEAVE') THEN r->>'effective_status'
          WHEN c.last_out IS NULL THEN 'CHECKED_IN' ELSE 'CHECKED_OUT' END,
      'attendance_status', CASE
          WHEN upper(coalesce(r->>'attendance_status', '')) IN ('LEAVE', 'ON_LEAVE') THEN r->>'attendance_status'
          WHEN c.last_out IS NULL THEN 'CHECKED_IN' ELSE 'CHECKED_OUT' END,
      'worked_on_off_day', upper(coalesce(r->>'effective_status', '')) IN ('WEEKLY_OFF', 'HOLIDAY'),
      'warning', CASE
          WHEN c.last_out_source = 'AUTO_8PM' THEN to_jsonb('Auto checkout at 8 PM (no app checkout, no biometric after 6:30 PM)'::text)
          WHEN c.last_out IS NULL AND (r->>'warning') = 'No checkout' THEN 'null'::jsonb
          ELSE r->'warning' END
    )
  END
  FROM c;
$$;
REVOKE ALL ON FUNCTION public.hrms_canonical_row_patch(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_canonical_row_patch(jsonb) TO authenticated;

-- Day-end job: scheduled runs repair the last 30 days, not only today/yesterday.
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.hrms_apply_day_end_checkouts(date)') IS NOT NULL THEN
    v_def := pg_get_functiondef('public.hrms_apply_day_end_checkouts(date)'::regprocedure);
    v_new := replace(v_def, 'a.date >= v_today - 1', 'a.date >= v_today - 30');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END IF;
END $$;

-- Worked on a weekly off → one comp-off (once per day, never duplicated).
CREATE OR REPLACE FUNCTION public.hrms_auto_weekly_off_comp_off()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF new.checkin_time IS NULL OR new.user_id IS NULL OR new.date IS NULL THEN
    RETURN new;
  END IF;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('weekly-off-comp:' || new.user_id || ':' || new.date, 0));
    IF NOT EXISTS (
      SELECT 1 FROM public.comp_off_earnings e
      WHERE e.user_id = new.user_id
        AND e.eligible_work_date = new.date
        AND e.source_type = 'WEEKLY_OFF_ATTENDANCE'
    ) AND coalesce(public.resolve_hrms_calendar_day(new.user_id, new.date)->>'kind', '') = 'WEEKLY_OFF' THEN
      PERFORM public.grant_weekly_off_comp_off(new.user_id, new.date);
    END IF;
  EXCEPTION WHEN others THEN
    -- A comp-off problem must never block attendance.
    RAISE WARNING 'weekly-off comp-off skipped for % on %: %', new.user_id, new.date, SQLERRM;
  END;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS hrms_weekly_off_comp_off_ins ON public.attendance_logs;
CREATE TRIGGER hrms_weekly_off_comp_off_ins
AFTER INSERT ON public.attendance_logs
FOR EACH ROW WHEN (new.checkin_time IS NOT NULL)
EXECUTE FUNCTION public.hrms_auto_weekly_off_comp_off();

DROP TRIGGER IF EXISTS hrms_weekly_off_comp_off_upd ON public.attendance_logs;
CREATE TRIGGER hrms_weekly_off_comp_off_upd
AFTER UPDATE OF checkin_time ON public.attendance_logs
FOR EACH ROW WHEN (old.checkin_time IS NULL AND new.checkin_time IS NOT NULL)
EXECUTE FUNCTION public.hrms_auto_weekly_off_comp_off();

-- ─── 5. BIOMETRIC: Monday credit must never break punch import ───────────────
CREATE OR REPLACE FUNCTION public.trigger_monday_biometric_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_team text;
  v_bonus_enabled boolean;
  v_month_start date;
  v_punch_date date;
BEGIN
  BEGIN
    IF new.log_date IS NULL THEN RETURN new; END IF;
    v_punch_date := (new.log_date AT TIME ZONE 'Asia/Kolkata')::date;
    IF extract(isodow FROM v_punch_date) <> 1 THEN RETURN new; END IF;

    v_user_id := new.user_id;
    SELECT coalesce(t.name, p.team, p.department) INTO v_team
    FROM public.profiles p
    LEFT JOIN public.teams t ON t.id = p.team_id
    WHERE p.id = v_user_id;
    IF v_user_id IS NULL OR v_team IS NULL THEN RETURN new; END IF;

    SELECT monday_credit_bonus INTO v_bonus_enabled
    FROM public.work_schedule_configs
    WHERE lower(team) = lower(v_team);
    IF NOT coalesce(v_bonus_enabled, false) THEN RETURN new; END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('monday-credit:' || v_user_id || ':' || v_punch_date, 0));
    IF EXISTS (
      SELECT 1 FROM public.compliance_score_deductions
      WHERE user_id = v_user_id
        AND reason = 'Monday Biometric Attendance Credit'
        AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = v_punch_date
    ) THEN
      RETURN new;
    END IF;

    v_month_start := date_trunc('month', v_punch_date)::date;
    INSERT INTO public.employee_compliance_scores (user_id, score_month, current_score)
    VALUES (v_user_id, v_month_start, 100)
    ON CONFLICT (user_id, score_month) DO NOTHING;
    UPDATE public.employee_compliance_scores
    SET current_score = least(100, current_score + 1), updated_at = now()
    WHERE user_id = v_user_id AND score_month = v_month_start;
    INSERT INTO public.compliance_score_deductions
      (user_id, score_month, deduction_amount, reason, source_table, source_id, deducted_by)
    VALUES (v_user_id, v_month_start, -1, 'Monday Biometric Attendance Credit',
            'smartoffice_device_logs', new.id, NULL);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'monday credit skipped: %', SQLERRM;
  END;
  RETURN new;
END;
$$;

-- ─── 6. LOCATION ─────────────────────────────────────────────────────────────
-- 6a. Site visit pings also feed the Site Visit Observer tables.
CREATE OR REPLACE FUNCTION public.hrms_mirror_site_visit_ping(p_client_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ping public.location_tracking%rowtype;
  v_visit public.field_visits%rowtype;
  v_quality text;
  v_status text;
BEGIN
  SELECT * INTO v_ping FROM public.location_tracking WHERE client_event_id = p_client_event_id LIMIT 1;
  IF NOT FOUND OR v_ping.field_visit_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_visit FROM public.field_visits WHERE id = v_ping.field_visit_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_quality := CASE WHEN v_ping.quality_status IN ('RELIABLE', 'LOW_ACCURACY', 'MOCKED', 'STALE', 'IMPOSSIBLE_SPEED')
                    THEN v_ping.quality_status ELSE 'LOW_ACCURACY' END;

  INSERT INTO public.site_visit_location_history (
    field_visit_id, user_id, client_event_id, latitude, longitude, accuracy_m,
    altitude_m, heading, speed_mps, mocked, quality_status, recorded_at
  ) VALUES (
    v_visit.id, v_ping.user_id, p_client_event_id, v_ping.latitude, v_ping.longitude, v_ping.accuracy,
    v_ping.altitude, v_ping.heading, v_ping.speed, coalesce(v_ping.mocked, false), v_quality,
    public.hrms_timestamp(v_ping.recorded_at)
  ) ON CONFLICT (client_event_id) DO NOTHING;

  IF v_quality NOT IN ('RELIABLE', 'LOW_ACCURACY') THEN RETURN; END IF;

  v_status := CASE
    WHEN v_quality = 'LOW_ACCURACY' THEN 'LOW_ACCURACY'
    WHEN v_visit.status = 'CHECKED_IN' OR (v_visit.arrived_at IS NOT NULL AND v_visit.departed_at IS NULL) THEN 'AT_SITE'
    ELSE 'IN_TRANSIT' END;

  INSERT INTO public.site_visit_live_locations (
    field_visit_id, user_id, latitude, longitude, accuracy_m, altitude_m, heading,
    speed_mps, tracking_status, recorded_at, updated_at,
    source, last_location_at, last_uploaded_at, gps_quality
  ) VALUES (
    v_visit.id, v_ping.user_id, v_ping.latitude, v_ping.longitude, v_ping.accuracy, v_ping.altitude,
    v_ping.heading, v_ping.speed, v_status, public.hrms_timestamp(v_ping.recorded_at), now(),
    'background', public.hrms_timestamp(v_ping.recorded_at), now(),
    CASE WHEN coalesce(v_ping.accuracy, 999) <= 25 THEN 'HIGH'
         WHEN v_ping.accuracy <= 60 THEN 'ACCEPTABLE'
         WHEN v_ping.accuracy <= 100 THEN 'WEAK' ELSE 'INVALID' END
  )
  ON CONFLICT (field_visit_id) DO UPDATE SET
    latitude = excluded.latitude, longitude = excluded.longitude, accuracy_m = excluded.accuracy_m,
    altitude_m = excluded.altitude_m, heading = excluded.heading, speed_mps = excluded.speed_mps,
    tracking_status = excluded.tracking_status, recorded_at = excluded.recorded_at, updated_at = now(),
    last_location_at = excluded.last_location_at, last_uploaded_at = now(), gps_quality = excluded.gps_quality
  WHERE site_visit_live_locations.recorded_at <= excluded.recorded_at;
EXCEPTION WHEN others THEN
  RAISE WARNING 'site visit mirror skipped: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_mirror_site_visit_ping(uuid) FROM public, anon, authenticated;

-- 6b. Notify an employee's manager and HR of the same office (or company-wide HR).
CREATE OR REPLACE FUNCTION public.hrms_notify_line_and_hr(
  p_subject_user uuid, p_title text, p_message text, p_type text,
  p_event_key text, p_deep_link text, p_data jsonb DEFAULT '{}'::jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT x.id
    FROM (
      SELECT m.id FROM public.profiles s JOIN public.profiles m ON m.id = s.reports_to
      WHERE s.id = p_subject_user AND coalesce(m.is_active, true)
      UNION
      SELECT h.id FROM public.profiles s
      JOIN public.profiles h
        ON upper(coalesce(h.role, '')) IN ('HR', 'HRD')
       AND coalesce(h.is_active, true)
       AND (h.office_id IS NULL OR s.office_id IS NULL OR h.office_id = s.office_id)
      WHERE s.id = p_subject_user
    ) x
    WHERE x.id <> p_subject_user
  LOOP
    PERFORM public.enqueue_hrms_notification(r.id, p_title, p_message, p_type,
      p_event_key || ':' || r.id, p_deep_link, NULL, NULL, coalesce(p_data, '{}'::jsonb));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
EXCEPTION WHEN others THEN
  RAISE WARNING 'line/HR notification skipped: %', SQLERRM;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_notify_line_and_hr(uuid, text, text, text, text, text, jsonb) FROM public, anon, authenticated;

-- 6c. Office geofence evaluation for one stored attendance ping.
--     Outside = (distance - accuracy) > radius + 150 m. One open cycle per day:
--     POTENTIAL_EXIT on the first outside ping, confirmed after 10 minutes
--     (by a later ping or by the 5-minute job), back inside closes it.
CREATE OR REPLACE FUNCTION public.hrms_evaluate_office_geofence(p_client_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ping public.location_tracking%rowtype;
  v_att public.attendance_logs%rowtype;
  v_office record;
  v_radius double precision;
  v_distance double precision;
  v_outside boolean;
  v_event public.geofence_events%rowtype;
  v_at timestamptz;
BEGIN
  SELECT * INTO v_ping FROM public.location_tracking WHERE client_event_id = p_client_event_id LIMIT 1;
  IF NOT FOUND OR v_ping.quality_status <> 'RELIABLE' OR v_ping.field_visit_id IS NOT NULL THEN RETURN; END IF;
  v_at := public.hrms_timestamp(v_ping.recorded_at);

  SELECT a.* INTO v_att FROM public.tracking_sessions s
  JOIN public.attendance_logs a ON a.id = s.attendance_log_id
  WHERE s.id = v_ping.tracking_session_id;
  IF NOT FOUND OR v_att.checkout_time IS NOT NULL OR v_att.office_id IS NULL THEN RETURN; END IF;

  -- Field staff and WFH days are not office-bound.
  IF EXISTS (SELECT 1 FROM public.field_visits fv WHERE fv.user_id = v_att.user_id AND fv.date = v_att.date) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.leave_requests lr
             WHERE lr.user_id = v_att.user_id AND lower(lr.status) = 'approved'
               AND v_att.date BETWEEN lr.start_date AND lr.end_date) THEN RETURN; END IF;

  SELECT o.id, o.name, o.latitude, o.longitude, coalesce(o.allowed_radius_meters, o.attendance_radius) AS radius
  INTO v_office FROM public.offices o WHERE o.id = v_att.office_id;
  IF NOT FOUND OR v_office.latitude IS NULL OR v_office.longitude IS NULL THEN RETURN; END IF;
  v_radius := greatest(coalesce(v_office.radius, 200), 50);
  v_distance := public.tracking_distance_metres(v_office.latitude, v_office.longitude, v_ping.latitude, v_ping.longitude);
  v_outside := (v_distance - coalesce(v_ping.accuracy, 0)) > v_radius + 150;

  SELECT * INTO v_event FROM public.geofence_events
  WHERE attendance_id = v_att.id AND geofence_type = 'OFFICE' AND geofence_id = v_office.id
    AND status NOT IN ('RETURNED_INSIDE', 'CLOSED')
  ORDER BY detected_at DESC LIMIT 1;

  IF v_outside THEN
    IF v_event.id IS NULL THEN
      INSERT INTO public.geofence_events (
        client_event_id, user_id, attendance_id, geofence_type, geofence_id, event_type,
        latitude, longitude, accuracy_m, accuracy_class, calculated_distance_m,
        event_source, detected_at, status
      ) VALUES (
        p_client_event_id, v_att.user_id, v_att.id, 'OFFICE', v_office.id, 'OFFICE_EXIT',
        v_ping.latitude, v_ping.longitude, v_ping.accuracy,
        CASE WHEN coalesce(v_ping.accuracy, 999) <= 50 THEN 'GOOD' ELSE 'UNCERTAIN' END,
        round(v_distance::numeric, 1), 'BACKGROUND_LOCATION', v_at, 'POTENTIAL_EXIT'
      ) ON CONFLICT DO NOTHING;
    ELSIF v_event.status = 'POTENTIAL_EXIT' AND v_at >= v_event.detected_at + interval '10 minutes' THEN
      PERFORM public.hrms_confirm_office_exit(v_event.id, v_distance);
    END IF;
  ELSIF v_event.id IS NOT NULL AND v_event.status = 'POTENTIAL_EXIT' THEN
    UPDATE public.geofence_events SET status = 'RETURNED_INSIDE', processed_at = now() WHERE id = v_event.id;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'office geofence skipped: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_evaluate_office_geofence(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hrms_confirm_office_exit(p_event_id uuid, p_distance double precision DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.geofence_events%rowtype;
  v_name text;
  v_office text;
  v_dist integer;
BEGIN
  UPDATE public.geofence_events
  SET status = 'PENDING_REASON', processed_at = now(), notification_sent_at = now(),
      calculated_distance_m = coalesce(round(p_distance::numeric, 1), calculated_distance_m)
  WHERE id = p_event_id AND status = 'POTENTIAL_EXIT'
  RETURNING * INTO v_event;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT p.name, o.name INTO v_name, v_office
  FROM public.profiles p LEFT JOIN public.offices o ON o.id = v_event.geofence_id
  WHERE p.id = v_event.user_id;
  v_dist := round(coalesce(v_event.calculated_distance_m, 0))::int;

  INSERT INTO public.location_alerts (user_id, alert_type, message)
  VALUES (v_event.user_id, 'geofence_exit',
          coalesce(v_name, 'Employee') || ' has been outside ' || coalesce(v_office, 'the office')
          || ' for over 10 minutes (' || v_dist || ' m away).');

  PERFORM public.enqueue_hrms_notification(v_event.user_id,
    'You are outside the office',
    'You have been away from ' || coalesce(v_office, 'the office') || ' for over 10 minutes. Please tell us why.',
    'geofence_reason_required', 'geofence-reason:' || v_event.id,
    '/HRMS/?geofenceEvent=' || v_event.id, NULL, NULL,
    jsonb_build_object('geofenceEventId', v_event.id, 'distance', v_dist));

  PERFORM public.hrms_notify_line_and_hr(v_event.user_id,
    'Employee outside office',
    coalesce(v_name, 'An employee') || ' has been outside ' || coalesce(v_office, 'the office')
      || ' for over 10 minutes (' || v_dist || ' m away).',
    'geofence_exit', 'geofence-exit:' || v_event.id, '/HRMS/admin/live-tracking',
    jsonb_build_object('geofenceEventId', v_event.id, 'userId', v_event.user_id));
EXCEPTION WHEN others THEN
  RAISE WARNING 'office exit confirmation skipped: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_confirm_office_exit(uuid, double precision) FROM public, anon, authenticated;

-- The old insert-time alert fired on every potential exit; alerts now come
-- from the confirmation above.
DO $$
BEGIN
  IF to_regclass('public.geofence_events') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS geofence_event_to_alert_trg ON public.geofence_events;
  END IF;
END $$;

-- Every 5 minutes: confirm exits of people who stopped moving outside, close
-- cycles of people who checked out.
CREATE OR REPLACE FUNCTION public.hrms_geofence_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_confirmed integer := 0;
  v_closed integer := 0;
BEGIN
  UPDATE public.geofence_events g
  SET status = 'CLOSED', processed_at = now()
  FROM public.attendance_logs a
  WHERE a.id = g.attendance_id AND a.checkout_time IS NOT NULL
    AND g.status = 'POTENTIAL_EXIT';
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  FOR r IN
    SELECT g.id, g.user_id, g.detected_at
    FROM public.geofence_events g
    JOIN public.attendance_logs a ON a.id = g.attendance_id AND a.checkout_time IS NULL
    WHERE g.status = 'POTENTIAL_EXIT' AND g.geofence_type = 'OFFICE'
      AND g.detected_at <= now() - interval '10 minutes'
      AND g.detected_at >= now() - interval '1 day'
  LOOP
    PERFORM public.hrms_confirm_office_exit(r.id, NULL);
    v_confirmed := v_confirmed + 1;
  END LOOP;
  RETURN jsonb_build_object('confirmed', v_confirmed, 'closed', v_closed);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_geofence_sweep() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_geofence_sweep() TO service_role;

-- 6d. Attendance pings (no site visit today): stored instead of discarded.
CREATE OR REPLACE FUNCTION public.hrms_record_attendance_ping(
  p_uid uuid,
  p_attendance_log_id uuid,
  p_tracking_session_id uuid,
  p_client_event_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_altitude_m double precision,
  p_heading double precision,
  p_speed_mps double precision,
  p_mocked boolean,
  p_recorded_at timestamptz,
  p_provider text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attendance public.attendance_logs%rowtype;
  v_session public.tracking_sessions%rowtype;
  v_previous public.location_tracking%rowtype;
  v_quality text := 'RELIABLE';
  v_elapsed double precision;
  v_jump double precision;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'CLIENT_EVENT_ID_REQUIRED'; END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180
     OR (p_latitude = 0 AND p_longitude = 0) THEN
    RAISE EXCEPTION 'INVALID_COORDINATES';
  END IF;
  IF p_recorded_at > now() + interval '1 minute' OR p_recorded_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'INVALID_TIMESTAMP_SKEW';
  END IF;

  IF p_attendance_log_id IS NOT NULL THEN
    SELECT * INTO v_attendance FROM public.attendance_logs
    WHERE id = p_attendance_log_id AND user_id = p_uid;
  ELSE
    SELECT * INTO v_attendance FROM public.attendance_logs
    WHERE user_id = p_uid AND checkin_time IS NOT NULL AND checkout_time IS NULL
    ORDER BY checkin_time DESC LIMIT 1;
  END IF;
  IF NOT FOUND OR v_attendance.checkout_time IS NOT NULL OR v_attendance.checkin_time IS NULL THEN
    RETURN jsonb_build_object('tracking_session_status', 'STOPPED', 'health_warning', 'NO_OPEN_ATTENDANCE');
  END IF;

  SELECT * INTO v_session FROM public.tracking_sessions
  WHERE attendance_log_id = v_attendance.id AND status = 'ACTIVE'
  ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND AND p_tracking_session_id IS NOT NULL THEN
    -- Sessions stopped by the old "no field visit" rule are resumed.
    UPDATE public.tracking_sessions
    SET status = 'ACTIVE', stopped_at = NULL, stop_reason = NULL, native_task_active = true, updated_at = now()
    WHERE id = p_tracking_session_id AND user_id = p_uid AND attendance_log_id = v_attendance.id
    RETURNING * INTO v_session;
  END IF;
  IF v_session.id IS NULL THEN
    INSERT INTO public.tracking_sessions (user_id, attendance_log_id, status, start_reason, native_task_active)
    VALUES (p_uid, v_attendance.id, 'ACTIVE', 'FIRST_VALIDATED_PING', true)
    RETURNING * INTO v_session;
  END IF;

  IF EXISTS (SELECT 1 FROM public.location_tracking WHERE client_event_id = p_client_event_id) THEN
    RETURN jsonb_build_object('tracking_session_id', v_session.id, 'tracking_session_status', v_session.status,
                              'journey_status', NULL, 'duplicate', true, 'should_notify_local', false);
  END IF;

  SELECT * INTO v_previous FROM public.location_tracking
  WHERE tracking_session_id = v_session.id AND quality_status = 'RELIABLE'
  ORDER BY recorded_at DESC LIMIT 1;

  IF coalesce(p_mocked, false) THEN
    v_quality := 'MOCKED';
  ELSIF p_accuracy_m IS NULL OR p_accuracy_m < 0 OR p_accuracy_m > 100 THEN
    v_quality := 'LOW_ACCURACY';
  ELSIF p_recorded_at < now() - interval '5 minutes' THEN
    v_quality := 'STALE';
  ELSIF p_latitude NOT BETWEEN 6.5 AND 37.6 OR p_longitude NOT BETWEEN 68 AND 97.5 THEN
    v_quality := 'OUTSIDE_ALLOWED_REGION';
  ELSIF v_previous.id IS NOT NULL THEN
    v_elapsed := extract(epoch FROM (p_recorded_at - public.hrms_timestamp(v_previous.recorded_at)));
    IF v_elapsed >= 5 THEN
      v_jump := public.tracking_distance_metres(v_previous.latitude, v_previous.longitude, p_latitude, p_longitude);
      IF v_jump / v_elapsed > 70 THEN v_quality := 'IMPOSSIBLE_SPEED'; END IF;
    END IF;
  END IF;

  INSERT INTO public.location_tracking (
    user_id, tracking_session_id, field_visit_id, latitude, longitude,
    accuracy, altitude, heading, speed, mocked, provider, client_event_id,
    sync_source, quality_status, gps_available, status, recorded_at, date,
    source, received_at
  ) VALUES (
    p_uid, v_session.id, NULL, p_latitude, p_longitude,
    p_accuracy_m, p_altitude_m, p_heading, p_speed_mps, coalesce(p_mocked, false),
    left(p_provider, 80), p_client_event_id,
    CASE WHEN p_provider ILIKE '%offline%' THEN 'OFFLINE_SYNC' ELSE 'NATIVE' END,
    v_quality, true, 'GREEN', p_recorded_at,
    (p_recorded_at AT TIME ZONE 'Asia/Kolkata')::date, 'app', now()
  );

  UPDATE public.tracking_sessions
  SET last_location_at = greatest(coalesce(last_location_at, p_recorded_at), p_recorded_at),
      last_accuracy_m = CASE WHEN p_recorded_at >= coalesce(last_location_at, '-infinity')
                             THEN p_accuracy_m ELSE last_accuracy_m END,
      native_task_active = true, updated_at = now()
  WHERE id = v_session.id;

  PERFORM public.hrms_evaluate_office_geofence(p_client_event_id);

  RETURN jsonb_build_object(
    'tracking_session_id', v_session.id,
    'tracking_session_status', 'ACTIVE',
    'journey_status', NULL,
    'distance_m', NULL,
    'quality_status', v_quality,
    'event_generated', NULL,
    'should_notify_local', false,
    'health_warning', CASE WHEN v_quality = 'RELIABLE' THEN NULL ELSE v_quality END,
    'duplicate', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_record_attendance_ping(uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision, boolean, timestamptz, text)
  FROM public, anon, authenticated;

-- 6e. The public entry point (same signature the apps call).
CREATE OR REPLACE FUNCTION public.record_location_ping(
  p_attendance_log_id uuid DEFAULT NULL,
  p_tracking_session_id uuid DEFAULT NULL,
  p_field_visit_id uuid DEFAULT NULL,
  p_client_event_id uuid DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_accuracy_m double precision DEFAULT NULL,
  p_altitude_m double precision DEFAULT NULL,
  p_heading double precision DEFAULT NULL,
  p_speed_mps double precision DEFAULT NULL,
  p_mocked boolean DEFAULT false,
  p_recorded_at timestamptz DEFAULT now(),
  p_provider text DEFAULT 'expo-location',
  p_client_quality_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_visit_id uuid;
  v_date date := (coalesce(p_recorded_at, now()) AT TIME ZONE 'Asia/Kolkata')::date;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;

  -- An active site visit of the ping's own IST date (the device's cached one first).
  IF p_field_visit_id IS NOT NULL THEN
    SELECT fv.id INTO v_visit_id FROM public.field_visits fv
    WHERE fv.id = p_field_visit_id AND fv.user_id = v_uid AND fv.date = v_date
      AND fv.status IN ('PENDING', 'IN_TRANSIT', 'CHECKED_IN') AND fv.destination_coords IS NOT NULL;
  END IF;
  IF v_visit_id IS NULL THEN
    SELECT fv.id INTO v_visit_id FROM public.field_visits fv
    WHERE fv.user_id = v_uid AND fv.date = v_date
      AND fv.status IN ('PENDING', 'IN_TRANSIT', 'CHECKED_IN') AND fv.destination_coords IS NOT NULL
    ORDER BY fv.created_at DESC LIMIT 1;
  END IF;

  IF v_visit_id IS NOT NULL THEN
    v_result := public.record_location_ping_unscoped_20260725(
      p_attendance_log_id, p_tracking_session_id, v_visit_id, p_client_event_id,
      p_latitude, p_longitude, p_accuracy_m, p_altitude_m, p_heading, p_speed_mps,
      p_mocked, p_recorded_at, p_provider, p_client_quality_status);
    IF NOT coalesce((v_result->>'duplicate')::boolean, false) THEN
      PERFORM public.hrms_mirror_site_visit_ping(p_client_event_id);
    END IF;
    RETURN v_result;
  END IF;

  RETURN public.hrms_record_attendance_ping(
    v_uid, p_attendance_log_id, p_tracking_session_id, p_client_event_id,
    p_latitude, p_longitude, p_accuracy_m, p_altitude_m, p_heading, p_speed_mps,
    p_mocked, p_recorded_at, p_provider);
END;
$$;
REVOKE ALL ON FUNCTION public.record_location_ping(
  uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision,
  boolean, timestamptz, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_location_ping(
  uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision,
  boolean, timestamptz, text, text) TO authenticated;

-- 6f. Employee: my open "please give a reason" event.
CREATE OR REPLACE FUNCTION public.rpc_my_pending_geofence_reason()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT jsonb_build_object('id', g.id, 'distance', coalesce(g.calculated_distance_m, 0),
                              'detected_at', g.detected_at, 'office_name', o.name)
    FROM public.geofence_events g
    LEFT JOIN public.offices o ON o.id = g.geofence_id
    WHERE g.user_id = auth.uid() AND g.status = 'PENDING_REASON'
      AND NOT EXISTS (SELECT 1 FROM public.geofence_reasons gr WHERE gr.geofence_event_id = g.id)
    ORDER BY g.detected_at DESC LIMIT 1), 'null'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.rpc_my_pending_geofence_reason() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_my_pending_geofence_reason() TO authenticated;

-- Employee submits the reason (replaces the older version without search_path).
DROP FUNCTION IF EXISTS public.rpc_submit_geofence_reason(uuid, text);
CREATE FUNCTION public.rpc_submit_geofence_reason(p_event_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.geofence_events%rowtype;
  v_reason_id uuid;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'REASON_TOO_SHORT'; END IF;
  SELECT * INTO v_event FROM public.geofence_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.user_id <> auth.uid() THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.geofence_reasons WHERE geofence_event_id = p_event_id) THEN
    RAISE EXCEPTION 'REASON_ALREADY_SUBMITTED';
  END IF;

  INSERT INTO public.geofence_reasons (geofence_event_id, submitted_by, reason)
  VALUES (p_event_id, auth.uid(), left(btrim(p_reason), 1000))
  RETURNING id INTO v_reason_id;
  UPDATE public.geofence_events SET status = 'REASON_SUBMITTED', processed_at = now() WHERE id = p_event_id;

  SELECT name INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM public.hrms_notify_line_and_hr(auth.uid(), 'Reason submitted for leaving office',
    coalesce(v_name, 'An employee') || ': ' || left(btrim(p_reason), 140),
    'geofence_reason_submitted', 'geofence-reason-submitted:' || p_event_id, '/HRMS/admin/live-tracking',
    jsonb_build_object('geofenceEventId', p_event_id, 'reasonId', v_reason_id));
  RETURN jsonb_build_object('success', true, 'reason_id', v_reason_id);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_submit_geofence_reason(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_geofence_reason(uuid, text) TO authenticated;

-- 6g. Review by HR / anyone with live_tracking.view over that employee.
--     REJECTED deducts the configured compliance points (once).
CREATE OR REPLACE FUNCTION public.rpc_review_geofence_event(
  p_event_id uuid, p_decision text, p_comment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.geofence_events%rowtype;
  v_reason_id uuid;
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_points integer;
  v_month date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF v_decision NOT IN ('ACCEPTED', 'REJECTED', 'WAIVED') THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;
  SELECT * INTO v_event FROM public.geofence_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
  IF v_event.user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_REVIEW_OWN_EVENT'; END IF;
  IF NOT (public.is_profile_admin()
          OR public.can_access_user_data(v_event.user_id, 'live_tracking.view')) THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF v_decision = 'REJECTED' AND length(btrim(coalesce(p_comment, ''))) < 3 THEN
    RAISE EXCEPTION 'COMMENT_REQUIRED';
  END IF;

  SELECT id INTO v_reason_id FROM public.geofence_reasons WHERE geofence_event_id = p_event_id
  ORDER BY submitted_at DESC LIMIT 1;
  IF v_reason_id IS NULL THEN
    -- No reason given: the reviewer records the decision against an empty reason.
    INSERT INTO public.geofence_reasons (geofence_event_id, submitted_by, reason)
    VALUES (p_event_id, v_event.user_id, '(no reason submitted by the employee)')
    RETURNING id INTO v_reason_id;
  END IF;

  INSERT INTO public.geofence_reason_reviews (geofence_reason_id, reviewed_by, review_status, review_comment)
  VALUES (v_reason_id, auth.uid(), v_decision, nullif(btrim(coalesce(p_comment, '')), ''));
  UPDATE public.geofence_events SET status = 'CLOSED', processed_at = now() WHERE id = p_event_id;

  IF v_decision = 'REJECTED'
     AND to_regclass('public.compliance_score_deductions') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.compliance_score_deductions
                     WHERE source_table = 'geofence_events' AND source_id = p_event_id) THEN
    SELECT coalesce(max(default_deduction_amount), 5) INTO v_points FROM public.compliance_score_config
    WHERE violation_type = 'GEOFENCE_VIOLATION_REJECTED';
    v_month := date_trunc('month', (v_event.detected_at AT TIME ZONE 'Asia/Kolkata'))::date;
    INSERT INTO public.employee_compliance_scores (user_id, score_month, current_score)
    VALUES (v_event.user_id, v_month, 100) ON CONFLICT (user_id, score_month) DO NOTHING;
    UPDATE public.employee_compliance_scores
    SET current_score = greatest(0, current_score - v_points), updated_at = now()
    WHERE user_id = v_event.user_id AND score_month = v_month;
    INSERT INTO public.compliance_score_deductions
      (user_id, score_month, deduction_amount, reason, source_table, source_id, deducted_by)
    VALUES (v_event.user_id, v_month, v_points, 'Left office without an accepted reason',
            'geofence_events', p_event_id, auth.uid());
  END IF;

  PERFORM public.enqueue_hrms_notification(v_event.user_id,
    'Your reason was ' || lower(v_decision),
    coalesce(nullif(btrim(coalesce(p_comment, '')), ''), 'Your reason for leaving the office was reviewed.'),
    'geofence_reason_' || lower(v_decision), 'geofence-review:' || p_event_id,
    '/HRMS/notifications', NULL, NULL, jsonb_build_object('geofenceEventId', p_event_id));
  RETURN jsonb_build_object('success', true, 'decision', v_decision);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_review_geofence_event(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_review_geofence_event(uuid, text, text) TO authenticated;

-- Reviewer list: open office-exit events visible to the caller.
CREATE OR REPLACE FUNCTION public.rpc_geofence_review_queue(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(q) ORDER BY q.detected_at DESC), '[]'::jsonb)
  FROM (
    SELECT g.id, g.user_id, p.name AS employee_name, o.name AS office_name, g.status,
           g.detected_at, g.calculated_distance_m AS distance_m, g.accuracy_m,
           g.latitude, g.longitude,
           (SELECT gr.reason FROM public.geofence_reasons gr WHERE gr.geofence_event_id = g.id
            ORDER BY gr.submitted_at DESC LIMIT 1) AS reason,
           (SELECT gr.submitted_at FROM public.geofence_reasons gr WHERE gr.geofence_event_id = g.id
            ORDER BY gr.submitted_at DESC LIMIT 1) AS reason_at
    FROM public.geofence_events g
    JOIN public.profiles p ON p.id = g.user_id
    LEFT JOIN public.offices o ON o.id = g.geofence_id
    WHERE g.status IN ('PENDING_REASON', 'REASON_SUBMITTED')
      AND g.detected_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 60)))
      AND g.user_id <> auth.uid()
      AND (public.is_profile_admin() OR public.can_access_user_data(g.user_id, 'live_tracking.view'))
    LIMIT 200
  ) q;
$$;
REVOKE ALL ON FUNCTION public.rpc_geofence_review_queue(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_geofence_review_queue(integer) TO authenticated;

-- ─── 7. ALERT TYPES (either case) ────────────────────────────────────────────
ALTER TABLE public.location_alerts DROP CONSTRAINT IF EXISTS location_alerts_alert_type_check;
ALTER TABLE public.location_alerts ADD CONSTRAINT location_alerts_alert_type_check CHECK (
  lower(alert_type) IN ('gps_off', 'location_stale', 'health_warning', 'permission_revoked',
                        'geofence_exit', 'no_data', 'mocked_location', 'impossible_speed',
                        'shared_device')
) NOT VALID;

-- ─── 8. EXPIRED TEMPORARY GRANTS ─────────────────────────────────────────────
DO $$
DECLARE
  f record;
  v_def text;
  v_new text;
BEGIN
  FOR f IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('rpc_attendance_canonical_range', 'rpc_latest_location_pings')
      AND p.prosrc ~* 'user_permissions'
      AND p.prosrc !~* 'expires_at'
  LOOP
    v_def := pg_get_functiondef(f.oid);
    v_new := regexp_replace(v_def, '(\m\w+\.)?revoked_at\s+IS\s+NULL',
      '\1revoked_at IS NULL AND (\1expires_at IS NULL OR \1expires_at > now())', 'gi');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END $$;

-- ─── 9. SCHEDULES ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hrms-geofence-sweep-5min';
    PERFORM cron.schedule('hrms-geofence-sweep-5min', '*/5 * * * *',
      $job$ select public.hrms_geofence_sweep(); $job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed: schedule hrms_geofence_sweep() every 5 minutes.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (run after; read-only) ────────────────────────────────────────────
-- SELECT
--   has_table_privilege('authenticated','public.attendance_logs','UPDATE')                    AS emp_update_attendance,  -- false
--   has_table_privilege('authenticated','public.leave_requests','UPDATE')                     AS emp_update_leave,       -- false
--   has_table_privilege('authenticated','public.attendance_regularization_requests','UPDATE') AS emp_update_reg,         -- false
--   (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) FROM pg_proc p
--     WHERE p.proname = 'grant_weekly_off_comp_off')                                          AS anon_comp_off,          -- false
--   (SELECT late_checkin_time FROM attendance_policies ORDER BY 1 LIMIT 1)                    AS late_from,              -- 10:33:00
--   position('lower(r.status)' IN pg_get_viewdef('public.v_attendance_daily_canonical'::regclass)) > 0 AS leave_fixed,  -- true
--   (SELECT count(*) FROM cron.job WHERE jobname = 'hrms-geofence-sweep-5min')               AS geofence_job;           -- 1
