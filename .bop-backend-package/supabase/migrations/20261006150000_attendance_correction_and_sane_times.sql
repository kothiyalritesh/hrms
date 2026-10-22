-- =============================================================================
-- 20261006150000_attendance_correction_and_sane_times.sql
--
-- Fixes the "Correct Attendance" flow and impossible times in Attendance Control
-- (example: Kiranpal Singh, 2026-10-06: check-in 10:22 IST from the app,
--  "checkout" 10:16 IST = his single biometric punch).
--
-- 1. rpc_admin_correct_attendance (same signature, the app is unchanged):
--    • authorizes the SIGNED-IN user (auth.uid()); the old version trusted the
--      p_admin_id sent by the browser, so anyone could pass an admin's id;
--    • allowed: data admins (SYSTEM_ADMIN/ADMIN/HR/HRD) or attendance.regularize
--      covering the employee; nobody corrects their own record;
--    • validates: check-in on the record's IST date, checkout after check-in and
--      within 24 h, nothing in the future;
--    • sets the authorized-correction flag, so same-day checkout corrections no
--      longer fail at commit (CHECKOUT_REQUIRES_HRMS_OR_AUTHORIZED_CORRECTION);
--    • a corrected check-in is what reports show (app_checkin_time + source ADMIN),
--      and the late flag is recomputed by the existing trigger (10:32 rule);
--    • audit row keeps old and new check-in and checkout.
-- 2. rpc_attendance_canonical_range (wrapper from 20261006130000), same signature:
--    • first-in = EARLIEST of app / biometric / field-visit evidence
--      (an admin-corrected check-in always wins);
--    • a "checkout" that is not after the first-in is ignored, so a single
--      biometric punch can no longer appear as a checkout before the check-in;
--    • working minutes and CHECKED_OUT/CHECKED_IN status follow those values.
-- Idempotent. Requires 20261006130000.
-- =============================================================================

ALTER TABLE public.attendance_audit_logs ADD COLUMN IF NOT EXISTS old_checkin_at timestamptz;
ALTER TABLE public.attendance_audit_logs ADD COLUMN IF NOT EXISTS new_checkin_at timestamptz;
ALTER TABLE public.attendance_audit_logs ADD COLUMN IF NOT EXISTS actor_user_id uuid;

