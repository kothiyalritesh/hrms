create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260731027000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'field_visit_evidence_rpc', 'submit_field_visit_current_location_v3',
    'admin_dashboard_rpc', 'rpc_admin_dashboard_summary',
    'authenticated_profile_rpc', 'rpc_get_my_profile_v2',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260731.2',
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
