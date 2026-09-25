DELETE FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE permission_key = 'field_visit.create');
DELETE FROM public.user_permission_overrides WHERE permission_id IN (SELECT id FROM public.permissions WHERE permission_key = 'field_visit.create');
DELETE FROM public.permissions WHERE permission_key = 'field_visit.create';
insert into public.permissions (module, action, permission_key, description) values
('EMPLOYEE', 'view', 'employee.view', 'View employee profiles'),
('EMPLOYEE', 'create', 'employee.create', 'Create new employees'),
('EMPLOYEE', 'edit', 'employee.edit', 'Edit employee profiles'),
('EMPLOYEE', 'deactivate', 'employee.deactivate', 'Deactivate employees'),
('ATTENDANCE', 'view', 'attendance.view', 'View attendance records'),
('ATTENDANCE', 'edit', 'attendance.edit', 'Edit attendance records'),
('ATTENDANCE', 'export', 'attendance.export', 'Export attendance reports'),
('ATTENDANCE', 'approve', 'attendance.approve', 'Approve manual attendance/regularizations'),
('LEAVE', 'view', 'leave.view', 'View leave requests'),
('LEAVE', 'approve', 'leave.approve', 'Approve or reject leave requests'),
('LOCATION', 'view_live', 'location.view_live', 'View live tracking on maps'),
('FIELD_VISIT', 'view', 'field_visit.view', 'View field visits/meetings'),
('FIELD_VISIT', 'create', 'field_visit.create', 'Assign field visits')
on conflict (permission_key) do nothing;
-- Fix: Remove the OFFICE_NOT_ASSIGNED guard from the inner rpc_attendance_checkin.
--
-- Background: Migration 20260918010000_allow_any_office_checkin.sql updated the
-- outer rpc_attendance_checkin_v2 to allow employees to check in at any active
-- office. However, migration 20260804000000_fix_attendance_checkin_rpc_overload.sql
-- also redefined the inner rpc_attendance_checkin (the private function called by
-- v2) and kept the old assigned-office check (profile.office_id = p_office_id).
-- This inner guard fires first and returns OFFICE_NOT_ASSIGNED before the outer
-- v2 logic even runs, causing the user-facing error:
--   "Attendance can only be marked for your assigned office."
--
-- The office-assignment validation is the responsibility of the outer v2 wrapper.
-- The inner function only needs to validate that the office is active and the
-- GPS reading is valid.

create or replace function public.rpc_attendance_checkin(
  p_user_id uuid,
  p_office_id uuid,
  p_checkin_location jsonb,
  p_distance double precision,
  p_source text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now timestamptz := clock_timestamp();
  v_attendance public.attendance_logs%rowtype;
  v_office public.offices%rowtype;
  v_lat double precision;
  v_lon double precision;
  v_source text := upper(coalesce(nullif(btrim(p_source), ''), 'APP'));
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED',
      'message', 'A valid session is required.');
  end if;
  if p_user_id is distinct from v_uid then
    return jsonb_build_object('success', false, 'error', 'USER_ID_MISMATCH',
      'message', 'You cannot create attendance for another employee.');
  end if;

  -- NOTE: The OFFICE_NOT_ASSIGNED check has been intentionally removed.
  -- Any-office check-in validation is handled by the outer rpc_attendance_checkin_v2
  -- wrapper (which validates GPS proximity to the requested office).

  select * into v_office from public.offices
  where id = p_office_id and coalesce(is_active, true);
  if not found then
    return jsonb_build_object('success', false, 'error', 'OFFICE_LOCATION_UNAVAILABLE',
      'message', 'The requested office is inactive or unavailable.');
  end if;

  begin
    v_lat := (p_checkin_location->>'latitude')::double precision;
    v_lon := (p_checkin_location->>'longitude')::double precision;
  exception when others then
    return jsonb_build_object('success', false, 'error', 'INVALID_GPS',
      'message', 'A valid precise GPS reading is required.');
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || v_today::text, 0)
  );
  select * into v_attendance from public.attendance_logs
  where user_id = v_uid and date = v_today
  order by created_at desc limit 1 for update;

  if found and v_attendance.checkin_time is not null then
    return jsonb_build_object(
      'success', true, 'existing', true, 'id', v_attendance.id,
      'attendance_id', v_attendance.id,
      'checkin_time', v_attendance.checkin_time,
      'status', v_attendance.status,
      'attendance_state', v_attendance.attendance_state,
      'server_now', v_now,
      'message', 'Already checked in today.'
    );
  end if;

  if found then
    update public.attendance_logs set
      attendance_type = coalesce(attendance_type, 'OFFICE'),
      office_id = p_office_id,
      checkin_location = p_checkin_location,
      distance_from_office = round(p_distance)::integer,
      checkin_latitude = v_lat,
      checkin_longitude = v_lon,
      checkin_location_id = p_office_id,
      checkin_location_name = v_office.name,
      checkin_distance_meters = round(p_distance)::integer,
      checkin_source = v_source,
      status = 'CHECKED_IN',
      attendance_state = 'WORKING',
      attendance_status = coalesce(attendance_status, 'PRESENT'),
      day_status = coalesce(day_status, 'P'),
      checkin_time = v_now,
      updated_at = v_now
    where id = v_attendance.id
    returning * into v_attendance;
  else
    insert into public.attendance_logs(
      user_id, date, attendance_type, office_id, checkin_location,
      distance_from_office, checkin_latitude, checkin_longitude,
      checkin_location_id, checkin_location_name, checkin_distance_meters,
      checkin_source, status, attendance_state, attendance_status, day_status,
      checkin_time
    ) values (
      v_uid, v_today, 'OFFICE', p_office_id, p_checkin_location,
      round(p_distance)::integer, v_lat, v_lon,
      p_office_id, v_office.name, round(p_distance)::integer,
      v_source, 'CHECKED_IN', 'WORKING', 'PRESENT', 'P', v_now
    ) returning * into v_attendance;
  end if;

  begin
    insert into public.attendance_audit_logs(
      attendance_id, user_id, action, old_status, new_status, reason, source
    ) values (
      v_attendance.id, v_uid, 'CHECK_IN', null, 'CHECKED_IN',
      'Checked in at ' || coalesce(v_office.name, 'office'), v_source
    );
    insert into public.hrms_audit_events(
      actor_user_id, target_user_id, action, entity_type, entity_id,
      new_values, source
    ) values (
      v_uid, v_uid, 'MANUAL_APP_CHECKIN', 'attendance', v_attendance.id,
      jsonb_build_object('checkin_time', v_now, 'office_id', p_office_id,
        'distance_metres', p_distance), v_source
    );
  exception when others then
    null;
  end;

  begin
    insert into public.notifications(user_id, title, message, type, event_key)
    values(v_uid, 'Attendance check-in successful',
      'Your attendance was recorded at ' || v_office.name,
      'attendance_checkin', 'attendance-checkin:' || v_attendance.id)
    on conflict(event_key) where event_key is not null do nothing;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'success', true, 'existing', false, 'id', v_attendance.id,
    'attendance_id', v_attendance.id, 'checkin_time', v_attendance.checkin_time,
    'status', v_attendance.status, 'attendance_state', v_attendance.attendance_state,
    'server_now', v_now, 'message', 'Check-in successful.'
  );
