-- Verified and idempotent wrapper for manual biometric spreadsheet imports.
-- The source-file SHA-256 and caller-stable batch ID make retries safe.

create or replace function public.apply_biometric_import_batch_v2(
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
  v_existing public.biometric_import_batches%rowtype;
  v_result jsonb;
  v_submitted integer;
  v_inserted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_batch_id is null
     or p_source_file_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_BIOMETRIC_IMPORT_IDEMPOTENCY';
  end if;
  v_submitted := jsonb_array_length(p_rows);

  select * into v_existing
  from public.biometric_import_batches
  where id = p_batch_id;
  if found then
    if v_existing.payload_hash <> p_source_file_hash then
      raise exception 'BIOMETRIC_BATCH_ID_CONFLICT';
    end if;
    if v_existing.status = 'APPLIED' then
      return v_existing.result || jsonb_build_object(
        'success', true,
        'transaction_status', 'COMMITTED',
        'idempotent_replay', true
      );
    end if;
    raise exception 'BIOMETRIC_BATCH_NOT_RETRYABLE';
  end if;

  select * into v_existing
  from public.biometric_import_batches
  where source = p_source
    and payload_hash = p_source_file_hash
    and status = 'APPLIED'
  order by created_at desc
  limit 1;
  if found then
    return v_existing.result || jsonb_build_object(
      'success', true,
      'transaction_status', 'COMMITTED',
      'idempotent_replay', true,
      'batch_id', v_existing.id
    );
  end if;

  v_result := public.apply_biometric_import_batch(
    p_batch_id,
    p_source,
    p_source_file_hash,
    p_rows
  );
  select count(*) into v_inserted
  from public.smartoffice_device_logs
  where import_batch_id = p_batch_id;

  v_result := v_result || jsonb_build_object(
    'success', true,
    'transaction_status', 'COMMITTED',
    'submitted_punches', v_submitted,
    'inserted_punches', v_inserted,
    'duplicate_punches', v_submitted - v_inserted,
    'rejected_punches', 0,
    'idempotent_replay', false
  );
  update public.biometric_import_batches
  set result = v_result
  where id = p_batch_id;
  return v_result;
end;
$$;

revoke all on function public.apply_biometric_import_batch_v2(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_biometric_import_batch_v2(
  uuid, text, text, jsonb
) to service_role;

notify pgrst, 'reload schema';
