-- Migration: 20260910000000_schedule_daily_alerts_and_autoclose.sql
-- Description: Schedules pg_cron jobs for 12:00 PM IST daily check-in alerts (D.3)
--              and 8:30 PM IST automatic attendance end-time reconciliation (D.8).

-- 1. Ensure reconcile_missing_attendance_checkouts has appropriate permissions
grant execute on function public.reconcile_missing_attendance_checkouts(date) to authenticated, service_role;

-- 2. Setup pg_cron schedules
do $$
declare
  v_current_project_url text := 'https://fuchvtzbgwzdpzfaizbj.supabase.co';
  v_publishable_key text := 'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX';
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Clean up any existing jobs with these names
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in (
      'hrms-daily-checkin-alert-12pm-ist',
      'hrms-auto-checkout-reconcile-830pm-ist',
      'hrms-auto-end-time-edge-function'
    );

    -- Schedule 1: Daily Check-in Alert at 12:00 PM IST (06:30 UTC)
    -- Invokes Edge Function daily-checkin-alert
    if exists (select 1 from pg_extension where extname = 'pg_net') then
      perform cron.schedule(
        'hrms-daily-checkin-alert-12pm-ist',
        '30 6 * * *',
        format(
          $job$
            select net.http_post(
              url := '%s/functions/v1/daily-checkin-alert',
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer %s',
                'apikey', '%s'
              ),
              body := '{"source":"pg_cron"}'::jsonb,
              timeout_milliseconds := 55000
            );
          $job$,
          v_current_project_url,
          v_publishable_key,
          v_publishable_key
        )
      );
    end if;

    -- Schedule 2: Authoritative Database Reconcile at 8:30 PM IST (15:00 UTC)
    -- Direct SQL execution for maximum reliability
    perform cron.schedule(
      'hrms-auto-checkout-reconcile-830pm-ist',
      '0 15 * * *',
      $job$
        select public.reconcile_missing_attendance_checkouts((now() at time zone 'Asia/Kolkata')::date);
      $job$
    );

    -- Schedule 3: Invoke auto-end-time Edge Function at 8:31 PM IST (15:01 UTC)
    -- Sends audit broadcasts / push summaries
    if exists (select 1 from pg_extension where extname = 'pg_net') then
      perform cron.schedule(
        'hrms-auto-end-time-edge-function',
        '1 15 * * *',
        format(
          $job$
            select net.http_post(
              url := '%s/functions/v1/auto-end-time',
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer %s',
                'apikey', '%s'
              ),
              body := '{"source":"pg_cron"}'::jsonb,
              timeout_milliseconds := 55000
            );
          $job$,
          v_current_project_url,
          v_publishable_key,
          v_publishable_key
        )
      );
    end if;

    raise notice 'Successfully scheduled HRMS daily checkin alerts and auto-end-time jobs.';
  else
    raise notice 'pg_cron extension not found. Configure these schedules via Supabase Cron Dashboard or API.';
  end if;
exception when others then
  raise notice 'Error configuring cron schedules: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';

