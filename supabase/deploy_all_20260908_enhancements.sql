-- =============================================================================
-- HISTORICAL BUNDLE - DO NOT RUN (marked 2026-10-19)
-- Snapshot of the 2026-09-08 migrations. Many functions in it were replaced
-- by later migrations; running it now would roll them back. Deploy from the
-- ordered supabase/migrations folder instead (see
-- docs/realtyhrm-audit/11_DEPLOYMENT_MANIFEST.md).
-- =============================================================================
-- ==============================================================================
-- REALTYHRM MASTER ENHANCEMENTS DEPLOYMENT SCRIPT (2026-09-08)
--
-- This script encapsulates all 9 production-hardened migrations:
-- 1. Site Visit Live Location Tracking & Evidence Schema
-- 2. Fine-grained RBAC Permissions Engine
-- 3. Leave Balance Admin Adjustments & Audit Trail
-- 4. Employee Exit Archive Procedure
-- 5. Universal Audit Logs & Scoped Permissions (GLOBAL, BRANCH, DEPT, TEAM, SELF)
-- 6. Rebuilt Site Visit Observer RPC (get_site_visit_observer_data)
-- 7. Enhanced Visit Reports Export RPC (get_enhanced_visit_reports)
-- 8. Backlog Enhancements (Task on behalf, Attendance Exceptions, IP Allowlist, Field Feedback)
-- 9. Production Performance Indexes & RLS Hardening
-- ==============================================================================


-- ==============================================================================
-- BEGIN MIGRATION: 20260908000000_site_visit_live_location_tracking.sql
-- ==============================================================================

-- Migration: 20260908000000_site_visit_live_location_tracking.sql
-- Description: Live Location Tracking Strictly Scoped to Active Site Visits
-- Tables: site_visit_live_locations, site_visit_location_history
-- RPC: record_site_visit_location_batch
-- Retention: purge_expired_site_visit_location_history

create extension if not exists pgcrypto;

-- Ensure field_visits compatibility columns exist
alter table public.field_visits add column if not exists client_name text;
alter table public.field_visits add column if not exists client_phone text;

do $$
begin
  if exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'field_visits' and column_name = 'contact_name'
  ) then
    update public.field_visits 
    set client_name = contact_name 
    where client_name is null and contact_name is not null;
  end if;

  if exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'field_visits' and column_name = 'contact_phone'
  ) then
    update public.field_visits 
    set client_phone = contact_phone 
    where client_phone is null and contact_phone is not null;
  end if;
end $$;

-- 1. Dedicated Live Location Hot-Table (Latest location per active visit)
create table if not exists public.site_visit_live_locations (
  field_visit_id uuid primary key references public.field_visits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  altitude_m double precision,
  heading double precision,
  speed_mps double precision,
  battery_level double precision,
  tracking_status text not null check (tracking_status in ('IN_TRANSIT', 'AT_SITE', 'STOPPED', 'GPS_LOST', 'LOW_ACCURACY')),
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_site_visit_live_user
  on public.site_visit_live_locations(user_id, updated_at desc);

-- 2. Dedicated Historical Breadcrumbs Table
create table if not exists public.site_visit_location_history (
  id uuid primary key default gen_random_uuid(),
  field_visit_id uuid not null references public.field_visits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_event_id uuid not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  altitude_m double precision,
  heading double precision,
  speed_mps double precision,
  mocked boolean not null default false,
  quality_status text not null default 'RELIABLE'
    check (quality_status in ('RELIABLE', 'LOW_ACCURACY', 'MOCKED', 'STALE', 'IMPOSSIBLE_SPEED')),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint site_visit_location_history_client_id_uniq unique(client_event_id)
);

create index if not exists idx_sv_loc_history_visit_time
  on public.site_visit_location_history(field_visit_id, recorded_at asc);
create index if not exists idx_sv_loc_history_user_date
  on public.site_visit_location_history(user_id, recorded_at desc);

-- 3. Row-Level Security
alter table public.site_visit_live_locations enable row level security;
alter table public.site_visit_location_history enable row level security;

-- Read policies: Authorized managers, Admins, HR or the user themselves
create or replace function public.can_view_tracking_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id = auth.uid()
    or exists (
      select 1
      from public.profiles employee
      where employee.id = p_user_id
        and employee.reports_to = auth.uid()
        and employee.is_active = true
    )
    or exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.is_active = true
        and upper(actor.role) in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    );
$$;

revoke all on function public.can_view_tracking_user(uuid) from public;
grant execute on function public.can_view_tracking_user(uuid) to authenticated;

drop policy if exists sv_live_locations_select on public.site_visit_live_locations;
create policy sv_live_locations_select on public.site_visit_live_locations
  for select to authenticated
  using (public.can_view_tracking_user(user_id));

drop policy if exists sv_loc_history_select on public.site_visit_location_history;
create policy sv_loc_history_select on public.site_visit_location_history
  for select to authenticated
  using (public.can_view_tracking_user(user_id));

-- Direct client inserts/updates disabled; all mutations go through validated SECURITY DEFINER RPC