-- ─── 1. Admin correction ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_admin_correct_attendance(
  p_admin_id      uuid,                       -- ignored (kept for app compatibility)
  p_attendance_id uuid,
  p_new_checkin   timestamptz DEFAULT NULL,
  p_new_checkout  timestamptz DEFAULT NULL,
  p_new_status    varchar     DEFAULT NULL,
  p_reason        text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_rec      public.attendance_logs%ROWTYPE;
  v_checkin  timestamptz;
  v_checkout timestamptz;
  v_status   text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', 'Sign in again.');
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED',
                              'message', 'A reason (at least 3 characters) is required.');
  END IF;

  SELECT * INTO v_rec FROM public.attendance_logs WHERE id = p_attendance_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND',
      'message', 'No app attendance record exists for this day. Ask the employee to submit a regularization, or check the biometric data.');
  END IF;

  IF v_rec.user_id = v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_CORRECTION_FORBIDDEN',
                              'message', 'You cannot correct your own attendance. Ask another admin or HR.');
  END IF;
  IF NOT (public.hrms_is_admin_user(v_actor)
          OR public.can_access_user_data(v_rec.user_id, 'attendance.regularize')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN',
                              'message', 'You are not allowed to correct this employee''s attendance.');
  END IF;

  IF p_new_checkin IS NULL AND p_new_checkout IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOTHING_TO_CHANGE', 'message', 'Change the check-in or checkout time.');
  END IF;

  v_checkin  := coalesce(p_new_checkin, v_rec.checkin_time);
  v_checkout := coalesce(p_new_checkout, v_rec.checkout_time);

  IF v_checkin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'CHECKIN_REQUIRED', 'message', 'Enter a check-in time.');
  END IF;
  IF (v_checkin AT TIME ZONE 'Asia/Kolkata')::date <> v_rec.date THEN
    RETURN jsonb_build_object('success', false, 'error', 'CHECKIN_WRONG_DAY',
      'message', format('Check-in must be on %s (IST).', to_char(v_rec.date, 'DD Mon YYYY')));
  END IF;
  IF v_checkin > now() + interval '5 minutes' OR (v_checkout IS NOT NULL AND v_checkout > now() + interval '5 minutes') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FUTURE_TIME', 'message', 'Times cannot be in the future.');
  END IF;
  IF v_checkout IS NOT NULL AND v_checkout <= v_checkin THEN
    RETURN jsonb_build_object('success', false, 'error', 'CHECKOUT_BEFORE_CHECKIN',
      'message', format('Checkout (%s IST) must be after check-in (%s IST).',
                        to_char(v_checkout AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
                        to_char(v_checkin  AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')));
  END IF;
  IF v_checkout IS NOT NULL AND v_checkout > v_checkin + interval '24 hours' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_TOO_LONG', 'message', 'Checkout must be within 24 hours of check-in.');
  END IF;

  -- Accepted by the protected-checkout constraint trigger at commit.
  PERFORM set_config('app.authorized_attendance_correction', 'REGULARIZATION', true);

  v_status := coalesce(p_new_status::text,
                       CASE WHEN p_new_checkout IS NOT NULL THEN 'ADMIN_CORRECTED' ELSE v_rec.status END);

  UPDATE public.attendance_logs SET
    checkin_time      = v_checkin,
    app_checkin_time  = CASE WHEN p_new_checkin IS NOT NULL THEN p_new_checkin ELSE app_checkin_time END,
    checkin_source    = CASE WHEN p_new_checkin IS NOT NULL THEN 'ADMIN' ELSE checkin_source END,
    checkout_time     = v_checkout,
    checkout_source   = CASE WHEN p_new_checkout IS NOT NULL THEN 'ADMIN' ELSE checkout_source END,
    status            = v_status,
    corrected_by      = v_actor,
    correction_reason = btrim(p_reason),
    updated_at        = now()
  WHERE id = p_attendance_id;

  -- Audit row; link it from attendance_logs.last_audit_id when that column exists
  -- (works whatever type the audit id is).
  BEGIN
    WITH ins AS (
    INSERT INTO public.attendance_audit_logs (
      attendance_id, user_id, action, old_status, new_status,
      old_checkout_at, new_checkout_at, old_checkin_at, new_checkin_at,
      reason, source, actor_user_id
    ) VALUES (
      p_attendance_id, v_rec.user_id, 'ADMIN_CORRECT', v_rec.status, v_status,
      v_rec.checkout_time, v_checkout, v_rec.checkin_time, v_checkin,
      btrim(p_reason), 'ADMIN', v_actor
    )
      RETURNING id
    )
    UPDATE public.attendance_logs a SET last_audit_id = ins.id FROM ins WHERE a.id = p_attendance_id;
  EXCEPTION WHEN undefined_column THEN
    INSERT INTO public.attendance_audit_logs (
      attendance_id, user_id, action, old_status, new_status,
      old_checkout_at, new_checkout_at, old_checkin_at, new_checkin_at,
      reason, source, actor_user_id
    ) VALUES (
      p_attendance_id, v_rec.user_id, 'ADMIN_CORRECT', v_rec.status, v_status,
      v_rec.checkout_time, v_checkout, v_rec.checkin_time, v_checkin,
      btrim(p_reason), 'ADMIN', v_actor
    );
  END;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Attendance corrected.',
    'record_id', p_attendance_id,
    'checkin_ist',  to_char(v_checkin  AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
    'checkout_ist', to_char(v_checkout AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
    'is_late', (SELECT a.is_late FROM public.attendance_logs a WHERE a.id = p_attendance_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_correct_attendance(uuid, uuid, timestamptz, timestamptz, varchar, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_correct_attendance(uuid, uuid, timestamptz, timestamptz, varchar, text) TO authenticated;

-- ─── 2. Sane first-in / last-out on every canonical row ──────────────────────

-- Given one canonical row (as jsonb), return the fields to override.
CREATE OR REPLACE FUNCTION public.hrms_canonical_row_patch(r jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH v AS (
    SELECT (r->>'app_first_in')::timestamptz         AS app,
           (r->>'biometric_first_in')::timestamptz   AS bio,
           (r->>'field_visit_first_in')::timestamptz AS fv,
           (r->>'effective_checkout')::timestamptz   AS co,
           upper(coalesce(r->>'attendance_source', '')) AS src
  ), f AS (
    SELECT v.*,
           CASE WHEN v.src = 'ADMIN' AND v.app IS NOT NULL THEN v.app
                ELSE least(v.app, v.bio, v.fv) END AS first_in
    FROM v
  ), o AS (
    SELECT f.*,
           CASE WHEN f.co IS NOT NULL AND f.first_in IS NOT NULL AND f.co > f.first_in THEN f.co END AS last_out
    FROM f
  )
  SELECT CASE
    -- Rows with no evidence: leave untouched.
    WHEN o.first_in IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'effective_checkin', o.first_in,
      'official_first_in', o.first_in,
      'first_in_source', CASE
          WHEN o.src = 'ADMIN' AND o.app IS NOT NULL THEN 'ADMIN_CORRECTED'
          WHEN o.first_in = o.app THEN 'APP'
          WHEN o.first_in = o.bio THEN 'BIOMETRIC'
          WHEN o.first_in = o.fv  THEN 'FIELD_VISIT'
          ELSE r->>'first_in_source' END,
      'effective_checkout', o.last_out,
      'official_last_out',  o.last_out,
      'last_out_source', CASE WHEN o.last_out IS NULL THEN 'NO_DATA' ELSE r->>'last_out_source' END,
      'working_minutes', CASE WHEN o.last_out IS NOT NULL
                              THEN floor(extract(epoch FROM (o.last_out - o.first_in)) / 60)::int END,
      'effective_status', CASE WHEN r->>'effective_status' = 'CHECKED_OUT' AND o.last_out IS NULL
                               THEN 'CHECKED_IN' ELSE r->>'effective_status' END,
      'attendance_status', CASE WHEN r->>'attendance_status' = 'CHECKED_OUT' AND o.last_out IS NULL
                                THEN 'CHECKED_IN' ELSE r->>'attendance_status' END,
      'warning', CASE WHEN o.co IS NOT NULL AND o.last_out IS NULL THEN to_jsonb('No checkout'::text)
                      ELSE r->'warning' END
    )
  END
  FROM o;
$$;

REVOKE ALL ON FUNCTION public.hrms_canonical_row_patch(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_canonical_row_patch(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_attendance_canonical_range(
  p_start_date date,
  p_end_date   date,
  p_office_id  uuid DEFAULT NULL,
  p_team_id    uuid DEFAULT NULL,
  p_user_id    uuid DEFAULT NULL
)
RETURNS SETOF public.v_attendance_daily_canonical
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_user      uuid := p_user_id;
  v_unscoped  boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE' USING ERRCODE = '22023';
  END IF;
  IF p_end_date - p_start_date > 400 THEN
    RAISE EXCEPTION 'DATE_RANGE_TOO_LARGE: maximum 400 days per request' USING ERRCODE = '22023';
  END IF;

  -- Who may see what (same rules as 20261006130000).
  v_unscoped := p_user_id = v_uid
    OR public.hrms_is_admin_user(v_uid)
    OR EXISTS (SELECT 1 FROM public.user_permissions up
               WHERE up.user_id = v_uid AND up.permission = 'attendance.view'
                 AND up.revoked_at IS NULL AND up.scope::text = 'GLOBAL');

  IF NOT v_unscoped AND NOT EXISTS (
       SELECT 1 FROM public.user_permissions up
       WHERE up.user_id = v_uid AND up.permission = 'attendance.view' AND up.revoked_at IS NULL) THEN
    IF p_user_id IS NOT NULL THEN
      RETURN;                 -- asked for someone else without any grant
    END IF;
    v_user := v_uid;          -- no grant: own rows only
    v_unscoped := true;
  END IF;

  RETURN QUERY
    SELECT (jsonb_populate_record(s.c, public.hrms_canonical_row_patch(to_jsonb(s.c)))).*
    FROM (
      SELECT c
      FROM public.rpc_attendance_canonical_range_core(p_start_date, p_end_date, p_office_id, p_team_id, v_user) c
      WHERE v_unscoped
         OR c.user_id IN (SELECT public.authorized_user_ids('attendance.view'))
    ) s
    ORDER BY (s.c).work_date DESC, (s.c).employee_name ASC, (s.c).user_id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK (manual): re-run 20261006130000_canonical_range_authorization.sql to
-- restore the previous wrapper. The correction RPC has no safe "old" version to
-- go back to (it trusted the caller-supplied admin id).
-- =============================================================================
