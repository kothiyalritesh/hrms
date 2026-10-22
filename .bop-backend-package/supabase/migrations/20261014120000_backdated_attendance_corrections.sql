-- =============================================================================
-- 20261014120000_backdated_attendance_corrections.sql
--
-- HR-assisted backdated attendance correction.
--
-- An employee could not check in or out (no network at a remote site, HRMS or
-- device failure). HR verifies the evidence and records the actual times for
-- that day. The result goes into attendance_logs with the existing ADMIN
-- correction convention, so the dashboard, the employee's month, Attendance
-- Control and every report show the same day.
--
--  * attendance_corrections: one row per correction, never deleted; only the
--    workflow functions below may change its status.
--  * Permissions: attendance.backdate_correct (submit), attendance.backdate_approve
--    (approve high-risk ones). Data admins (SYSTEM_ADMIN/ADMIN/HR/HRD) have both,
--    as with every other attendance permission; others need a grant.
--  * Window: current and previous month (IST), not before joining, not after
--    the last working day, no future times.
--  * Risk: routine corrections apply at once. High-risk ones (older than 7 days,
--    an existing check-in or biometric punches, holiday / weekly off, half-day
--    leave, an earlier correction, evidence not verified, over 12 hours) wait
--    for a second person, who may be neither the submitter nor the employee.
--  * A day with approved full-day leave is refused.
--  * Every applied correction: attendance_audit_logs + hrms_audit_events row,
--    and a notification to the employee naming the date, reason and HR officer.
--  * rpc_sync_biometric_punches no longer replaces an HR-corrected check-in.
--
-- Employee regularization requests (the main flow) use the same table and the
-- same apply step:
--  * the employee raises a request for an absent day of their own (last N days,
--    attendance_runtime_settings.regularization_request_window_days, default 7);
--    nothing changes until it is approved;
--  * admins and the employee's HR (HR/HRD of the same office) are notified;
--  * a reviewer with approval rights (never the employee) approves, rejects
--    with a reason, or returns it for more information, which the employee
--    answers; after a rejection a new request can be raised, linked to it;
--  * approval re-checks the day, then applies atomically; every step is kept
--    in attendance_correction_events.
-- Idempotent.
-- =============================================================================

-- ─── 1. Permissions ──────────────────────────────────────────────────────────

INSERT INTO public.permissions (permission_key, module, action, label, description, scoped, risk_level, aliases, sort_order, is_active)
VALUES
  ('attendance.backdate_correct', 'Attendance', 'create', 'Backdated attendance correction',
   'Record attendance for a past day of an employee in scope, with evidence', true, 'HIGH', '{}', 22, true),
  ('attendance.backdate_approve', 'Attendance', 'approve', 'Approve backdated corrections',
   'Approve or reject high-risk backdated corrections in scope', true, 'HIGH', '{}', 22, true)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, label = EXCLUDED.label,
  description = EXCLUDED.description, scoped = EXCLUDED.scoped,
  risk_level = EXCLUDED.risk_level, sort_order = EXCLUDED.sort_order, is_active = true;

-- ─── 2. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.attendance_corrections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES public.profiles(id),
  business_date           date NOT NULL,
  reason_code             text NOT NULL CHECK (reason_code IN
                            ('POOR_NETWORK','REMOTE_SITE_VISIT','HRMS_FAILURE','DEVICE_LOCATION_ISSUE','OTHER')),
  remarks                 text NOT NULL,
  site_name               text,
  office_id               uuid,
  checkin_at              timestamptz NOT NULL,
  checkout_at             timestamptz,
  evidence_type           text NOT NULL CHECK (evidence_type IN
                            ('WHATSAPP_LOCATION','SITE_VISIT_RECORD','SUPERVISOR_CONFIRMATION',
                             'CLIENT_CONFIRMATION','EMPLOYEE_EXPLANATION','OTHER')),
  evidence_source         text NOT NULL,
  evidence_details        text,
  evidence_verification   text NOT NULL CHECK (evidence_verification IN ('VERIFIED','PARTIALLY_VERIFIED','UNVERIFIED')),
  acknowledgement_version text NOT NULL,
  acknowledgement_text    text NOT NULL,
  acknowledged_at         timestamptz NOT NULL DEFAULT now(),
  risk_level              text NOT NULL CHECK (risk_level IN ('ROUTINE','HIGH')),
  risk_reasons            jsonb NOT NULL DEFAULT '[]'::jsonb,
  original_snapshot       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                  text NOT NULL CHECK (status IN ('PENDING_APPROVAL','APPLIED','REJECTED','CANCELLED')),
  attendance_id           uuid,
  applied_values          jsonb,
  requested_by            uuid NOT NULL REFERENCES public.profiles(id),
  requested_at            timestamptz NOT NULL DEFAULT now(),
  decided_by              uuid REFERENCES public.profiles(id),
  decided_at              timestamptz,
  decision_notes          text,
  applied_at              timestamptz,
  idempotency_key         uuid NOT NULL UNIQUE
);
-- Employee requests share this table: origin says who raised it.
ALTER TABLE public.attendance_corrections ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'HR_ENTRY';
ALTER TABLE public.attendance_corrections ADD COLUMN IF NOT EXISTS request_type text;
ALTER TABLE public.attendance_corrections ADD COLUMN IF NOT EXISTS location_evidence text;
ALTER TABLE public.attendance_corrections ADD COLUMN IF NOT EXISTS parent_request_id uuid REFERENCES public.attendance_corrections(id);
ALTER TABLE public.attendance_corrections DROP CONSTRAINT IF EXISTS attendance_corrections_status_check;
ALTER TABLE public.attendance_corrections ADD CONSTRAINT attendance_corrections_status_check
  CHECK (status IN ('PENDING_APPROVAL','NEEDS_INFO','APPLIED','REJECTED','CANCELLED'));
ALTER TABLE public.attendance_corrections DROP CONSTRAINT IF EXISTS attendance_corrections_origin_check;
ALTER TABLE public.attendance_corrections ADD CONSTRAINT attendance_corrections_origin_check
  CHECK (origin IN ('HR_ENTRY','EMPLOYEE_REQUEST'));
CREATE INDEX IF NOT EXISTS attendance_corrections_user_day ON public.attendance_corrections (user_id, business_date);
CREATE INDEX IF NOT EXISTS attendance_corrections_status ON public.attendance_corrections (status, requested_at DESC);
-- One open request per employee-day.
DROP INDEX IF EXISTS public.attendance_corrections_one_pending;
CREATE UNIQUE INDEX attendance_corrections_one_pending
  ON public.attendance_corrections (user_id, business_date) WHERE status IN ('PENDING_APPROVAL','NEEDS_INFO');

-- Every step of a request (submitted, returned for information, answered,
-- approved, rejected, applied, withdrawn) with who did it. Never changed.
CREATE TABLE IF NOT EXISTS public.attendance_correction_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_id uuid NOT NULL REFERENCES public.attendance_corrections(id),
  event_type    text NOT NULL CHECK (event_type IN
                  ('SUBMITTED','RETURNED_FOR_INFO','INFO_PROVIDED','APPROVED','REJECTED','APPLIED','WITHDRAWN')),
  actor_user_id uuid NOT NULL REFERENCES public.profiles(id),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()   -- steps in one transaction keep their order
);
ALTER TABLE public.attendance_correction_events ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE INDEX IF NOT EXISTS attendance_correction_events_correction
  ON public.attendance_correction_events (correction_id, created_at);
