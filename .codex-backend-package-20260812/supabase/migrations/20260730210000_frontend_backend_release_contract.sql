-- Production clients fail closed when deployed against an incompatible
-- database/function release. Update this value with every breaking contract.

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260730210000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation'
  );
$$;

revoke all on function public.rpc_get_release_contract()
  from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
