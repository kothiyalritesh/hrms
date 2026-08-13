create or replace function public.rpc_assign_biometric_employee_codes_batch(
  p_mappings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_mapping record; v_count integer := 0;
begin
  perform public.require_profile_admin();
  if jsonb_typeof(p_mappings) <> 'array'
     or jsonb_array_length(p_mappings) not between 1 and 500 then
    raise exception 'INVALID_BIOMETRIC_MAPPING_BATCH';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_mappings) as rows(profile_id uuid, employee_code text)
    group by lower(btrim(employee_code))
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_BIOMETRIC_CODE_IN_BATCH';
  end if;
  for v_mapping in
    select profile_id, employee_code
    from jsonb_to_recordset(p_mappings)
      as rows(profile_id uuid, employee_code text)
    order by profile_id
  loop
    perform public.rpc_assign_biometric_employee_code(
      v_mapping.profile_id, v_mapping.employee_code
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('success', true, 'updated', v_count);
end;
$$;

revoke all on function public.rpc_assign_biometric_employee_codes_batch(jsonb)
  from public, anon;
grant execute on function public.rpc_assign_biometric_employee_codes_batch(jsonb)
  to authenticated;
notify pgrst, 'reload schema';
