-- Restore automatic biometric synchronization without requiring a new custom
-- secret. The cron request uses the project's existing publishable key stored
-- in Vault. The Edge Function also enforces source, rate, and payload scope.

do $$
declare
  v_anon_key text;
begin
  select decrypted_secret
  into v_anon_key
  from vault.decrypted_secrets
  where name = 'SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON'
  limit 1;

  if nullif(v_anon_key, '') is null then
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
      v_anon_key,
      v_anon_key
    )
  );
end;
$$;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260731031000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'attendance_history_rpc', 'rpc_get_my_monthly_attendance_v2',
    'attendance_day_detail_contract', 'attendance-day-v3',
    'attendance_regularization_list_rpc',
      'rpc_admin_list_attendance_regularization',
    'attendance_late_cutoff', '10:32:00',
    'attendance_late_boundary', 'INCLUSIVE',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'biometric_cron_auth', 'PROJECT_PUBLISHABLE_KEY',
    'field_visit_evidence_rpc', 'submit_field_visit_current_location_v3',
    'admin_dashboard_rpc', 'rpc_admin_dashboard_summary',
    'authenticated_profile_rpc', 'rpc_get_my_profile_v2',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260801.1',
      'otp-auth', '20260731.1',
      'field-visit-evidence-upload', '20260731.2',
      'smartoffice-proxy', '20260731.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
