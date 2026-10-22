-- =============================================================================
-- 20261012120000_notification_reliability.sql
--
-- 1. "Clear all" brought reminders back within a minute and pushed them again:
--    duplicates were detected only through the notification row's event_key,
--    and deleting the row deleted the key. Deleted keys are now remembered
--    (notification_dismissed_keys) and a notification with such a key is not
--    created again. Keys older than 60 days are pruned.
-- 2. A failure while creating a notification could roll back the action that
--    fired it (e.g. Going Home checkout -> field visit trigger -> notification
--    error -> checkout returned success:false). Notification trigger functions
--    now log a WARNING and let the action commit.
-- 3. Geofence exit alerts bypassed the durable push outbox (separate table +
--    webhook worker: no retry, duplicates on webhook retry, no in-app row,
--    generic text). They now go through enqueue_hrms_notification like every
--    other HRMS alert (in-app row + retried push, one per geofence event).
-- 4. notifications is published to Supabase Realtime so the Notifications
--    screen updates live (RLS still limits each user to their own rows).
--
-- Idempotent. No existing notification is changed or deleted.
-- =============================================================================

-- 1 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_dismissed_keys (
  event_key    text PRIMARY KEY,
  user_id      uuid,
  dismissed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_dismissed_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_dismissed_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_dismissed_keys TO service_role;
CREATE INDEX IF NOT EXISTS notification_dismissed_keys_at_idx
  ON public.notification_dismissed_keys (dismissed_at);

CREATE OR REPLACE FUNCTION public.hrms_remember_dismissed_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF old.event_key IS NOT NULL THEN
    INSERT INTO public.notification_dismissed_keys(event_key, user_id)
    VALUES (old.event_key, old.user_id)
    ON CONFLICT (event_key) DO UPDATE SET dismissed_at = now();
  END IF;
  RETURN old;
END $$;

DROP TRIGGER IF EXISTS hrms_remember_dismissed_notification_trg ON public.notifications;
CREATE TRIGGER hrms_remember_dismissed_notification_trg
AFTER DELETE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.hrms_remember_dismissed_notification();

CREATE OR REPLACE FUNCTION public.hrms_skip_dismissed_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF new.event_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notification_dismissed_keys k WHERE k.event_key = new.event_key
  ) THEN
    RETURN NULL;  -- already seen and cleared by the employee: don't recreate / re-push
  END IF;
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS hrms_skip_dismissed_notification_trg ON public.notifications;
CREATE TRIGGER hrms_skip_dismissed_notification_trg
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.hrms_skip_dismissed_notification();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hrms-prune-dismissed-notification-keys';
    PERFORM cron.schedule('hrms-prune-dismissed-notification-keys', '17 3 * * *',
      $c$DELETE FROM public.notification_dismissed_keys WHERE dismissed_at < now() - interval '60 days'$c$);
  END IF;
END $$;

-- 2 ---------------------------------------------------------------------------
-- Wrap every AFTER-trigger function that creates notifications in an
-- exception block. The original body runs unchanged as a nested block.
DO $$
DECLARE
  f record;
  v_def text;
  v_body text;
  v_new text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, p.prosrc
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prorettype = 'trigger'::regtype
      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
      AND (p.prosrc ~* 'enqueue_hrms_notification\s*\(' OR p.proname = 'queue_notification_push')
      AND p.prosrc !~ 'HRMS_NOTIFICATION_TRIGGER_GUARD'
      -- only AFTER triggers (a BEFORE trigger's return value matters)
      AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid AND (t.tgtype & 2) <> 0)
  LOOP
    v_def := pg_get_functiondef(f.oid);
    v_body := regexp_replace(f.prosrc, ';?\s*$', '');
    v_new := replace(v_def, f.prosrc, format($b$
-- HRMS_NOTIFICATION_TRIGGER_GUARD: a notification problem never undoes the action.
BEGIN
%s;
EXCEPTION WHEN others THEN
  RAISE WARNING 'notification trigger %s skipped: %%', SQLERRM;
  RETURN NULL;
END
$b$, v_body, f.proname));
    IF v_new = v_def THEN
      RAISE EXCEPTION 'notification trigger %: body not found in definition', f.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;

-- 3 ---------------------------------------------------------------------------
DO $$
DECLARE
  f regprocedure;
  v_def text;
  v_new text;
  v_pattern text := $r$INSERT\s+INTO\s+public\.notification_outbox\s*\(\s*geofence_event_id,\s*recipient_user_id,\s*notification_type,\s*payload\s*\)\s*VALUES\s*\(\s*v_event_id,\s*p_user_id,\s*'GEOFENCE_VIOLATION_EMPLOYEE',\s*jsonb_build_object\(\s*'distance_m',\s*v_distance_m,\s*'radius_m',\s*v_radius_m\s*\)\s*\);$r$;
BEGIN
  SELECT p.oid::regprocedure INTO f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'rpc_ingest_location_observation'
  ORDER BY p.oid DESC LIMIT 1;
  IF f IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef(f);
  IF position('geofence-exit:' IN v_def) > 0 THEN RETURN; END IF;
  v_new := regexp_replace(v_def, v_pattern, $x$PERFORM public.enqueue_hrms_notification(
                p_user_id,
                'You left the ' || CASE WHEN p_geofence_type = 'OFFICE' THEN 'office' ELSE 'site' END || ' area',
                format('You are about %s m away (allowed %s m). Return, or open HRMS and give a reason.',
                       round(v_distance_m), round(v_radius_m)),
                'geofence',
                'geofence-exit:' || v_event_id,
                '/HRMS/notifications',
                NULL, NULL,
                jsonb_build_object('geofence_event_id', v_event_id, 'distance_m', v_distance_m, 'radius_m', v_radius_m));$x$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'rpc_ingest_location_observation: geofence outbox insert not found';
  END IF;
  EXECUTE v_new;
END $$;

-- 4 ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- Trigger functions now guarded:
-- SELECT proname FROM pg_proc WHERE prosrc LIKE '%HRMS_NOTIFICATION_TRIGGER_GUARD%';
