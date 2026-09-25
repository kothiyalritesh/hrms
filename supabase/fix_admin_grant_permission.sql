-- ==============================================================================
-- REALTYHRM MASTER HOTFIX: Multi-Dimensional Scopes & admin_grant_permission
--
-- Features:
-- 1. Alters audit_logs.record_id from uuid to text (fixes 42804 datatype mismatch)
-- 2. Adds multi-dimensional scope columns (office_id, department, team_lead_id, team_name)
-- 3. Drops obsolete function overloads to prevent PostgREST signature ambiguity
-- 4. Replaces public.can_access_user_data with recursive hierarchy & matrix matching
-- 5. Replaces admin_grant_permission with multi-dimensional check-and-upsert logic
-- 6. Replaces admin_revoke_permission, log_audit_event, and get_my_permissions
-- 7. Reloads PostgREST schema cache
-- ==============================================================================

-- 1. Ensure audit_logs.record_id is text so text entity IDs can be stored
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

-- 2. Drop all previous function overloads
drop function if exists public.admin_grant_permission(uuid, text);
drop function if exists public.admin_revoke_permission(uuid, text);
drop function if exists public.admin_grant_permission(uuid, text, text, uuid);
drop function if exists public.admin_revoke_permission(uuid, text, text);
drop function if exists public.admin_grant_permission(uuid, text, text, uuid, uuid, text, uuid, text);

-- 3. Ensure user_permissions schema has multi-dimensional columns
alter table public.user_permissions
  add column if not exists scope text not null default 'GLOBAL',
  add column if not exists scope_id uuid default null,
  add column if not exists office_id uuid references public.offices(id) on delete cascade,
  add column if not exists department text,
  add column if not exists team_lead_id uuid references public.profiles(id) on delete set null,
  add column if not exists team_name text,
  add column if not exists revoked_at timestamptz default null;

-- Drop legacy table constraint that blocked scope variations
alter table public.user_permissions drop constraint if exists user_permissions_unique;
drop index if exists idx_user_permissions_unique_scoped;

