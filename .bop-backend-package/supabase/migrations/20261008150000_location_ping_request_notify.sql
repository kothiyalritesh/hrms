-- =============================================================================
-- 20261008150000_location_ping_request_notify.sql
--
-- "Request Ping" from Live Tracking now reaches the employee:
--   1. Every new ping request sends the employee a notification (in-app, and
--      push once the Android app has FCM). Opening HRMS — from the
--      notification or normally — shares the current location automatically.
--   2. rpc_my_pending_ping_requests / rpc_fulfill_location_ping_request let the
--      app answer the request: the location is stored on the request and, when
--      the employee is checked in, also as a live-tracking ping.
-- Idempotent.
-- =============================================================================

ALTER TABLE public.location_ping_requests ADD COLUMN IF NOT EXISTS responded_at timestamptz;
ALTER TABLE public.location_ping_requests ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.location_ping_requests ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE public.location_ping_requests ADD COLUMN IF NOT EXISTS accuracy_m double precision;

CREATE OR REPLACE FUNCTION public.hrms_notify_location_ping_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester text;
BEGIN
  SELECT name INTO v_requester FROM public.profiles WHERE id = new.requested_by;
  PERFORM public.enqueue_hrms_notification(new.target_user_id,
    'Location update requested',
    coalesce(v_requester, 'Your manager') || ' asked for your current location. Open HRMS to share it.',
    'location_ping_request', 'ping-request:' || new.id,
    '/HRMS/?pingRequest=' || new.id, NULL, NULL,
    jsonb_build_object('pingRequestId', new.id, 'action', 'SHARE_LOCATION'));
  RETURN new;
EXCEPTION WHEN others THEN
  RAISE WARNING 'ping request notification skipped: %', SQLERRM;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS hrms_notify_location_ping_request_trg ON public.location_ping_requests;
CREATE TRIGGER hrms_notify_location_ping_request_trg
AFTER INSERT ON public.location_ping_requests
FOR EACH ROW EXECUTE FUNCTION public.hrms_notify_location_ping_request();

-- Requests the signed-in employee still has to answer (last 6 hours).
CREATE OR REPLACE FUNCTION public.rpc_my_pending_ping_requests()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM public.location_ping_requests r
  WHERE r.target_user_id = auth.uid()
    AND r.status = 'pending'
    AND r.created_at >= now() - interval '6 hours';
$$;
REVOKE ALL ON FUNCTION public.rpc_my_pending_ping_requests() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_my_pending_ping_requests() TO authenticated;

-- Answer: one GPS reading answers every pending request of the employee.
CREATE OR REPLACE FUNCTION public.rpc_fulfill_location_ping_request(
  p_request_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_mocked boolean DEFAULT false,
  p_captured_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_ping jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90
     OR p_longitude NOT BETWEEN -180 AND 180 OR (p_latitude = 0 AND p_longitude = 0) THEN
    RAISE EXCEPTION 'INVALID_COORDINATES';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.location_ping_requests WHERE id = p_request_id AND target_user_id = v_uid) THEN
    RAISE EXCEPTION 'PING_REQUEST_NOT_FOUND';
  END IF;

  -- Also a live-tracking ping when the employee is checked in (ignored otherwise).
  BEGIN
    v_ping := public.record_location_ping(
      NULL, NULL, NULL, gen_random_uuid(), p_latitude, p_longitude, p_accuracy_m,
      NULL, NULL, NULL, coalesce(p_mocked, false),
      least(coalesce(p_captured_at, now()), now()), 'ping-request', NULL);
  EXCEPTION WHEN others THEN
    v_ping := jsonb_build_object('error', SQLERRM);
  END;

  UPDATE public.location_ping_requests
  SET status = 'fulfilled', responded_at = now(),
      latitude = p_latitude, longitude = p_longitude, accuracy_m = p_accuracy_m
  WHERE target_user_id = v_uid AND status = 'pending'
    AND created_at >= now() - interval '6 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'answered', v_count, 'ping', v_ping);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_fulfill_location_ping_request(uuid, double precision, double precision, double precision, boolean, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_fulfill_location_ping_request(uuid, double precision, double precision, double precision, boolean, timestamptz) TO authenticated;

-- Live Tracking listens for the answer.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = 'location_ping_requests') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.location_ping_requests';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
