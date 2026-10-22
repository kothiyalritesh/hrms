-- =============================================================================
-- 20261008120000_fraud_compliance_notifications.sql
--
-- Run AFTER 20261008110000_site_visit_evidence_review.sql.
--
--   1. Fraud signals are produced, not only stored:
--        * a ping marked MOCKED                → SUSPICIOUS event (+ alert)
--        * a ping marked IMPOSSIBLE_SPEED      → WARNING event
--        * the same phone used by two people   → SUSPICIOUS event for both (+ alert)
--      One event per employee, type and day. Manager + HR are notified for
--      SUSPICIOUS events.
--   2. Fraud review: CONFIRMED / DISMISSED with notes; CONFIRMED deducts
--      compliance points once.
--   3. Compliance score: a row for every active employee each month, config
--      rows for late arrival / unapproved absence (0 points = off until HR sets
--      a value), nightly application for yesterday, employee + HR RPCs.
--   4. Notifications: managers no longer get two copies of a leave or
--      regularization request; regularization goes to HR of the same office
--      and can never block the request.
--   5. Security leftovers: visit feedback only on your own completed visit,
--      clock-drift view respects RLS, hierarchy changes by delegated users need
--      company-wide teams.manage.
-- Idempotent.
-- =============================================================================

SET statement_timeout = '10min';

