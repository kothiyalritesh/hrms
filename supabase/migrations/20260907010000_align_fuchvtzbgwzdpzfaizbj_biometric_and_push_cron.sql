-- Migration: Align pg_cron jobs and Vault keys to the current active project (fuchvtzbgwzdpzfaizbj)
-- Fixes automatic biometric synchronization and notification dispatch

DO $$
DECLARE
  v_current_project_url TEXT := 'https://fuchvtzbgwzdpzfaizbj.supabase.co';
  v_publishable_key TEXT := 'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX';
BEGIN
  -- 1. Update Vault secret for SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'vault' AND tablename = 'secrets') THEN
    DELETE FROM vault.secrets WHERE name = 'SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON';
    PERFORM vault.create_secret(
      v_publishable_key,
      'SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON',
      'Publishable key for scheduled biometric cron on fuchvtzbgwzdpzfaizbj'
    );
  END IF;

  -- 2. Clean up legacy/mispointed cron schedules
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN (
      'biometric-attendance-sync-every-2-minutes',
      'biometric-attendance-sync-every-minute',
      'hrms-push-dispatch-every-minute'
    );

    -- 3. Reschedule biometric attendance sync targeting the active fuchvtzbgwzdpzfaizbj Edge Function
    PERFORM cron.schedule(
      'biometric-attendance-sync-every-minute',
      '* * * * *',
      format(
        $job$
          SELECT net.http_post(
            url := '%s/functions/v1/biometric-attendance-sync',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer %s',
              'apikey', '%s',
              'x-biometric-sync-source', 'pg_cron'
            ),
            body := '{}'::jsonb,
            timeout_milliseconds := 55000
          );
        $job$,
        v_current_project_url,
        v_publishable_key,
        v_publishable_key
      )
    );

    -- 4. Reschedule push dispatch targeting active fuchvtzbgwzdpzfaizbj Edge Function
    PERFORM cron.schedule(
      'hrms-push-dispatch-every-minute',
      '* * * * *',
      format(
        $job$
          SELECT net.http_post(
            url := '%s/functions/v1/notification-dispatch',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer %s',
              'apikey', '%s'
            ),
            body := '{"source":"pg_cron"}'::jsonb,
            timeout_milliseconds := 50000
          );
        $job$,
        v_current_project_url,
        v_publishable_key,
        v_publishable_key
      )
    );
  END IF;
END;
$$;
