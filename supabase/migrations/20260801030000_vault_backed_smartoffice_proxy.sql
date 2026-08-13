-- Restore the existing SmartOffice integration without adding another
-- browser-visible credential or requiring a new cron secret. Configuration is
-- read from Vault only by the service-role SmartOffice Edge Function.

create or replace function public.rpc_get_smartoffice_proxy_config()
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_url text;
  v_api_key text;
  v_account_name text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select
    max(decrypted_secret) filter (where name = 'SMARTOFFICE_URL'),
    max(decrypted_secret) filter (where name = 'SMARTOFFICE_API_KEY'),
    max(decrypted_secret) filter (
      where name = 'SMARTOFFICE_API_ACCOUNT_NAME'
    )
  into v_url, v_api_key, v_account_name
  from vault.decrypted_secrets
  where name in (
    'SMARTOFFICE_URL',
    'SMARTOFFICE_API_KEY',
    'SMARTOFFICE_API_ACCOUNT_NAME'
  );

  if nullif(trim(v_url), '') is null
    or nullif(trim(v_api_key), '') is null then
    raise exception 'SMARTOFFICE_SERVER_CONFIG_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'url', trim(v_url),
    'api_key', trim(v_api_key),
    'account_name', nullif(trim(v_account_name), '')
  );
end;
$$;

revoke all on function public.rpc_get_smartoffice_proxy_config() from public;
revoke all on function public.rpc_get_smartoffice_proxy_config()
  from anon, authenticated;
grant execute on function public.rpc_get_smartoffice_proxy_config()
  to service_role;

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
    'smartoffice_config', 'DATABASE_VAULT_SERVICE_ROLE',
    'field_visit_evidence_rpc', 'submit_field_visit_current_location_v3',
    'admin_dashboard_rpc', 'rpc_admin_dashboard_summary',
    'authenticated_profile_rpc', 'rpc_get_my_profile_v2',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260801.1',
      'otp-auth', '20260731.1',
      'field-visit-evidence-upload', '20260731.2',
      'smartoffice-proxy', '20260801.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