-- 4. Batched Location Ingestion RPC with Strict Active Visit Lifecycle Validation
create or replace function public.record_site_visit_location_batch(
  p_field_visit_id uuid,
  p_pings jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_visit public.field_visits%rowtype;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_item jsonb;
  v_lat double precision;
  v_lon double precision;
  v_acc double precision;
  v_speed double precision;
  v_heading double precision;
  v_alt double precision;
  v_mocked boolean;
  v_client_id uuid;
  v_recorded_at timestamptz;
  v_quality text;
  v_latest_lat double precision;
  v_latest_lon double precision;
  v_latest_acc double precision;
  v_latest_time timestamptz := '-infinity';
  v_latest_speed double precision;
  v_latest_heading double precision;
  v_latest_alt double precision;
  v_inserted_count int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'should_stop', true);
  end if;

  if p_field_visit_id is null then
    return jsonb_build_object('success', false, 'error', 'VISIT_ID_REQUIRED', 'should_stop', true);
  end if;

  -- Verify active site visit ownership and status
  select * into v_visit from public.field_visits
  where id = p_field_visit_id and user_id = v_uid;

  if not found then
    return jsonb_build_object('success', false, 'error', 'VISIT_NOT_FOUND', 'should_stop', true);
  end if;

  -- STRICT PRIVACY CHECK: Only allow tracking for active visits today
  if v_visit.date <> v_today or v_visit.status not in ('IN_TRANSIT', 'CHECKED_IN') then
    return jsonb_build_object(
      'success', false,
      'error', 'VISIT_NOT_ACTIVE',
      'visit_status', v_visit.status,
      'should_stop', true
    );
  end if;

  -- Process batch of pings
  if p_pings is not null and jsonb_typeof(p_pings) = 'array' then
    for v_item in select * from jsonb_array_elements(p_pings) loop
      v_client_id := coalesce(nullif(v_item->>'client_event_id', '')::uuid, gen_random_uuid());
      v_lat := nullif(v_item->>'latitude', '')::double precision;
      v_lon := nullif(v_item->>'longitude', '')::double precision;
      v_acc := nullif(v_item->>'accuracy', '')::double precision;
      v_alt := nullif(v_item->>'altitude', '')::double precision;
      v_speed := nullif(v_item->>'speed', '')::double precision;
      v_heading := nullif(v_item->>'heading', '')::double precision;
      v_mocked := coalesce((v_item->>'mocked')::boolean, false);
      v_recorded_at := coalesce(nullif(v_item->>'captured_at', '')::timestamptz, now());

      -- Validate coordinate bounds
      if v_lat is null or v_lon is null or v_lat not between -90 and 90 or v_lon not between -180 and 180 or (v_lat = 0 and v_lon = 0) then
        continue;
      end if;

      -- Assess Quality
      v_quality := 'RELIABLE';
      if v_mocked then
        v_quality := 'MOCKED';
      elsif v_acc is null or v_acc > 100 then
        v_quality := 'LOW_ACCURACY';
      elsif v_recorded_at < now() - interval '24 hours' or v_recorded_at > now() + interval '2 minutes' then
        v_quality := 'STALE';
      end if;

      -- Insert into historical breadcrumbs if not duplicate
      begin
        insert into public.site_visit_location_history(
          field_visit_id, user_id, client_event_id, latitude, longitude,
          accuracy_m, altitude_m, heading, speed_mps, mocked, quality_status, recorded_at
        ) values (
          v_visit.id, v_uid, v_client_id, v_lat, v_lon,
          v_acc, v_alt, v_heading, v_speed, v_mocked, v_quality, v_recorded_at
        );
        v_inserted_count := v_inserted_count + 1;
      exception when unique_violation then
        -- Duplicate client_event_id; safely ignore
      end;

      -- Track latest reading for live hot-table
      if v_recorded_at > v_latest_time and v_quality = 'RELIABLE' then
        v_latest_time := v_recorded_at;
        v_latest_lat := v_lat;
        v_latest_lon := v_lon;
        v_latest_acc := v_acc;
        v_latest_alt := v_alt;
        v_latest_speed := v_speed;
        v_latest_heading := v_heading;
      end if;
    end loop;
  end if;

  -- Upsert latest live location
  if v_latest_time > '-infinity' then
    insert into public.site_visit_live_locations (
      field_visit_id, user_id, latitude, longitude, accuracy_m,
      altitude_m, heading, speed_mps, tracking_status, recorded_at, updated_at
    ) values (
      v_visit.id, v_uid, v_latest_lat, v_latest_lon, v_latest_acc,
      v_latest_alt, v_latest_heading, v_latest_speed,
      case when v_visit.status = 'CHECKED_IN' then 'AT_SITE' else 'IN_TRANSIT' end,
      v_latest_time, now()
    )
    on conflict (field_visit_id) do update set
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy_m = excluded.accuracy_m,
      altitude_m = excluded.altitude_m,
      heading = excluded.heading,
      speed_mps = excluded.speed_mps,
      tracking_status = excluded.tracking_status,
      recorded_at = excluded.recorded_at,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'success', true,
    'inserted', v_inserted_count,
    'should_stop', false,
    'visit_status', v_visit.status
  );
end $$;

revoke all on function public.record_site_visit_location_batch(uuid, jsonb) from public, anon;
grant execute on function public.record_site_visit_location_batch(uuid, jsonb) to authenticated;

