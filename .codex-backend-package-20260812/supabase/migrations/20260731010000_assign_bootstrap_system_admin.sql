-- Correct the explicitly designated bootstrap administrator. Fail closed if
-- the phone is missing or duplicated so this migration can never grant the
-- role to an ambiguous profile.

do $$
declare
  v_profile_count integer;
  v_profile_id uuid;
  v_system_admin_role_id uuid;
  v_updated_count integer;
begin
  select count(*)
  into v_profile_count
  from public.profiles
  where regexp_replace(coalesce(phone, ''), '\D', '', 'g') in (
    '9999999999',
    '919999999999'
  );

  if v_profile_count <> 1 then
    raise exception
      'BOOTSTRAP_SYSTEM_ADMIN_PROFILE_MUST_MATCH_EXACTLY_ONCE: found %',
      v_profile_count;
  end if;

  select id
  into strict v_profile_id
  from public.profiles
  where regexp_replace(coalesce(phone, ''), '\D', '', 'g') in (
    '9999999999',
    '919999999999'
  );

  select id
  into v_system_admin_role_id
  from public.roles
  where upper(regexp_replace(btrim(name), '[^A-Za-z0-9]+', '_', 'g')) in (
    'SYSTEM_ADMIN',
    'SUPER_ADMIN'
  )
  order by case
    when upper(regexp_replace(btrim(name), '[^A-Za-z0-9]+', '_', 'g'))
      = 'SYSTEM_ADMIN' then 0
    else 1
  end
  limit 1;

  if v_system_admin_role_id is null then
    insert into public.roles(name)
    values ('SYSTEM_ADMIN')
    returning id into v_system_admin_role_id;
  end if;

  update public.profiles
  set
    role = 'SYSTEM_ADMIN',
    role_id = v_system_admin_role_id,
    updated_at = now()
  where id = v_profile_id;
  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 or not exists (
    select 1
    from public.profiles
    where id = v_profile_id
      and role = 'SYSTEM_ADMIN'
      and role_id = v_system_admin_role_id
  ) then
    raise exception 'BOOTSTRAP_SYSTEM_ADMIN_ASSIGNMENT_NOT_CONFIRMED';
  end if;
end;
$$;
