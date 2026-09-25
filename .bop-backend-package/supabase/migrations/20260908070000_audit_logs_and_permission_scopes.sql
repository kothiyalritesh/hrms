-- Migration: 20260908070000_audit_logs_and_permission_scopes.sql
-- Unified Audit Logs & Scoped Permissions Model (GLOBAL, DEPARTMENT, BRANCH, TEAM, SELF)

create extension if not exists pgcrypto;

-- 1. Universal Audit Logs Table (with backward compatibility for existing table)
create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references public.profiles(id) on delete set null,
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  old_data       jsonb,
  new_data       jsonb,
  metadata       jsonb default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- Backward compatibility: add columns if table already existed in earlier schema
alter table public.audit_logs
  add column if not exists actor_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists old_data jsonb,
  add column if not exists new_data jsonb,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists table_name text,
  add column if not exists record_id text,
  add column if not exists old_values jsonb,
  add column if not exists new_values jsonb,
  add column if not exists performed_by uuid references public.profiles(id) on delete set null,
  add column if not exists performed_at timestamptz default now();

-- Ensure record_id is typed as text if it previously existed as uuid
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_logs'
      and column_name = 'record_id'
      and data_type <> 'text'
  ) then
    alter table public.audit_logs alter column record_id type text using record_id::text;
  end if;
end $$;

-- Sync legacy columns with new columns for existing rows
update public.audit_logs
set
  actor_user_id = coalesce(actor_user_id, performed_by),
  created_at = coalesce(created_at, performed_at, now()),
  entity_type = coalesce(entity_type, table_name, 'unknown'),
  entity_id = coalesce(entity_id, record_id::text),
  old_data = coalesce(old_data, old_values),
  new_data = coalesce(new_data, new_values)
where actor_user_id is null and performed_by is not null;

create index if not exists idx_audit_logs_actor_created
  on public.audit_logs(actor_user_id, created_at desc);

create index if not exists idx_audit_logs_entity
  on public.audit_logs(entity_type, entity_id);

create index if not exists idx_audit_logs_action_created
  on public.audit_logs(action, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN')
    )
    or actor_user_id = auth.uid()
    or performed_by = auth.uid()
  );

-- Direct client inserts disabled; inserts happen via SECURITY DEFINER functions

-- 2. Audit Logging Helper RPC (populates both legacy and upgraded column names)
create or replace function public.log_audit_event(
  p_action      text,
  p_entity_type text,
  p_entity_id   text,
  p_old_data    jsonb default null,
  p_new_data    jsonb default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  insert into public.audit_logs (
    actor_user_id,
    performed_by,
    action,
    entity_type,
    table_name,
    entity_id,
    record_id,
    old_data,
    old_values,
    new_data,
    new_values,
    metadata,
    created_at,
    performed_at
  ) values (
    v_uid,
    v_uid,
    p_action,
    p_entity_type,
    p_entity_type,
    p_entity_id,
    p_entity_id,
    p_old_data,
    p_old_data,
    p_new_data,
    p_new_data,
    coalesce(p_metadata, '{}'::jsonb),
    now(),
    now()
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.log_audit_event(text, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.log_audit_event(text, text, text, jsonb, jsonb, jsonb) to authenticated;

-- 3. Extend user_permissions with Scope & Revocation
create table if not exists public.user_permissions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  permission text        not null,
  granted_by uuid        references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now()
);

alter table public.user_permissions
  add column if not exists scope text not null default 'GLOBAL'
    check (scope in ('GLOBAL', 'DEPARTMENT', 'BRANCH', 'TEAM', 'SELF')),
  add column if not exists scope_id uuid default null,
  add column if not exists revoked_at timestamptz default null;

-- Ensure compound index and drop outdated unique constraint if needed
alter table public.user_permissions drop constraint if exists user_permissions_unique;
drop index if exists idx_user_permissions_unique_scoped;
create unique index if not exists idx_user_permissions_unique_scoped
  on public.user_permissions(user_id, permission, scope, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;

-- 4. Upgraded get_my_permissions() returning detailed permission catalogue and scope
drop function if exists public.get_my_permissions();
create or replace function public.get_my_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permission', up.permission,
        'scope', up.scope,
        'scope_id', up.scope_id
      )
    ),
    '[]'::jsonb
  )
  from public.user_permissions up
  where up.user_id = auth.uid()
    and up.revoked_at is null;
$$;

revoke all on function public.get_my_permissions() from public, anon;
grant execute on function public.get_my_permissions() to authenticated;

