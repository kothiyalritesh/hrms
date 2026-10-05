-- Add Date of Joining to profiles
alter table public.profiles
  add column if not exists date_of_joining date;

-- 1. Master Permissions Table
create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique,  -- e.g., 'employee.view'
  module text not null,                 -- e.g., 'employee'
  action text not null,                 -- e.g., 'view'
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. Master Roles Table
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,       -- e.g., 'HR', 'TEAM_HEAD'
  description text,
  created_at timestamptz not null default now()
);

-- Seed basic roles from existing strings used in codebase
insert into public.roles (name) values 
  ('SYSTEM_ADMIN'), ('ADMIN'), ('HRD'), ('HR'), ('TEAM_HEAD'), ('EMPLOYEE')
on conflict (name) do nothing;

-- 3. Role Permissions Mapping
create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  effect text not null check (effect in ('ALLOW', 'DENY')),
  scope_type text not null default 'ALL' check (scope_type in ('ALL', 'TEAM', 'SELF', 'DEPARTMENT', 'OFFICE', 'PROJECT', 'CUSTOM')),
  scope_id uuid, -- Nullable. If null, dynamically evaluates to the user's own team/office.
  created_at timestamptz not null default now()
);

-- 4. User Permissions Override
create table if not exists public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  effect text not null check (effect in ('ALLOW', 'DENY')),
  scope_type text not null default 'ALL' check (scope_type in ('ALL', 'TEAM', 'SELF', 'DEPARTMENT', 'OFFICE', 'PROJECT', 'CUSTOM')),
  scope_id uuid,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);


create unique index if not exists idx_role_permissions_unique 
on public.role_permissions (role_id, permission_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));

create unique index if not exists idx_user_permission_overrides_unique 
on public.user_permission_overrides (user_id, permission_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 5. Permission Audit Logs
create table if not exists public.permission_audit_logs (
  id uuid primary key default gen_random_uuid(),
  performed_by uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete cascade,
  target_role_id uuid references public.roles(id) on delete cascade,
  permission_id uuid references public.permissions(id) on delete cascade,
  old_effect text,
  new_effect text,
  old_scope_type text,
  new_scope_type text,
  old_scope_id uuid,
  new_scope_id uuid,
  reason text,
  created_at timestamptz not null default now(),
  check (target_user_id is not null or target_role_id is not null)
);

-- 6. RPC: has_permission Check
-- p_target_resource_id is the specific team/office/user being acted upon.
create or replace function public.has_permission(
  p_user_id uuid,
  p_permission_key text,
  p_target_resource_id uuid default null
) returns boolean
language plpgsql security definer
as $$
declare
  v_user_role text;
  v_user_team uuid;
  v_user_office uuid;
  v_role_id uuid;
  v_perm_id uuid;
  v_override record;
  v_role_perm record;
begin
  select role, office_id into v_user_role, v_user_office from public.profiles where id = p_user_id;
  
  -- SYSTEM_ADMIN fallback
  if v_user_role = 'SYSTEM_ADMIN' then
    return true;
  end if;

  select id into v_perm_id from public.permissions where permission_key = p_permission_key and is_active = true;
  if v_perm_id is null then return false; end if;

  -- 1. Check User Overrides
  -- Find the most specific override that matches the requested target
  for v_override in 
    select effect, scope_type, scope_id from public.user_permission_overrides 
    where user_id = p_user_id and permission_id = v_perm_id
    order by case effect when 'DENY' then 1 else 2 end -- DENY takes precedence if multiple matches
  loop
    if v_override.scope_type = 'ALL' then
      if v_override.effect = 'DENY' then return false; else return true; end if;
    elsif v_override.scope_type = 'SELF' and (p_target_resource_id is null or p_target_resource_id = p_user_id) then
      if v_override.effect = 'DENY' then return false; else return true; end if;
    elsif v_override.scope_type = 'TEAM' and (v_override.scope_id is null or v_override.scope_id = p_target_resource_id) then
      -- Need to verify the target matches the user's team if scope_id is null, but we don't have team_id strictly in profiles here.
      -- Assuming the target_resource_id IS the team id if scope_type is TEAM.
      if v_override.effect = 'DENY' then return false; else return true; end if;
    elsif v_override.scope_type = 'OFFICE' and (v_override.scope_id is null or v_override.scope_id = p_target_resource_id) then
      if v_override.scope_id is null and p_target_resource_id = v_user_office then
        if v_override.effect = 'DENY' then return false; else return true; end if;
      elsif v_override.scope_id = p_target_resource_id then
        if v_override.effect = 'DENY' then return false; else return true; end if;
      end if;
    end if;
  end loop;

  -- 2. Check Role Permissions
  select id into v_role_id from public.roles where name = v_user_role;
  if v_role_id is not null then
    for v_role_perm in 
      select effect, scope_type, scope_id from public.role_permissions 
      where role_id = v_role_id and permission_id = v_perm_id
      order by case effect when 'DENY' then 1 else 2 end
    loop
      if v_role_perm.scope_type = 'ALL' then
        if v_role_perm.effect = 'DENY' then return false; else return true; end if;
      elsif v_role_perm.scope_type = 'SELF' and (p_target_resource_id is null or p_target_resource_id = p_user_id) then
        if v_role_perm.effect = 'DENY' then return false; else return true; end if;
      elsif v_role_perm.scope_type = 'TEAM' and (v_role_perm.scope_id is null or v_role_perm.scope_id = p_target_resource_id) then
        if v_role_perm.effect = 'DENY' then return false; else return true; end if;
      elsif v_role_perm.scope_type = 'OFFICE' and (v_role_perm.scope_id is null or v_role_perm.scope_id = p_target_resource_id) then
        if v_role_perm.scope_id is null and p_target_resource_id = v_user_office then
          if v_role_perm.effect = 'DENY' then return false; else return true; end if;
        elsif v_role_perm.scope_id = p_target_resource_id then
          if v_role_perm.effect = 'DENY' then return false; else return true; end if;
        end if;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

-- 7. RPC: get_effective_permissions
create or replace function public.get_effective_permissions(p_user_id uuid)
returns jsonb
language plpgsql security definer
as $$
declare
  v_user_role text;
  v_role_id uuid;
  v_result jsonb := '[]'::jsonb;
begin
  select role into v_user_role from public.profiles where id = p_user_id;
  select id into v_role_id from public.roles where name = v_user_role;
  
  with all_perms as (
    select 
      p.permission_key, rp.scope_type, rp.scope_id, rp.effect, 'ROLE' as source, 2 as priority
    from public.role_permissions rp
    join public.permissions p on p.id = rp.permission_id
    where rp.role_id = v_role_id
    union all
    select 
      p.permission_key, upo.scope_type, upo.scope_id, upo.effect, 'USER_OVERRIDE' as source, 1 as priority
    from public.user_permission_overrides upo
    join public.permissions p on p.id = upo.permission_id
    where upo.user_id = p_user_id
  ),
  deduplicated as (
    select distinct on (permission_key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
      permission_key, scope_type, scope_id, effect, source
    from all_perms
    order by permission_key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), priority asc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'permission', permission_key, 'scope_type', scope_type, 'scope_id', scope_id, 'effect', effect, 'source', source
    )
  ), '[]'::jsonb) into v_result
  from deduplicated
  where effect = 'ALLOW' or v_user_role = 'SYSTEM_ADMIN';

  return jsonb_build_object(
    'is_system_admin', (v_user_role = 'SYSTEM_ADMIN'),
    'permissions', v_result
  );
end;
$$;