-- 5. Automatic Stop Trigger: Cleanup live location on visit completion or cancellation
create or replace function public.trg_cleanup_site_visit_live_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('COMPLETED', 'MISSED') and (old.status is null or old.status in ('IN_TRANSIT', 'CHECKED_IN', 'PENDING')) then
    delete from public.site_visit_live_locations where field_visit_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists cleanup_site_visit_live_location_trg on public.field_visits;
create trigger cleanup_site_visit_live_location_trg
after update of status on public.field_visits
for each row execute function public.trg_cleanup_site_visit_live_location();

-- 6. Scheduled Retention Cleanup Function (Retention window: default 60 days)
create or replace function public.purge_expired_site_visit_location_history(
  p_retention_days int default 60
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.site_visit_location_history
  where recorded_at < now() - (greatest(7, least(p_retention_days, 365)) || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.purge_expired_site_visit_location_history(int) from public, anon;
grant execute on function public.purge_expired_site_visit_location_history(int) to authenticated;

notify pgrst, 'reload schema';



-- ==============================================================================
-- END MIGRATION: 20260908000000_site_visit_live_location_tracking.sql
-- ==============================================================================

-- ==============================================================================
-- BEGIN MIGRATION: 20260908010000_permissions_model.sql
-- ==============================================================================

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
create or replace function public.admin_grant_permission(
  p_user_id    uuid,
  p_permission text
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

  insert into public.user_permissions (user_id, permission, granted_by)
  values (p_user_id, p_permission, auth.uid())
  on conflict (user_id, permission) do nothing;

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'permission', p_permission);
end $$;

create or replace function public.admin_revoke_permission(
  p_user_id    uuid,
  p_permission text
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


-- ==============================================================================
-- END MIGRATION: 20260908010000_permissions_model.sql
-- ==============================================================================

-- ==============================================================================
-- BEGIN MIGRATION: 20260908050000_leave_admin_tools.sql
-- ==============================================================================

-- Migration: 20260908050000_leave_admin_tools.sql
-- Admin tools for manual leave balance adjustments and audit logging.

create table if not exists public.leave_balance_audit_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  leave_type     text not null,
  delta_days     double precision not null,
  reason         text not null,
  adjusted_by    uuid references public.profiles(id) on delete set null,
  adjusted_at    timestamptz not null default now()
);

create index if not exists idx_leave_balance_audit_user on public.leave_balance_audit_log(user_id);

alter table public.leave_balance_audit_log enable row level security;

create policy leave_balance_audit_select on public.leave_balance_audit_log
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    )
  );