CREATE OR REPLACE FUNCTION public.hrms_attendance_correction_events_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'ATTENDANCE_CORRECTION_HISTORY_IS_PERMANENT' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS hrms_attendance_correction_events_guard_trg ON public.attendance_correction_events;
CREATE TRIGGER hrms_attendance_correction_events_guard_trg
  BEFORE UPDATE OR DELETE ON public.attendance_correction_events
  FOR EACH ROW EXECUTE FUNCTION public.hrms_attendance_correction_events_guard();
ALTER TABLE public.attendance_correction_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_correction_events FROM anon, authenticated;

-- How many days back an employee may request (HR/Admin can change it).
ALTER TABLE public.attendance_runtime_settings
  ADD COLUMN IF NOT EXISTS regularization_request_window_days integer NOT NULL DEFAULT 7;
ALTER TABLE public.attendance_runtime_settings DROP CONSTRAINT IF EXISTS attendance_runtime_settings_regularization_window_check;
ALTER TABLE public.attendance_runtime_settings ADD CONSTRAINT attendance_runtime_settings_regularization_window_check
  CHECK (regularization_request_window_days BETWEEN 1 AND 62);
INSERT INTO public.attendance_runtime_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Rows are never deleted, and only the workflow may move a pending row on.
CREATE OR REPLACE FUNCTION public.hrms_attendance_corrections_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ATTENDANCE_CORRECTIONS_ARE_PERMANENT' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('hrms.attendance_correction_workflow', true), '') <> 'on' THEN
    RAISE EXCEPTION 'ATTENDANCE_CORRECTIONS_CHANGE_ONLY_THROUGH_WORKFLOW' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.business_date, NEW.reason_code, NEW.remarks, NEW.site_name, NEW.office_id,
      NEW.checkin_at, NEW.checkout_at, NEW.evidence_type, NEW.evidence_source, NEW.evidence_details,
      NEW.evidence_verification, NEW.acknowledgement_version, NEW.acknowledgement_text, NEW.acknowledged_at,
      NEW.risk_level, NEW.risk_reasons, NEW.original_snapshot, NEW.requested_by, NEW.requested_at,
      NEW.idempotency_key, NEW.origin, NEW.request_type, NEW.location_evidence, NEW.parent_request_id)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.business_date, OLD.reason_code, OLD.remarks, OLD.site_name, OLD.office_id,
      OLD.checkin_at, OLD.checkout_at, OLD.evidence_type, OLD.evidence_source, OLD.evidence_details,
      OLD.evidence_verification, OLD.acknowledgement_version, OLD.acknowledgement_text, OLD.acknowledged_at,
      OLD.risk_level, OLD.risk_reasons, OLD.original_snapshot, OLD.requested_by, OLD.requested_at,
      OLD.idempotency_key, OLD.origin, OLD.request_type, OLD.location_evidence, OLD.parent_request_id) THEN
    RAISE EXCEPTION 'ATTENDANCE_CORRECTION_DETAILS_ARE_PERMANENT' USING ERRCODE = '42501';
  END IF;
  -- Open requests may move on; a decided one only gets its applied values once.
  IF OLD.status NOT IN ('PENDING_APPROVAL', 'NEEDS_INFO')
     AND NOT (OLD.status = 'APPLIED' AND NEW.status = 'APPLIED' AND OLD.applied_at IS NULL) THEN
    RAISE EXCEPTION 'ATTENDANCE_CORRECTION_ALREADY_DECIDED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hrms_attendance_corrections_guard_trg ON public.attendance_corrections;
CREATE TRIGGER hrms_attendance_corrections_guard_trg
  BEFORE UPDATE OR DELETE ON public.attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION public.hrms_attendance_corrections_guard();

ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_corrections FROM anon, authenticated;
GRANT SELECT ON public.attendance_corrections TO authenticated;
DROP POLICY IF EXISTS attendance_corrections_select ON public.attendance_corrections;
CREATE POLICY attendance_corrections_select ON public.attendance_corrections
  FOR SELECT TO authenticated
  USING (public.can_access_user_data(user_id, 'attendance.backdate_correct')
         OR public.can_access_user_data(user_id, 'attendance.backdate_approve')
         OR public.can_access_user_data(user_id, 'attendance.view'));

-- ─── 3. Helpers ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hrms_correction_ack_text()
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'I have verified the available evidence and confirm that the entered attendance details are accurate to the best of my knowledge. I accept responsibility for submitting this correction.'::text
$$;