-- ─── 1. Fraud events ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_fraud_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid REFERENCES public.attendance_logs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  severity text NOT NULL CHECK (severity IN ('NORMAL', 'WARNING', 'SUSPICIOUS')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  is_mocked boolean DEFAULT false,
  developer_mode boolean DEFAULT false,
  ip_latitude double precision,
  ip_longitude double precision,
  ip_gps_distance_m integer,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_fraud_events ADD COLUMN IF NOT EXISTS review_decision text;
ALTER TABLE public.attendance_fraud_events ADD COLUMN IF NOT EXISTS event_day date;
CREATE INDEX IF NOT EXISTS idx_attendance_fraud_score ON public.attendance_fraud_events (score DESC, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_fraud_events_daily_signal
  ON public.attendance_fraud_events (user_id, event_type, event_day) WHERE event_day IS NOT NULL;
ALTER TABLE public.attendance_fraud_events ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_fraud_events FROM anon, authenticated;
DROP POLICY IF EXISTS attendance_fraud_events_admin_select ON public.attendance_fraud_events;
CREATE POLICY attendance_fraud_events_admin_select ON public.attendance_fraud_events
  FOR SELECT TO authenticated
  USING (public.is_profile_admin() OR public.can_access_user_data(user_id, 'suspicious.view'));
GRANT SELECT ON public.attendance_fraud_events TO authenticated;

CREATE OR REPLACE FUNCTION public.hrms_record_fraud_signal(
  p_user_id uuid, p_event_type text, p_severity text, p_score integer, p_reasons jsonb,
  p_latitude double precision DEFAULT NULL, p_longitude double precision DEFAULT NULL,
  p_accuracy double precision DEFAULT NULL, p_mocked boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_id uuid;
  v_name text;
  v_attendance uuid;
BEGIN
  SELECT id INTO v_attendance FROM public.attendance_logs WHERE user_id = p_user_id AND date = v_day
  ORDER BY created_at LIMIT 1;
  INSERT INTO public.attendance_fraud_events (
    attendance_id, user_id, event_type, score, severity, reasons, latitude, longitude, accuracy_m, is_mocked, event_day
  ) VALUES (
    v_attendance, p_user_id, p_event_type, greatest(0, least(100, p_score)), p_severity, coalesce(p_reasons, '[]'::jsonb),
    p_latitude, p_longitude, p_accuracy, coalesce(p_mocked, false), v_day
  ) ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;  -- already recorded today

  IF p_severity = 'SUSPICIOUS' THEN
    SELECT name INTO v_name FROM public.profiles WHERE id = p_user_id;
    PERFORM public.hrms_notify_line_and_hr(p_user_id,
      'Suspicious attendance activity',
      coalesce(v_name, 'An employee') || ': ' || coalesce(p_reasons->>0, p_event_type),
      'fraud_suspicious', 'fraud:' || v_id, '/HRMS/admin/suspicious-attendance',
      jsonb_build_object('fraudEventId', v_id, 'userId', p_user_id));
  END IF;
  RETURN v_id;
EXCEPTION WHEN others THEN
  RAISE WARNING 'fraud signal skipped: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_record_fraud_signal(uuid, text, text, integer, jsonb, double precision, double precision, double precision, boolean)
  FROM public, anon, authenticated;

-- Pings flagged by the server's quality check.
CREATE OR REPLACE FUNCTION public.hrms_location_quality_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF new.quality_status = 'MOCKED' THEN
    IF public.hrms_record_fraud_signal(new.user_id, 'MOCK_LOCATION', 'SUSPICIOUS', 90,
         '["Location reported by a fake-GPS (mock location) app"]'::jsonb,
         new.latitude, new.longitude, new.accuracy, true) IS NOT NULL THEN
      INSERT INTO public.location_alerts (user_id, alert_type, message)
      SELECT new.user_id, 'mocked_location', coalesce(p.name, 'Employee') || ' is using a fake-GPS app.'
      FROM public.profiles p WHERE p.id = new.user_id;
    END IF;
  ELSIF new.quality_status = 'IMPOSSIBLE_SPEED' THEN
    PERFORM public.hrms_record_fraud_signal(new.user_id, 'IMPOSSIBLE_SPEED', 'WARNING', 60,
         '["Location jumped faster than 250 km/h between two readings"]'::jsonb,
         new.latitude, new.longitude, new.accuracy, false);
  END IF;
  RETURN new;
EXCEPTION WHEN others THEN
  RAISE WARNING 'location quality signal skipped: %', SQLERRM;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS hrms_location_quality_signal_trg ON public.location_tracking;
CREATE TRIGGER hrms_location_quality_signal_trg
AFTER INSERT ON public.location_tracking
FOR EACH ROW WHEN (new.quality_status IN ('MOCKED', 'IMPOSSIBLE_SPEED'))
EXECUTE FUNCTION public.hrms_location_quality_signal();

-- One phone, two employees.
CREATE OR REPLACE FUNCTION public.hrms_shared_device_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_me text;
BEGIN
  IF new.device_identifier IS NULL OR NOT coalesce(new.is_active, true) THEN RETURN new; END IF;
  SELECT name INTO v_me FROM public.profiles WHERE id = new.user_id;
  FOR r IN
    SELECT DISTINCT s.user_id, p.name
    FROM public.user_device_sessions s
    JOIN public.profiles p ON p.id = s.user_id AND coalesce(p.is_active, true)
    WHERE s.device_identifier = new.device_identifier
      AND s.user_id <> new.user_id
      AND s.last_active_at >= now() - interval '30 days'
  LOOP
    IF public.hrms_record_fraud_signal(new.user_id, 'SHARED_DEVICE', 'SUSPICIOUS', 80,
         jsonb_build_array('Same phone also used by ' || coalesce(r.name, 'another employee')),
         NULL, NULL, NULL, false) IS NOT NULL THEN
      INSERT INTO public.location_alerts (user_id, alert_type, message)
      VALUES (new.user_id, 'shared_device',
              coalesce(v_me, 'Employee') || ' and ' || coalesce(r.name, 'another employee') || ' use the same phone.');
    END IF;
    PERFORM public.hrms_record_fraud_signal(r.user_id, 'SHARED_DEVICE', 'SUSPICIOUS', 80,
         jsonb_build_array('Same phone also used by ' || coalesce(v_me, 'another employee')),
         NULL, NULL, NULL, false);
  END LOOP;
  RETURN new;
EXCEPTION WHEN others THEN
  RAISE WARNING 'shared device signal skipped: %', SQLERRM;
  RETURN new;
END;
$$;
DO $$
BEGIN
  IF to_regclass('public.user_device_sessions') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS hrms_shared_device_signal_trg ON public.user_device_sessions';
    EXECUTE 'CREATE TRIGGER hrms_shared_device_signal_trg
             AFTER INSERT OR UPDATE OF user_id, device_identifier, is_active ON public.user_device_sessions
             FOR EACH ROW EXECUTE FUNCTION public.hrms_shared_device_signal()';
  END IF;
END $$;

-- ─── 2. Fraud review ─────────────────────────────────────────────────────────
INSERT INTO public.compliance_score_config (violation_type, default_deduction_amount, description)
VALUES ('FRAUD_CONFIRMED', 10, 'Deduction when HR confirms suspicious attendance (fake GPS, shared phone)'),
       ('LATE_ARRIVAL', 0, 'Points per late arrival (0 = not counted)'),
       ('UNAPPROVED_ABSENCE', 0, 'Points per absent working day without leave (0 = not counted)')
ON CONFLICT (violation_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.hrms_apply_compliance_deduction(
  p_user_id uuid, p_violation text, p_month date, p_reason text,
  p_source_table text, p_source_id uuid, p_actor uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_points integer;
  v_month date := date_trunc('month', p_month)::date;
BEGIN
  SELECT default_deduction_amount INTO v_points FROM public.compliance_score_config WHERE violation_type = p_violation;
  IF coalesce(v_points, 0) = 0 THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.compliance_score_deductions
             WHERE source_table = p_source_table AND source_id = p_source_id AND user_id = p_user_id) THEN
    RETURN 0;
  END IF;
  INSERT INTO public.employee_compliance_scores (user_id, score_month, current_score)
  VALUES (p_user_id, v_month, 100) ON CONFLICT (user_id, score_month) DO NOTHING;
  UPDATE public.employee_compliance_scores
  SET current_score = greatest(0, least(100, current_score - v_points)), updated_at = now()
  WHERE user_id = p_user_id AND score_month = v_month;
  INSERT INTO public.compliance_score_deductions
    (user_id, score_month, deduction_amount, reason, source_table, source_id, deducted_by)
  VALUES (p_user_id, v_month, v_points, left(p_reason, 300), p_source_table, p_source_id, p_actor);
  RETURN v_points;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_apply_compliance_deduction(uuid, text, date, text, text, uuid, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_review_fraud_event(
  p_event_id uuid, p_decision text, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e public.attendance_fraud_events%rowtype;
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_points integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF v_decision NOT IN ('CONFIRMED', 'DISMISSED') THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;
  IF v_notes IS NULL OR length(v_notes) < 3 THEN RAISE EXCEPTION 'NOTES_REQUIRED'; END IF;
  SELECT * INTO e FROM public.attendance_fraud_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FRAUD_EVENT_NOT_FOUND'; END IF;
  IF e.user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_REVIEW_OWN_EVENT'; END IF;
  IF NOT (public.is_profile_admin() OR public.can_access_user_data(e.user_id, 'suspicious.view')) THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.attendance_fraud_events
  SET reviewed_at = now(), reviewed_by = auth.uid(), review_notes = left(v_notes, 500), review_decision = v_decision
  WHERE id = p_event_id;

  IF v_decision = 'CONFIRMED' THEN
    v_points := public.hrms_apply_compliance_deduction(e.user_id, 'FRAUD_CONFIRMED',
      coalesce(e.event_day, (e.created_at AT TIME ZONE 'Asia/Kolkata')::date),
      'Confirmed: ' || replace(lower(e.event_type), '_', ' ') || ' — ' || v_notes,
      'attendance_fraud_events', p_event_id, auth.uid());
    PERFORM public.enqueue_hrms_notification(e.user_id, 'Attendance issue confirmed',
      v_notes, 'fraud_confirmed', 'fraud-review:' || p_event_id, '/HRMS/account/profile', NULL, NULL,
      jsonb_build_object('fraudEventId', p_event_id));
  END IF;
  RETURN jsonb_build_object('success', true, 'decision', v_decision, 'points_deducted', v_points,
                            'event_id', p_event_id, 'reviewed_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_review_fraud_event(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_review_fraud_event(uuid, text, text) TO authenticated;

-- ─── 3. Compliance score ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hrms_open_compliance_month(p_month date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month date := date_trunc('month', coalesce(p_month, (now() AT TIME ZONE 'Asia/Kolkata')::date))::date;
  v_count integer;
BEGIN
  INSERT INTO public.employee_compliance_scores (user_id, score_month, current_score)
  SELECT p.id, v_month, 100 FROM public.profiles p WHERE coalesce(p.is_active, true)
  ON CONFLICT (user_id, score_month) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_open_compliance_month(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_open_compliance_month(date) TO service_role;
SELECT public.hrms_open_compliance_month(NULL);

-- Late arrivals and unapproved absences of one day (only when HR set points > 0).
CREATE OR REPLACE FUNCTION public.hrms_apply_attendance_compliance(p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date date := coalesce(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1);
  r record;
  v_late integer := 0;
  v_absent integer := 0;
BEGIN
  IF coalesce((SELECT default_deduction_amount FROM public.compliance_score_config WHERE violation_type = 'LATE_ARRIVAL'), 0) > 0 THEN
    FOR r IN SELECT a.id, a.user_id FROM public.attendance_logs a WHERE a.date = v_date AND a.is_late LOOP
      IF public.hrms_apply_compliance_deduction(r.user_id, 'LATE_ARRIVAL', v_date,
           'Late arrival on ' || to_char(v_date, 'DD Mon'), 'attendance_logs', r.id, NULL) > 0 THEN
        v_late := v_late + 1;
      END IF;
    END LOOP;
  END IF;
  IF coalesce((SELECT default_deduction_amount FROM public.compliance_score_config WHERE violation_type = 'UNAPPROVED_ABSENCE'), 0) > 0 THEN
    FOR r IN
      SELECT c.user_id FROM public.v_attendance_daily_canonical c
      WHERE c.work_date = v_date AND c.effective_status = 'ABSENT' AND coalesce(c.is_active, true)
    LOOP
      IF public.hrms_apply_compliance_deduction(r.user_id, 'UNAPPROVED_ABSENCE', v_date,
           'Absent without leave on ' || to_char(v_date, 'DD Mon'), 'attendance_absence',
           md5(r.user_id::text || ':' || v_date)::uuid, NULL) > 0 THEN
        v_absent := v_absent + 1;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('date', v_date, 'late', v_late, 'absent', v_absent);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_apply_attendance_compliance(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_apply_attendance_compliance(date) TO service_role;

-- Employee: own score this month with the reasons.
CREATE OR REPLACE FUNCTION public.rpc_my_compliance_score(p_month date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH m AS (SELECT date_trunc('month', coalesce(p_month, (now() AT TIME ZONE 'Asia/Kolkata')::date))::date AS month)
  SELECT jsonb_build_object(
    'month', m.month,
    'score', coalesce((SELECT current_score FROM public.employee_compliance_scores s
                       WHERE s.user_id = auth.uid() AND s.score_month = m.month), 100),
    'entries', coalesce((SELECT jsonb_agg(jsonb_build_object(
                  'points', -d.deduction_amount, 'reason', d.reason, 'at', d.created_at) ORDER BY d.created_at DESC)
                FROM public.compliance_score_deductions d
                WHERE d.user_id = auth.uid() AND d.score_month = m.month), '[]'::jsonb))
  FROM m;
$$;
REVOKE ALL ON FUNCTION public.rpc_my_compliance_score(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_my_compliance_score(date) TO authenticated;

-- HR / managers: scores of the employees they can see.
CREATE OR REPLACE FUNCTION public.rpc_compliance_scores(p_month date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH m AS (SELECT date_trunc('month', coalesce(p_month, (now() AT TIME ZONE 'Asia/Kolkata')::date))::date AS month)
  SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.score, x.name), '[]'::jsonb)
  FROM (
    SELECT p.id AS user_id, p.name, p.employee_number, o.name AS office_name,
           coalesce(s.current_score, 100) AS score,
           (SELECT count(*) FROM public.compliance_score_deductions d
            WHERE d.user_id = p.id AND d.score_month = m.month AND d.deduction_amount > 0) AS deductions,
           (SELECT d.reason FROM public.compliance_score_deductions d
            WHERE d.user_id = p.id AND d.score_month = m.month AND d.deduction_amount > 0
            ORDER BY d.created_at DESC LIMIT 1) AS last_reason
    FROM m
    CROSS JOIN public.profiles p
    LEFT JOIN public.offices o ON o.id = p.office_id
    LEFT JOIN public.employee_compliance_scores s ON s.user_id = p.id AND s.score_month = m.month
    WHERE coalesce(p.is_active, true)
      AND p.id <> auth.uid()
      AND (public.is_profile_admin() OR public.can_access_user_data(p.id, 'employees.view'))
  ) x;
$$;
REVOKE ALL ON FUNCTION public.rpc_compliance_scores(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_compliance_scores(date) TO authenticated;

-- ─── 4. Notifications without duplicates ─────────────────────────────────────
-- notify_leave_workflow_trg already notifies the manager; this trigger now
-- informs HR only.
DO $$
DECLARE v_def text;
BEGIN
  IF to_regprocedure('public.notify_on_leave_request()') IS NOT NULL THEN
    v_def := pg_get_functiondef('public.notify_on_leave_request()'::regprocedure);
    v_def := replace(v_def,
      'IF v_emp.reports_to IS NOT NULL AND v_emp.reports_to <> NEW.user_id THEN',
      'IF false /* manager is notified by notify_leave_workflow_trg */ THEN');
    EXECUTE v_def;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notify_on_regularization_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emp record;
  v_hr record;
  v_msg text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  BEGIN
    SELECT id, name, office_id, reports_to INTO v_emp FROM public.profiles WHERE id = NEW.user_id;
    v_msg := coalesce(v_emp.name, 'An employee') || ' requested attendance regularization.';
    -- The manager is notified by notify_regularization_workflow_trg.
    FOR v_hr IN
      SELECT p.id FROM public.profiles p
      WHERE upper(coalesce(p.role, '')) IN ('HR', 'HRD')
        AND coalesce(p.is_active, true)
        AND p.id <> NEW.user_id
        AND (v_emp.reports_to IS NULL OR p.id <> v_emp.reports_to)
        AND (p.office_id IS NULL OR v_emp.office_id IS NULL OR p.office_id = v_emp.office_id)
    LOOP
      INSERT INTO public.notifications (user_id, title, message, type, reference_id)
      VALUES (v_hr.id, 'Regularization: ' || coalesce(v_emp.name, 'Employee'), v_msg, 'REGULARIZATION_REQUEST', NEW.id);
    END LOOP;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'notify_on_regularization_request skipped for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Employees who are not expected at work on a date (weekly off / holiday);
-- used by the daily missed-check-in reminder.
CREATE OR REPLACE FUNCTION public.hrms_off_day_user_ids(p_date date)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(p.id), ARRAY[]::uuid[])
  FROM public.profiles p
  WHERE coalesce(p.is_active, true)
    AND coalesce(public.resolve_hrms_calendar_day(p.id, p_date)->>'kind', 'WORKING_DAY') IN ('WEEKLY_OFF', 'HOLIDAY');
$$;
REVOKE ALL ON FUNCTION public.hrms_off_day_user_ids(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_off_day_user_ids(date) TO service_role;

-- ─── 5. Security leftovers ───────────────────────────────────────────────────
-- Visit feedback only on your own completed visit.
DO $$
BEGIN
  IF to_regprocedure('public.submit_visit_feedback(uuid, integer, text)') IS NOT NULL
     AND to_regprocedure('public.submit_visit_feedback__core(uuid, integer, text)') IS NULL THEN
    ALTER FUNCTION public.submit_visit_feedback(uuid, integer, text) RENAME TO submit_visit_feedback__core;
    REVOKE ALL ON FUNCTION public.submit_visit_feedback__core(uuid, integer, text) FROM public, anon, authenticated;
  END IF;
  IF to_regprocedure('public.submit_visit_feedback__core(uuid, integer, text)') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.submit_visit_feedback(p_visit_id uuid, p_rating integer, p_notes text)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $b$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM public.field_visits
                       WHERE id = p_visit_id AND user_id = auth.uid() AND status = 'COMPLETED') THEN
          RAISE EXCEPTION 'FIELD_VISIT_NOT_FOUND';
        END IF;
        RETURN to_jsonb(public.submit_visit_feedback__core(p_visit_id, p_rating, p_notes));
      END $b$;
    $f$;
    REVOKE ALL ON FUNCTION public.submit_visit_feedback(uuid, integer, text) FROM public, anon;
    GRANT EXECUTE ON FUNCTION public.submit_visit_feedback(uuid, integer, text) TO authenticated;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'submit_visit_feedback not wrapped: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF to_regclass('public.v_location_clock_drift_analysis') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.v_location_clock_drift_analysis SET (security_invoker = true)';
  END IF;
  IF to_regclass('public.upcoming_birthdays_30_days') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.upcoming_birthdays_30_days FROM anon';
  END IF;
END $$;

-- Hierarchy changes by delegated users need company-wide teams.manage.
DO $$
BEGIN
  IF to_regprocedure('public.hrms_install_permission_wrapper(text, text, text, text, text)') IS NOT NULL THEN
    PERFORM public.hrms_install_permission_wrapper('rpc_admin_update_hierarchy',
      $k$ARRAY['teams.manage']$k$, NULL, NULL, $x$public.hrms_has_global_permission('teams.manage')$x$);
    PERFORM public.hrms_install_permission_wrapper('rpc_admin_update_hierarchy_v2',
      $k$ARRAY['teams.manage']$k$, NULL, NULL, $x$public.hrms_has_global_permission('teams.manage')$x$);
    PERFORM public.hrms_install_permission_wrapper('rpc_admin_apply_hierarchy_import',
      $k$ARRAY['teams.manage']$k$, NULL, NULL, $x$public.hrms_has_global_permission('teams.manage')$x$);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'hierarchy wrappers unchanged: %', SQLERRM;
END $$;

-- ─── 6. Schedules ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job
    WHERE jobname IN ('hrms-compliance-open-month', 'hrms-compliance-attendance-daily');
    -- 00:10 IST daily (idempotent; creates the new month's rows on the 1st)
    PERFORM cron.schedule('hrms-compliance-open-month', '40 18 * * *',
      $job$ select public.hrms_open_compliance_month((now() at time zone 'Asia/Kolkata')::date); $job$);
    -- 00:30 IST daily, for yesterday
    PERFORM cron.schedule('hrms-compliance-attendance-daily', '0 19 * * *',
      $job$ select public.hrms_apply_attendance_compliance(null); $job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed: schedule hrms_open_compliance_month() monthly and hrms_apply_attendance_compliance() daily.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