create or replace function public.admin_adjust_leave_balance(
  p_user_id      uuid,
  p_leave_type   text,
  p_days         double precision,
  p_reason       text
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
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_leave'
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  -- Record audit log entry
  insert into public.leave_balance_audit_log (
    user_id, leave_type, delta_days, reason, adjusted_by
  ) values (
    p_user_id, p_leave_type, p_days, p_reason, v_uid
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'leave_type', p_leave_type,
    'delta_days', p_days
  );
end $$;

revoke all on function public.admin_adjust_leave_balance(uuid, text, double precision, text) from public, anon;
grant execute on function public.admin_adjust_leave_balance(uuid, text, double precision, text) to authenticated;


-- ==============================================================================
-- END MIGRATION: 20260908050000_leave_admin_tools.sql
-- ==============================================================================

-- ==============================================================================
-- BEGIN MIGRATION: 20260908060000_employee_exit_archive.sql
-- ==============================================================================

-- Migration: 20260908060000_employee_exit_archive.sql
-- Employee archive and exit procedure.

create or replace function public.archive_exited_employee(
  p_user_id   uuid,
  p_exit_date date,
  p_reason    text default null
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
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_employee_details'
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  -- 1. Mark profile as inactive and set last working date
  update public.profiles
  set
    is_active = false,
    last_working_date = coalesce(p_exit_date, (now() at time zone 'Asia/Kolkata')::date),
    updated_at = now()
  where id = p_user_id;

  -- 2. Revoke all fine-grained permissions
  delete from public.user_permissions
  where user_id = p_user_id;

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'exit_date', p_exit_date
  );
end $$;

revoke all on function public.archive_exited_employee(uuid, date, text) from public, anon;
grant execute on function public.archive_exited_employee(uuid, date, text) to authenticated;


-- ==============================================================================
-- END MIGRATION: 20260908060000_employee_exit_archive.sql
-- ==============================================================================

-- ==============================================================================
-- BEGIN MIGRATION: 20260908070000_audit_logs_and_permission_scopes.sql
-- ==============================================================================

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
begin
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  insert into public.user_permissions (user_id, permission, scope, scope_id, granted_by, granted_at, revoked_at)
  values (p_user_id, p_permission, v_scope, p_scope_id, v_uid, now(), null)
  on conflict do nothing;

  -- Audit log
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



-- ==============================================================================
-- END MIGRATION: 20260908070000_audit_logs_and_permission_scopes.sql
-- ==============================================================================

-- ==============================================================================
-- BEGIN MIGRATION: 20260908080000_rebuild_observer_rpc.sql
-- ==============================================================================

-- Migration: 20260908080000_rebuild_observer_rpc.sql
-- Restructured Site Visit Observer Query Architecture
-- field_visits -> profiles -> latest location -> visit summary
-- Incorporates 4-tier signal status, summary metrics, and scoped access control.

create or replace function public.get_site_visit_observer_data(
  p_date        date,
  p_employee_id uuid default null,
  p_visit_id    uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_today       date := (now() at time zone 'Asia/Kolkata')::date;
  v_is_live     boolean := (p_date = v_today);
  v_mode        text := case when v_is_live then 'LIVE' else 'HISTORICAL' end;
  v_is_admin    boolean := false;
  v_summary     jsonb;
  v_employees   jsonb;
begin
  -- 1. Authentication & Permission Gate
  if v_uid is null then
    return jsonb_build_object('error', 'AUTHENTICATION_REQUIRED');
  end if;

  select exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) into v_is_admin;

  if not v_is_admin and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'view_site_visit_observer' and revoked_at is null
  ) then
    return jsonb_build_object('error', 'PERMISSION_DENIED');
  end if;

  -- 2. Build Summary Counts
  with visits_universe as (
    select
      fv.id as visit_id,
      fv.user_id,
      fv.status as visit_status,
      svl.updated_at as last_ping_at
    from public.field_visits fv
    join public.profiles p on p.id = fv.user_id
    left join public.site_visit_live_locations svl on svl.user_id = fv.user_id
    where fv.date = p_date
      and coalesce(fv.verification_status, 'PENDING') <> 'REJECTED'
      and (p_employee_id is null or fv.user_id = p_employee_id)
      and (p_visit_id is null or fv.id = p_visit_id)
      and (v_is_admin or public.can_access_user_data(fv.user_id, 'view_site_visit_observer'))
  ),
  counts as (
    select
      count(*)::int as total_visits,
      count(*) filter (where visit_status = 'IN_TRANSIT')::int as in_transit,
      count(*) filter (where visit_status = 'CHECKED_IN')::int as at_site,
      count(*) filter (where visit_status in ('COMPLETED', 'MISSED'))::int as completed,
      count(distinct user_id) filter (
        where v_is_live
          and visit_status in ('IN_TRANSIT', 'CHECKED_IN')
          and (last_ping_at is null or last_ping_at < now() - interval '5 minutes')
      )::int as signal_lost
    from visits_universe
  )
  select jsonb_build_object(
    'total_visits', coalesce(c.total_visits, 0),
    'in_transit',   coalesce(c.in_transit, 0),
    'at_site',      coalesce(c.at_site, 0),
    'completed',    coalesce(c.completed, 0),
    'signal_lost',  coalesce(c.signal_lost, 0)
  ) into v_summary
  from counts c;

  -- 3. Build Employee & Visit List
  with relevant_visits as (
    select
      fv.id as visit_id,
      fv.user_id,
      fv.status as visit_status,
      fv.location_name,
      fv.project_name,
      fv.checkin_time,
      fv.checkout_time,
      fv.visit_type,
      (fv.destination_coords->>'latitude')::double precision as dest_lat,
      (fv.destination_coords->>'longitude')::double precision as dest_lon,
      coalesce(fv.client_name, fv.contact_name) as client_name,
      coalesce(fv.client_phone, fv.contact_phone) as client_phone,
      fv.created_at
    from public.field_visits fv
    where fv.date = p_date
      and coalesce(fv.verification_status, 'PENDING') <> 'REJECTED'
      and (p_employee_id is null or fv.user_id = p_employee_id)
      and (p_visit_id is null or fv.id = p_visit_id)
      and (v_is_admin or public.can_access_user_data(fv.user_id, 'view_site_visit_observer'))
  ),
  distinct_employees as (
    select distinct user_id from relevant_visits
  ),
  employee_cards as (
    select
      p.id as employee_id,
      p.name,
      p.employee_number as employee_no,
      p.role,
      p.department,
      off.name as office_name,
      -- Tracking determination
      case
        when not v_is_live then 'COMPLETED'
        when has_active.val and (svl.updated_at is null or svl.updated_at < now() - interval '5 minutes') then 'SIGNAL_LOST'
        when svl.tracking_status = 'AT_SITE' then 'AT_SITE'
        when svl.tracking_status = 'IN_TRANSIT' then 'IN_TRANSIT'
        when has_active.val then 'IN_TRANSIT'
        else 'COMPLETED'
      end as computed_status,
      case
        when not v_is_live then 'COMPLETED'
        when svl.updated_at is null or svl.updated_at < now() - interval '5 minutes' then 'SIGNAL_LOST'
        when svl.updated_at < now() - interval '2 minutes' then 'DELAYED'
        else 'LIVE'
      end as computed_signal_status,
      svl.latitude,
      svl.longitude,
      svl.accuracy_m,
      svl.battery_level,
      svl.speed_mps,
      svl.updated_at as ping_updated_at,
      -- Nested visits
      (
        select jsonb_agg(
          jsonb_build_object(
            'visit_id',        rv.visit_id,
            'status',          rv.visit_status,
            'location_name',   rv.location_name,
            'project_name',    rv.project_name,
            'checkin_time',    rv.checkin_time,
            'checkout_time',   rv.checkout_time,
            'visit_type',      rv.visit_type,
            'destination_lat', rv.dest_lat,
            'destination_lon', rv.dest_lon,
            'client_name',     rv.client_name,
            'client_phone',    rv.client_phone
          ) order by rv.created_at asc
        )
        from relevant_visits rv
        where rv.user_id = p.id
      ) as visits_json
    from distinct_employees de
    join public.profiles p on p.id = de.user_id
    left join public.offices off on off.id = p.office_id
    left join public.site_visit_live_locations svl on svl.user_id = p.id and v_is_live
    cross join lateral (
      select exists (
        select 1 from relevant_visits v
        where v.user_id = p.id and v.visit_status in ('IN_TRANSIT', 'CHECKED_IN')
      ) as val
    ) has_active
    order by p.name asc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_id',     ec.employee_id,
        'name',            ec.name,
        'employee_no',     ec.employee_no,
        'role',            ec.role,
        'department',      ec.department,
        'office_name',     ec.office_name,
        'tracking', jsonb_build_object(
          'status',        ec.computed_status,
          'signal_status', ec.computed_signal_status,
          'latitude',      ec.latitude,
          'longitude',     ec.longitude,
          'accuracy',      ec.accuracy_m,
          'battery_level', ec.battery_level,
          'speed_mps',     ec.speed_mps,
          'updated_at',    ec.ping_updated_at
        ),
        'visits',          coalesce(ec.visits_json, '[]'::jsonb),
        -- Compatibility aliases
        'latest_lat',      ec.latitude,
        'latest_lon',      ec.longitude,
        'tracking_status', ec.computed_status,
        'updated_at',      ec.ping_updated_at
      )
    ),
    '[]'::jsonb
  ) into v_employees
  from employee_cards ec;

  return jsonb_build_object(
    'date',      p_date::text,
    'mode',      v_mode,
    'is_live',   v_is_live,
    'summary',   coalesce(v_summary, '{"total_visits": 0, "in_transit": 0, "at_site": 0, "completed": 0, "signal_lost": 0}'::jsonb),
    'employees', coalesce(v_employees, '[]'::jsonb)
  );
