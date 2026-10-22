-- =============================================================================
-- 20261012140000_offline_attendance.sql
--
-- Offline check-in / check-out. The app saves the action with its GPS fix
-- and an operation id when there is no internet, and sends it when the
-- connection returns. The server:
--   * applies the SAME rules as online (active office, radius incl. GPS
--     uncertainty, accuracy <= 100 m, no mock location) — only the freshness
--     window differs: the GPS fix may be up to 24 h old instead of 60/120 s;
--   * records the ORIGINAL time of the action (checkin_time / checkout_time =
--     GPS capture time, business date = IST date of that time); the sync time
--     is kept separately (attendance_offline_operations.received_at);
--   * is idempotent per operation id: a retried operation returns the stored
--     result and never creates a second record;
--   * never reopens a closed day: a check-out arriving after the day is
--     already closed (e.g. 8 PM auto checkout) is reported as SUPERSEDED and
--     changes nothing (the employee can regularize);
--   * a check-out that arrives before its check-in is synced is answered with
--     a retryable error (NO_ACTIVE_CHECKIN_YET) so the app retries later.
-- Offline check-ins are marked checkin_source 'APP_OFFLINE' (they count as
-- app attendance everywhere; HR can still tell them apart).
--
-- The existing check-in core (rpc_attendance_checkin) and Going Home checkout
-- (rpc_attendance_checkout_reconciled) are reused. They take the action time
-- from the transaction-local setting hrms.offline_captured_at, which only the
-- two offline RPCs below set; online calls are unchanged.
--
-- Idempotent migration. No existing data is changed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.attendance_offline_operations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation_id  uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('CHECK_IN', 'CHECK_OUT')),
  captured_at   timestamptz NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'PROCESSING'
                CHECK (status IN ('PROCESSING', 'APPLIED', 'SUPERSEDED', 'REJECTED')),
  attendance_id uuid,
  response      jsonb,
  UNIQUE (user_id, operation_id)
);
CREATE INDEX IF NOT EXISTS attendance_offline_operations_received_idx
  ON public.attendance_offline_operations (received_at DESC);
ALTER TABLE public.attendance_offline_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_offline_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.attendance_offline_operations TO authenticated;
DROP POLICY IF EXISTS attendance_offline_operations_own ON public.attendance_offline_operations;
CREATE POLICY attendance_offline_operations_own ON public.attendance_offline_operations
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_profile_admin());

-- Reused cores take the action time from hrms.offline_captured_at when set. ---
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.rpc_attendance_checkin(uuid,uuid,jsonb,double precision,text)'::regprocedure);
  IF position('hrms.offline_captured_at' IN v_def) = 0 THEN
    v_new := replace(v_def,
      $a$v_today date := (now() at time zone 'Asia/Kolkata')::date;$a$,
      $b$v_today date := (coalesce(nullif(current_setting('hrms.offline_captured_at', true), '')::timestamptz, now()) at time zone 'Asia/Kolkata')::date;$b$);
    v_new := replace(v_new,
      $a$v_now timestamptz := clock_timestamp();$a$,
      $b$v_now timestamptz := coalesce(nullif(current_setting('hrms.offline_captured_at', true), '')::timestamptz, clock_timestamp());$b$);
    IF (length(v_new) - length(replace(v_new, 'hrms.offline_captured_at', ''))) / length('hrms.offline_captured_at') <> 2 THEN
      RAISE EXCEPTION 'rpc_attendance_checkin: time anchors not found';
    END IF;
    EXECUTE v_new;
  END IF;

  v_def := pg_get_functiondef('public.rpc_attendance_checkout_reconciled(uuid,uuid,jsonb,text,uuid)'::regprocedure);
  IF position('hrms.offline_captured_at' IN v_def) = 0 THEN
    v_new := replace(v_def,
      $a$v_now timestamptz := clock_timestamp();$a$,
      $b$v_now timestamptz := coalesce(nullif(current_setting('hrms.offline_captured_at', true), '')::timestamptz, clock_timestamp());$b$);
    IF v_new = v_def THEN
      RAISE EXCEPTION 'rpc_attendance_checkout_reconciled: time anchor not found';
    END IF;
    EXECUTE v_new;
  END IF;
