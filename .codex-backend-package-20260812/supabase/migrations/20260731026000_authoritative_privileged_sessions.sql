-- Make privileged identity and session recovery authoritative. The temporary
-- diagnostic from the preceding migration is removed before any app release.

drop function if exists public.rpc_temporary_role_recovery_diagnostic(uuid);

insert into public.roles(name)
select desired.name
from (values ('SYSTEM_ADMIN'), ('ADMIN'), ('HR'), ('HRD')) as desired(name)
where not exists (
  select 1
  from public.roles existing
  where case
    when regexp_replace(upper(btrim(existing.name)), '[^A-Z0-9]+', '_', 'g')
      = 'SUPER_ADMIN' then 'SYSTEM_ADMIN'
    else regexp_replace(upper(btrim(existing.name)), '[^A-Z0-9]+', '_', 'g')
  end = desired.name
);

create table if not exists public.protected_system_admin_profiles (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  reason text not null,
  protected_at timestamptz not null default now()
);
alter table public.protected_system_admin_profiles enable row level security;
revoke all on public.protected_system_admin_profiles
  from public, anon, authenticated;

do $$
declare
  v_system_role_id uuid;
  v_ritesh_id uuid;
  v_admin_id uuid;
  v_count integer;
begin
  select role.id
  into v_system_role_id
  from public.roles role
  where regexp_replace(upper(btrim(role.name)), '[^A-Z0-9]+', '_', 'g')
    in ('SYSTEM_ADMIN', 'SUPER_ADMIN')
  order by case
    when regexp_replace(upper(btrim(role.name)), '[^A-Z0-9]+', '_', 'g')
      = 'SYSTEM_ADMIN' then 0 else 1 end,
    role.id
  limit 1;

  select count(*), min(profile.id::text)::uuid
  into v_count, v_ritesh_id
  from public.profiles profile
  where regexp_replace(coalesce(profile.phone, ''), '\D', '', 'g')
      in ('7830580839', '917830580839')
    and lower(btrim(profile.name)) = 'ritesh kothiyal';
  if v_count <> 1 then
    raise exception 'RITESH_SYSTEM_ADMIN_IDENTITY_MUST_MATCH_ONCE: found %', v_count;
  end if;

  select count(*), min(profile.id::text)::uuid
  into v_count, v_admin_id
  from public.profiles profile
  where regexp_replace(coalesce(profile.phone, ''), '\D', '', 'g')
    in ('9999999999', '919999999999');
  if v_count <> 1 then
    raise exception 'ADMIN_SYSTEM_ACCOUNT_MUST_MATCH_ONCE: found %', v_count;
  end if;

  update public.profiles
  set role = 'SYSTEM_ADMIN', role_id = v_system_role_id,
      is_active = true, updated_at = now()
  where id in (v_ritesh_id, v_admin_id);
  get diagnostics v_count = row_count;
  if v_count <> 2 then
    raise exception 'SYSTEM_ADMIN_ASSIGNMENTS_NOT_CONFIRMED';
  end if;

  insert into public.protected_system_admin_profiles(profile_id, reason)
  values
    (v_ritesh_id, 'Designated Ritesh Kothiyal system administrator'),
    (v_admin_id, 'Designated 9999999999 bootstrap system account')
  on conflict (profile_id) do update
  set reason = excluded.reason;
end;
$$;

-- Repair role foreign keys for every already-authoritative privileged profile,
-- including HR profiles whose role row was previously missing.
with canonical_roles as (
  select distinct on (canonical_name)
    canonical_name,
    role_id
  from (
    select
      case
        when regexp_replace(upper(btrim(role.name)), '[^A-Z0-9]+', '_', 'g')
          = 'SUPER_ADMIN' then 'SYSTEM_ADMIN'
        else regexp_replace(upper(btrim(role.name)), '[^A-Z0-9]+', '_', 'g')
      end as canonical_name,
      role.id as role_id
    from public.roles role
  ) normalized
  where canonical_name in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  order by canonical_name, role_id
)
update public.profiles profile
set role_id = canonical.role_id, updated_at = now()
from canonical_roles canonical
where canonical.canonical_name = case
    when regexp_replace(upper(btrim(profile.role)), '[^A-Z0-9]+', '_', 'g')
      = 'SUPER_ADMIN' then 'SYSTEM_ADMIN'
    else regexp_replace(upper(btrim(profile.role)), '[^A-Z0-9]+', '_', 'g')
  end
  and profile.role_id is distinct from canonical.role_id;

create or replace function public.enforce_protected_system_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_system_role_id uuid;
  v_profile_id uuid;
begin
  v_profile_id := case when tg_op = 'DELETE' then old.id else new.id end;
  if not exists (
    select 1
    from public.protected_system_admin_profiles protected
    where protected.profile_id = v_profile_id
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'PROTECTED_SYSTEM_ADMIN_CANNOT_BE_DELETED';
  end if;

  select role.id into v_system_role_id
  from public.roles role
  where regexp_replace(upper(btrim(role.name)), '[^A-Z0-9]+', '_', 'g')
    in ('SYSTEM_ADMIN', 'SUPER_ADMIN')
  order by case
    when regexp_replace(upper(btrim(role.name)), '[^A-Z0-9]+', '_', 'g')
      = 'SYSTEM_ADMIN' then 0 else 1 end,
    role.id
  limit 1;

  if new.role is distinct from 'SYSTEM_ADMIN'
     or new.role_id is distinct from v_system_role_id
     or new.is_active is distinct from true then
    raise exception 'PROTECTED_SYSTEM_ADMIN_CANNOT_BE_DEMOTED';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_protected_system_admin_profile_trigger
  on public.profiles;
create trigger enforce_protected_system_admin_profile_trigger
before update of role, role_id, is_active or delete on public.profiles
for each row
execute function public.enforce_protected_system_admin_profile();

create or replace function public.rpc_get_my_profile_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  select jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'email', profile.email,
    'phone', profile.phone,
    'role', case
      when regexp_replace(upper(btrim(profile.role)), '[^A-Z0-9]+', '_', 'g')
        = 'SUPER_ADMIN' then 'SYSTEM_ADMIN'
      else regexp_replace(upper(btrim(profile.role)), '[^A-Z0-9]+', '_', 'g')
    end,
    'avatar', profile.avatar,
    'is_active', profile.is_active,
    'reports_to', profile.reports_to,
    'created_at', profile.created_at
  )
  into v_profile
  from public.profiles profile
  where profile.id = auth.uid();

  if v_profile is null then
    raise exception 'AUTHENTICATED_PROFILE_NOT_FOUND';
  end if;
  return v_profile;
end;
$$;

revoke all on function public.rpc_get_my_profile_v2()
  from public, anon;
grant execute on function public.rpc_get_my_profile_v2()
  to authenticated;