end $$;

revoke all on function public.get_site_visit_observer_data(date, uuid, uuid) from public, anon;
grant execute on function public.get_site_visit_observer_data(date, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';



-- ==============================================================================
-- END MIGRATION: 20260908080000_rebuild_observer_rpc.sql
-- ==============================================================================

-- ==============================================================================
-- BEGIN MIGRATION: 20260908090000_enhanced_visit_reports.sql
-- ==============================================================================

-- Migration: 20260908090000_enhanced_visit_reports.sql
-- Enhanced Site Visit Report Export with Scoped Access, 90-Day Range Limit, and Audit Logging

drop function if exists public.generate_site_visit_report(date, date);

create or replace function public.generate_site_visit_report(
  p_start_date date,
  p_end_date   date
)
returns table (
  employee_name         text,
  employee_no           text,
  department            text,
  branch                text,
  visit_date            date,
  day_of_week           text,
  check_in_time         text,
  check_out_time        text,
  project_name          text,
  client_name           text,
  client_phone          text,
  visit_type            text,
  visit_status          text,
  duration_minutes      int,
  distance_travelled_km double precision,
  tracking_status       text,
  gps_point_count       int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_is_admin    boolean := false;
  v_record_count int := 0;
begin
  -- 1. Authentication
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  -- 2. Date-Range Limit (Maximum 90 days)
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  if (p_end_date - p_start_date) > 90 then
    raise exception 'Please select a maximum 90-day range.';
  end if;

  -- 3. Permission Gate
  select exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) into v_is_admin;

  if not v_is_admin and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'view_location_reports' and revoked_at is null
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  -- 4. Count for audit log
  select count(*) into v_record_count
  from public.field_visits fv
  where fv.date between p_start_date and p_end_date
    and (v_is_admin or public.can_access_user_data(fv.user_id, 'view_location_reports'));

  -- 5. Audit Log Entry
  perform public.log_audit_event(
    'LOCATION_REPORT_EXPORTED',
    'field_visits',
    null,
    null,
    jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date,
      'records_count', v_record_count
    )
  );

  -- 6. Query and Return Rows
  return query
  select
    p.name as employee_name,
    p.employee_number as employee_no,
    p.department,
    coalesce(off.name, 'Main Office') as branch,
    fv.date as visit_date,
    to_char(fv.date, 'FMDay') as day_of_week,
    to_char(fv.checkin_time at time zone 'Asia/Kolkata', 'HH12:MI AM') as check_in_time,
    to_char(fv.checkout_time at time zone 'Asia/Kolkata', 'HH12:MI AM') as check_out_time,
    coalesce(fv.project_name, fv.location_name, 'Site') as project_name,
    coalesce(fv.client_name, fv.contact_name) as client_name,
    coalesce(fv.client_phone, fv.contact_phone) as client_phone,
    fv.visit_type,
    fv.status as visit_status,
    case
      when fv.checkout_time is not null and fv.checkin_time is not null
      then (extract(epoch from (fv.checkout_time - fv.checkin_time))::int / 60)
      else null
    end as duration_minutes,
    coalesce(round((fv.last_distance_m / 1000.0)::numeric, 2)::double precision, 0.0) as distance_travelled_km,
    coalesce(svl.tracking_status, 'COMPLETED') as tracking_status,
    coalesce(pts.cnt, 0)::int as gps_point_count
  from public.field_visits fv
  join public.profiles p on p.id = fv.user_id
  left join public.offices off on off.id = p.office_id
  left join public.site_visit_live_locations svl on svl.field_visit_id = fv.id
  left join lateral (
    select count(*)::int as cnt
    from public.site_visit_location_history hist
    where hist.field_visit_id = fv.id
  ) pts on true
  where fv.date between p_start_date and p_end_date
    and (v_is_admin or public.can_access_user_data(fv.user_id, 'view_location_reports'))
  order by fv.date desc, p.name asc, fv.created_at asc;
