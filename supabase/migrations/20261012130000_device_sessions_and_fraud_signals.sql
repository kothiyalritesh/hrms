-- =============================================================================
-- 20261012130000_device_sessions_and_fraud_signals.sql
--
-- 1. "Duplicate Devices & Sessions" was always empty: v_duplicate_device_usage
--    read employee_device_bindings, which nothing writes. Rebuilt on
--    user_device_sessions (written at every sign-in + 5-minute heartbeat):
--    one row per account per device that 2+ accounts used in the last 30 days.
--    Still limited to holders of devices.manage.
-- 2. A revoked device session locked the employee out on that phone for good
--    (the device id survives logout, so every new sign-in hit the revoked
--    row). A sign-in that happened AFTER the revocation now reopens it; the
--    revoked sign-in itself stays blocked.
-- 3. The public IP of the last sign-in / heartbeat is stored on the session
--    (shown for review; a shared office IP is NOT treated as fraud).
-- 4. A check-in rejected because the GPS was mocked (fake-GPS app) now also
--    records a Suspicious Attendance signal (once per employee per day).
--
-- Idempotent. No existing row is changed.
-- =============================================================================

-- 3 ---------------------------------------------------------------------------
ALTER TABLE public.user_device_sessions ADD COLUMN IF NOT EXISTS last_ip text;

CREATE OR REPLACE FUNCTION public.hrms_request_ip()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT nullif(btrim(split_part(coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb->>'x-forwarded-for',
    nullif(current_setting('request.headers', true), '')::jsonb->>'x-real-ip', ''), ',', 1)), '');
$$;
REVOKE ALL ON FUNCTION public.hrms_request_ip() FROM PUBLIC, anon, authenticated;

-- 2 + 3 -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_register_device_session(
  p_device_identifier text, p_device_name text, p_platform text, p_app_version text, p_push_token text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.user_device_sessions%rowtype;
  v_ip text;
  v_revoked_at timestamptz;
  v_signed_in_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_active) THEN RAISE EXCEPTION 'EMPLOYEE_INACTIVE'; END IF;
  BEGIN v_ip := public.hrms_request_ip(); EXCEPTION WHEN others THEN v_ip := NULL; END;

  INSERT INTO public.user_device_sessions(user_id, device_identifier, device_name, platform, app_version, push_token, last_ip)
  VALUES (v_uid, left(p_device_identifier, 255), left(p_device_name, 255), left(p_platform, 30), left(p_app_version, 40), p_push_token, v_ip)
  ON CONFLICT (user_id, device_identifier) DO UPDATE SET
    device_name = excluded.device_name, platform = excluded.platform, app_version = excluded.app_version,
    push_token = coalesce(excluded.push_token, user_device_sessions.push_token), last_active_at = now(), is_active = true,
    last_ip = coalesce(excluded.last_ip, user_device_sessions.last_ip)
  WHERE user_device_sessions.revoked_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT revoked_at INTO v_revoked_at FROM public.user_device_sessions
    WHERE user_id = v_uid AND device_identifier = left(p_device_identifier, 255);
    -- When did THIS sign-in start? (Supabase puts session_id in the JWT.)
    BEGIN
      SELECT s.created_at INTO v_signed_in_at FROM auth.sessions s
      WHERE s.id = nullif(current_setting('request.jwt.claims', true)::jsonb->>'session_id', '')::uuid
        AND s.user_id = v_uid;
    EXCEPTION WHEN others THEN v_signed_in_at := NULL;
    END;
    IF v_signed_in_at IS NOT NULL AND v_revoked_at IS NOT NULL AND v_signed_in_at > v_revoked_at THEN
      UPDATE public.user_device_sessions SET
        revoked_at = NULL, is_active = true, last_active_at = now(),
        device_name = left(p_device_name, 255), platform = left(p_platform, 30), app_version = left(p_app_version, 40),
        push_token = coalesce(p_push_token, push_token), last_ip = coalesce(v_ip, last_ip)
      WHERE user_id = v_uid AND device_identifier = left(p_device_identifier, 255)
      RETURNING * INTO v_row;
      INSERT INTO public.hrms_audit_events(actor_user_id, target_user_id, action, entity_type, entity_id, new_values, source, device_id)
      VALUES (v_uid, v_uid, 'DEVICE_SESSION_REOPENED', 'device_session', v_row.id,
        jsonb_build_object('previously_revoked_at', v_revoked_at, 'signed_in_at', v_signed_in_at), 'APP', v_row.device_identifier);
      RETURN jsonb_build_object('success', true, 'session', to_jsonb(v_row) - 'push_token');
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'DEVICE_SESSION_REVOKED');
  END IF;
  RETURN jsonb_build_object('success', true, 'session', to_jsonb(v_row) - 'push_token');
END $$;
REVOKE ALL ON FUNCTION public.rpc_register_device_session(text, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_register_device_session(text, text, text, text, text) TO authenticated;

-- 1 ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_duplicate_device_usage;
CREATE VIEW public.v_duplicate_device_usage AS
WITH recent AS (
  SELECT s.* FROM public.user_device_sessions s
  WHERE s.last_active_at >= now() - interval '30 days'
), device_counts AS (
  SELECT device_identifier, count(DISTINCT user_id)::int AS users_count
  FROM recent
  GROUP BY device_identifier
  HAVING count(DISTINCT user_id) > 1
)
SELECT r.device_identifier, r.user_id, p.name AS user_name, p.employee_number,
       r.platform, r.app_version, c.users_count,
       r.last_active_at AS last_used, r.created_at AS first_seen, r.last_ip
FROM recent r
JOIN device_counts c ON c.device_identifier = r.device_identifier
JOIN public.profiles p ON p.id = r.user_id
WHERE public.hrms_has_permission('devices.manage')
ORDER BY c.users_count DESC, r.device_identifier, r.last_active_at DESC;
REVOKE ALL ON public.v_duplicate_device_usage FROM anon;
GRANT SELECT ON public.v_duplicate_device_usage TO authenticated;

-- 4 ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_new text;
  v_pattern text := $r$(\n\s*)return jsonb_build_object\(\s*'success', false, 'error', 'GPS_NOT_TRUSTED',$r$;
BEGIN
  IF to_regprocedure('public.rpc_attendance_checkin_v2(uuid,jsonb)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.rpc_attendance_checkin_v2(uuid,jsonb)'::regprocedure);
  IF position('Check-in attempted with a fake-GPS' IN v_def) > 0 THEN RETURN; END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, v_pattern, 'g')) <> 1 THEN
    RAISE EXCEPTION 'rpc_attendance_checkin_v2: GPS_NOT_TRUSTED branch not found exactly once';
  END IF;
  v_new := regexp_replace(v_def, v_pattern, $x$\1if lower(coalesce(p_location->>'mocked', 'false')) = 'true' then
      perform public.hrms_record_fraud_signal(v_uid, 'MOCK_LOCATION', 'SUSPICIOUS', 90,
        '["Check-in attempted with a fake-GPS (mock location) app"]'::jsonb, v_lat, v_lon, v_accuracy, true);
    end if;\1return jsonb_build_object('success', false, 'error', 'GPS_NOT_TRUSTED',$x$);
  EXECUTE v_new;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- SELECT device_identifier, user_name, users_count, last_used FROM v_duplicate_device_usage;  -- as an admin
