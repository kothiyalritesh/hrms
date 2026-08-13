-- Protected, audited profile administration. Browser clients no longer need
-- direct INSERT/UPDATE/DELETE grants on profiles.

create or replace function public.require_profile_admin()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_role text;
begin
  select upper(coalesce(role, '')) into v_role
  from public.profiles where id = auth.uid() and is_active = true;
  if coalesce(v_role, '') not in
    ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD') then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;
  return v_role;
end;
$$;

revoke all on function public.require_profile_admin() from public, anon;
grant execute on function public.require_profile_admin() to authenticated;

create or replace function public.rpc_admin_save_profile(
  p_profile_id uuid,
  p_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text := public.require_profile_admin();
  v_id uuid := p_profile_id;
  v_target_role text := upper(nullif(btrim(p_values->>'role'), ''));
begin
  if nullif(btrim(p_values->>'name'), '') is null then
    raise exception 'PROFILE_NAME_REQUIRED';
  end if;
  if v_target_role in ('SYSTEM_ADMIN', 'SUPER_ADMIN')
     and v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
    raise exception 'SYSTEM_ADMIN_PERMISSION_REQUIRED';
  end if;

  if v_id is null then
    insert into public.profiles(
      name, email, phone, employee_number, role, role_id, office_id, team,
      is_active
    ) values (
      btrim(p_values->>'name'),
      nullif(btrim(p_values->>'email'), ''),
      nullif(regexp_replace(p_values->>'phone', '\D', '', 'g'), ''),
      nullif(btrim(p_values->>'employee_number'), ''),
      nullif(btrim(p_values->>'role'), ''),
      nullif(p_values->>'role_id', '')::uuid,
      nullif(p_values->>'office_id', '')::uuid,
      nullif(btrim(p_values->>'team'), ''),
      coalesce((p_values->>'is_active')::boolean, true)
    ) returning id into v_id;
  else
    if exists (
      select 1 from public.profiles
      where id = v_id
        and upper(coalesce(role, '')) in ('SYSTEM_ADMIN', 'SUPER_ADMIN')
    ) and v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
      raise exception 'SYSTEM_ADMIN_PERMISSION_REQUIRED';
    end if;

    update public.profiles
    set name = btrim(p_values->>'name'),
        email = nullif(btrim(p_values->>'email'), ''),
        phone = nullif(regexp_replace(p_values->>'phone', '\D', '', 'g'), ''),
        employee_number = nullif(btrim(p_values->>'employee_number'), ''),
        role = nullif(btrim(p_values->>'role'), ''),
        role_id = nullif(p_values->>'role_id', '')::uuid,
        office_id = nullif(p_values->>'office_id', '')::uuid,
        team = nullif(btrim(p_values->>'team'), ''),
        updated_at = now()
    where id = v_id;
    if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  end if;

  return jsonb_build_object('success', true, 'profile_id', v_id);
end;
$$;

revoke all on function public.rpc_admin_save_profile(uuid, jsonb)
  from public, anon;
grant execute on function public.rpc_admin_save_profile(uuid, jsonb)
  to authenticated;

create or replace function public.rpc_admin_set_profile_active(
  p_profile_id uuid,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_actor_role text := public.require_profile_admin();
begin
  if p_profile_id = auth.uid() and not p_is_active then
    raise exception 'CANNOT_DEACTIVATE_CURRENT_USER';
  end if;
  if exists (
    select 1 from public.profiles where id = p_profile_id
      and upper(coalesce(role, '')) in ('SYSTEM_ADMIN', 'SUPER_ADMIN')
  ) and v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
    raise exception 'SYSTEM_ADMIN_PERMISSION_REQUIRED';
  end if;
  update public.profiles
  set is_active = p_is_active, updated_at = now()
  where id = p_profile_id;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  return jsonb_build_object('success', true, 'profile_id', p_profile_id);
end;
$$;

revoke all on function public.rpc_admin_set_profile_active(uuid, boolean)
  from public, anon;
grant execute on function public.rpc_admin_set_profile_active(uuid, boolean)
  to authenticated;

create or replace function public.rpc_update_my_profile(p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if nullif(btrim(p_values->>'name'), '') is null then
    raise exception 'PROFILE_NAME_REQUIRED';
  end if;
  update public.profiles
  set name = btrim(p_values->>'name'),
      avatar = case
        when p_values ? 'avatar' then nullif(btrim(p_values->>'avatar'), '')
        else avatar
      end,
      updated_at = now()
  where id = auth.uid() and is_active = true;
  if not found then raise exception 'ACTIVE_PROFILE_NOT_FOUND'; end if;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.rpc_update_my_profile(jsonb) from public, anon;
grant execute on function public.rpc_update_my_profile(jsonb) to authenticated;

create or replace function public.rpc_admin_sync_smartoffice_profile(
  p_profile_id uuid,
  p_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_profile_admin();
  update public.profiles
  set name = coalesce(nullif(btrim(p_values->>'name'), ''), name),
      email = coalesce(nullif(btrim(p_values->>'email'), ''), email),
      phone = coalesce(
        nullif(regexp_replace(p_values->>'phone', '\D', '', 'g'), ''), phone
      ),
      smartoffice_department = p_values->>'smartoffice_department',
      smartoffice_designation = p_values->>'smartoffice_designation',
      smartoffice_grade = p_values->>'smartoffice_grade',
      smartoffice_location = p_values->>'smartoffice_location',
      smartoffice_company = p_values->>'smartoffice_company',
      smartoffice_team = p_values->>'smartoffice_team',
      smartoffice_synced_at = now(),
      updated_at = now()
  where id = p_profile_id and is_active = true;
  if not found then raise exception 'ACTIVE_PROFILE_NOT_FOUND'; end if;
  return jsonb_build_object('success', true, 'profile_id', p_profile_id);
end;
$$;

revoke all on function public.rpc_admin_sync_smartoffice_profile(uuid, jsonb)
  from public, anon;
grant execute on function public.rpc_admin_sync_smartoffice_profile(uuid, jsonb)
  to authenticated;

create or replace function public.rpc_admin_update_hierarchy(p_updates jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_count integer := 0;
begin
  perform public.require_profile_admin();
  if jsonb_typeof(p_updates) <> 'array'
     or jsonb_array_length(p_updates) > 5000 then
    raise exception 'INVALID_HIERARCHY_BATCH';
  end if;
  for v_item in select value from jsonb_array_elements(p_updates)
  loop
    if nullif(v_item->>'id', '') is null then
      raise exception 'PROFILE_ID_REQUIRED';
    end if;
    update public.profiles
    set reports_to = case when v_item ? 'reports_to'
          then nullif(v_item->>'reports_to', '')::uuid else reports_to end,
        team = case when v_item ? 'team'
          then nullif(btrim(v_item->>'team'), '') else team end,
        phone = case when v_item ? 'phone'
          then nullif(regexp_replace(v_item->>'phone', '\D', '', 'g'), '')
          else phone end,
        updated_at = now()
    where id = (v_item->>'id')::uuid and is_active = true;
    if not found then raise exception 'ACTIVE_PROFILE_NOT_FOUND'; end if;
    v_count := v_count + 1;
  end loop;

  if exists (
    with recursive hierarchy as (
      select id as start_id, reports_to as current_id, array[id] as path,
        reports_to = id as cycle
      from public.profiles where reports_to is not null
      union all
      select h.start_id, p.reports_to, h.path || h.current_id,
        h.current_id = any(h.path)
      from hierarchy h
      join public.profiles p on p.id = h.current_id
      where h.current_id is not null and not h.cycle
    )
    select 1 from hierarchy where cycle
  ) then
    raise exception 'REPORTING_HIERARCHY_CYCLE';
  end if;
  return v_count;
end;
$$;

revoke all on function public.rpc_admin_update_hierarchy(jsonb)
  from public, anon;
grant execute on function public.rpc_admin_update_hierarchy(jsonb)
  to authenticated;

revoke insert, update, delete on public.profiles from authenticated;