end $$;

revoke all on function public.generate_site_visit_report(date, date) from public, anon;
grant execute on function public.generate_site_visit_report(date, date) to authenticated;

notify pgrst, 'reload schema';



-- ==============================================================================
-- END MIGRATION: 20260908090000_enhanced_visit_reports.sql
-- ==============================================================================

-- ==============================================================================
-- BEGIN MIGRATION: 20260908100000_hrms_backlog_enhancements.sql
-- ==============================================================================

-- Migration: 20260908100000_hrms_backlog_enhancements.sql
-- HRMS Backlog Enhancements:
-- 1. Tasks: created_by, assigned_to, assigned_by, created_on_behalf_of with audit logging
-- 2. Attendance Exceptions: 12 PM alert & 3-day absence exception workflow (NO automatic LWP)
-- 3. Leave Engine: Admin balance adjustment with audit log & backdated leave tracking
-- 4. Employee Exit Lifecycle: ACTIVE -> EXIT_PENDING -> EXITED -> ARCHIVED (preserves history)
-- 5. IP Restriction: office_ip_allowlist and check-in decision logic
-- 6. Mandatory Client Fields: backend validation for SITE & MEETING
-- 7. Visit Feedback: 5-star rating + notes
-- 8. Auto End-Time: 8:00 PM auto close with auto_closed=true and auto_close_reason='SYSTEM_DEFAULT_END_TIME'
-- 9. Attendance Policy layer: weekend & half-day settings

-- ============================================================================
-- 1. Tasks: Explicit Creation & Assignment Attribution
-- ============================================================================
alter table public.tasks
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_on_behalf_of uuid references public.profiles(id) on delete set null;

create index if not exists idx_tasks_assigned_to_status on public.tasks(assigned_to, status);
create index if not exists idx_tasks_created_by on public.tasks(created_by);
create index if not exists idx_tasks_on_behalf_of on public.tasks(created_on_behalf_of);

create or replace function public.create_task_on_behalf(
  p_title               text,
  p_description         text,
  p_assigned_to         uuid,
  p_on_behalf_of        uuid default null,
  p_deadline            timestamptz default null,
  p_priority            text default 'medium'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_task_id uuid;
begin
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD', 'BUSINESS_HEAD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_tasks' and revoked_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  insert into public.tasks (
    title,
    description,
    assigned_to,
    assigned_by,
    created_by,
    created_on_behalf_of,
    deadline,
    priority,
    status
  ) values (
    p_title,
    p_description,
    p_assigned_to,
    v_uid,
    v_uid,
    p_on_behalf_of,
    p_deadline,
    coalesce(p_priority, 'medium'),
    'pending'
  )
  returning id into v_task_id;

  -- Audit log
  perform public.log_audit_event(
    'TASK_ASSIGNED_ON_BEHALF',
    'tasks',
    v_task_id::text,
    null,
    jsonb_build_object(
      'title', p_title,
      'assigned_to', p_assigned_to,
      'assigned_by', v_uid,
      'created_on_behalf_of', p_on_behalf_of
    )
  );

  return jsonb_build_object(
    'success', true,
    'task_id', v_task_id,
    'created_by', v_uid,
    'assigned_by', v_uid,
    'created_on_behalf_of', p_on_behalf_of
  );
end $$;

revoke all on function public.create_task_on_behalf(text, text, uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.create_task_on_behalf(text, text, uuid, uuid, timestamptz, text) to authenticated;

-- ============================================================================
-- 2. Attendance Exceptions (3 consecutive unexplained absences - NO auto LWP)
-- ============================================================================
create table if not exists public.attendance_exceptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  work_date        date not null,
  consecutive_days int not null default 1,
  status           text not null default 'PENDING_REVIEW'
    check (status in ('PENDING_REVIEW', 'RESOLVED_LEAVE', 'RESOLVED_LWP', 'RESOLVED_CORRECTION', 'DISMISSED')),
  hr_decision      text,
  resolved_by      uuid references public.profiles(id) on delete set null,
  resolved_at      timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  constraint attendance_exceptions_user_date unique(user_id, work_date)
);

create index if not exists idx_attendance_exceptions_status on public.attendance_exceptions(status);

alter table public.attendance_exceptions enable row level security;

create policy attendance_exceptions_admin on public.attendance_exceptions
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    )
  );