create unique index if not exists idx_user_permissions_unique_scoped
  on public.user_permissions(
    user_id,
    permission,
    scope,
    coalesce(office_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(department, '__ALL__'),
    coalesce(team_lead_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where revoked_at is null;

-- 4. Audit Logging RPC
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

-- 5. Recursive Multi-Dimensional Scope Access Resolver: can_access_user_data
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
  v_rule record;
begin
  if v_uid is null then
    return false;
  end if;

  -- Admin override: Full access across entire organization
  select * into v_caller from public.profiles where id = v_uid;
  if v_caller.role in ('SYSTEM_ADMIN', 'ADMIN') then
    return true;
  end if;

  -- Self access: Users can always view their own records
  if p_target_user_id = v_uid then
    return true;
  end if;

  select * into v_target from public.profiles where id = p_target_user_id;
  if v_target.id is null then
    return false;
  end if;

  -- Evaluate caller's active permission rules for this specific permission
  for v_rule in
    select scope, scope_id, office_id, department, team_lead_id, team_name
    from public.user_permissions
    where user_id = v_uid
      and permission = p_permission
      and revoked_at is null
  loop
    -- Rule A: GLOBAL scope grants universal access
    if v_rule.scope = 'GLOBAL' then
      return true;
    end if;

    -- Rule B: SELF scope only matches caller
    if v_rule.scope = 'SELF' and p_target_user_id = v_uid then
      return true;
    end if;

    -- Rule C: Compound Multi-Dimensional Filter (Branch x Dept x Team)
    declare
      v_match boolean := true;
    begin
      -- 1. Office / Branch Dimension
      if v_rule.office_id is not null then
        if v_target.office_id is distinct from v_rule.office_id then
          v_match := false;
        end if;
      elsif v_rule.scope = 'BRANCH' and v_rule.office_id is null then
        -- Dynamic fallback: caller's own branch
        if v_target.office_id is distinct from v_caller.office_id then
          v_match := false;
        end if;
      end if;

      -- 2. Department Dimension
      if v_match and v_rule.department is not null and v_rule.department <> '__ALL__' then
        if lower(coalesce(v_target.department, '')) <> lower(v_rule.department) then
          v_match := false;
        end if;
      elsif v_match and v_rule.scope = 'DEPARTMENT' and v_rule.department is null then
        -- Dynamic fallback: caller's own department
        if lower(coalesce(v_target.department, '')) <> lower(coalesce(v_caller.department, '')) then
          v_match := false;
        end if;
      end if;

      -- 3. Team Lead / Hierarchy Dimension (Recursive traversal)
      if v_match and v_rule.team_lead_id is not null then
        -- Matches if target is the team lead themselves OR reports directly/indirectly to the team lead
        if v_target.id <> v_rule.team_lead_id and not exists (
          with recursive sub_team as (
            select id from public.profiles where reports_to = v_rule.team_lead_id
            union
            select p.id from public.profiles p join sub_team st on p.reports_to = st.id
          )
          select 1 from sub_team where id = v_target.id
        ) then
          v_match := false;
        end if;
      elsif v_match and v_rule.scope = 'TEAM' and v_rule.team_lead_id is null then
        -- Dynamic fallback: caller's own direct reportees or same team
        if v_target.reports_to <> v_uid and lower(coalesce(v_target.team, '')) <> lower(coalesce(v_caller.team, '')) then
          v_match := false;
        end if;
      end if;

      -- 4. Team Name Dimension
      if v_match and v_rule.team_name is not null and v_rule.team_name <> '__ALL__' then
        if lower(coalesce(v_target.team, '')) <> lower(v_rule.team_name) then
          v_match := false;
        end if;
      end if;

      -- If all specified dimensions match, grant access
      if v_match then
        return true;
      end if;
    end;
  end loop;

  return false;
end $$;

-- 6. Multi-Dimensional Admin Grant Permission RPC
create or replace function public.admin_grant_permission(
  p_user_id      uuid,
  p_permission   text,
  p_scope        text default 'GLOBAL',
  p_scope_id     uuid default null,
  p_office_id    uuid default null,
  p_department   text default null,
  p_team_lead_id uuid default null,
  p_team_name    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_scope       text := coalesce(p_scope, 'GLOBAL');
  v_existing_id uuid;
begin
  -- 1. Security Gate: Only SYSTEM_ADMIN or ADMIN can grant permissions
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  -- 2. Validate target employee exists
  if not exists (
    select 1 from public.profiles
    where id = p_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- 3. Scope validation fallback
  if v_scope not in ('GLOBAL', 'BRANCH', 'DEPARTMENT', 'TEAM', 'SELF', 'CUSTOM') then
    v_scope := 'GLOBAL';
  end if;

  -- Normalize empty strings to null
  if p_department = '' or p_department = '__ALL__' then p_department := null; end if;
  if p_team_name = '' or p_team_name = '__ALL__' then p_team_name := null; end if;

  -- 4. Check for existing permission entry for (user_id, permission)
  select id into v_existing_id
  from public.user_permissions
  where user_id = p_user_id
    and permission = p_permission
  order by (revoked_at is null) desc, granted_at desc
  limit 1;

  if v_existing_id is not null then
    -- Update existing record with new multi-dimensional configuration
    update public.user_permissions
    set scope        = v_scope,
        scope_id     = coalesce(p_office_id, p_scope_id),
        office_id    = p_office_id,
        department   = p_department,
        team_lead_id = p_team_lead_id,
        team_name    = p_team_name,
        granted_by   = v_uid,
        granted_at   = now(),
        revoked_at   = null
    where id = v_existing_id;
  else
    -- Insert new multi-dimensional permission
    insert into public.user_permissions (
      user_id,
      permission,
      scope,
      scope_id,
      office_id,
      department,
      team_lead_id,
      team_name,
      granted_by,
      granted_at,
      revoked_at
    ) values (
      p_user_id,
      p_permission,
      v_scope,
      coalesce(p_office_id, p_scope_id),
      p_office_id,
      p_department,
      p_team_lead_id,
      p_team_name,
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
    jsonb_build_object(
      'permission', p_permission,
      'scope', v_scope,
      'office_id', p_office_id,
      'department', p_department,
      'team_lead_id', p_team_lead_id,
      'team_name', p_team_name
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'permission', p_permission,
    'scope', v_scope,
    'office_id', p_office_id,
    'department', p_department,
    'team_lead_id', p_team_lead_id,
    'team_name', p_team_name
  );
end $$;

-- 7. Multi-Dimensional Admin Revoke Permission RPC
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

-- 8. Updated get_my_permissions RPC with dimensional attributes
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
        'scope_id', up.scope_id,
        'office_id', up.office_id,
        'department', up.department,
        'team_lead_id', up.team_lead_id,
        'team_name', up.team_name
      )
    ),
    '[]'::jsonb
  )
  from public.user_permissions up
  where up.user_id = auth.uid()
    and up.revoked_at is null;
$$;

-- 9. Grant execution privileges to authenticated users
revoke all on function public.log_audit_event(text, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.log_audit_event(text, text, text, jsonb, jsonb, jsonb) to authenticated;

revoke all on function public.can_access_user_data(uuid, text) from public, anon;
grant execute on function public.can_access_user_data(uuid, text) to authenticated;

revoke all on function public.admin_grant_permission(uuid, text, text, uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.admin_grant_permission(uuid, text, text, uuid, uuid, text, uuid, text) to authenticated;

revoke all on function public.admin_revoke_permission(uuid, text, text) from public, anon;
grant execute on function public.admin_revoke_permission(uuid, text, text) to authenticated;

revoke all on function public.get_my_permissions() from public, anon;
grant execute on function public.get_my_permissions() to authenticated;

-- 10. Refresh PostgREST schema cache
notify pgrst, 'reload schema';