CREATE OR REPLACE FUNCTION public.hrms_correction_can_submit(p_actor uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_actor IS NOT NULL AND p_actor <> p_user
     AND (public.hrms_is_admin_user(p_actor) OR public.can_access_user_data(p_user, 'attendance.backdate_correct'))
$$;

CREATE OR REPLACE FUNCTION public.hrms_correction_can_approve(p_actor uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_actor IS NOT NULL AND p_actor <> p_user
     AND (public.hrms_is_admin_user(p_actor)
          OR public.can_access_user_data(p_user, 'attendance.backdate_approve')
          OR public.can_access_user_data(p_user, 'regularization.approve'))
$$;

CREATE OR REPLACE FUNCTION public.hrms_correction_event(p_id uuid, p_type text, p_actor uuid, p_notes text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.attendance_correction_events (correction_id, event_type, actor_user_id, notes)
  VALUES (p_id, p_type, p_actor, nullif(btrim(coalesce(p_notes, '')), ''))
$$;
REVOKE ALL ON FUNCTION public.hrms_correction_event(uuid, text, uuid, text) FROM public, anon, authenticated;

-- A new or answered employee request goes to the admins and the employee's
-- HR (HR / HRD of the same office, or HR without an office).
CREATE OR REPLACE FUNCTION public.hrms_notify_regularization_reviewers(p_id uuid, p_title text, p_message text, p_key text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid;
  v_count integer := 0;
  r record;
BEGIN
  SELECT user_id INTO v_user FROM public.attendance_corrections WHERE id = p_id;
  FOR r IN
    SELECT DISTINCT h.id
    FROM public.profiles s
    JOIN public.profiles h ON coalesce(h.is_active, true) AND h.id <> s.id
     AND (upper(coalesce(h.role, '')) IN ('ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN')
          OR (upper(coalesce(h.role, '')) IN ('HR', 'HRD')
              AND (h.office_id IS NULL OR s.office_id IS NULL OR h.office_id = s.office_id)))
    WHERE s.id = v_user
  LOOP
    BEGIN
      PERFORM public.enqueue_hrms_notification(r.id, p_title, p_message, 'attendance_regularization_request',
        p_key || ':' || r.id, '/HRMS/admin/backdated-attendance');
      v_count := v_count + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'reviewer notification skipped: %', SQLERRM;
    END;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_notify_regularization_reviewers(uuid, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.hrms_correction_can_submit(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.hrms_correction_can_approve(uuid, uuid) FROM public, anon;

-- Everything already known about one employee-day (shown to HR before submit,
-- and stored with the correction as the "before" picture).
CREATE OR REPLACE FUNCTION public.hrms_correction_day_context(p_user uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_att      jsonb;
  v_bio      jsonb;
  v_fv       jsonb;
  v_leave    jsonb;
  v_calendar jsonb;
  v_prev     jsonb;
  v_reg      jsonb := '[]'::jsonb;
BEGIN
  SELECT jsonb_build_object(
           'id', a.id, 'checkin_time', a.checkin_time, 'checkout_time', a.checkout_time,
           'checkin_source', a.checkin_source, 'checkout_source', a.checkout_source, 'status', a.status,
           'biometric_first_punch', a.biometric_first_punch, 'biometric_last_punch', a.biometric_last_punch)
    INTO v_att
  FROM public.attendance_logs a
  WHERE a.user_id = p_user AND a.date = p_date
  ORDER BY a.created_at NULLS LAST
  LIMIT 1;

  SELECT CASE WHEN count(*) > 0 THEN jsonb_build_object('count', count(*), 'first', min(l.log_date), 'last', max(l.log_date)) END
    INTO v_bio
  FROM public.smartoffice_device_logs l
  WHERE l.user_id = p_user AND l.log_date_only = p_date;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'name', coalesce(f.location_name, f.project_name), 'status', f.status,
           'verification_status', f.verification_status,
           'checkin_time', f.checkin_time, 'checkout_time', f.checkout_time) ORDER BY f.checkin_time NULLS LAST), '[]'::jsonb)
    INTO v_fv
  FROM public.field_visits f
  WHERE f.user_id = p_user AND f.date = p_date;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'leave_type', r.leave_type, 'is_half_day', coalesce(r.is_half_day, false))), '[]'::jsonb)
    INTO v_leave
  FROM public.leave_requests r
  WHERE r.user_id = p_user AND lower(r.status::text) = 'approved'
    AND p_date BETWEEN r.start_date AND r.end_date;

  BEGIN
    v_calendar := public.resolve_hrms_calendar_day(p_user, p_date);
  EXCEPTION WHEN others THEN
    v_calendar := NULL;
  END;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'status', c.status, 'checkin_at', c.checkin_at, 'checkout_at', c.checkout_at,
           'requested_at', c.requested_at) ORDER BY c.requested_at), '[]'::jsonb)
    INTO v_prev
  FROM public.attendance_corrections c
  WHERE c.user_id = p_user AND c.business_date = p_date AND c.status IN ('PENDING_APPROVAL','APPLIED');

  IF v_att IS NOT NULL AND to_regclass('public.attendance_regularization_requests') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'request_type', request_type,
                                                    'requested_checkout', requested_checkout)), '[]'::jsonb)
      FROM public.attendance_regularization_requests
      WHERE attendance_id = $1 AND upper(status::text) = 'APPROVED'
    $q$ INTO v_reg USING (v_att->>'id')::uuid;
  END IF;

  RETURN jsonb_build_object(
    'attendance', v_att, 'biometric', v_bio, 'field_visits', v_fv, 'leave', v_leave,
    'calendar', v_calendar, 'corrections', v_prev, 'approved_regularizations', coalesce(v_reg, '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_correction_day_context(uuid, date) FROM public, anon, authenticated;

-- Writes an approved correction into attendance_logs (caller holds the lock).
CREATE OR REPLACE FUNCTION public.hrms_apply_attendance_correction(p_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c          public.attendance_corrections%ROWTYPE;
  v_rec      public.attendance_logs%ROWTYPE;
  v_found    boolean;
  v_checkout timestamptz;
  v_status   text;
  v_name     text;
  v_officer  text;
  v_reason   text;
BEGIN
  SELECT * INTO c FROM public.attendance_corrections WHERE id = p_id;
  SELECT * INTO v_rec FROM public.attendance_logs
   WHERE user_id = c.user_id AND date = c.business_date
   ORDER BY created_at NULLS LAST LIMIT 1
   FOR UPDATE;
  v_found := FOUND;

  -- Accepted by the protected-checkout constraint trigger at commit.
  PERFORM set_config('app.authorized_attendance_correction', 'REGULARIZATION', true);
  v_reason := format('Backdated correction %s: %s', c.reason_code, c.remarks);

  IF v_found THEN
    v_checkout := coalesce(c.checkout_at, CASE WHEN v_rec.checkout_time > c.checkin_at THEN v_rec.checkout_time END);
    v_status := CASE WHEN v_checkout IS NOT NULL THEN 'ADMIN_CORRECTED' ELSE 'CHECKED_IN' END;
    UPDATE public.attendance_logs SET
      checkin_time      = c.checkin_at,
      app_checkin_time  = c.checkin_at,
      checkin_source    = 'ADMIN',
      checkout_time     = v_checkout,
      checkout_source   = CASE WHEN c.checkout_at IS NOT NULL THEN 'ADMIN' ELSE checkout_source END,
      status            = v_status,
      office_id         = coalesce(office_id, c.office_id),
      corrected_by      = c.requested_by,
      correction_reason = v_reason,
      updated_at        = now()
    WHERE id = v_rec.id;
  ELSE
    v_checkout := c.checkout_at;
    v_status := CASE WHEN v_checkout IS NOT NULL THEN 'ADMIN_CORRECTED' ELSE 'CHECKED_IN' END;
    INSERT INTO public.attendance_logs (
      user_id, date, attendance_type, office_id, checkin_source, status, attendance_state,
      attendance_status, day_status, checkin_time, app_checkin_time, checkout_time, checkout_source,
      corrected_by, correction_reason, updated_at
    ) VALUES (
      c.user_id, c.business_date, CASE WHEN c.office_id IS NULL THEN 'FIELD' ELSE 'OFFICE' END, c.office_id,
      'ADMIN', v_status, 'WORKING', 'PRESENT', 'P', c.checkin_at, c.checkin_at, v_checkout,
      CASE WHEN v_checkout IS NOT NULL THEN 'ADMIN' END,
      c.requested_by, v_reason, now()
    ) RETURNING * INTO v_rec;
  END IF;

  INSERT INTO public.attendance_audit_logs (
    attendance_id, user_id, action, old_status, new_status,
    old_checkout_at, new_checkout_at, old_checkin_at, new_checkin_at,
    reason, source, actor_user_id
  ) VALUES (
    v_rec.id, c.user_id, 'BACKDATED_CORRECTION',
    CASE WHEN v_found THEN v_rec.status END, v_status,
    CASE WHEN v_found THEN (c.original_snapshot->'attendance'->>'checkout_time')::timestamptz END, v_checkout,
    CASE WHEN v_found THEN (c.original_snapshot->'attendance'->>'checkin_time')::timestamptz END, c.checkin_at,
    v_reason, 'ADMIN', p_actor
  );

  INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, old_values, new_values, source)
  VALUES (p_actor, c.user_id, 'BACKDATED_ATTENDANCE_CORRECTION', 'attendance_correction', c.id,
          c.original_snapshot,
          jsonb_build_object('attendance_id', v_rec.id, 'business_date', c.business_date,
                             'checkin_at', c.checkin_at, 'checkout_at', v_checkout,
                             'submitted_by', c.requested_by, 'approved_by', c.decided_by,
                             'risk_level', c.risk_level),
          'ADMIN');

  PERFORM set_config('hrms.attendance_correction_workflow', 'on', true);
  UPDATE public.attendance_corrections SET
    status = 'APPLIED', attendance_id = v_rec.id, applied_at = now(),
    applied_values = jsonb_build_object('checkin_at', c.checkin_at, 'checkout_at', v_checkout, 'status', v_status)
  WHERE id = c.id;
  PERFORM public.hrms_correction_event(c.id, 'APPLIED', p_actor,
    format('Attendance set to %s%s (IST)',
           to_char(c.checkin_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
           CASE WHEN v_checkout IS NOT NULL THEN '-' || to_char(v_checkout AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') ELSE '' END));

  SELECT name INTO v_officer FROM public.profiles WHERE id = c.requested_by;
  BEGIN
    PERFORM public.enqueue_hrms_notification(
      c.user_id,
      CASE WHEN c.origin = 'EMPLOYEE_REQUEST' THEN 'Regularization approved' ELSE 'Attendance corrected' END,
      format(CASE WHEN c.origin = 'EMPLOYEE_REQUEST'
                  THEN 'Your regularization request for %s was approved by %s: in %s%s. Reason: %s.'
                  ELSE 'Your attendance for %s was recorded by %s: in %s%s. Reason: %s.' END,
             to_char(c.business_date, 'DD Mon YYYY'),
             coalesce(CASE WHEN c.origin = 'EMPLOYEE_REQUEST'
                           THEN (SELECT name FROM public.profiles WHERE id = p_actor) ELSE v_officer END, 'HR'),
             to_char(c.checkin_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'),
             CASE WHEN v_checkout IS NOT NULL
                  THEN ', out ' || to_char(v_checkout AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') ELSE '' END,
             replace(lower(c.reason_code), '_', ' ')),
      'attendance_corrected',
      'attendance-correction:' || c.id,
      '/HRMS/attendance');
  EXCEPTION WHEN others THEN
    RAISE WARNING 'correction notification skipped: %', SQLERRM;
  END;

  RETURN jsonb_build_object('attendance_id', v_rec.id, 'checkin_at', c.checkin_at,
                            'checkout_at', v_checkout, 'status', v_status);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_apply_attendance_correction(uuid, uuid) FROM public, anon, authenticated;

-- ─── 4. Workflow RPCs ────────────────────────────────────────────────────────

-- Employees HR may correct, with search.
CREATE OR REPLACE FUNCTION public.rpc_attendance_correction_employees(p_search text DEFAULT NULL)
RETURNS TABLE (id uuid, name text, employee_number text, office_id uuid, office_name text,
               joining_date date, last_working_date date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_from date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date) - interval '1 month')::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.name::text, p.employee_number::text, p.office_id, o.name::text,
           p.joining_date::date, p.last_working_date
    FROM public.profiles p
    LEFT JOIN public.offices o ON o.id = p.office_id
    WHERE p.id <> v_uid
      AND (coalesce(p.is_active, true) OR p.last_working_date >= v_from)
      AND (p_search IS NULL OR btrim(p_search) = ''
           OR p.name ILIKE '%' || btrim(p_search) || '%'
           OR p.employee_number::text ILIKE '%' || btrim(p_search) || '%')
      AND public.hrms_correction_can_submit(v_uid, p.id)
    ORDER BY p.name
    LIMIT 25;
END;
$$;

-- What already exists for the day, the allowed window and the acknowledgement.
CREATE OR REPLACE FUNCTION public.rpc_attendance_correction_preview(p_user_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NOT public.hrms_correction_can_submit(v_uid, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN',
                              'message', 'You cannot correct this employee''s attendance.');
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'window_start', (date_trunc('month', v_today) - interval '1 month')::date,
    'window_end', v_today,
    'acknowledgement_version', 'v1',
    'acknowledgement_text', public.hrms_correction_ack_text(),
    'context', public.hrms_correction_day_context(p_user_id, p_date));
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_attendance_correction_submit(
  p_user_id                uuid,
  p_business_date          date,
  p_reason_code            text,
  p_remarks                text,
  p_checkin_at             timestamptz,
  p_checkout_at            timestamptz,
  p_evidence_type          text,
  p_evidence_source        text,
  p_evidence_verification  text,
  p_acknowledged           boolean,
  p_acknowledgement_version text,
  p_idempotency_key        uuid,
  p_site_name              text DEFAULT NULL,
  p_office_id              uuid DEFAULT NULL,
  p_evidence_details       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_today    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_from     date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date) - interval '1 month')::date;
  v_profile  public.profiles%ROWTYPE;
  v_existing public.attendance_corrections%ROWTYPE;
  v_ctx      jsonb;
  v_risks    jsonb := '[]'::jsonb;
  v_id       uuid;
  v_applied  jsonb;
  v_kind     text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', 'Sign in again.');
  END IF;
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED', 'message', 'Missing request id.');
  END IF;

  -- A retried submit returns the first result.
  SELECT * INTO v_existing FROM public.attendance_corrections WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.requested_by <> v_uid THEN
      RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REUSED', 'message', 'Request id already used.');
    END IF;
    RETURN jsonb_build_object('success', true, 'replayed', true, 'correction_id', v_existing.id,
                              'status', v_existing.status, 'risk_level', v_existing.risk_level,
                              'risk_reasons', v_existing.risk_reasons);
  END IF;

  IF p_user_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_CORRECTION_FORBIDDEN',
                              'message', 'You cannot correct your own attendance. Ask another admin or HR.');
  END IF;
  IF NOT public.hrms_correction_can_submit(v_uid, p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN',
                              'message', 'You are not allowed to correct this employee''s attendance.');
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_NOT_FOUND', 'message', 'Employee not found.');
  END IF;

  -- Date and times.
  IF p_business_date IS NULL OR p_business_date > v_today OR p_business_date < v_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'DATE_OUTSIDE_WINDOW',
      'message', format('Choose a date from %s to %s.', to_char(v_from, 'DD Mon YYYY'), to_char(v_today, 'DD Mon YYYY')));
  END IF;
  IF v_profile.joining_date IS NOT NULL AND p_business_date < v_profile.joining_date::date THEN
    RETURN jsonb_build_object('success', false, 'error', 'BEFORE_JOINING', 'message', 'This date is before the employee joined.');
  END IF;
  IF v_profile.last_working_date IS NOT NULL AND p_business_date > v_profile.last_working_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'AFTER_LAST_WORKING_DAY', 'message', 'This date is after the employee''s last working day.');
  END IF;
  IF p_checkin_at IS NULL OR (p_checkin_at AT TIME ZONE 'Asia/Kolkata')::date <> p_business_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'CHECKIN_WRONG_DAY',
      'message', format('Check-in must be on %s (IST).', to_char(p_business_date, 'DD Mon YYYY')));
  END IF;
  IF p_checkin_at > now() OR (p_checkout_at IS NOT NULL AND p_checkout_at > now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FUTURE_TIME', 'message', 'Times cannot be in the future.');
  END IF;
  IF p_checkout_at IS NOT NULL AND p_checkout_at <= p_checkin_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'CHECKOUT_BEFORE_CHECKIN', 'message', 'Check-out must be after check-in.');
  END IF;
  IF p_checkout_at IS NOT NULL AND p_checkout_at > p_checkin_at + interval '16 hours' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_TOO_LONG', 'message', 'Check-out must be within 16 hours of check-in.');
  END IF;
  IF p_checkout_at IS NULL AND p_business_date < v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'CHECKOUT_REQUIRED', 'message', 'Enter the check-out time for a past day.');
  END IF;

  -- Reason, evidence, acknowledgement.
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('POOR_NETWORK','REMOTE_SITE_VISIT','HRMS_FAILURE','DEVICE_LOCATION_ISSUE','OTHER') THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED', 'message', 'Choose a reason.');
  END IF;
  IF p_remarks IS NULL OR length(btrim(p_remarks)) < 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'REMARKS_REQUIRED',
                              'message', 'Describe the site, purpose and how it was verified (at least 10 characters).');
  END IF;
  IF p_evidence_type IS NULL OR p_evidence_type NOT IN ('WHATSAPP_LOCATION','SITE_VISIT_RECORD','SUPERVISOR_CONFIRMATION','CLIENT_CONFIRMATION','EMPLOYEE_EXPLANATION','OTHER')
     OR p_evidence_source IS NULL OR length(btrim(p_evidence_source)) < 3
     OR p_evidence_verification IS NULL OR p_evidence_verification NOT IN ('VERIFIED','PARTIALLY_VERIFIED','UNVERIFIED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'EVIDENCE_REQUIRED',
                              'message', 'Record the evidence type, where it came from and whether it was verified.');
  END IF;
  IF p_acknowledged IS NOT TRUE OR coalesce(p_acknowledgement_version, '') <> 'v1' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ACKNOWLEDGEMENT_REQUIRED', 'message', 'Tick the acknowledgement to submit.');
  END IF;

  -- One change at a time per employee-day (also serialises with check-in/out).
  PERFORM pg_advisory_xact_lock(hashtextextended('att-corr:' || p_user_id || ':' || p_business_date, 0));

  IF EXISTS (SELECT 1 FROM public.attendance_corrections
             WHERE user_id = p_user_id AND business_date = p_business_date AND status IN ('PENDING_APPROVAL', 'NEEDS_INFO')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PENDING_CORRECTION_EXISTS',
                              'message', 'A correction or request for this day is already open.');
  END IF;

  v_ctx := public.hrms_correction_day_context(p_user_id, p_business_date);

  -- Blocking conflicts.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ctx->'leave') l WHERE (l->>'is_half_day')::boolean IS NOT TRUE) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ON_APPROVED_LEAVE',
      'message', 'The employee has approved full-day leave on this date. Cancel the leave first.');
  END IF;
  IF jsonb_array_length(v_ctx->'approved_regularizations') > 0 AND p_checkout_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'CHECKOUT_ALREADY_REGULARIZED',
      'message', 'This day''s check-out was already set by an approved regularization request. Leave check-out empty or change it there.');
  END IF;

  -- High-risk signals.
  IF p_business_date < v_today - 7 THEN
    v_risks := v_risks || jsonb_build_array('More than 7 days old');
  END IF;
  IF (v_ctx->'attendance'->>'checkin_time') IS NOT NULL THEN
    v_risks := v_risks || jsonb_build_array('Replaces a check-in that already exists');
  END IF;
  IF v_ctx->'biometric' IS NOT NULL AND v_ctx->'biometric' <> 'null'::jsonb THEN
    v_risks := v_risks || jsonb_build_array('Biometric punches exist for this day');
  END IF;
  v_kind := upper(coalesce(v_ctx->'calendar'->>'kind', ''));
  IF v_kind IN ('HOLIDAY', 'WEEKLY_OFF') THEN
    v_risks := v_risks || jsonb_build_array(CASE WHEN v_kind = 'HOLIDAY' THEN 'Holiday' ELSE 'Weekly off' END
                                            || ' (working on it may earn a comp-off)');
  END IF;
  IF jsonb_array_length(v_ctx->'leave') > 0 THEN
    v_risks := v_risks || jsonb_build_array('Half-day leave approved on this day');
  END IF;
  IF jsonb_array_length(v_ctx->'corrections') > 0 THEN
    v_risks := v_risks || jsonb_build_array('Corrected before');
  END IF;
  IF p_evidence_verification <> 'VERIFIED' THEN
    v_risks := v_risks || jsonb_build_array('Evidence not fully verified');
  END IF;
  IF p_checkout_at IS NOT NULL AND p_checkout_at > p_checkin_at + interval '12 hours' THEN
    v_risks := v_risks || jsonb_build_array('More than 12 working hours');
  END IF;

  INSERT INTO public.attendance_corrections (
    user_id, business_date, reason_code, remarks, site_name, office_id, checkin_at, checkout_at,
    evidence_type, evidence_source, evidence_details, evidence_verification,
    acknowledgement_version, acknowledgement_text, acknowledged_at,
    risk_level, risk_reasons, original_snapshot, status, requested_by, idempotency_key
  ) VALUES (
    p_user_id, p_business_date, p_reason_code, btrim(p_remarks), nullif(btrim(coalesce(p_site_name, '')), ''),
    coalesce(p_office_id, v_profile.office_id), p_checkin_at, p_checkout_at,
    p_evidence_type, btrim(p_evidence_source), nullif(btrim(coalesce(p_evidence_details, '')), ''), p_evidence_verification,
    'v1', public.hrms_correction_ack_text(), now(),
    CASE WHEN jsonb_array_length(v_risks) > 0 THEN 'HIGH' ELSE 'ROUTINE' END, v_risks, v_ctx,
    CASE WHEN jsonb_array_length(v_risks) > 0 THEN 'PENDING_APPROVAL' ELSE 'APPLIED' END,
    v_uid, p_idempotency_key
  ) RETURNING id INTO v_id;
  PERFORM public.hrms_correction_event(v_id, 'SUBMITTED', v_uid, 'Recorded by HR');

  IF jsonb_array_length(v_risks) = 0 THEN
    v_applied := public.hrms_apply_attendance_correction(v_id, v_uid);
    RETURN jsonb_build_object('success', true, 'correction_id', v_id, 'status', 'APPLIED',
                              'risk_level', 'ROUTINE', 'risk_reasons', v_risks, 'applied', v_applied,
                              'message', 'Attendance corrected. The employee has been notified.');
  END IF;

  RETURN jsonb_build_object('success', true, 'correction_id', v_id, 'status', 'PENDING_APPROVAL',
                            'risk_level', 'HIGH', 'risk_reasons', v_risks,
                            'message', 'Saved. Another authorised person must approve this correction before it applies.');
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_attendance_corrections_list(text, date, date, integer, integer);

