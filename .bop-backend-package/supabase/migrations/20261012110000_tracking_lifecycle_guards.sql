-- =============================================================================
-- 20261012110000_tracking_lifecycle_guards.sql
--
-- Location kept being collected after checkout. Server-side causes:
-- 1. record_location_ping treated "no open attendance" as "not checked in
--    yet": with a field visit of today still open, pings after a SYSTEM
--    (8 PM), biometric or event checkout were accepted as visit travel and
--    answered ACTIVE, so the phone kept tracking until midnight.
--    Now: once today's attendance is checked out, pings are answered STOPPED.
-- 2. "Open attendance" had no date bound: a never-closed session from an
--    earlier day kept tracking alive indefinitely. Now only a session that
--    started within the last 16 hours counts as open (same bound as the
--    silence sweep).
-- 3. Only APP / APP_EARLY / ADMIN checkouts stopped the server tracking
--    session; SYSTEM, BIOMETRIC, EVENT, REGULARIZATION left it ACTIVE.
--    Now every checkout stops it.
--
-- Idempotent. No data is changed except closing ACTIVE tracking sessions of
-- attendance that is already checked out (they are stale by definition).
-- =============================================================================

-- 1 + 2. record_location_ping -------------------------------------------------
DO $$
DECLARE
  v_sig text := 'public.record_location_ping(uuid,uuid,uuid,uuid,double precision,double precision,double precision,double precision,double precision,double precision,boolean,timestamp with time zone,text,text)';
  v_def text;
  v_new text;
  v_open_anchor text := 'WHERE a.user_id = v_uid AND a.checkin_time IS NOT NULL AND a.checkout_time IS NULL);';
  v_branch_anchor text := 'IF v_visit_id IS NOT NULL AND NOT v_open_attendance THEN';
BEGIN
  v_def := pg_get_functiondef(v_sig::regprocedure);
  IF position('ATTENDANCE_CLOSED_TODAY' IN v_def) > 0 THEN
    RAISE NOTICE 'record_location_ping: guards already applied';
    RETURN;
  END IF;
  IF position(v_open_anchor IN v_def) = 0 OR position(v_branch_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'record_location_ping: expected anchors not found';
  END IF;
  v_new := replace(v_def, v_open_anchor,
    'WHERE a.user_id = v_uid AND a.checkin_time IS NOT NULL AND a.checkout_time IS NULL'
    || ' AND a.checkin_time >= now() - interval ''16 hours'');');
  v_new := replace(v_new, v_branch_anchor, $x$-- Day already checked out: no more tracking today, even for an open visit.
  IF NOT v_open_attendance AND EXISTS (
    SELECT 1 FROM public.attendance_logs a
    WHERE a.user_id = v_uid AND a.date = v_date AND a.checkout_time IS NOT NULL
  ) THEN
    UPDATE public.tracking_sessions
    SET status = 'STOPPED', stopped_at = now(), updated_at = now(), stop_reason = 'ATTENDANCE_CLOSED_TODAY'
    WHERE user_id = v_uid AND status = 'ACTIVE';
    RETURN jsonb_build_object('success', true, 'stored', false, 'stored_reason', 'ATTENDANCE_CLOSED_TODAY',
      'tracking_session_status', 'STOPPED', 'health_warning', 'ATTENDANCE_CLOSED_TODAY');
  END IF;

  $x$ || v_branch_anchor);
  EXECUTE v_new;
END $$;

-- 2. hrms_record_attendance_ping: a session older than 16 h is not open ----------
DO $$
DECLARE
  v_def text;
  v_new text;
  v_anchor text := 'IF NOT FOUND OR v_attendance.checkout_time IS NOT NULL OR v_attendance.checkin_time IS NULL THEN';
  f regprocedure;
BEGIN
  SELECT p.oid::regprocedure INTO f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'hrms_record_attendance_ping'
  ORDER BY p.oid DESC LIMIT 1;
  IF f IS NULL THEN RAISE EXCEPTION 'hrms_record_attendance_ping missing'; END IF;
  v_def := pg_get_functiondef(f);
  IF position('v_attendance.checkin_time < now() - interval' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'hrms_record_attendance_ping: anchor not found';
  END IF;
  v_new := replace(v_def, v_anchor,
    'IF NOT FOUND OR v_attendance.checkout_time IS NOT NULL OR v_attendance.checkin_time IS NULL'
    || ' OR v_attendance.checkin_time < now() - interval ''16 hours'' THEN');
  EXECUTE v_new;
END $$;

-- 3. Every checkout source stops the tracking session ----------------------------
CREATE OR REPLACE FUNCTION public.stop_tracking_after_authoritative_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF old.checkout_time IS NULL AND new.checkout_time IS NOT NULL THEN
    UPDATE public.tracking_sessions
    SET status = 'STOPPED', stopped_at = coalesce(new.checkout_time, now()),
        stop_reason = 'AUTHORITATIVE_' || upper(coalesce(new.checkout_source, 'APP')) || '_CHECKOUT',
        native_task_active = false, updated_at = now()
    WHERE attendance_log_id = new.id AND status = 'ACTIVE';
  END IF;
  RETURN new;
END $$;

-- Sessions left ACTIVE by earlier non-app checkouts.
UPDATE public.tracking_sessions s
SET status = 'STOPPED', stopped_at = coalesce(a.checkout_time, now()),
    stop_reason = 'AUTHORITATIVE_' || upper(coalesce(a.checkout_source, 'SYSTEM')) || '_CHECKOUT',
    native_task_active = false, updated_at = now()
FROM public.attendance_logs a
WHERE s.attendance_log_id = a.id AND s.status = 'ACTIVE' AND a.checkout_time IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- Should be 0: tracking sessions still ACTIVE for a checked-out day.
-- SELECT count(*) FROM tracking_sessions s JOIN attendance_logs a ON a.id = s.attendance_log_id
-- WHERE s.status = 'ACTIVE' AND a.checkout_time IS NOT NULL;
