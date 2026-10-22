-- Send waiting notifications as soon as a phone registers for push.
--
-- A notification for someone with no registered phone is parked as
-- WAITING_TOKEN and retried every 30 minutes for 3 days. When the person
-- installs the new app and signs in, their pending broadcasts and alerts
-- should go out on the next dispatcher run (every minute), not up to 30
-- minutes later.

CREATE OR REPLACE FUNCTION public.hrms_requeue_pushes_for_new_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.active IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.active IS TRUE AND OLD.token = NEW.token THEN
    RETURN NEW;  -- heartbeat-style update of an already active token
  END IF;
  UPDATE public.notification_push_outbox
     SET next_attempt_at = now(),
         updated_at = now()
   WHERE recipient_user_id = NEW.user_id
     AND status = 'WAITING_TOKEN'
     AND expires_at > now();
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- Never block token registration because of the outbox.
  RAISE WARNING 'push requeue skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_requeue_pushes_for_new_token() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS hrms_requeue_pushes_for_new_token_trg ON public.device_push_tokens;
CREATE TRIGGER hrms_requeue_pushes_for_new_token_trg
  AFTER INSERT OR UPDATE OF active, token ON public.device_push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.hrms_requeue_pushes_for_new_token();

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- SELECT count(*) AS phones_registered, count(*) FILTER (WHERE active) AS active FROM device_push_tokens;
-- SELECT status, count(*) FROM notification_push_outbox WHERE created_at > now() - interval '1 day' GROUP BY 1;