CREATE OR REPLACE FUNCTION public.rpc_attendance_correction_decide(p_correction_id uuid, p_approve boolean, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  c         public.attendance_corrections%ROWTYPE;
  v_ctx     jsonb;
  v_applied jsonb;
  v_name    text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', 'Sign in again.');
  END IF;
  SELECT * INTO c FROM public.attendance_corrections WHERE id = p_correction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Request not found.');
  END IF;
  IF v_uid = c.requested_by OR v_uid = c.user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SEPARATION_OF_DUTIES',
                              'message', 'Someone other than the requester and the employee must decide.');
  END IF;
  IF NOT public.hrms_correction_can_approve(v_uid, c.user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN',
                              'message', 'You are not allowed to decide requests for this employee.');
  END IF;
  IF NOT coalesce(p_approve, false) AND (p_notes IS NULL OR length(btrim(p_notes)) < 3) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOTES_REQUIRED', 'message', 'Write why it is rejected.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('att-corr:' || c.user_id || ':' || c.business_date, 0));
  SELECT * INTO c FROM public.attendance_corrections WHERE id = p_correction_id FOR UPDATE;
  IF c.status NOT IN ('PENDING_APPROVAL', 'NEEDS_INFO') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_DECIDED',
                              'message', 'This request was already ' || lower(replace(c.status, '_', ' ')) || '.');
  END IF;

  -- Checked again at approval: the day may have changed since the request.
  IF p_approve THEN
    v_ctx := public.hrms_correction_day_context(c.user_id, c.business_date);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ctx->'leave') l WHERE (l->>'is_half_day')::boolean IS NOT TRUE) THEN
      RETURN jsonb_build_object('success', false, 'error', 'ON_APPROVED_LEAVE',
        'message', 'The employee now has approved full-day leave on this date. Reject this request or cancel the leave.');
    END IF;
    IF jsonb_array_length(v_ctx->'approved_regularizations') > 0 AND c.checkout_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'CHECKOUT_ALREADY_REGULARIZED',
        'message', 'This day''s check-out was already set by an approved check-out regularization.');
    END IF;
  END IF;

  PERFORM set_config('hrms.attendance_correction_workflow', 'on', true);
  UPDATE public.attendance_corrections SET
    status = CASE WHEN p_approve THEN 'APPLIED' ELSE 'REJECTED' END,
    decided_by = v_uid, decided_at = now(), decision_notes = nullif(btrim(coalesce(p_notes, '')), '')
  WHERE id = c.id;
  PERFORM public.hrms_correction_event(c.id, CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END, v_uid, p_notes);

  SELECT name INTO v_name FROM public.profiles WHERE id = c.user_id;
  IF p_approve THEN
    v_applied := public.hrms_apply_attendance_correction(c.id, v_uid);
  END IF;

  BEGIN
    IF c.origin = 'EMPLOYEE_REQUEST' THEN
      IF NOT p_approve THEN   -- approval is announced by the apply step
        PERFORM public.enqueue_hrms_notification(
          c.user_id, 'Regularization rejected',
          format('Your regularization request for %s was rejected: %s', to_char(c.business_date, 'DD Mon YYYY'), btrim(p_notes)),
          'attendance_regularization_decision', 'attendance-correction-decision:' || c.id, '/HRMS/attendance');
      END IF;
    ELSE
      PERFORM public.enqueue_hrms_notification(
        c.requested_by,
        CASE WHEN p_approve THEN 'Attendance correction approved' ELSE 'Attendance correction rejected' END,
        format('%s, %s%s', coalesce(v_name, 'Employee'), to_char(c.business_date, 'DD Mon YYYY'),
               CASE WHEN NOT p_approve THEN ': ' || btrim(p_notes) ELSE '' END),
        'attendance_correction_decision', 'attendance-correction-decision:' || c.id, '/HRMS/admin/backdated-attendance');
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'correction decision notification skipped: %', SQLERRM;
  END;

  RETURN jsonb_build_object('success', true, 'status', CASE WHEN p_approve THEN 'APPLIED' ELSE 'REJECTED' END,
                            'applied', v_applied);