exception
  when unique_violation then
    select * into v_attendance from public.attendance_logs
    where user_id = v_uid and date = v_today limit 1;
    return jsonb_build_object(
      'success', true, 'existing', true, 'id', v_attendance.id,
      'attendance_id', v_attendance.id, 'checkin_time', v_attendance.checkin_time,
      'status', v_attendance.status, 'attendance_state', v_attendance.attendance_state,
      'server_now', clock_timestamp(), 'message', 'Already checked in today.'
    );
  when others then
    return jsonb_build_object('success', false, 'error', sqlstate,
      'message', 'Check-in failed: ' || sqlerrm);
end $$;

revoke all on function public.rpc_attendance_checkin(uuid,uuid,jsonb,double precision,text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';

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




-- Update rpc_admin_save_profile to handle date_of_joining
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
  v_raw_phone text := p_values->>'phone';
  v_phone text := nullif(regexp_replace(coalesce(v_raw_phone, ''), '\D', '', 'g'), '');
  v_existing_phone text;
  v_gender text := coalesce(upper(btrim(p_values->>'gender')), 'MALE');
  v_doj date := nullif(p_values->>'date_of_joining', '')::date;
begin
  if nullif(btrim(p_values->>'name'), '') is null then
    raise exception 'PROFILE_NAME_REQUIRED';
  end if;

  if v_target_role in ('SYSTEM_ADMIN', 'SUPER_ADMIN') and v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
    raise exception 'UNAUTHORIZED_ROLE_ASSIGNMENT';
  end if;

  if v_phone is null then
    raise exception 'PROFILE_PHONE_REQUIRED';
  end if;

  if length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'INVALID_PHONE_NUMBER_FORMAT';
  end if;

  if v_gender not in ('MALE', 'FEMALE') then
    v_gender := 'MALE';
  end if;

  if v_id is null then
    if exists (select 1 from public.profiles where phone = v_phone) then
      raise exception 'PHONE_NUMBER_ALREADY_EXISTS';
    end if;

    insert into public.profiles (
      name, email, phone, employee_number, role, role_id,
      office_id, team, is_active, gender, date_of_joining
    ) values (
      btrim(p_values->>'name'),
      nullif(btrim(p_values->>'email'), ''),
      v_phone,
      nullif(btrim(p_values->>'employee_number'), ''),
      nullif(btrim(p_values->>'role'), ''),
      nullif(p_values->>'role_id', '')::uuid,
      nullif(p_values->>'office_id', '')::uuid,
      nullif(btrim(p_values->>'team'), ''),
      coalesce((p_values->>'is_active')::boolean, true),
      v_gender,
      v_doj
    ) returning id into v_id;

    perform public.log_audit_event('EMPLOYEE_CREATED', 'profiles', v_id::text, null, p_values);
  else
    select phone into v_existing_phone from public.profiles where id = v_id;
    if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

    if v_existing_phone <> v_phone and exists (
      select 1 from public.profiles where phone = v_phone and id <> v_id
    ) then
      raise exception 'PHONE_NUMBER_ALREADY_EXISTS';
    end if;

    update public.profiles
    set name = btrim(p_values->>'name'),
        email = nullif(btrim(p_values->>'email'), ''),
        phone = v_phone,
        employee_number = nullif(btrim(p_values->>'employee_number'), ''),
        role = nullif(btrim(p_values->>'role'), ''),
        role_id = nullif(p_values->>'role_id', '')::uuid,
        office_id = nullif(p_values->>'office_id', '')::uuid,
        team = nullif(btrim(p_values->>'team'), ''),
        gender = v_gender,
        date_of_joining = coalesce(v_doj, date_of_joining), -- Only update if provided
        updated_at = now()
    where id = v_id;

    perform public.log_audit_event(
      'EMPLOYEE_UPDATED',
      'profiles',
      v_id::text,
      jsonb_build_object('phone', v_existing_phone),
      p_values
    );
  end if;

  return jsonb_build_object('success', true, 'profile_id', v_id, 'phone', v_phone);
end $$;
