-- Supabase's Edge runtime exposes the current project publishable key through
-- SUPABASE_ANON_KEY. Reschedule after aligning Vault with that existing key.

do $$
declare
  v_publishable_key text;
begin
  select decrypted_secret
  into v_publishable_key
  from vault.decrypted_secrets
  where name = 'SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON'
  limit 1;

  if nullif(v_publishable_key, '') is null then
    raise exception 'BIOMETRIC_CRON_PROJECT_KEY_NOT_CONFIGURED';
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname in (
    'biometric-attendance-sync-every-2-minutes',
    'biometric-attendance-sync-every-minute'
  );

  perform cron.schedule(
    'biometric-attendance-sync-every-minute',
    '* * * * *',
    format(
      $job$
        select net.http_post(
          url := 'https://jidbrwpzfpbursihtvpg.supabase.co/functions/v1/biometric-attendance-sync',
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
      v_publishable_key,
      v_publishable_key
    )
  );
end;
$$;