-- 5. Scope Resolution Helper: can_access_user_data
create or replace function public.can_access_user_data(
  p_target_user_id uuid,
  p_permission     text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_caller public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_perm record;
begin
  if v_uid is null then
    return false;
  end if;

  -- Admin override
  select * into v_caller from public.profiles where id = v_uid;
  if v_caller.role in ('SYSTEM_ADMIN', 'ADMIN') then
    return true;
  end if;

  -- Same user check
  if p_target_user_id = v_uid then
    return true;
  end if;

  select * into v_target from public.profiles where id = p_target_user_id;

  -- Check user permissions against target user
  for v_perm in
    select permission, scope, scope_id
    from public.user_permissions
    where user_id = v_uid and permission = p_permission and revoked_at is null
  loop
    if v_perm.scope = 'GLOBAL' then
      return true;
    elsif v_perm.scope = 'BRANCH' then
      if v_perm.scope_id is not null and v_target.office_id = v_perm.scope_id then
        return true;
      elsif v_perm.scope_id is null and v_caller.office_id is not null and v_target.office_id = v_caller.office_id then
        return true;
      end if;
    elsif v_perm.scope = 'DEPARTMENT' then
      if v_target.department is not null and lower(v_target.department) = lower(coalesce(v_caller.department, '')) then
        return true;
      end if;
    elsif v_perm.scope = 'TEAM' then
      if v_target.reports_to = v_uid or v_target.team = v_caller.team then
        return true;
      end if;
    elsif v_perm.scope = 'SELF' and p_target_user_id = v_uid then
      return true;
    end if;
  end loop;

  return false;
end $$;

revoke all on function public.can_access_user_data(uuid, text) from public, anon;
grant execute on function public.can_access_user_data(uuid, text) to authenticated;

-- 6. Updated has_permission helper
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_permissions
    where user_id = auth.uid()
      and permission = p_permission
      and revoked_at is null
  );
$$;

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- 7. Audited Admin Grant & Revoke Functions
drop function if exists public.admin_grant_permission(uuid, text);
drop function if exists public.admin_revoke_permission(uuid, text);
drop function if exists public.admin_grant_permission(uuid, text, text, uuid);
drop function if exists public.admin_revoke_permission(uuid, text, text);

create or replace function public.admin_grant_permission(
  p_user_id    uuid,
  p_permission text,
  p_scope      text default 'GLOBAL',
  p_scope_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_scope text := coalesce(p_scope, 'GLOBAL');
  v_uid         uuid := auth.uid();
  v_scope       text := coalesce(p_scope, 'GLOBAL');
  v_existing_id uuid;
begin
  -- 1. Security Gate: caller must have SYSTEM_ADMIN or ADMIN role
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  insert into public.user_permissions (user_id, permission, scope, scope_id, granted_by, granted_at, revoked_at)
  values (p_user_id, p_permission, v_scope, p_scope_id, v_uid, now(), null)
  on conflict do nothing;
  -- 2. Validate target employee exists
  if not exists (
    select 1 from public.profiles
    where id = p_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- Audit log
  -- 3. Scope validation fallback
  if v_scope not in ('GLOBAL', 'DEPARTMENT', 'BRANCH', 'TEAM', 'SELF') then
    v_scope := 'GLOBAL';
  end if;

  -- 4. Check for existing permission row (active or revoked)
  select id into v_existing_id
  from public.user_permissions
  where user_id = p_user_id
    and permission = p_permission
  order by (revoked_at is null) desc, granted_at desc
  limit 1;

  if v_existing_id is not null then
    -- Reactivate or update scope of existing record
    update public.user_permissions
    set scope      = v_scope,
        scope_id   = p_scope_id,
        granted_by = v_uid,
        granted_at = now(),
        revoked_at = null
    where id = v_existing_id;
  else
    -- Insert clean new permission
    insert into public.user_permissions (
      user_id,
      permission,
      scope,
      scope_id,
      granted_by,
      granted_at,
      revoked_at
    ) values (
      p_user_id,
      p_permission,
      v_scope,
      p_scope_id,
      v_uid,
      now(),
      null
    );
  end if;

  -- 5. Audit log
  perform public.log_audit_event(
    'PERMISSION_GRANTED',
    'user_permissions',
    p_user_id::text,
    null,
    jsonb_build_object('permission', p_permission, 'scope', v_scope, 'scope_id', p_scope_id)
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'permission', p_permission,
    'scope', v_scope
  );
end $$;

create or replace function public.admin_revoke_permission(
  p_user_id    uuid,
  p_permission text,
  p_scope      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  update public.user_permissions
  set revoked_at = now()
  where user_id = p_user_id
    and permission = p_permission
    and (p_scope is null or scope = p_scope)
    and revoked_at is null;

  -- Audit log
  perform public.log_audit_event(
    'PERMISSION_REVOKED',
    'user_permissions',
    p_user_id::text,
    jsonb_build_object('permission', p_permission, 'scope', p_scope),
    null
  );

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'permission', p_permission);
end $$;

revoke all on function public.admin_grant_permission(uuid, text, text, uuid) from public, anon;
revoke all on function public.admin_revoke_permission(uuid, text, text) from public, anon;
grant execute on function public.admin_grant_permission(uuid, text, text, uuid) to authenticated;
grant execute on function public.admin_revoke_permission(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

