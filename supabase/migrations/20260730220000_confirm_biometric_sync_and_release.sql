-- Authoritative service-role wrapper for scheduled/admin SmartOffice sync.

create or replace function public.apply_biometric_import_batch_v4(
  p_batch_id uuid,
  p_source text,
  p_source_file_hash text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_batch public.biometric_import_batches%rowtype;
  v_applied_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  v_result := public.apply_biometric_import_batch_v2(
    p_batch_id, p_source, p_source_file_hash, p_rows
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result->>'transaction_status' <> 'COMMITTED'
     or nullif(v_result->>'batch_id', '') is null then
    raise exception 'BIOMETRIC_IMPORT_CONFIRMATION_INVALID';
  end if;

  v_applied_id := (v_result->>'batch_id')::uuid;
  select * into v_batch
  from public.biometric_import_batches
  where id = v_applied_id;
  if not found
     or v_batch.status <> 'APPLIED'
     or v_batch.source <> left(p_source, 80)
     or v_batch.payload_hash <> p_source_file_hash then
    raise exception 'BIOMETRIC_IMPORT_BATCH_IDENTITY_MISMATCH';
  end if;

  return v_result || jsonb_build_object(
    'batch_id', v_batch.id,
    'rollback_id', v_batch.id,
    'source_file_hash', v_batch.payload_hash
  );
end;
$$;

revoke all on function public.apply_biometric_import_batch_v4(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_biometric_import_batch_v4(
  uuid, text, text, jsonb
) to service_role;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260730220000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation'
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
