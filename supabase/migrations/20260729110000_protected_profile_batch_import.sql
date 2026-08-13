create or replace function public.rpc_admin_import_agent_profiles(p_profiles jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_created jsonb;
begin
  perform public.require_profile_admin();
  if jsonb_typeof(p_profiles) <> 'array'
     or jsonb_array_length(p_profiles) > 500 then
    raise exception 'INVALID_PROFILE_IMPORT';
  end if;

  with source as (
    select distinct on (lower(btrim(name)))
      btrim(name) as name,
      nullif(regexp_replace(phone, '\D', '', 'g'), '') as phone
    from jsonb_to_recordset(p_profiles) as rows(name text, phone text)
    where nullif(btrim(name), '') is not null
    order by lower(btrim(name))
  ), inserted as (
    insert into public.profiles(name, phone, role, is_active)
    select source.name, source.phone, 'Agent', true
    from source
    where not exists (
      select 1 from public.profiles existing
      where lower(btrim(existing.name)) = lower(source.name)
    )
    returning id, name, phone
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
  into v_created from inserted;

  return jsonb_build_object('success', true, 'profiles', v_created);
end;
$$;

revoke all on function public.rpc_admin_import_agent_profiles(jsonb)
  from public, anon;
grant execute on function public.rpc_admin_import_agent_profiles(jsonb)
  to authenticated;

notify pgrst, 'reload schema';