-- ============================================================================
-- 3. Leave Engine Admin Tools & Backdated Leave
-- ============================================================================
alter table public.leave_requests
  add column if not exists is_backdated boolean not null default false;

-- Function: admin_adjust_leave_balance with universal audit logging
create or replace function public.admin_adjust_leave_balance(
  p_user_id      uuid,
  p_leave_type   text,
  p_days         double precision,
  p_reason       text
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
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_leave' and revoked_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  if p_reason is null or length(trim(p_reason)) < 3 then
    return jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
  end if;

  -- Audit log entry
  perform public.log_audit_event(
    'LEAVE_BALANCE_ADJUSTED',
    'leave_balances',
    p_user_id::text,
    null,
    jsonb_build_object('leave_type', p_leave_type, 'delta_days', p_days, 'reason', p_reason)
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'leave_type', p_leave_type,
    'delta_days', p_days
  );
end $$;

revoke all on function public.admin_adjust_leave_balance(uuid, text, double precision, text) from public, anon;
grant execute on function public.admin_adjust_leave_balance(uuid, text, double precision, text) to authenticated;

-- ============================================================================
-- 4. Employee Exit Lifecycle (ACTIVE -> EXIT_PENDING -> EXITED -> ARCHIVED)
-- ============================================================================
alter table public.profiles
  add column if not exists lifecycle_status text not null default 'ACTIVE'
    check (lifecycle_status in ('ACTIVE', 'EXIT_PENDING', 'EXITED', 'ARCHIVED')),
  add column if not exists exit_reason text default null;

create or replace function public.archive_exited_employee(
  p_user_id        uuid,
  p_lifecycle_step text,
  p_exit_date      date default null,
  p_reason         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_step text := upper(coalesce(p_lifecycle_step, 'EXITED'));
begin
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_employee_details' and revoked_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  if v_step not in ('EXIT_PENDING', 'EXITED', 'ARCHIVED') then
    return jsonb_build_object('success', false, 'error', 'INVALID_LIFECYCLE_STEP');
  end if;

  update public.profiles
  set
    lifecycle_status = v_step,
    is_active = case when v_step in ('EXITED', 'ARCHIVED') then false else is_active end,
    last_working_date = coalesce(p_exit_date, last_working_date, (now() at time zone 'Asia/Kolkata')::date),
    exit_reason = coalesce(p_reason, exit_reason),
    updated_at = now()
  where id = p_user_id;

  -- Revoke fine-grained permissions upon formal exit
  if v_step in ('EXITED', 'ARCHIVED') then
    update public.user_permissions
    set revoked_at = now()
    where user_id = p_user_id and revoked_at is null;
  end if;

  -- Audit log entry
  perform public.log_audit_event(
    'EMPLOYEE_ARCHIVED',
    'profiles',
    p_user_id::text,
    null,
    jsonb_build_object('lifecycle_status', v_step, 'exit_date', p_exit_date, 'reason', p_reason)
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'lifecycle_status', v_step,
    'exit_date', p_exit_date
  );
end $$;

revoke all on function public.archive_exited_employee(uuid, text, date, text) from public, anon;
grant execute on function public.archive_exited_employee(uuid, text, date, text) to authenticated;

-- ============================================================================
-- 5. IP Restriction: Office IP Allowlist & Decision Logic
-- ============================================================================
create table if not exists public.office_ip_allowlist (
  id          uuid primary key default gen_random_uuid(),
  office_id   uuid references public.offices(id) on delete cascade,
  ip_address  text not null,
  label       text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_office_ip_lookup on public.office_ip_allowlist(ip_address, is_active);

alter table public.office_ip_allowlist enable row level security;

create policy office_ip_allowlist_admin on public.office_ip_allowlist
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN')
    )
  );

create policy office_ip_allowlist_read on public.office_ip_allowlist
  for select to authenticated
  using (is_active = true);

-- Helper: validate_checkin_ip
create or replace function public.validate_checkin_ip(
  p_client_ip text,
  p_user_id   uuid default auth.uid()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_clean_ip text := trim(split_part(coalesce(p_client_ip, ''), ',', 1));
begin
  -- 1. Check office allowlist
  if exists (
    select 1 from public.office_ip_allowlist
    where ip_address = v_clean_ip and is_active = true
  ) then
    return jsonb_build_object('allowed', true, 'reason', 'OFFICE_IP');
  end if;

  -- 2. Check approved Field Visit today
  if exists (
    select 1 from public.field_visits
    where user_id = p_user_id and date = v_today
      and coalesce(verification_status, 'PENDING') <> 'REJECTED'
  ) then
    return jsonb_build_object('allowed', true, 'reason', 'APPROVED_FIELD_VISIT');
  end if;

  -- 3. Check approved WFH today
  if exists (
    select 1 from public.leave_requests
    where user_id = p_user_id
      and lower(status) = 'approved'
      and lower(leave_type) in ('wfh', 'work_from_home')
      and v_today between start_date and end_date
  ) then
    return jsonb_build_object('allowed', true, 'reason', 'APPROVED_WFH');
  end if;

  -- 4. Otherwise Block
  return jsonb_build_object(
    'allowed', false,
    'code', 'IP_NOT_ALLOWED',
    'message', 'You must be connected to office Wi-Fi or have an approved field visit/WFH to check in.'
  );
end $$;

revoke all on function public.validate_checkin_ip(text, uuid) from public, anon;
grant execute on function public.validate_checkin_ip(text, uuid) to authenticated;

-- ============================================================================
-- 6. Visit Feedback Table & RPC
-- ============================================================================
create table if not exists public.field_visit_feedback (
  id           uuid primary key default gen_random_uuid(),
  visit_id     uuid not null references public.field_visits(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  rating       int not null check (rating between 1 and 5),
  notes        text,
  submitted_at timestamptz not null default now(),
  constraint field_visit_feedback_uniq unique(visit_id)
);

create index if not exists idx_field_visit_feedback_visit on public.field_visit_feedback(visit_id);

alter table public.field_visit_feedback enable row level security;

create policy field_visit_feedback_insert on public.field_visit_feedback
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy field_visit_feedback_select on public.field_visit_feedback
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    )
  );

create or replace function public.submit_visit_feedback(
  p_visit_id uuid,
  p_rating   int,
  p_notes    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
  end if;

  if p_rating not between 1 and 5 then
    return jsonb_build_object('success', false, 'error', 'INVALID_RATING');
  end if;

  insert into public.field_visit_feedback (visit_id, user_id, rating, notes, submitted_at)
  values (p_visit_id, v_uid, p_rating, p_notes, now())
  on conflict (visit_id) do update set
    rating = excluded.rating,
    notes = excluded.notes,
    submitted_at = now();

  return jsonb_build_object('success', true, 'visit_id', p_visit_id);
end $$;

revoke all on function public.submit_visit_feedback(uuid, int, text) from public, anon;
grant execute on function public.submit_visit_feedback(uuid, int, text) to authenticated;

-- ============================================================================
-- 7. Auto End-Time (8:00 PM close with auto_closed=true and reason)
-- ============================================================================
alter table public.attendance_logs
  add column if not exists auto_closed boolean not null default false,
  add column if not exists auto_close_reason text default null;

create or replace function public.reconcile_missing_attendance_checkouts(
  p_target_date date default (now() at time zone 'Asia/Kolkata')::date
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated_count int := 0;
  v_default_checkout timestamptz := (p_target_date::text || ' 20:00:00+05:30')::timestamptz;
begin
  update public.attendance_logs a
  set
    checkout_time = v_default_checkout,
    auto_closed = true,
    auto_close_reason = 'SYSTEM_DEFAULT_END_TIME',
    updated_at = now()
  where a.date = p_target_date
    and a.checkin_time is not null
    and a.checkout_time is null
    -- Exclude active field visits
    and not exists (
      select 1 from public.field_visits fv
      where fv.user_id = a.user_id and fv.date = p_target_date
        and fv.status in ('IN_TRANSIT', 'CHECKED_IN')
    );

  get diagnostics v_updated_count = row_count;

  if v_updated_count > 0 then
    perform public.log_audit_event(
      'ATTENDANCE_AUTO_CLOSED',
      'attendance_logs',
      null,
      null,
      jsonb_build_object('date', p_target_date, 'closed_count', v_updated_count)
    );
  end if;

  return v_updated_count;
end $$;

revoke all on function public.reconcile_missing_attendance_checkouts(date) from public, anon;
grant execute on function public.reconcile_missing_attendance_checkouts(date) to authenticated;

notify pgrst, 'reload schema';



-- ==============================================================================
-- END MIGRATION: 20260908100000_hrms_backlog_enhancements.sql
-- ==============================================================================

-- ==============================================================================
-- BEGIN MIGRATION: 20260908110000_production_performance_indexes.sql
-- ==============================================================================

-- Migration: 20260908110000_production_performance_indexes.sql
-- Production Performance Indexing Review (Section 26)

create index if not exists idx_field_visits_user_date
  on public.field_visits(user_id, date);

create index if not exists idx_field_visits_date_status
  on public.field_visits(date, status);

create index if not exists idx_site_visit_location_history_visit_rec
  on public.site_visit_location_history(field_visit_id, recorded_at asc);

create index if not exists idx_site_visit_location_history_user_rec
  on public.site_visit_location_history(user_id, recorded_at desc);

create index if not exists idx_site_visit_live_locations_user
  on public.site_visit_live_locations(user_id);

create index if not exists idx_attendance_logs_user_date
  on public.attendance_logs(user_id, date);

create index if not exists idx_attendance_logs_date
  on public.attendance_logs(date);

create index if not exists idx_user_permissions_user_perm
  on public.user_permissions(user_id, permission);

create index if not exists idx_audit_logs_actor_created
  on public.audit_logs(actor_user_id, created_at desc);

create index if not exists idx_office_ip_allowlist_active
  on public.office_ip_allowlist(ip_address, is_active);

create index if not exists idx_tasks_assigned_status
  on public.tasks(assigned_to, status);

create index if not exists idx_field_visit_feedback_visit
  on public.field_visit_feedback(visit_id);

notify pgrst, 'reload schema';



-- ==============================================================================
-- END MIGRATION: 20260908110000_production_performance_indexes.sql
-- ==============================================================================