END;
$$;

-- Reviewer asks the employee for more information (request stays open).
CREATE OR REPLACE FUNCTION public.rpc_attendance_correction_return(p_correction_id uuid, p_notes text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  c     public.attendance_corrections%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.attendance_corrections WHERE id = p_correction_id FOR UPDATE;
  IF NOT FOUND OR v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Request not found.');
  END IF;
  IF c.origin <> 'EMPLOYEE_REQUEST' THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AN_EMPLOYEE_REQUEST', 'message', 'Only employee requests can be returned.');
  END IF;
  IF v_uid = c.user_id OR NOT public.hrms_correction_can_approve(v_uid, c.user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'You are not allowed to review this request.');
  END IF;
  IF p_notes IS NULL OR length(btrim(p_notes)) < 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOTES_REQUIRED', 'message', 'Write what information is needed.');
  END IF;
  IF c.status <> 'PENDING_APPROVAL' THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_PENDING', 'message', 'Only a pending request can be returned.');
  END IF;
  PERFORM set_config('hrms.attendance_correction_workflow', 'on', true);
  UPDATE public.attendance_corrections SET status = 'NEEDS_INFO', decision_notes = btrim(p_notes) WHERE id = c.id;
  PERFORM public.hrms_correction_event(c.id, 'RETURNED_FOR_INFO', v_uid, p_notes);
  BEGIN
    PERFORM public.enqueue_hrms_notification(
      c.user_id, 'More information needed',
      format('HR needs more information for your regularization request of %s: %s',
             to_char(c.business_date, 'DD Mon YYYY'), btrim(p_notes)),
      'attendance_regularization_info', 'attendance-correction-info:' || c.id || ':' || extract(epoch FROM now())::bigint,
      '/HRMS/attendance');
  EXCEPTION WHEN others THEN
    RAISE WARNING 'info request notification skipped: %', SQLERRM;
  END;
  RETURN jsonb_build_object('success', true, 'status', 'NEEDS_INFO');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_attendance_correction_cancel(p_correction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  c     public.attendance_corrections%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.attendance_corrections WHERE id = p_correction_id FOR UPDATE;
  IF NOT FOUND OR v_uid IS NULL OR c.requested_by <> v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Only the person who raised it can withdraw it.');
  END IF;
  IF c.status NOT IN ('PENDING_APPROVAL', 'NEEDS_INFO') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_DECIDED', 'message', 'It was already decided.');
  END IF;
  PERFORM set_config('hrms.attendance_correction_workflow', 'on', true);
  UPDATE public.attendance_corrections
     SET status = 'CANCELLED', decided_by = v_uid, decided_at = now(), decision_notes = 'Withdrawn'
   WHERE id = c.id;
  PERFORM public.hrms_correction_event(c.id, 'WITHDRAWN', v_uid, NULL);
  RETURN jsonb_build_object('success', true, 'status', 'CANCELLED');
END;
$$;

-- ─── 5. Employee regularization requests ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hrms_regularization_declaration_text()
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'I confirm that the requested attendance details are accurate and understand that the request will be verified before any correction is applied.'::text
$$;

CREATE OR REPLACE FUNCTION public.rpc_my_regularization_policy()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'window_days', coalesce((SELECT regularization_request_window_days FROM public.attendance_runtime_settings LIMIT 1), 7),
    'today', (now() AT TIME ZONE 'Asia/Kolkata')::date,
    'declaration_version', 'v1',
    'declaration_text', public.hrms_regularization_declaration_text())
$$;

CREATE OR REPLACE FUNCTION public.rpc_regularization_request_submit(
  p_business_date        date,
  p_checkin_at           timestamptz,
  p_checkout_at          timestamptz,
  p_reason_code          text,
  p_explanation          text,
  p_evidence_type        text,
  p_evidence_source      text,
  p_declared             boolean,
  p_declaration_version  text,
  p_idempotency_key      uuid,
  p_site_name            text DEFAULT NULL,
  p_evidence_details     text DEFAULT NULL,
  p_location_evidence    text DEFAULT NULL,
  p_parent_request_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_today    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_window   integer;
  v_profile  public.profiles%ROWTYPE;
  v_existing public.attendance_corrections%ROWTYPE;
  v_ctx      jsonb;
  v_risks    jsonb := '[]'::jsonb;
  v_kind     text;
  v_id       uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', 'Sign in again.');
  END IF;
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED', 'message', 'Missing request id.');
  END IF;
  SELECT * INTO v_existing FROM public.attendance_corrections WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.requested_by <> v_uid THEN
      RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REUSED', 'message', 'Request id already used.');
    END IF;
    RETURN jsonb_build_object('success', true, 'replayed', true, 'request_id', v_existing.id, 'status', v_existing.status);
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT coalesce(v_profile.is_active, true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_INACTIVE', 'message', 'Your account is inactive.');
  END IF;

  SELECT coalesce(regularization_request_window_days, 7) INTO v_window FROM public.attendance_runtime_settings LIMIT 1;
  v_window := coalesce(v_window, 7);
  IF p_business_date IS NULL OR p_business_date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'FUTURE_DATE', 'message', 'You can only request a past day.');
  END IF;
  IF p_business_date < v_today - v_window THEN
    RETURN jsonb_build_object('success', false, 'error', 'OUTSIDE_REQUEST_WINDOW',
      'message', format('Requests can be raised for the last %s days only. For an older day, contact HR.', v_window));
  END IF;
  IF v_profile.joining_date IS NOT NULL AND p_business_date < v_profile.joining_date::date THEN
    RETURN jsonb_build_object('success', false, 'error', 'BEFORE_JOINING', 'message', 'This date is before your joining date.');
  END IF;

  IF p_checkin_at IS NULL OR p_checkout_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TIMES_REQUIRED', 'message', 'Enter both check-in and check-out times.');
  END IF;
  IF (p_checkin_at AT TIME ZONE 'Asia/Kolkata')::date <> p_business_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'CHECKIN_WRONG_DAY',
      'message', format('Check-in must be on %s.', to_char(p_business_date, 'DD Mon YYYY')));
  END IF;
  IF p_checkin_at > now() OR p_checkout_at > now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'FUTURE_TIME', 'message', 'Times cannot be in the future.');
  END IF;
  IF p_checkout_at <= p_checkin_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'CHECKOUT_BEFORE_CHECKIN', 'message', 'Check-out must be after check-in.');
  END IF;
  IF p_checkout_at > p_checkin_at + interval '16 hours' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_TOO_LONG', 'message', 'Check-out must be within 16 hours of check-in.');
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('POOR_NETWORK','REMOTE_SITE_VISIT','HRMS_FAILURE','DEVICE_LOCATION_ISSUE','OTHER') THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED', 'message', 'Choose a reason.');
  END IF;
  IF p_explanation IS NULL OR length(btrim(p_explanation)) < 15 THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPLANATION_REQUIRED',
                              'message', 'Explain what happened (at least 15 characters).');
  END IF;
  IF p_evidence_type IS NULL OR p_evidence_type NOT IN ('WHATSAPP_LOCATION','SITE_VISIT_RECORD','SUPERVISOR_CONFIRMATION','CLIENT_CONFIRMATION','EMPLOYEE_EXPLANATION','OTHER')
     OR p_evidence_source IS NULL OR length(btrim(p_evidence_source)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'EVIDENCE_REQUIRED',
                              'message', 'Say what evidence you have and where HR can find it.');
  END IF;
  IF p_declared IS NOT TRUE OR coalesce(p_declaration_version, '') <> 'v1' THEN
    RETURN jsonb_build_object('success', false, 'error', 'DECLARATION_REQUIRED', 'message', 'Tick the declaration to submit.');
  END IF;
  IF p_parent_request_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.attendance_corrections
       WHERE id = p_parent_request_id AND user_id = v_uid AND business_date = p_business_date
         AND status IN ('REJECTED', 'CANCELLED')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PARENT', 'message', 'The earlier request does not match this day.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('att-corr:' || v_uid || ':' || p_business_date, 0));

  IF EXISTS (SELECT 1 FROM public.attendance_corrections
             WHERE user_id = v_uid AND business_date = p_business_date AND status IN ('PENDING_APPROVAL', 'NEEDS_INFO')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_ALREADY_OPEN',
                              'message', 'You already have an open request for this day.');
  END IF;

  v_ctx := public.hrms_correction_day_context(v_uid, p_business_date);
  IF (v_ctx->'attendance'->>'checkin_time') IS NOT NULL
     OR (v_ctx->'biometric' IS NOT NULL AND v_ctx->'biometric' <> 'null'::jsonb)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ctx->'field_visits') f
                WHERE f->>'checkin_time' IS NOT NULL AND coalesce(f->>'verification_status', '') <> 'REJECTED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ATTENDANCE_EXISTS',
      'message', 'Attendance is already recorded for this day. For a missing check-out, use check-out regularization.');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ctx->'leave') l WHERE (l->>'is_half_day')::boolean IS NOT TRUE) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ON_APPROVED_LEAVE', 'message', 'You have approved leave on this day.');
  END IF;

  -- Shown to the reviewer.
  v_kind := upper(coalesce(v_ctx->'calendar'->>'kind', ''));
  IF v_kind IN ('HOLIDAY', 'WEEKLY_OFF') THEN
    v_risks := v_risks || jsonb_build_array(CASE WHEN v_kind = 'HOLIDAY' THEN 'Holiday' ELSE 'Weekly off' END
                                            || ' (working on it may earn a comp-off)');
  END IF;
  IF jsonb_array_length(v_ctx->'leave') > 0 THEN
    v_risks := v_risks || jsonb_build_array('Half-day leave approved on this day');
  END IF;
  IF jsonb_array_length(v_ctx->'corrections') > 0 THEN
    v_risks := v_risks || jsonb_build_array('Corrected before');
  END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_corrections
             WHERE user_id = v_uid AND business_date = p_business_date AND status = 'REJECTED') THEN
    v_risks := v_risks || jsonb_build_array('Earlier request for this day was rejected');
  END IF;
  IF p_checkout_at > p_checkin_at + interval '12 hours' THEN
    v_risks := v_risks || jsonb_build_array('More than 12 working hours');
  END IF;

  INSERT INTO public.attendance_corrections (
    user_id, business_date, reason_code, remarks, site_name, office_id, checkin_at, checkout_at,
    evidence_type, evidence_source, evidence_details, evidence_verification,
    acknowledgement_version, acknowledgement_text, acknowledged_at,
    risk_level, risk_reasons, original_snapshot, status, requested_by, idempotency_key,
    origin, request_type, location_evidence, parent_request_id
  ) VALUES (
    v_uid, p_business_date, p_reason_code, btrim(p_explanation), nullif(btrim(coalesce(p_site_name, '')), ''),
    v_profile.office_id, p_checkin_at, p_checkout_at,
    p_evidence_type, btrim(p_evidence_source), nullif(btrim(coalesce(p_evidence_details, '')), ''), 'UNVERIFIED',
    'v1', public.hrms_regularization_declaration_text(), now(),
    CASE WHEN jsonb_array_length(v_risks) > 0 THEN 'HIGH' ELSE 'ROUTINE' END, v_risks, v_ctx,
    'PENDING_APPROVAL', v_uid, p_idempotency_key,
    'EMPLOYEE_REQUEST', 'MISSED_CHECKIN_AND_CHECKOUT', nullif(btrim(coalesce(p_location_evidence, '')), ''), p_parent_request_id
  ) RETURNING id INTO v_id;
  PERFORM public.hrms_correction_event(v_id, 'SUBMITTED', v_uid, NULL);

  PERFORM public.hrms_notify_regularization_reviewers(v_id,
    'Regularization request',
    format('%s (%s) requested attendance for %s: %s-%s. Reason: %s.',
           coalesce(v_profile.name, 'An employee'), coalesce(v_profile.employee_number::text, '-'),
           to_char(p_business_date, 'DD Mon YYYY'),
           to_char(p_checkin_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'),
           to_char(p_checkout_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'),
           replace(lower(p_reason_code), '_', ' ')),
    'regularization-request:' || v_id);

  RETURN jsonb_build_object('success', true, 'request_id', v_id, 'status', 'PENDING_APPROVAL',
    'message', 'Request sent. HR will review it; your attendance changes only if it is approved.');
END;
$$;

-- Employee answers a "more information needed" request.
CREATE OR REPLACE FUNCTION public.rpc_regularization_request_respond(p_request_id uuid, p_information text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  c     public.attendance_corrections%ROWTYPE;
  v_name text;
BEGIN
  SELECT * INTO c FROM public.attendance_corrections WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_uid IS NULL OR c.user_id <> v_uid OR c.origin <> 'EMPLOYEE_REQUEST' THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Request not found.');
  END IF;
  IF c.status <> 'NEEDS_INFO' THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_WAITING_FOR_INFO', 'message', 'HR has not asked for more information.');
  END IF;
  IF p_information IS NULL OR length(btrim(p_information)) < 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INFORMATION_REQUIRED', 'message', 'Write the information HR asked for.');
  END IF;
  PERFORM set_config('hrms.attendance_correction_workflow', 'on', true);
  UPDATE public.attendance_corrections SET status = 'PENDING_APPROVAL' WHERE id = c.id;
  PERFORM public.hrms_correction_event(c.id, 'INFO_PROVIDED', v_uid, p_information);
  SELECT name INTO v_name FROM public.profiles WHERE id = v_uid;
  PERFORM public.hrms_notify_regularization_reviewers(c.id, 'Regularization: information added',
    format('%s added information to the request for %s.', coalesce(v_name, 'An employee'), to_char(c.business_date, 'DD Mon YYYY')),
    'regularization-info:' || c.id || ':' || extract(epoch FROM now())::bigint);
  RETURN jsonb_build_object('success', true, 'status', 'PENDING_APPROVAL');
END;
$$;

-- The signed-in employee's own requests, with their history.
CREATE OR REPLACE FUNCTION public.rpc_my_regularization_requests(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x.requested_at DESC), '[]'::jsonb)
  FROM (
    SELECT c.id, c.business_date, c.status, c.reason_code, c.remarks AS explanation, c.site_name,
           c.checkin_at, c.checkout_at, c.evidence_type, c.evidence_source, c.evidence_details,
           c.location_evidence, c.decision_notes, c.requested_at, c.decided_at, c.parent_request_id,
           d.name AS decided_by_name,
           coalesce((SELECT jsonb_agg(jsonb_build_object('event_type', e.event_type, 'notes', e.notes,
                                                         'created_at', e.created_at, 'actor_name', a.name)
                                      ORDER BY e.created_at)
                     FROM public.attendance_correction_events e
                     JOIN public.profiles a ON a.id = e.actor_user_id
                     WHERE e.correction_id = c.id), '[]'::jsonb) AS events
    FROM public.attendance_corrections c
    LEFT JOIN public.profiles d ON d.id = c.decided_by
    WHERE c.user_id = auth.uid() AND c.origin = 'EMPLOYEE_REQUEST'
      AND (p_from IS NULL OR c.business_date >= p_from)
      AND (p_to IS NULL OR c.business_date <= p_to)
  ) x
$$;

CREATE OR REPLACE FUNCTION public.rpc_attendance_corrections_list(
  p_status text DEFAULT NULL,
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_origin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_rows   jsonb;
  v_total  integer;
  v_counts jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  WITH visible AS (
    SELECT c.* FROM public.attendance_corrections c
    WHERE c.user_id <> v_uid
      AND (public.hrms_is_admin_user(v_uid)
           OR c.requested_by = v_uid
           OR public.can_access_user_data(c.user_id, 'attendance.backdate_correct')
           OR public.can_access_user_data(c.user_id, 'attendance.backdate_approve')
           OR public.can_access_user_data(c.user_id, 'regularization.view')
           OR public.can_access_user_data(c.user_id, 'regularization.approve'))
      AND (p_origin IS NULL OR c.origin = p_origin)
  ), filtered AS (
    SELECT * FROM visible
    WHERE (p_status IS NULL OR status = p_status
           OR (p_status = 'OPEN' AND status IN ('PENDING_APPROVAL', 'NEEDS_INFO')))
      AND (p_from IS NULL OR business_date >= p_from)
      AND (p_to IS NULL OR business_date <= p_to)
  )
  SELECT (SELECT count(*) FROM filtered),
         (SELECT jsonb_build_object(
            'pending',  count(*) FILTER (WHERE status = 'PENDING_APPROVAL'),
            'needs_info', count(*) FILTER (WHERE status = 'NEEDS_INFO'),
            'applied',  count(*) FILTER (WHERE status = 'APPLIED'),
            'rejected', count(*) FILTER (WHERE status = 'REJECTED')) FROM visible),
         coalesce((SELECT jsonb_agg(row_to_json(x) ORDER BY x.requested_at DESC) FROM (
           SELECT f.*, e.name AS employee_name, e.employee_number, r.name AS requested_by_name,
                  d.name AS decided_by_name,
                  public.hrms_correction_can_approve(v_uid, f.user_id) AND v_uid <> f.requested_by AS can_decide,
                  f.requested_by = v_uid AS can_cancel,
                  coalesce((SELECT jsonb_agg(jsonb_build_object('event_type', ev.event_type, 'notes', ev.notes,
                                                                'created_at', ev.created_at, 'actor_name', a.name)
                                             ORDER BY ev.created_at)
                            FROM public.attendance_correction_events ev
                            JOIN public.profiles a ON a.id = ev.actor_user_id
                            WHERE ev.correction_id = f.id), '[]'::jsonb) AS events
           FROM filtered f
           JOIN public.profiles e ON e.id = f.user_id
           JOIN public.profiles r ON r.id = f.requested_by
           LEFT JOIN public.profiles d ON d.id = f.decided_by
           ORDER BY f.requested_at DESC
           LIMIT greatest(1, least(coalesce(p_limit, 50), 200)) OFFSET greatest(0, coalesce(p_offset, 0))
         ) x), '[]'::jsonb)
    INTO v_total, v_counts, v_rows;
  RETURN jsonb_build_object('total', v_total, 'pending', (v_counts->>'pending')::int, 'counts', v_counts, 'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_attendance_correction_employees(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_attendance_correction_preview(uuid, date) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_attendance_correction_submit(uuid, date, text, text, timestamptz, timestamptz, text, text, text, boolean, text, uuid, text, uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_attendance_correction_decide(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_attendance_correction_cancel(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_attendance_corrections_list(text, date, date, integer, integer, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_attendance_correction_return(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_my_regularization_policy() FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_regularization_request_submit(date, timestamptz, timestamptz, text, text, text, text, boolean, text, uuid, text, text, text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_regularization_request_respond(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_my_regularization_requests(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_correction_employees(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_correction_preview(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_correction_submit(uuid, date, text, text, timestamptz, timestamptz, text, text, text, boolean, text, uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_correction_decide(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_correction_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_corrections_list(text, date, date, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_correction_return(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_my_regularization_policy() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_regularization_request_submit(date, timestamptz, timestamptz, text, text, text, text, boolean, text, uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_regularization_request_respond(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_my_regularization_requests(date, date) TO authenticated;

-- ─── 6. Biometric sync keeps an HR-corrected check-in ────────────────────────

DO $$
DECLARE
  v_def text;
  v_new text;
  a1 text := $a$checkin_time = CASE(\s+)WHEN attendance_logs\.checkin_time IS NULL THEN EXCLUDED\.checkin_time$a$;
  a2 text := $a$checkin_source = CASE(\s+)WHEN attendance_logs\.checkin_time IS NULL THEN 'BIOMETRIC'$a$;
BEGIN
  IF to_regprocedure('public.rpc_sync_biometric_punches(jsonb)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.rpc_sync_biometric_punches(jsonb)'::regprocedure);
  IF position('HRMS_KEEP_ADMIN_CHECKIN' IN v_def) > 0 THEN RETURN; END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, a1, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, a2, 'g')) <> 1 THEN
    RAISE EXCEPTION 'rpc_sync_biometric_punches: check-in upsert not found exactly once';
  END IF;
  v_new := regexp_replace(v_def, a1, $b$checkin_time = CASE\1/* HRMS_KEEP_ADMIN_CHECKIN: a check-in set by HR stays as HR set it. */\1WHEN attendance_logs.checkin_source = 'ADMIN' AND attendance_logs.checkin_time IS NOT NULL THEN attendance_logs.checkin_time\1WHEN attendance_logs.checkin_time IS NULL THEN EXCLUDED.checkin_time$b$);
  v_new := regexp_replace(v_new, a2, $b$checkin_source = CASE\1WHEN attendance_logs.checkin_source = 'ADMIN' AND attendance_logs.checkin_time IS NOT NULL THEN 'ADMIN'\1WHEN attendance_logs.checkin_time IS NULL THEN 'BIOMETRIC'$b$);
  EXECUTE v_new;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- SELECT permission_key, is_active FROM permissions WHERE permission_key LIKE 'attendance.backdate%';
-- SELECT position('HRMS_KEEP_ADMIN_CHECKIN' IN pg_get_functiondef('public.rpc_sync_biometric_punches(jsonb)'::regprocedure)) > 0 AS biometric_ok;
-- SELECT origin, status, count(*) FROM attendance_corrections GROUP BY 1, 2;
-- SELECT regularization_request_window_days FROM attendance_runtime_settings;   -- change with UPDATE (1-62)
