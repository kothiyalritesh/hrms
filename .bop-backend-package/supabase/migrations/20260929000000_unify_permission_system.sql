-- Unify both permission systems.
-- Runtime enforcement (usePermissions / PermissionsContext) reads from
-- user_permissions via get_my_permissions().
-- The PermissionsManagerScreen writes via admin_grant_permission().
-- This migration ensures all screen.* keys exist in user_permissions-compatible
-- format and that get_my_permissions() returns the right shape.

-- 1. Ensure user_permissions has all required columns (idempotent)
alter table public.user_permissions
  add column if not exists scope       text not null default 'GLOBAL'
    check (scope in ('GLOBAL','BRANCH','DEPARTMENT','TEAM','SELF')),
  add column if not exists scope_id    uuid default null,
  add column if not exists office_id   uuid references public.offices(id) on delete cascade,
  add column if not exists department  text,
  add column if not exists team_lead_id uuid references public.profiles(id) on delete set null,
  add column if not exists team_name   text,
  add column if not exists revoked_at  timestamptz default null;

-- 2. Canonical get_my_permissions() — returns jsonb array of scoped permissions
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
        'permission',   up.permission,
        'scope',        up.scope,
        'scope_id',     up.scope_id,
        'office_id',    up.office_id,
        'department',   up.department,
        'team_lead_id', up.team_lead_id,
        'team_name',    up.team_name
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

-- 3. Seed all grantable permission keys into user_permissions-compatible catalogue
--    (stored in the permissions master table for the UI to enumerate)
insert into public.permissions (permission_key, module, action, description) values
  ('screen.attendance_control',      'SCREEN', 'access', 'Attendance Control Screen'),
  ('screen.user_management',         'SCREEN', 'access', 'User Management Screen'),
  ('screen.leave_balance',           'SCREEN', 'access', 'Leave Balance Screen'),
  ('screen.audit_logs',              'SCREEN', 'access', 'Audit Logs'),
  ('screen.birthday_management',     'SCREEN', 'access', 'Birthday Management'),
  ('screen.task_project_control',    'SCREEN', 'access', 'Task/Project Control'),
  ('screen.ticket_management',       'SCREEN', 'access', 'Ticket Management'),
  ('screen.live_tracking',           'SCREEN', 'access', 'Live Tracking'),
  ('screen.field_visit_admin',       'SCREEN', 'access', 'Field Visit Admin'),
  ('screen.team_hierarchy',          'SCREEN', 'access', 'Team Hierarchy'),
  ('screen.check_in_logs',           'SCREEN', 'access', 'Check In Logs'),
  ('screen.suspicious_attendance',   'SCREEN', 'access', 'Suspicious Attendance'),
  ('screen.attendance_regularization','SCREEN','access', 'Attendance Regularization'),
  ('screen.event_management',        'SCREEN', 'access', 'Event Management'),
  ('screen.smartoffice_integration', 'SCREEN', 'access', 'SmartOffice Integration'),
  ('screen.site_settings',           'SCREEN', 'access', 'Site Settings'),
  ('screen.office_settings',         'SCREEN', 'access', 'Office Settings'),
  ('screen.notification_management', 'SCREEN', 'access', 'Notification Management'),
  ('screen.anonymous_feedback',      'SCREEN', 'access', 'Anonymous Feedback'),
  ('screen.site_visit_observer',     'SCREEN', 'access', 'Site Visit Observer'),
  ('screen.in_transit',              'SCREEN', 'access', 'In Transit Monitor'),
  ('screen.duplicate_devices',       'SCREEN', 'access', 'Duplicate Devices'),
  ('screen.permissions_manager',     'SCREEN', 'access', 'Permissions Manager')
on conflict (permission_key) do nothing;

notify pgrst, 'reload schema';
