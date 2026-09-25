-- Migration: 20260908010000_permissions_model.sql
-- Fine-grained backend-controlled permissions model
-- Replaces role-string-based feature gating with explicit per-user permission grants.

-- 1. user_permissions table
create table if not exists public.user_permissions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  permission text        not null,
  granted_by uuid        references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  constraint user_permissions_unique unique (user_id, permission)
);

create index if not exists idx_user_permissions_user_id
  on public.user_permissions(user_id);

create index if not exists idx_user_permissions_permission
  on public.user_permissions(permission);

-- 2. Row-Level Security
alter table public.user_permissions enable row level security;

drop policy if exists user_permissions_select on public.user_permissions;
create policy user_permissions_select
  on public.user_permissions for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('SYSTEM_ADMIN', 'ADMIN')
    )
  );

drop policy if exists user_permissions_insert on public.user_permissions;
create policy user_permissions_insert
  on public.user_permissions for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('SYSTEM_ADMIN', 'ADMIN')
    )
  );

drop policy if exists user_permissions_delete on public.user_permissions;
create policy user_permissions_delete
  on public.user_permissions for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('SYSTEM_ADMIN', 'ADMIN')
    )
  );

-- 3. get_my_permissions() RPC
drop function if exists public.get_my_permissions();
create or replace function public.get_my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(permission order by permission), '{}')
  from public.user_permissions
  where user_id = auth.uid();
$$;

revoke all on function public.get_my_permissions() from public, anon;
grant execute on function public.get_my_permissions() to authenticated;

-- 4. has_permission(perm) helper for use inside other RPCs and policies
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
  );
$$;

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- 5. Admin RPCs: grant_permission / revoke_permission
drop function if exists public.admin_grant_permission(uuid, text);
drop function if exists public.admin_revoke_permission(uuid, text);
drop function if exists public.admin_grant_permission(uuid, text, text, uuid);
drop function if exists public.admin_revoke_permission(uuid, text, text);

create or replace function public.admin_grant_permission(
  p_user_id    uuid,
  p_permission text
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
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
    where id = v_uid
      and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  insert into public.user_permissions (user_id, permission, granted_by)
  values (p_user_id, p_permission, auth.uid())
  on conflict (user_id, permission) do nothing;
  values (p_user_id, p_permission, v_uid)
  on conflict do nothing;

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'permission', p_permission);
  return jsonb_build_object('success', true, 'user_id', p_user_id, 'permission', p_permission, 'scope', v_scope);
end $$;

create or replace function public.admin_revoke_permission(
  p_user_id    uuid,
  p_permission text
  p_permission text,
  p_scope      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  delete from public.user_permissions
  where user_id = p_user_id and permission = p_permission;

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'permission', p_permission);
end $$;

revoke all on function public.admin_grant_permission(uuid, text) from public, anon;
revoke all on function public.admin_revoke_permission(uuid, text) from public, anon;
grant execute on function public.admin_grant_permission(uuid, text) to authenticated;
grant execute on function public.admin_revoke_permission(uuid, text) to authenticated;
revoke all on function public.admin_grant_permission(uuid, text, text, uuid) from public, anon;
revoke all on function public.admin_revoke_permission(uuid, text, text) from public, anon;
grant execute on function public.admin_grant_permission(uuid, text, text, uuid) to authenticated;
grant execute on function public.admin_revoke_permission(uuid, text, text) to authenticated;

-- Permission keys used by HRMS:
--   view_live_tracking          View real-time employee location map
--   view_location_history       Open timeline/history modal per employee
--   view_site_visit_observer    Access Site Visit Observer panel
--   view_location_reports       Download location / visit reports
--   view_hr_panel               Access HR Panel section
--   view_reports                Access Reports section
--   manage_leave                Approve / reject leave requests
--   manage_attendance           Edit / override attendance records
--   manage_employee_details     Edit employee profile data
--   manage_tasks                Create tasks on behalf of other employees
