-- ─── Phase 2: Unified Permission Engine ───
-- Perfectly implementing the Access Control Matrix

DO $$
BEGIN
  ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'OFFICE_TREE';
  ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'TEAM_TREE';
  ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'REPORTS_TO';
  ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'ASSIGNED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

INSERT INTO public.permissions (module, action, permission_key, description) VALUES
('EMPLOYEES', 'view', 'employees.view', 'Can view employees'),
('EMPLOYEES', 'create', 'employees.create', 'Can create employees'),
('EMPLOYEES', 'update', 'employees.update', 'Can update employees'),
('EMPLOYEES', 'delete', 'employees.delete', 'Can delete employees'),
('EMPLOYEES', 'export', 'employees.export', 'Can export employees'),
('ATTENDANCE', 'view', 'attendance.view', 'Can view attendance'),
('ATTENDANCE', 'create', 'attendance.create', 'Can create attendance'),
('ATTENDANCE', 'update', 'attendance.update', 'Can update attendance'),
('ATTENDANCE', 'regularize', 'attendance.regularize', 'Can regularize attendance'),
('ATTENDANCE', 'export', 'attendance.export', 'Can export attendance'),
('REGULARIZATION', 'view', 'regularization.view', 'Can view regularization'),
('REGULARIZATION', 'approve', 'regularization.approve', 'Can approve regularization'),
('REGULARIZATION', 'reject', 'regularization.reject', 'Can reject regularization'),
('FIELD_VISITS', 'view', 'field_visits.view', 'Can view field_visits'),
('FIELD_VISITS', 'create', 'field_visits.create', 'Can create field_visits'),
('FIELD_VISITS', 'update', 'field_visits.update', 'Can update field_visits'),
('FIELD_VISITS', 'approve', 'field_visits.approve', 'Can approve field_visits'),
('FIELD_VISITS', 'export', 'field_visits.export', 'Can export field_visits'),
('LIVE_TRACKING', 'view', 'live_tracking.view', 'Can view live_tracking'),
('LEAVES', 'view', 'leaves.view', 'Can view leaves'),
('LEAVES', 'create', 'leaves.create', 'Can create leaves'),
('LEAVES', 'approve', 'leaves.approve', 'Can approve leaves'),
('LEAVES', 'reject', 'leaves.reject', 'Can reject leaves'),
('LEAVES', 'export', 'leaves.export', 'Can export leaves'),
('TASKS', 'view', 'tasks.view', 'Can view tasks'),
('TASKS', 'create', 'tasks.create', 'Can create tasks'),
('TASKS', 'update', 'tasks.update', 'Can update tasks'),
('TASKS', 'assign', 'tasks.assign', 'Can assign tasks'),
('TEAMS', 'view', 'teams.view', 'Can view teams'),
('TEAMS', 'manage', 'teams.manage', 'Can manage teams'),
('OFFICES', 'view', 'offices.view', 'Can view offices'),
('OFFICES', 'manage', 'offices.manage', 'Can manage offices'),
('DASHBOARD', 'view', 'dashboard.view', 'Can view dashboard'),
('REPORTS', 'view', 'reports.view', 'Can view reports'),
('REPORTS', 'export', 'reports.export', 'Can export reports'),
('NOTIFICATIONS', 'send', 'notifications.send', 'Can send notifications'),
('AUDIT_LOGS', 'view', 'audit_logs.view', 'Can view audit_logs'),
('AUDIT_LOGS', 'export', 'audit_logs.export', 'Can export audit_logs'),
('PERMISSIONS', 'view', 'permissions.view', 'Can view permissions'),
('PERMISSIONS', 'assign', 'permissions.assign', 'Can assign permissions'),
('PERMISSIONS', 'revoke', 'permissions.revoke', 'Can revoke permissions'),
('BIOMETRIC', 'manage', 'biometric.manage', 'Can manage biometric')
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module,
  action = EXCLUDED.action,
  description = EXCLUDED.description;