END $$;

-- Shared: claim / replay an operation -----------------------------------------
CREATE OR REPLACE FUNCTION public.hrms_offline_operation_claim(
  p_uid uuid, p_operation_id uuid, p_action text, p_captured_at timestamptz
) RETURNS public.attendance_offline_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_op public.attendance_offline_operations%rowtype;
BEGIN
  INSERT INTO public.attendance_offline_operations(user_id, operation_id, action, captured_at)
  VALUES (p_uid, p_operation_id, p_action, p_captured_at)
  ON CONFLICT (user_id, operation_id) DO NOTHING;
  SELECT * INTO v_op FROM public.attendance_offline_operations
  WHERE user_id = p_uid AND operation_id = p_operation_id FOR UPDATE;
  IF v_op.action <> p_action THEN
    RAISE EXCEPTION 'OPERATION_ID_REUSED';
  END IF;
  RETURN v_op;
END $$;
REVOKE ALL ON FUNCTION public.hrms_offline_operation_claim(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hrms_offline_operation_finish(
  p_op_id uuid, p_status text, p_attendance_id uuid, p_response jsonb
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.attendance_offline_operations
  SET status = p_status, attendance_id = p_attendance_id,
      response = p_response || jsonb_build_object('offline_status', p_status, 'synced_at', now())
  WHERE id = p_op_id
  RETURNING response;
$$;
REVOKE ALL ON FUNCTION public.hrms_offline_operation_finish(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Offline check-in ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_attendance_offline_checkin(
  p_office_id uuid, p_location jsonb, p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_op public.attendance_offline_operations%rowtype;
  v_office public.offices%rowtype;
  v_lat double precision;
  v_lon double precision;
  v_accuracy double precision;
  v_radius double precision;
  v_distance double precision;
  v_captured_at timestamptz;
  v_result jsonb;
  v_reject jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'OPERATION_ID_REQUIRED'; END IF;
  BEGIN
    v_lat := (p_location->>'latitude')::double precision;
    v_lon := (p_location->>'longitude')::double precision;
    v_accuracy := greatest(0, (p_location->>'accuracy')::double precision);
    v_captured_at := coalesce(nullif(p_location->>'capturedAt', ''), nullif(p_location->>'captured_at', ''))::timestamptz;
  EXCEPTION WHEN others THEN
    v_lat := NULL;
  END;
  IF v_captured_at IS NULL THEN RAISE EXCEPTION 'CAPTURED_AT_REQUIRED'; END IF;

  v_op := public.hrms_offline_operation_claim(v_uid, p_operation_id, 'CHECK_IN', v_captured_at);
  IF v_op.status <> 'PROCESSING' AND v_op.response IS NOT NULL THEN
    RETURN v_op.response || jsonb_build_object('idempotent', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_active) THEN
    v_reject := jsonb_build_object('success', false, 'error', 'USER_INACTIVE', 'message', 'Your account is inactive.');
  ELSIF v_captured_at < now() - interval '24 hours' OR v_captured_at > now() + interval '10 seconds' THEN
    v_reject := jsonb_build_object('success', false, 'error', 'OFFLINE_ACTION_TOO_OLD',
      'message', 'This offline check-in is more than 24 hours old and was not applied. Ask HR to regularize.');
  ELSIF v_lat IS NULL OR v_lon IS NULL OR v_lat = 0 OR v_lon = 0
        OR v_lat NOT BETWEEN -90 AND 90 OR v_lon NOT BETWEEN -180 AND 180 OR v_accuracy > 100 THEN
    v_reject := jsonb_build_object('success', false, 'error', 'GPS_NOT_TRUSTED',
      'message', 'The saved GPS reading was not precise enough (more than 100 m uncertainty).');
  ELSIF lower(coalesce(p_location->>'mocked', 'false')) = 'true' THEN
    PERFORM public.hrms_record_fraud_signal(v_uid, 'MOCK_LOCATION', 'SUSPICIOUS', 90,
      '["Offline check-in captured with a fake-GPS (mock location) app"]'::jsonb, v_lat, v_lon, v_accuracy, true);
    v_reject := jsonb_build_object('success', false, 'error', 'GPS_NOT_TRUSTED',
      'message', 'A mock (fake) location was detected. Check-in was not applied.');
  END IF;

  IF v_reject IS NULL THEN
    SELECT * INTO v_office FROM public.offices WHERE id = p_office_id AND coalesce(is_active, true);
    v_radius := coalesce(v_office.allowed_radius_meters, v_office.attendance_radius);
    IF v_office.id IS NULL OR v_office.latitude IS NULL OR v_office.longitude IS NULL THEN
      v_reject := jsonb_build_object('success', false, 'error', 'OFFICE_LOCATION_UNAVAILABLE',
        'message', 'The office is inactive or has no location.');
    ELSIF v_radius IS NULL OR v_radius < 10 OR v_radius > 1000 THEN
      v_reject := jsonb_build_object('success', false, 'error', 'OFFICE_RADIUS_NOT_CONFIGURED',
        'message', 'Attendance radius is not configured for this office. Contact HR.');
    ELSE
      v_distance := public.field_visit_distance_metres(v_office.latitude, v_office.longitude, v_lat, v_lon);
      IF v_distance + v_accuracy > v_radius THEN
        -- Suspicious only when the reading itself is outside the office area.
        IF v_distance > v_radius THEN
          PERFORM public.hrms_record_fraud_signal(v_uid, 'OUTSIDE_OFFICE_RADIUS', 'SUSPICIOUS', 80,
            jsonb_build_array(format('Offline check-in attempted %s m from %s (allowed %s m)',
                                     round(v_distance), v_office.name, round(v_radius))),
            v_lat, v_lon, v_accuracy, false);
        END IF;
        v_reject :=jsonb_build_object('success', false, 'error', 'OUTSIDE_OFFICE_RADIUS',
          'message', format('When you checked in offline you were %s m from %s (allowed %s m). Check-in was not applied.',
                            ceil(v_distance + v_accuracy), v_office.name, ceil(v_radius)),
          'distance_metres', v_distance, 'allowed_radius_metres', v_radius);
      END IF;
    END IF;
  END IF;

  IF v_reject IS NOT NULL THEN
    RETURN public.hrms_offline_operation_finish(v_op.id, 'REJECTED', NULL, v_reject);
  END IF;

  PERFORM set_config('hrms.offline_captured_at', v_captured_at::text, true);
  v_result := public.rpc_attendance_checkin(
    v_uid, p_office_id,
    p_location || jsonb_build_object('offline', true, 'synced_at', now()),
    v_distance, 'APP_OFFLINE');
  PERFORM set_config('hrms.offline_captured_at', '', true);

  IF NOT coalesce((v_result->>'success')::boolean, false) THEN
    RETURN public.hrms_offline_operation_finish(v_op.id, 'REJECTED', NULL, v_result);
  END IF;
  RETURN public.hrms_offline_operation_finish(v_op.id,
    CASE WHEN coalesce((v_result->>'existing')::boolean, false) THEN 'SUPERSEDED' ELSE 'APPLIED' END,
    coalesce(nullif(v_result->>'attendance_id', ''), nullif(v_result->>'id', ''))::uuid,
    v_result || jsonb_build_object('captured_at', v_captured_at, 'server_now', now()));
END $$;
REVOKE ALL ON FUNCTION public.rpc_attendance_offline_checkin(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_offline_checkin(uuid, jsonb, uuid) TO authenticated;

-- Offline check-out -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_attendance_offline_checkout(
  p_location jsonb, p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_op public.attendance_offline_operations%rowtype;
  v_attendance public.attendance_logs%rowtype;
  v_captured_at timestamptz;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'OPERATION_ID_REQUIRED'; END IF;
  BEGIN
    v_captured_at := coalesce(nullif(p_location->>'capturedAt', ''), nullif(p_location->>'captured_at', ''))::timestamptz;
  EXCEPTION WHEN others THEN v_captured_at := NULL;
  END;
  IF v_captured_at IS NULL THEN RAISE EXCEPTION 'CAPTURED_AT_REQUIRED'; END IF;

  v_op := public.hrms_offline_operation_claim(v_uid, p_operation_id, 'CHECK_OUT', v_captured_at);
  IF v_op.status <> 'PROCESSING' AND v_op.response IS NOT NULL THEN
    RETURN v_op.response || jsonb_build_object('idempotent', true);
  END IF;

  IF v_captured_at < now() - interval '24 hours' OR v_captured_at > now() + interval '10 seconds' THEN
    RETURN public.hrms_offline_operation_finish(v_op.id, 'REJECTED', NULL, jsonb_build_object(
      'success', false, 'error', 'OFFLINE_ACTION_TOO_OLD',
      'message', 'This offline check-out is more than 24 hours old and was not applied. Ask HR to regularize.'));
  END IF;

  SELECT * INTO v_attendance FROM public.attendance_logs
  WHERE user_id = v_uid AND date = (v_captured_at AT TIME ZONE 'Asia/Kolkata')::date
    AND checkin_time IS NOT NULL
  ORDER BY checkin_time LIMIT 1;
  IF NOT FOUND THEN
    -- The check-in may still be waiting in the phone's queue: retry later.
    RAISE EXCEPTION 'NO_ACTIVE_CHECKIN_YET' USING ERRCODE = '55000';
  END IF;
  IF v_attendance.checkout_time IS NOT NULL THEN
    RETURN public.hrms_offline_operation_finish(v_op.id, 'SUPERSEDED', v_attendance.id, jsonb_build_object(
      'success', true, 'already_checked_out', true, 'attendance_id', v_attendance.id,
      'checkout_time', v_attendance.checkout_time,
      'message', 'The day was already checked out before this offline check-out reached the server. Nothing was changed.'));
  END IF;
  IF v_attendance.checkin_time > v_captured_at THEN
    RETURN public.hrms_offline_operation_finish(v_op.id, 'REJECTED', v_attendance.id, jsonb_build_object(
      'success', false, 'error', 'CHECKOUT_BEFORE_CHECKIN',
      'message', 'This offline check-out is earlier than the recorded check-in and was not applied.'));
  END IF;

  PERFORM set_config('hrms.offline_captured_at', v_captured_at::text, true);
  v_result := public.rpc_attendance_checkout_reconciled(v_uid, v_attendance.id, p_location, 'GOING_HOME', p_operation_id);
  PERFORM set_config('hrms.offline_captured_at', '', true);

  RETURN public.hrms_offline_operation_finish(v_op.id,
    CASE WHEN NOT coalesce((v_result->>'success')::boolean, false) THEN 'REJECTED'
         WHEN coalesce((v_result->>'already_checked_out')::boolean, false) THEN 'SUPERSEDED'
         ELSE 'APPLIED' END,
    v_attendance.id, v_result || jsonb_build_object('captured_at', v_captured_at, 'server_now', now()));
END $$;
REVOKE ALL ON FUNCTION public.rpc_attendance_offline_checkout(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_offline_checkout(jsonb, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- SELECT p.name, o.action, o.captured_at AT TIME ZONE 'Asia/Kolkata' captured_ist,
--        o.received_at AT TIME ZONE 'Asia/Kolkata' synced_ist, o.status, o.response->>'message'
-- FROM attendance_offline_operations o JOIN profiles p ON p.id = o.user_id ORDER BY o.received_at DESC LIMIT 50;
