-- =============================================================================
-- 20261020100000_permission_capabilities_and_hierarchy.sql
--
-- Permission Manager v3: one toggle per capability, levels that include View,
-- one reporting-hierarchy rule, bulk grants, a delegation ceiling, live
-- refresh, and fixes for holes found in the 2026-10-19 audit.
--
--  1. permission_capabilities: what the Permission Manager shows. A capability
--     grants one or more existing permission keys and can imply other
--     capabilities (Manage / Approve / Export always include View). Merged:
--       attendance.correct          = attendance.regularize + attendance.backdate_correct
--       attendance.requests.approve = regularization.approve + attendance.backdate_approve
--       tracking.view               = live_tracking.view + activity_analysis.view
--     Grants are stored by capability key; hrms_active_grants expands them, so
--     every existing RPC / RLS check keeps working and a change to a
--     capability's contents applies to everyone at once. Old grants of the
--     merged keys keep working (and now include View); nothing is rewritten.
--  2. permission_screen_access: which permissions open each app screen
--     (served to the app; no app release needed to change it).
--  3. hrms_role_access: per-role "full data access" switch. Seeded exactly as
--     today (SYSTEM_ADMIN, ADMIN, HR, HRD). HR / HRD can be switched off by an
--     admin; their role templates are pre-filled with every data capability
--     at company scope, so switching off changes nothing until trimmed.
--     SYSTEM_ADMIN / ADMIN can never be switched off.
--  4. Reporting hierarchy: a built-in "@MANAGER" role template applies to
--     everyone who has at least one active report, covering their whole
--     reporting tree. Editable like any template. RLS rules that used the
--     old per-row manager checks now use one set lookup that follows the
--     template; location access no longer comes from attendance.view.
--  5. Grants: delegation ceiling (a delegate can only grant what they hold,
--     to people and scopes inside their own reach), bulk add / revoke / copy,
--     revoke covers aliases and merged keys, a re-grant never shortens an
--     expiry, inactive keys and users are rejected, writes only through RPCs.
--  6. Security: no direct client changes to leave / regularization approval
--     fields; tasks cannot be created with a forged assigned_by or for people
--     outside tasks.manage scope; no self-credit of leave balance.
--  7. Role-only admin functions now follow permissions (bulk employee import,
--     biometric mapping, event audience, reset-all leave balances).
--  8. Birthdays saved through an RPC (birthdays.manage); direct profile
--     updates were blocked for everyone.
--  9. user_permission_versions: bumped on every access change; the app
--     listens (Realtime) and refreshes permissions within seconds.
-- Idempotent. Patches print a NOTICE (not an error) when an optional target
-- function is missing in this database; required tables raise an error.
--
-- The database always decides access at request time (grants, expiry, scope
-- and the reporting tree are evaluated per query). The version/Realtime
-- refresh only updates what the app shows; a revoke is enforced by the server
-- the moment it commits.
-- =============================================================================

-- ─── 0. Parity baseline: effective access BEFORE this migration ─────────────
-- Taken once (first run), with the engine as it was. The post-deploy check
-- (supabase/manual/2026-10-20_permission_postcheck.sql) compares against it.
DO $$
BEGIN
  IF to_regclass('public.hrms_access_baseline_20261020') IS NULL THEN
    CREATE TABLE public.hrms_access_baseline_20261020 AS
      SELECT p.id AS user_id, public.normalize_profile_role(p.role) AS role,
             coalesce(p.is_active, true) AS is_active,
             public.hrms_is_admin_user(p.id) AS full_data_access,
             g.permission, g.scope, g.scope_id, g.source, now() AS taken_at
      FROM public.profiles p
      LEFT JOIN LATERAL public.hrms_active_grants(p.id) g ON true;
    ALTER TABLE public.hrms_access_baseline_20261020 ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.hrms_access_baseline_20261020 FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.permission_capabilities (
  key         text PRIMARY KEY,
  module      text NOT NULL,
  label       text NOT NULL,
  description text,
  level       text NOT NULL CHECK (level IN ('VIEW', 'EXPORT', 'MANAGE', 'APPROVE')),
  risk_level  text NOT NULL DEFAULT 'MEDIUM' CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  scoped      boolean NOT NULL DEFAULT true,
  grants      text[] NOT NULL,
  implies     text[] NOT NULL DEFAULT '{}',
  sort_order  integer NOT NULL DEFAULT 1000,
  is_active   boolean NOT NULL DEFAULT true
);
ALTER TABLE public.permission_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.permission_capabilities FROM anon, authenticated;
GRANT SELECT ON public.permission_capabilities TO authenticated;
DROP POLICY IF EXISTS permission_capabilities_read ON public.permission_capabilities;
CREATE POLICY permission_capabilities_read ON public.permission_capabilities FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.permission_screen_access (
  route text PRIMARY KEY,
  keys  text[] NOT NULL
);
ALTER TABLE public.permission_screen_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.permission_screen_access FROM anon, authenticated;
GRANT SELECT ON public.permission_screen_access TO authenticated;
DROP POLICY IF EXISTS permission_screen_access_read ON public.permission_screen_access;
CREATE POLICY permission_screen_access_read ON public.permission_screen_access FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.hrms_role_access (
  role             text PRIMARY KEY,
  full_data_access boolean NOT NULL DEFAULT false,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hrms_role_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hrms_role_access FROM anon, authenticated;
GRANT SELECT ON public.hrms_role_access TO authenticated;
DROP POLICY IF EXISTS hrms_role_access_read ON public.hrms_role_access;
CREATE POLICY hrms_role_access_read ON public.hrms_role_access FOR SELECT TO authenticated USING (true);
INSERT INTO public.hrms_role_access (role, full_data_access) VALUES
  ('SYSTEM_ADMIN', true), ('ADMIN', true), ('HR', true), ('HRD', true)
ON CONFLICT (role) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_permission_versions (
  user_id    uuid PRIMARY KEY,
  version    bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_permission_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_permission_versions FROM anon, authenticated;
GRANT SELECT ON public.user_permission_versions TO authenticated;
DROP POLICY IF EXISTS user_permission_versions_own ON public.user_permission_versions;
CREATE POLICY user_permission_versions_own ON public.user_permission_versions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS hrms_profiles_reports_to_idx ON public.profiles (reports_to);

-- ─── 2. Capability catalog + screen map ──────────────────────────────────────

INSERT INTO public.permission_capabilities (key, module, label, description, level, risk_level, scoped, grants, implies, sort_order) VALUES
  ('employees.view',             'Employees', 'View employees',           'Employee profiles and My Team in scope',                 'VIEW',    'MEDIUM', true,  ARRAY['employees.view'], '{}', 10),
  ('employees.manage',           'Employees', 'Add / edit employees',     'Create, edit, deactivate and bulk-import employees',      'MANAGE',  'HIGH',   true,  ARRAY['employees.manage'], ARRAY['employees.view'], 11),
  ('teams.manage',               'Employees', 'Team hierarchy',           'Edit teams and reporting lines',                          'MANAGE',  'HIGH',   false, ARRAY['teams.manage'], ARRAY['employees.view'], 12),
  ('birthdays.manage',           'Employees', 'Birthdays',                'Set birthdays and announcements',                         'MANAGE',  'LOW',    false, ARRAY['birthdays.manage'], '{}', 13),
  ('attendance.view',            'Attendance','View attendance',          'Attendance logs, calendar and reports in scope',          'VIEW',    'MEDIUM', true,  ARRAY['attendance.view'], '{}', 20),
  ('attendance.export',          'Attendance','Export attendance',        'Download attendance reports (includes View)',             'EXPORT',  'MEDIUM', true,  ARRAY['attendance.export'], ARRAY['attendance.view'], 21),
  ('attendance.correct',         'Attendance','Correct attendance',       'Fix check-in / check-out and record missed days',         'MANAGE',  'HIGH',   true,  ARRAY['attendance.regularize','attendance.backdate_correct'], ARRAY['attendance.view','regularization.view'], 22),
  ('regularization.view',        'Attendance','View requests',            'Regularization and correction requests in scope',         'VIEW',    'LOW',    true,  ARRAY['regularization.view'], '{}', 23),
  ('attendance.requests.approve','Attendance','Approve requests',         'Approve or reject regularization and correction requests','APPROVE', 'HIGH',   true,  ARRAY['regularization.approve','attendance.backdate_approve'], ARRAY['regularization.view','attendance.view'], 24),
  ('checkin_logs.view',          'Attendance','Check-in logs',            'GPS check-in attempts and blocked check-ins',             'VIEW',    'MEDIUM', true,  ARRAY['checkin_logs.view'], ARRAY['attendance.view'], 25),
  ('suspicious.view',            'Attendance','Suspicious attendance',    'Suspicious check-ins and compliance scores',              'VIEW',    'MEDIUM', true,  ARRAY['suspicious.view'], ARRAY['employees.view'], 26),
  ('attendance.calendar.manage', 'Attendance','Holidays & weekly offs',   'Edit the holiday calendar and weekly-off rules',          'MANAGE',  'MEDIUM', false, ARRAY['attendance.calendar.manage'], '{}', 27),
  ('devices.manage',             'Attendance','Duplicate devices',        'Device sessions and buddy-punching checks',               'MANAGE',  'HIGH',   false, ARRAY['devices.manage'], '{}', 28),
  ('biometric.manage',           'Attendance','Biometric sync',           'SmartOffice sync, employee-code mapping, imported data',  'MANAGE',  'HIGH',   false, ARRAY['biometric.manage'], ARRAY['attendance.view'], 29),
  ('leave.view',                 'Leave',     'View leave',               'Leave requests and balances in scope',                    'VIEW',    'LOW',    true,  ARRAY['leave.view'], '{}', 30),
  ('leave.approve',              'Leave',     'Approve leave',            'Approve or reject leave (includes View)',                 'APPROVE', 'HIGH',   true,  ARRAY['leave.approve'], ARRAY['leave.view'], 31),
  ('leave.balance.manage',       'Leave',     'Adjust leave balances',    'Credit / debit balances and comp-offs (includes View)',   'MANAGE',  'HIGH',   true,  ARRAY['leave.balance.manage'], ARRAY['leave.view'], 32),
  ('field_visits.view',          'Field & tracking','Field visits',       'Field / site visits and their evidence in scope',         'VIEW',    'MEDIUM', true,  ARRAY['field_visits.view'], '{}', 40),
  ('tracking.view',              'Field & tracking','Tracking & activity','Live location, In Transit and activity analysis (attendance and field visits are separate)', 'VIEW', 'HIGH', true, ARRAY['live_tracking.view','activity_analysis.view'], '{}', 41),
  ('sites.manage',               'Field & tracking','Sites & geofences',  'Projects, saved sites and geofences',                     'MANAGE',  'MEDIUM', false, ARRAY['sites.manage'], '{}', 42),
  ('offices.manage',             'Field & tracking','Offices & policies', 'Offices, radius and attendance policies',                 'MANAGE',  'HIGH',   false, ARRAY['offices.manage'], '{}', 43),
  ('tasks.view',                 'Work',      'View tasks',               'Tasks of employees in scope',                             'VIEW',    'LOW',    true,  ARRAY['tasks.view'], '{}', 50),
  ('tasks.manage',               'Work',      'Assign tasks',             'Create and assign tasks (includes View)',                 'MANAGE',  'MEDIUM', true,  ARRAY['tasks.manage'], ARRAY['tasks.view'], 51),
  ('events.manage',              'Work',      'Events',                   'Create and manage events and audiences',                  'MANAGE',  'MEDIUM', false, ARRAY['events.manage'], '{}', 52),
  ('notifications.send',         'Communication','Send notifications',    'Broadcasts and push notifications',                       'MANAGE',  'MEDIUM', false, ARRAY['notifications.send'], '{}', 60),
  ('tickets.manage',             'Communication','Support tickets',       'View and resolve support tickets',                        'MANAGE',  'LOW',    false, ARRAY['tickets.manage'], '{}', 61),
  ('feedback.view',              'Communication','Anonymous feedback',    'Read anonymous feedback',                                 'VIEW',    'MEDIUM', false, ARRAY['feedback.view'], '{}', 62),
  ('reports.view',               'Reports & audit','Reports',             'Reports tab (each report also needs its own data access)','VIEW',    'MEDIUM', true,  ARRAY['reports.view'], '{}', 70),
  ('audit.view',                 'Reports & audit','Audit logs',          'System activity trail',                                   'VIEW',    'HIGH',   false, ARRAY['audit.view'], '{}', 71),
  ('permissions.view',           'Permissions','View permissions',        'Open the Permission Manager, simulator and history',      'VIEW',    'MEDIUM', false, ARRAY['permissions.view'], '{}', 80),
  ('permissions.assign',         'Permissions','Grant permissions',       'Grant access within their own reach (includes View)',     'MANAGE',  'HIGH',   false, ARRAY['permissions.assign'], ARRAY['permissions.view'], 81),
  ('permissions.revoke',         'Permissions','Revoke permissions',      'Revoke access within their own reach (includes View)',    'MANAGE',  'HIGH',   false, ARRAY['permissions.revoke'], ARRAY['permissions.view'], 82)
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module, label = EXCLUDED.label, description = EXCLUDED.description,
  level = EXCLUDED.level, risk_level = EXCLUDED.risk_level, scoped = EXCLUDED.scoped,
  grants = EXCLUDED.grants, implies = EXCLUDED.implies, sort_order = EXCLUDED.sort_order, is_active = true;

-- The merged keys stay valid for old grants and server checks, but are no
-- longer offered on their own; biometric.manage becomes grantable again.
UPDATE public.permissions SET is_active = false
WHERE permission_key IN ('attendance.regularize', 'attendance.backdate_correct', 'regularization.approve',
                         'attendance.backdate_approve', 'live_tracking.view', 'activity_analysis.view');
UPDATE public.permissions SET is_active = true WHERE permission_key = 'biometric.manage';

-- Screens list the underlying keys on purpose (e.g. live_tracking.view, not
-- tracking.view): a capability holder has them through expansion, and so does
-- someone with only the older key, so both open the screen they could before.
INSERT INTO public.permission_screen_access (route, keys) VALUES
  ('UserManagement', ARRAY['employees.view']),
  ('SmartOfficeEmployeeImport', ARRAY['employees.manage']),
  ('TeamHierarchy', ARRAY['teams.manage']),
  ('EmployeeBirthdayManagement', ARRAY['birthdays.manage']),
  ('AttendanceControl', ARRAY['attendance.view']),
  ('AdvancedAttendanceReport', ARRAY['attendance.view']),
  ('AttendanceCalendar', ARRAY['attendance.calendar.manage']),
  ('AttendanceRegularization', ARRAY['regularization.view']),
  ('BackdatedAttendance', ARRAY['regularization.view','attendance.backdate_correct']),
  ('CheckInLogs', ARRAY['checkin_logs.view']),
  ('SuspiciousAttendance', ARRAY['suspicious.view']),
  ('ComplianceScores', ARRAY['employees.view','suspicious.view']),
  ('AdminDeviceSessions', ARRAY['devices.manage']),
  ('SmartOfficeIntegration', ARRAY['biometric.manage']),
  ('BiometricUserMatch', ARRAY['biometric.manage']),
  ('SmartOfficeImportedData', ARRAY['biometric.manage']),
  ('LeaveManagement', ARRAY['leave.view']),
  ('LeaveBalance', ARRAY['leave.view']),
  ('LiveTracking', ARRAY['live_tracking.view']),
  ('InTransit', ARRAY['live_tracking.view']),
  ('ActivityAnalysis', ARRAY['activity_analysis.view','live_tracking.view']),
  ('FieldVisitAdmin', ARRAY['field_visits.view']),
  ('SiteVisitObserver', ARRAY['field_visits.view']),
  ('SiteSettings', ARRAY['sites.manage']),
  ('OfficeSettings', ARRAY['offices.manage']),
  ('TaskProjectControl', ARRAY['tasks.view']),
  ('EventManagement', ARRAY['events.manage']),
  ('NotificationManagement', ARRAY['notifications.send']),
  ('TicketManagement', ARRAY['tickets.manage']),
  ('AnonymousFeedback', ARRAY['feedback.view']),
  ('AuditLogs', ARRAY['audit.view']),
  ('PermissionsManager', ARRAY['permissions.view']),
  ('TVDisplay', ARRAY['attendance.view']),
  ('ReportsAttendance', ARRAY['attendance.view']),
  ('ReportsAdvancedAttendance', ARRAY['attendance.view']),
  ('ReportsDownloads', ARRAY['attendance.view']),
  ('ReportsAttendanceRegister', ARRAY['attendance.view']),
  ('ReportsLateArrival', ARRAY['attendance.view']),
  ('ReportsIntelligence', ARRAY['attendance.view']),
  ('ReportsRegularization', ARRAY['regularization.view']),
  ('ReportsCheckInLogs', ARRAY['checkin_logs.view']),
  ('ReportsGps', ARRAY['suspicious.view']),
  ('ReportsBiometric', ARRAY['biometric.manage']),
  ('ReportsActivity', ARRAY['activity_analysis.view','live_tracking.view']),
  ('ReportsTracking', ARRAY['live_tracking.view']),
  ('ReportsGeofenceEvents', ARRAY['live_tracking.view','attendance.view']),
  ('ReportsFieldVisits', ARRAY['field_visits.view']),
  ('ReportsLeaves', ARRAY['leave.view']),
  ('ReportsLeaveBalance', ARRAY['leave.view']),
  ('ReportsLeaveUsage', ARRAY['leave.view']),
  ('ReportsOvertime', ARRAY['leave.view']),
  ('ReportsTeamHierarchy', ARRAY['teams.manage','employees.view']),
  ('ReportsAuditLogs', ARRAY['audit.view']),
  ('ReportsDownloadCentre', ARRAY['attendance.view'])
ON CONFLICT (route) DO UPDATE SET keys = EXCLUDED.keys;

-- ─── 3. Expansion: capability → every key it gives (incl. implied ones) ─────

CREATE OR REPLACE FUNCTION public.hrms_capability_keys(p_key text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE closure(k) AS (
    SELECT unnest(public.hrms_permission_keys(p_key))      -- the key and its aliases
    UNION
    -- a capability gives its keys and the capabilities it implies; a legacy
    -- key inside a merged capability gives only the implied View (so an old
    -- regularization.approve grant also opens the list it always needed)
    SELECT x
    FROM public.permission_capabilities c
    JOIN closure ON c.key = closure.k OR closure.k = ANY (c.grants)
    CROSS JOIN LATERAL unnest(CASE WHEN c.key = closure.k THEN c.grants || c.implies ELSE c.implies END) x
    WHERE c.is_active
  )
  SELECT ARRAY(SELECT DISTINCT k FROM closure WHERE k IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.hrms_capability_keys(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_capability_keys(text) TO authenticated;

-- The capability a stored key belongs to (itself, or the merged capability
-- that contains a legacy key, or the capability of an alias).
CREATE OR REPLACE FUNCTION public.hrms_capability_for(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT c.key FROM public.permission_capabilities c WHERE c.key = p_key),
    (SELECT c.key FROM public.permission_capabilities c WHERE p_key = ANY (c.grants) ORDER BY c.sort_order LIMIT 1),
    (SELECT c.key FROM public.permission_capabilities c
      WHERE c.key = ANY (public.hrms_permission_keys(p_key))
         OR EXISTS (SELECT 1 FROM unnest(c.grants) g WHERE g = ANY (public.hrms_permission_keys(p_key)))
      ORDER BY c.sort_order LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.hrms_capability_for(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_capability_for(text) TO authenticated;

-- Full data access per role (table driven; SYSTEM_ADMIN / ADMIN always).
CREATE OR REPLACE FUNCTION public.hrms_admin_roles()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY(
    SELECT DISTINCT r FROM (
      SELECT unnest(ARRAY['SYSTEM_ADMIN', 'ADMIN']) AS r
      UNION ALL
      SELECT upper(role) FROM public.hrms_role_access WHERE full_data_access
    ) roles);
$$;
REVOKE ALL ON FUNCTION public.hrms_admin_roles() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_admin_roles() TO authenticated, service_role;

-- Grants as stored (direct, role template, manager template). Only for
-- active people; templates match the normalised role.
CREATE OR REPLACE FUNCTION public.hrms_raw_grants(p_user uuid)
RETURNS TABLE (permission text, scope text, scope_id text, source text, grant_id uuid, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT p.id, public.normalize_profile_role(p.role) AS role
    FROM public.profiles p
    WHERE p.id = p_user AND coalesce(p.is_active, true)
  )
  SELECT up.permission, up.scope::text, up.scope_id, 'USER'::text, up.id, up.expires_at
  FROM public.user_permissions up JOIN me ON me.id = up.user_id
  WHERE up.revoked_at IS NULL AND (up.expires_at IS NULL OR up.expires_at > now())
  UNION ALL
  SELECT rg.permission, rg.scope, rg.scope_id, 'ROLE:' || me.role, rg.id, NULL::timestamptz
  FROM public.role_permission_grants rg JOIN me ON rg.role <> '@MANAGER'
       AND public.normalize_profile_role(rg.role) = me.role
  WHERE rg.revoked_at IS NULL
  UNION ALL
  SELECT rg.permission, rg.scope, rg.scope_id, 'MANAGER'::text, rg.id, NULL::timestamptz
  FROM public.role_permission_grants rg CROSS JOIN me
  WHERE rg.revoked_at IS NULL AND rg.role = '@MANAGER'
    AND EXISTS (SELECT 1 FROM public.profiles r
                WHERE r.reports_to = me.id AND r.id <> me.id AND coalesce(r.is_active, true));
$$;
REVOKE ALL ON FUNCTION public.hrms_raw_grants(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_raw_grants(uuid) TO service_role;

-- Every key in force for a user (same columns as before, so every caller
-- keeps working); capabilities are expanded here.
CREATE OR REPLACE FUNCTION public.hrms_active_grants(p_user uuid)
RETURNS TABLE (permission text, scope text, scope_id text, source text, grant_id uuid, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT k, r.scope, r.scope_id, r.source, r.grant_id, r.expires_at
  FROM public.hrms_raw_grants(p_user) r
  CROSS JOIN LATERAL unnest(public.hrms_capability_keys(r.permission)) k;
$$;
REVOKE ALL ON FUNCTION public.hrms_active_grants(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_active_grants(uuid) TO service_role;

-- The merged capability keys also live in the old catalog table, so every
-- older reader (labels, scoped flag, visible-profile rule) understands them.
INSERT INTO public.permissions (permission_key, module, action, label, description, scoped, risk_level, sort_order, is_active) VALUES
  ('attendance.correct', 'Attendance', 'manage', 'Correct attendance',
   'Fix check-in / check-out and record missed days in scope', true, 'HIGH', 22, true),
  ('attendance.requests.approve', 'Attendance', 'approve', 'Approve requests',
   'Approve or reject regularization and correction requests in scope', true, 'HIGH', 24, true),
  ('tracking.view', 'Field & tracking', 'view', 'Tracking & activity',
   'Live location, In Transit and activity analysis in scope', true, 'HIGH', 41, true)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, label = EXCLUDED.label,
  description = EXCLUDED.description, scoped = EXCLUDED.scoped, risk_level = EXCLUDED.risk_level,
  sort_order = EXCLUDED.sort_order, is_active = true;

-- Role admins: may manage permissions and templates (never switchable).
CREATE OR REPLACE FUNCTION public.hrms_is_role_admin(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles a
                 WHERE a.id = p_user AND a.is_active = true
                   AND public.normalize_profile_role(a.role) IN ('SYSTEM_ADMIN', 'ADMIN'));
$$;
REVOKE ALL ON FUNCTION public.hrms_is_role_admin(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_is_role_admin(uuid) TO authenticated;

-- ─── 4. Default templates (only when never seeded, so later edits stay) ─────

DO $$
DECLARE
  v_role text;
BEGIN
  -- Managers: their whole reporting tree.
  IF NOT EXISTS (SELECT 1 FROM public.role_permission_grants WHERE role = '@MANAGER') THEN
    INSERT INTO public.role_permission_grants (role, permission, scope, scope_id, reason)
    SELECT '@MANAGER', k, 'REPORTS_TO', NULL, 'Default manager access (2026-10-20)'
    FROM unnest(ARRAY['employees.view', 'attendance.view', 'leave.approve', 'attendance.requests.approve',
                      'tasks.manage', 'field_visits.view', 'tracking.view']) k;
  END IF;

  -- HR / HRD: every data capability company-wide, i.e. exactly what full
  -- data access gives them today. Used only if full access is switched off.
  -- Seeded once per role (marker = the seed reason), whatever older template
  -- rows exist; missing capabilities are added, nothing is removed. Switching
  -- full access off later is refused while the template is incomplete (see
  -- rpc_admin_set_role_full_access).
  FOREACH v_role IN ARRAY ARRAY['HR', 'HRD'] LOOP
    IF NOT EXISTS (SELECT 1 FROM public.role_permission_grants
                   WHERE public.normalize_profile_role(role) = v_role
                     AND reason = 'Same access as full data access (2026-10-20)') THEN
      INSERT INTO public.role_permission_grants (role, permission, scope, scope_id, reason)
      SELECT v_role, c.key, 'GLOBAL', NULL, 'Same access as full data access (2026-10-20)'
      FROM public.permission_capabilities c
      WHERE c.is_active AND c.key NOT LIKE 'permissions.%'
        AND NOT EXISTS (SELECT 1 FROM public.role_permission_grants rg
                        WHERE rg.revoked_at IS NULL AND public.normalize_profile_role(rg.role) = v_role
                          AND rg.permission = c.key AND rg.scope = 'GLOBAL' AND rg.scope_id IS NULL);
    END IF;
  END LOOP;
END $$;

-- ─── 5. Live refresh: a version per user, bumped on every access change ─────

CREATE OR REPLACE FUNCTION public.hrms_bump_permission_version(p_users uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.user_permission_versions AS v (user_id, version, updated_at)
  SELECT DISTINCT u, 1, now() FROM unnest(p_users) u WHERE u IS NOT NULL
  ON CONFLICT (user_id) DO UPDATE SET version = v.version + 1, updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.hrms_bump_permission_version(uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_bump_permission_version(uuid[]) TO service_role;

-- A person and everyone above them in the reporting line (cycle-safe).
CREATE OR REPLACE FUNCTION public.hrms_reporting_ancestors(p_user uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE up(id, depth) AS (
    SELECT p_user, 0 WHERE p_user IS NOT NULL
    UNION
    SELECT p.reports_to, up.depth + 1
    FROM up JOIN public.profiles p ON p.id = up.id
    WHERE p.reports_to IS NOT NULL AND up.depth < 25
  )
  SELECT DISTINCT id FROM up;
$$;
REVOKE ALL ON FUNCTION public.hrms_reporting_ancestors(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_reporting_ancestors(uuid) TO service_role;

-- Everyone a role template applies to ('@MANAGER' = everyone with reports).
CREATE OR REPLACE FUNCTION public.hrms_role_members(p_role text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id FROM public.profiles p
  WHERE coalesce(p.is_active, true)
    AND CASE WHEN p_role = '@MANAGER'
             THEN EXISTS (SELECT 1 FROM public.profiles r
                          WHERE r.reports_to = p.id AND r.id <> p.id AND coalesce(r.is_active, true))
             ELSE public.normalize_profile_role(p.role) = public.normalize_profile_role(p_role) END;
$$;
REVOKE ALL ON FUNCTION public.hrms_role_members(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_role_members(text) TO service_role;

CREATE OR REPLACE FUNCTION public.hrms_permission_version_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_permissions' THEN
    PERFORM public.hrms_bump_permission_version(ARRAY[
      CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END]);
  ELSIF TG_TABLE_NAME = 'role_permission_grants' THEN
    -- old and new role (an UPDATE may move an entry between roles)
    PERFORM public.hrms_bump_permission_version(ARRAY(
      SELECT public.hrms_role_members(r)
      FROM unnest(ARRAY[CASE WHEN TG_OP <> 'INSERT' THEN OLD.role END,
                        CASE WHEN TG_OP <> 'DELETE' THEN NEW.role END]) r
      WHERE r IS NOT NULL));
  ELSIF TG_TABLE_NAME = 'hrms_role_access' THEN
    PERFORM public.hrms_bump_permission_version(ARRAY(SELECT public.hrms_role_members(NEW.role)));
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    -- the person, and every manager above the old and the new position
    -- (their reporting trees changed; Manager-template status may change)
    IF TG_OP = 'INSERT' THEN
      PERFORM public.hrms_bump_permission_version(ARRAY(
        SELECT NEW.id UNION SELECT public.hrms_reporting_ancestors(NEW.reports_to)));
    ELSIF OLD.role IS DISTINCT FROM NEW.role OR OLD.reports_to IS DISTINCT FROM NEW.reports_to
       OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      PERFORM public.hrms_bump_permission_version(ARRAY(
        SELECT NEW.id
        UNION SELECT public.hrms_reporting_ancestors(OLD.reports_to)
        UNION SELECT public.hrms_reporting_ancestors(NEW.reports_to)));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_permission_version_trg() FROM public, anon, authenticated;

-- Catalog / screen-map changes can change everyone's access: bump everyone
-- once per statement.
CREATE OR REPLACE FUNCTION public.hrms_permission_catalog_version_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.hrms_bump_permission_version(ARRAY(
    SELECT p.id FROM public.profiles p WHERE coalesce(p.is_active, true)));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_permission_catalog_version_trg() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS hrms_permission_catalog_version_trg ON public.permission_capabilities;
CREATE TRIGGER hrms_permission_catalog_version_trg AFTER INSERT OR UPDATE OR DELETE ON public.permission_capabilities
  FOR EACH STATEMENT EXECUTE FUNCTION public.hrms_permission_catalog_version_trg();
DROP TRIGGER IF EXISTS hrms_permission_catalog_version_trg ON public.permission_screen_access;
CREATE TRIGGER hrms_permission_catalog_version_trg AFTER INSERT OR UPDATE OR DELETE ON public.permission_screen_access
  FOR EACH STATEMENT EXECUTE FUNCTION public.hrms_permission_catalog_version_trg();

DROP TRIGGER IF EXISTS hrms_permission_version_trg ON public.user_permissions;
CREATE TRIGGER hrms_permission_version_trg AFTER INSERT OR UPDATE OR DELETE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.hrms_permission_version_trg();
DROP TRIGGER IF EXISTS hrms_permission_version_trg ON public.role_permission_grants;
CREATE TRIGGER hrms_permission_version_trg AFTER INSERT OR UPDATE OR DELETE ON public.role_permission_grants
  FOR EACH ROW EXECUTE FUNCTION public.hrms_permission_version_trg();
DROP TRIGGER IF EXISTS hrms_permission_version_trg ON public.hrms_role_access;
CREATE TRIGGER hrms_permission_version_trg AFTER INSERT OR UPDATE ON public.hrms_role_access
  FOR EACH ROW EXECUTE FUNCTION public.hrms_permission_version_trg();
DROP TRIGGER IF EXISTS hrms_permission_version_trg ON public.profiles;
CREATE TRIGGER hrms_permission_version_trg AFTER INSERT OR UPDATE OF role, reports_to, is_active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.hrms_permission_version_trg();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = 'user_permission_versions') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_permission_versions';
  END IF;
END $$;

-- ─── 6. One hierarchy rule ──────────────────────────────────────────────────

-- People the caller reviews through the Manager template (whole reporting
-- tree), or everyone for full data access. Empty template = no manager access.
CREATE OR REPLACE FUNCTION public.hrms_reviewable_user_ids()
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF public.hrms_is_admin_user(v_uid) THEN
    RETURN QUERY SELECT p.id FROM public.profiles p;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT m
    FROM (SELECT DISTINCT g.scope, g.scope_id FROM public.hrms_raw_grants(v_uid) g WHERE g.source = 'MANAGER') s
    CROSS JOIN LATERAL public.hrms_scope_member_ids(s.scope, s.scope_id, v_uid) m
    WHERE m <> v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_reviewable_user_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_reviewable_user_ids() TO authenticated;

-- Same signature as before; no longer reads manager_team_cache or role names.
CREATE OR REPLACE FUNCTION public.current_user_can_review(employee_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.hrms_is_admin_user(auth.uid())
    OR CASE
         WHEN employee_id IS NULL
           THEN EXISTS (SELECT 1 FROM public.hrms_raw_grants(auth.uid()) g WHERE g.source = 'MANAGER')
         ELSE employee_id IN (SELECT public.hrms_reviewable_user_ids())
       END);
$$;

-- Tracking / location: one rule (tracking capability in scope, or self).
-- attendance.view alone no longer reveals live location.
CREATE OR REPLACE FUNCTION public.can_view_tracking_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_access_user_data(p_user_id, 'live_tracking.view');
$$;

CREATE OR REPLACE FUNCTION public.hrms_can_view_location(p_target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_access_user_data(p_target, 'live_tracking.view');
$$;

-- Access rules that called the per-row helpers now use one set lookup per
-- query, keyed to the data in the table. Rules that cannot be altered here
-- (e.g. storage) keep calling the rewritten helpers above, so they follow
-- the same rule.
DO $$
DECLARE
  r       record;
  v_key   text;
  v_qual  text;
  v_check text;
  v_sql   text;
  v_n     integer := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '(current_user_can_review|can_view_tracking_user)\('
  LOOP
    -- read rules follow the View capability, write rules the acting one
    v_key := CASE
      WHEN r.tablename ~ '(regulari|correction)' THEN
        CASE WHEN r.cmd = 'SELECT' THEN 'regularization.view' ELSE 'regularization.approve' END
      WHEN r.tablename ~ '(leave|on_duty|comp_off)' THEN
        CASE WHEN r.cmd = 'SELECT' THEN 'leave.view' ELSE 'leave.approve' END
      WHEN r.tablename ~ 'task' THEN
        CASE WHEN r.cmd = 'SELECT' THEN 'tasks.view' ELSE 'tasks.manage' END
      WHEN r.tablename ~ '(field_visit|site_visit)' OR r.schemaname = 'storage' THEN 'field_visits.view'
      WHEN r.tablename ~ '(location|tracking|transit|ping|escalation|geofence|heartbeat|journey)' THEN 'live_tracking.view'
      ELSE CASE WHEN r.cmd = 'SELECT' THEN 'attendance.view' ELSE 'attendance.regularize' END END;
    v_qual := r.qual;
    v_check := r.with_check;
    v_qual := regexp_replace(v_qual, '(public\.)?can_view_tracking_user\(([A-Za-z0-9_."]+)\)',
                             '(\2 IN (SELECT public.authorized_user_ids(''live_tracking.view'')))', 'g');
    v_check := regexp_replace(v_check, '(public\.)?can_view_tracking_user\(([A-Za-z0-9_."]+)\)',
                              '(\2 IN (SELECT public.authorized_user_ids(''live_tracking.view'')))', 'g');
    v_qual := regexp_replace(v_qual, '(public\.)?current_user_can_review\(([A-Za-z0-9_."]+)\)',
                             '(\2 IN (SELECT public.authorized_user_ids(' || quote_literal(v_key) || ')))', 'g');
    v_check := regexp_replace(v_check, '(public\.)?current_user_can_review\(([A-Za-z0-9_."]+)\)',
                              '(\2 IN (SELECT public.authorized_user_ids(' || quote_literal(v_key) || ')))', 'g');
    IF v_qual IS NOT DISTINCT FROM r.qual AND v_check IS NOT DISTINCT FROM r.with_check THEN
      CONTINUE;
    END IF;
    v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF v_qual IS NOT NULL THEN v_sql := v_sql || ' USING (' || v_qual || ')'; END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || v_check || ')'; END IF;
    BEGIN
      EXECUTE v_sql;
      v_n := v_n + 1;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'access rule %.%/% kept on the helper function: %', r.schemaname, r.tablename, r.policyname, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'hierarchy: % access rules now use the permission engine', v_n;
END $$;

-- ─── 7. Grants: validation, delegation ceiling, apply ───────────────────────

CREATE OR REPLACE FUNCTION public.hrms_permission_error_message(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_code
    WHEN 'AUTHENTICATION_REQUIRED' THEN 'Sign in again.'
    WHEN 'FORBIDDEN' THEN 'You are not allowed to change permissions.'
    WHEN 'ROLE_ADMIN_REQUIRED' THEN 'Only System Admin / Admin can do this.'
    WHEN 'USER_NOT_FOUND' THEN 'Employee not found or deactivated.'
    WHEN 'INVALID_PERMISSION_KEY' THEN 'Unknown or retired permission.'
    WHEN 'INVALID_SCOPE' THEN 'This scope is not allowed for this permission.'
    WHEN 'INVALID_SCOPE_TARGET' THEN 'Choose a valid office, team, manager or department.'
    WHEN 'INVALID_EXPIRY' THEN 'The expiry must be in the future.'
    WHEN 'REASON_REQUIRED' THEN 'A reason is required for high-risk access.'
    WHEN 'SELF_GRANT_FORBIDDEN' THEN 'You cannot change your own access.'
    WHEN 'ADMIN_ONLY_PERMISSION' THEN 'Only admins can give or remove permission-management rights.'
    WHEN 'OUTSIDE_YOUR_ACCESS' THEN 'You can only give access you hold yourself, for people inside your own scope.'
    WHEN 'TARGET_OUTSIDE_YOUR_SCOPE' THEN 'This employee is outside your scope.'
    WHEN 'NOTHING_TO_REVOKE' THEN 'No direct grant to remove (access may come from a role or manager template).'
    WHEN 'TOO_MANY' THEN 'Too many people or permissions in one change.'
    WHEN 'EMPTY_REQUEST' THEN 'Choose at least one person and one permission.'
    WHEN 'INVALID_ROLE' THEN 'Choose a role this template can apply to.'
    ELSE coalesce(p_code, 'Unknown error')
  END;
$$;

-- Validates a capability + scope and returns the stored form.
CREATE OR REPLACE FUNCTION public.hrms_normalize_grant(
  p_capability text, p_scope text, p_scope_id text,
  OUT capability text, OUT scope text, OUT scope_id text, OUT risk text, OUT error text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap public.permission_capabilities%ROWTYPE;
BEGIN
  capability := public.hrms_capability_for(btrim(coalesce(p_capability, '')));
  SELECT * INTO v_cap FROM public.permission_capabilities c WHERE c.key = capability AND c.is_active;
  IF NOT FOUND THEN
    error := 'INVALID_PERMISSION_KEY';
    RETURN;
  END IF;
  risk := v_cap.risk_level;
  scope := upper(btrim(coalesce(p_scope, 'GLOBAL')));
  scope_id := nullif(btrim(coalesce(p_scope_id, '')), '');
  IF scope NOT IN ('GLOBAL', 'OFFICE', 'OFFICE_TREE', 'TEAM', 'TEAM_TREE', 'REPORTS_TO', 'DEPARTMENT') THEN
    error := 'INVALID_SCOPE';
  ELSIF NOT v_cap.scoped AND scope <> 'GLOBAL' THEN
    error := 'INVALID_SCOPE';
  ELSIF scope = 'GLOBAL' THEN
    scope_id := NULL;
  ELSIF scope IN ('OFFICE', 'OFFICE_TREE') THEN
    IF NOT EXISTS (SELECT 1 FROM public.offices o WHERE o.id = public.hrms_try_uuid(scope_id)) THEN
      error := 'INVALID_SCOPE_TARGET';
    END IF;
  ELSIF scope IN ('TEAM', 'TEAM_TREE') THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = public.hrms_try_uuid(scope_id)) THEN
      error := 'INVALID_SCOPE_TARGET';
    END IF;
  ELSIF scope = 'REPORTS_TO' THEN
    IF scope_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = public.hrms_try_uuid(scope_id)) THEN
      error := 'INVALID_SCOPE_TARGET';
    END IF;
  ELSIF scope = 'DEPARTMENT' AND scope_id IS NULL THEN
    error := 'INVALID_SCOPE_TARGET';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_normalize_grant(text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_normalize_grant(text, text, text) TO authenticated;

-- NULL when the caller may give (or take away) this capability + scope for
-- p_target; otherwise the reason. Role admins: anything except their own
-- access. Delegates (permissions.assign / .revoke): only capabilities they
-- hold, at most at their own scope, for people they can see, never
-- permission-management rights, never themselves.
CREATE OR REPLACE FUNCTION public.hrms_grant_ceiling_error(
  p_target uuid, p_capability text, p_scope text, p_scope_id text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text;
BEGIN
  IF v_uid IS NULL THEN RETURN 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_target = v_uid THEN RETURN 'SELF_GRANT_FORBIDDEN'; END IF;
  IF public.hrms_is_role_admin(v_uid) THEN RETURN NULL; END IF;
  IF p_capability LIKE 'permissions.%' THEN RETURN 'ADMIN_ONLY_PERMISSION'; END IF;
  IF public.hrms_is_admin_user(v_uid) THEN RETURN NULL; END IF;      -- full data access holds every key company-wide

  FOREACH v_key IN ARRAY public.hrms_capability_keys(p_capability) LOOP
    -- a merged capability's own name is not a key anyone holds; its parts are
    CONTINUE WHEN v_key = p_capability AND EXISTS (
      SELECT 1 FROM public.permission_capabilities c WHERE c.key = v_key AND NOT (v_key = ANY (c.grants)));
    IF NOT public.hrms_has_permission(v_key) THEN RETURN 'OUTSIDE_YOUR_ACCESS'; END IF;
    -- the person receiving access must be inside the delegate's own reach
    IF p_target NOT IN (SELECT public.authorized_user_ids(v_key)) THEN RETURN 'TARGET_OUTSIDE_YOUR_SCOPE'; END IF;
    IF p_scope = 'GLOBAL' THEN
      IF NOT public.hrms_has_global_permission(ARRAY[v_key]) THEN RETURN 'OUTSIDE_YOUR_ACCESS'; END IF;
    ELSIF EXISTS (SELECT m FROM public.hrms_scope_member_ids(p_scope, p_scope_id, p_target) m
                  EXCEPT
                  SELECT a FROM public.authorized_user_ids(v_key) a) THEN
      RETURN 'OUTSIDE_YOUR_ACCESS';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_grant_ceiling_error(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_grant_ceiling_error(uuid, text, text, text) TO authenticated;

-- Writes one direct grant. Re-granting never shortens or removes an expiry
-- (use admin_set_grant_expiry for that). Caller has validated everything.
CREATE OR REPLACE FUNCTION public.hrms_apply_user_grant(
  p_user uuid, p_key text, p_scope text, p_scope_id text, p_expires_at timestamptz, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id  uuid;
  v_old timestamptz;
  v_new timestamptz;
BEGIN
  SELECT up.id, up.expires_at INTO v_id, v_old
  FROM public.user_permissions up
  WHERE up.user_id = p_user AND up.permission = p_key AND up.revoked_at IS NULL
    AND up.scope::text = p_scope AND coalesce(up.scope_id, '') = coalesce(p_scope_id, '')
  FOR UPDATE;

  PERFORM set_config('hrms.permission_reason', coalesce(p_reason, ''), true);

  IF v_id IS NOT NULL THEN
    v_new := CASE WHEN v_old IS NULL OR p_expires_at IS NULL THEN NULL ELSE greatest(v_old, p_expires_at) END;
    IF v_new IS NOT DISTINCT FROM v_old THEN
      RETURN jsonb_build_object('id', v_id, 'status', 'UNCHANGED', 'expires_at', v_old);
    END IF;
    UPDATE public.user_permissions
    SET expires_at = v_new, reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), reason)
    WHERE id = v_id;
    RETURN jsonb_build_object('id', v_id, 'status', 'EXTENDED', 'expires_at', v_new);
  END IF;

  EXECUTE format(
    'INSERT INTO public.user_permissions (user_id, permission, scope, scope_id, created_by, created_at, reason, expires_at)
     VALUES ($1, $2, %L, $3, $4, now(), $5, $6) RETURNING id', p_scope)
  INTO v_id
  USING p_user, p_key, p_scope_id, auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''), p_expires_at;
  RETURN jsonb_build_object('id', v_id, 'status', 'ADDED', 'expires_at', p_expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_apply_user_grant(uuid, text, text, text, timestamptz, text) FROM public, anon, authenticated;

-- Give several capabilities to several people in one atomic change.
-- p_grants: [{"capability": "...", "scope": "OFFICE", "scope_id": "..."}]
-- Every pair is checked first; if any fails nothing is written. p_dry_run
-- returns the per-person preview without writing.
CREATE OR REPLACE FUNCTION public.admin_set_access_bulk(
  p_user_ids   uuid[],
  p_grants     jsonb,
  p_expires_at timestamptz DEFAULT NULL,
  p_reason     text DEFAULT NULL,
  p_dry_run    boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_user    uuid;
  v_item    jsonb;
  v_norm    record;
  v_err     text;
  v_rows    jsonb := '[]'::jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_row     jsonb;
  v_res     jsonb;
  v_errors  integer := 0;
  v_counts  jsonb := '{"ADDED":0,"EXTENDED":0,"UNCHANGED":0}'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', public.hrms_permission_error_message('AUTHENTICATION_REQUIRED'));
  END IF;
  IF NOT public.hrms_is_permission_admin(v_actor, 'assign') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', public.hrms_permission_error_message('FORBIDDEN'));
  END IF;
  IF coalesce(cardinality(p_user_ids), 0) = 0 OR jsonb_typeof(p_grants) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_grants) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPTY_REQUEST', 'message', public.hrms_permission_error_message('EMPTY_REQUEST'));
  END IF;
  IF cardinality(p_user_ids) > 500 OR jsonb_array_length(p_grants) > 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'TOO_MANY', 'message', public.hrms_permission_error_message('TOO_MANY'));
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_EXPIRY', 'message', public.hrms_permission_error_message('INVALID_EXPIRY'));
  END IF;

  FOR v_user IN SELECT DISTINCT u FROM unnest(p_user_ids) u WHERE u IS NOT NULL LOOP
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_grants) LOOP
      SELECT * INTO v_norm FROM public.hrms_normalize_grant(v_item->>'capability', v_item->>'scope', v_item->>'scope_id');
      v_err := v_norm.error;
      IF v_err IS NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND coalesce(p.is_active, true)) THEN
        v_err := 'USER_NOT_FOUND';
      END IF;
      IF v_err IS NULL AND v_norm.risk = 'HIGH' AND v_reason IS NULL THEN
        v_err := 'REASON_REQUIRED';
      END IF;
      IF v_err IS NULL THEN
        v_err := public.hrms_grant_ceiling_error(v_user, v_norm.capability, v_norm.scope, v_norm.scope_id);
      END IF;
      IF v_err IS NOT NULL THEN v_errors := v_errors + 1; END IF;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'user_id', v_user,
        'capability', coalesce(v_norm.capability, v_item->>'capability'),
        'scope', v_norm.scope, 'scope_id', v_norm.scope_id,
        'scope_label', CASE WHEN v_norm.error IS NULL THEN public.hrms_scope_label(v_norm.scope, v_norm.scope_id) END,
        'status', CASE WHEN v_err IS NULL THEN 'OK' ELSE 'ERROR' END,
        'error', v_err,
        'message', CASE WHEN v_err IS NOT NULL THEN public.hrms_permission_error_message(v_err) END));
    END LOOP;
  END LOOP;

  IF v_errors > 0 OR p_dry_run THEN
    RETURN jsonb_build_object('success', v_errors = 0, 'dry_run', p_dry_run, 'applied', 0, 'errors', v_errors,
      'error', CASE WHEN v_errors > 0 THEN 'VALIDATION_FAILED' END,
      'message', CASE WHEN v_errors > 0 THEN format('%s change(s) not allowed; nothing was saved.', v_errors) END,
      'results', v_rows);
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
    v_res := public.hrms_apply_user_grant((v_row->>'user_id')::uuid, v_row->>'capability', v_row->>'scope',
                                          v_row->>'scope_id', p_expires_at, v_reason);
    v_counts := jsonb_set(v_counts, ARRAY[v_res->>'status'], to_jsonb((v_counts->>(v_res->>'status'))::int + 1));
    v_out := v_out || jsonb_build_array(v_row || jsonb_build_object('status', v_res->>'status', 'id', v_res->'id',
                                                                      'expires_at', v_res->'expires_at'));
  END LOOP;

  RETURN jsonb_build_object('success', true, 'dry_run', false, 'errors', 0,
    'applied', (v_counts->>'ADDED')::int + (v_counts->>'EXTENDED')::int,
    'added', (v_counts->>'ADDED')::int, 'extended', (v_counts->>'EXTENDED')::int,
    'unchanged', (v_counts->>'UNCHANGED')::int, 'results', v_out);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_access_bulk(uuid[], jsonb, timestamptz, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_access_bulk(uuid[], jsonb, timestamptz, text, boolean) TO authenticated;

-- Remove capabilities (direct grants, every scope, aliases and old merged
-- keys included) from several people at once. Atomic like the bulk grant.
CREATE OR REPLACE FUNCTION public.admin_revoke_access_bulk(
  p_user_ids     uuid[],
  p_capabilities text[],
  p_reason       text DEFAULT NULL,
  p_dry_run      boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_user   uuid;
  v_cap    text;
  v_canon  text;
  v_g      record;
  v_err    text;
  v_rows   jsonb := '[]'::jsonb;
  v_errors integer := 0;
  v_ids    uuid[] := ARRAY[]::uuid[];
  v_count  integer;
  v_n      integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', public.hrms_permission_error_message('AUTHENTICATION_REQUIRED'));
  END IF;
  IF NOT public.hrms_is_permission_admin(v_actor, 'revoke') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', public.hrms_permission_error_message('FORBIDDEN'));
  END IF;
  IF coalesce(cardinality(p_user_ids), 0) = 0 OR coalesce(cardinality(p_capabilities), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPTY_REQUEST', 'message', public.hrms_permission_error_message('EMPTY_REQUEST'));
  END IF;
  IF cardinality(p_user_ids) > 500 OR cardinality(p_capabilities) > 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'TOO_MANY', 'message', public.hrms_permission_error_message('TOO_MANY'));
  END IF;

  FOR v_user IN SELECT DISTINCT u FROM unnest(p_user_ids) u WHERE u IS NOT NULL LOOP
    FOREACH v_cap IN ARRAY p_capabilities LOOP
      v_canon := coalesce(public.hrms_capability_for(v_cap), v_cap);
      v_count := 0;
      v_err := NULL;
      FOR v_g IN
        SELECT up.id, up.permission, up.scope::text AS scope, up.scope_id
        FROM public.user_permissions up
        WHERE up.user_id = v_user AND up.revoked_at IS NULL
          AND (up.permission = v_cap OR public.hrms_capability_for(up.permission) = v_canon)
      LOOP
        v_err := coalesce(v_err, public.hrms_grant_ceiling_error(v_user, v_canon, v_g.scope, v_g.scope_id));
        v_ids := v_ids || v_g.id;
        v_count := v_count + 1;
      END LOOP;
      IF v_err IS NOT NULL THEN v_errors := v_errors + 1; END IF;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'user_id', v_user, 'capability', v_canon, 'grants', v_count,
        'status', CASE WHEN v_err IS NOT NULL THEN 'ERROR' WHEN v_count = 0 THEN 'NOTHING_TO_REVOKE' ELSE 'OK' END,
        'error', v_err,
        'message', CASE WHEN v_err IS NOT NULL THEN public.hrms_permission_error_message(v_err)
                        WHEN v_count = 0 THEN public.hrms_permission_error_message('NOTHING_TO_REVOKE') END,
        'still_from', (SELECT jsonb_agg(DISTINCT g.source) FROM public.hrms_raw_grants(v_user) g
                       WHERE g.source <> 'USER' AND public.hrms_capability_for(g.permission) = v_canon)));
    END LOOP;
  END LOOP;

  IF v_errors > 0 OR p_dry_run THEN
    RETURN jsonb_build_object('success', v_errors = 0, 'dry_run', p_dry_run, 'revoked', 0, 'errors', v_errors,
      'error', CASE WHEN v_errors > 0 THEN 'VALIDATION_FAILED' END,
      'message', CASE WHEN v_errors > 0 THEN format('%s change(s) not allowed; nothing was removed.', v_errors) END,
      'results', v_rows);
  END IF;

  PERFORM set_config('hrms.permission_reason', coalesce(p_reason, ''), true);
  UPDATE public.user_permissions SET revoked_at = now(), revoked_by = v_actor
  WHERE id = ANY (v_ids) AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'dry_run', false, 'errors', 0, 'revoked', v_n, 'results', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_revoke_access_bulk(uuid[], text[], text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_access_bulk(uuid[], text[], text, boolean) TO authenticated;

-- One direct grant by id (Effective access → Revoke).
CREATE OR REPLACE FUNCTION public.admin_revoke_grant(p_grant_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_g     record;
  v_err   text;
BEGIN
  IF v_actor IS NULL OR NOT public.hrms_is_permission_admin(v_actor, 'revoke') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', public.hrms_permission_error_message('FORBIDDEN'));
  END IF;
  SELECT up.id, up.user_id, up.permission, up.scope::text AS scope, up.scope_id INTO v_g
  FROM public.user_permissions up WHERE up.id = p_grant_id AND up.revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOTHING_TO_REVOKE', 'message', 'This grant was already removed.');
  END IF;
  v_err := public.hrms_grant_ceiling_error(v_g.user_id, coalesce(public.hrms_capability_for(v_g.permission), v_g.permission),
                                           v_g.scope, v_g.scope_id);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_err, 'message', public.hrms_permission_error_message(v_err));
  END IF;
  PERFORM set_config('hrms.permission_reason', coalesce(p_reason, ''), true);
  UPDATE public.user_permissions SET revoked_at = now(), revoked_by = v_actor WHERE id = p_grant_id;
  RETURN jsonb_build_object('success', true, 'revoked', 1);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_revoke_grant(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_grant(uuid, text) TO authenticated;

-- Renew, shorten or make permanent (NULL) one direct grant, explicitly.
CREATE OR REPLACE FUNCTION public.admin_set_grant_expiry(p_grant_id uuid, p_expires_at timestamptz, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_g     record;
  v_err   text;
BEGIN
  IF v_actor IS NULL OR NOT public.hrms_is_permission_admin(v_actor, 'assign') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', public.hrms_permission_error_message('FORBIDDEN'));
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_EXPIRY', 'message', public.hrms_permission_error_message('INVALID_EXPIRY'));
  END IF;
  SELECT up.id, up.user_id, up.permission, up.scope::text AS scope, up.scope_id INTO v_g
  FROM public.user_permissions up WHERE up.id = p_grant_id AND up.revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOTHING_TO_REVOKE', 'message', 'This grant no longer exists.');
  END IF;
  v_err := public.hrms_grant_ceiling_error(v_g.user_id, coalesce(public.hrms_capability_for(v_g.permission), v_g.permission),
                                           v_g.scope, v_g.scope_id);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_err, 'message', public.hrms_permission_error_message(v_err));
  END IF;
  PERFORM set_config('hrms.permission_reason', coalesce(p_reason, ''), true);
  UPDATE public.user_permissions SET expires_at = p_expires_at,
         reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), reason)
  WHERE id = p_grant_id;
  RETURN jsonb_build_object('success', true, 'id', p_grant_id, 'expires_at', p_expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_grant_expiry(uuid, timestamptz, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_grant_expiry(uuid, timestamptz, text) TO authenticated;

-- Copy one person's direct grants to others (same checks as a bulk grant).
CREATE OR REPLACE FUNCTION public.admin_copy_access(
  p_from uuid, p_to uuid[], p_reason text DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL, p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grants jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.hrms_is_permission_admin(auth.uid(), 'assign') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', public.hrms_permission_error_message('FORBIDDEN'));
  END IF;
  SELECT jsonb_agg(DISTINCT jsonb_build_object('capability', c, 'scope', s, 'scope_id', sid))
  INTO v_grants
  FROM (
    SELECT public.hrms_capability_for(up.permission) AS c, up.scope::text AS s, up.scope_id AS sid
    FROM public.user_permissions up
    WHERE up.user_id = p_from AND up.revoked_at IS NULL
      AND (up.expires_at IS NULL OR up.expires_at > now())
  ) g
  WHERE c IS NOT NULL AND (c NOT LIKE 'permissions.%' OR public.hrms_is_role_admin(auth.uid()));
  IF v_grants IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPTY_REQUEST', 'message', 'This person has no direct grants to copy.');
  END IF;
  RETURN public.admin_set_access_bulk(ARRAY(SELECT u FROM unnest(p_to) u WHERE u IS DISTINCT FROM p_from),
                                      v_grants, p_expires_at, coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Copied access'),
                                      p_dry_run);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_copy_access(uuid, uuid[], text, timestamptz, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_copy_access(uuid, uuid[], text, timestamptz, boolean) TO authenticated;

-- Old single-grant RPC, same signature, now on the same rules.
CREATE OR REPLACE FUNCTION public.admin_grant_permission(
  p_user_id    uuid,
  p_permission text,
  p_scope      text DEFAULT 'GLOBAL',
  p_scope_id   text DEFAULT NULL,
  p_reason     text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb;
  v_row jsonb;
BEGIN
  v_res := public.admin_set_access_bulk(ARRAY[p_user_id],
             jsonb_build_array(jsonb_build_object('capability', p_permission, 'scope', p_scope, 'scope_id', p_scope_id)),
             p_expires_at, p_reason, false);
  v_row := v_res->'results'->0;
  IF NOT coalesce((v_res->>'success')::boolean, false) THEN
    RETURN jsonb_build_object('success', false,
      'error', coalesce(v_row->>'error', v_res->>'error'),
      'message', coalesce(v_row->>'message', v_res->>'message'));
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_row->'id', 'existing', v_row->>'status' <> 'ADDED',
    'status', v_row->>'status', 'scope_label', v_row->>'scope_label', 'expires_at', v_row->'expires_at');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_grant_permission(uuid, text, text, text, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_permission(uuid, text, text, text, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_permission(
  p_user_id    uuid,
  p_permission text,
  p_scope      text DEFAULT NULL,
  p_scope_id   text DEFAULT NULL,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_canon text := coalesce(public.hrms_capability_for(p_permission), p_permission);
  v_scope text := upper(nullif(btrim(coalesce(p_scope, '')), ''));
  v_sid   text := nullif(btrim(coalesce(p_scope_id, '')), '');
  v_g     record;
  v_err   text;
  v_ids   uuid[] := ARRAY[]::uuid[];
  v_n     integer;
BEGIN
  IF v_actor IS NULL OR NOT public.hrms_is_permission_admin(v_actor, 'revoke') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', public.hrms_permission_error_message('FORBIDDEN'));
  END IF;
  FOR v_g IN
    SELECT up.id, up.scope::text AS scope, up.scope_id
    FROM public.user_permissions up
    WHERE up.user_id = p_user_id AND up.revoked_at IS NULL
      AND (up.permission = p_permission OR public.hrms_capability_for(up.permission) = v_canon)
      AND (v_scope IS NULL OR (up.scope::text = v_scope AND coalesce(up.scope_id, '') = coalesce(v_sid, '')))
  LOOP
    v_err := public.hrms_grant_ceiling_error(p_user_id, v_canon, v_g.scope, v_g.scope_id);
    IF v_err IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', v_err, 'message', public.hrms_permission_error_message(v_err));
    END IF;
    v_ids := v_ids || v_g.id;
  END LOOP;
  IF cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOTHING_TO_REVOKE', 'revoked', 0,
      'message', public.hrms_permission_error_message('NOTHING_TO_REVOKE'));
  END IF;
  PERFORM set_config('hrms.permission_reason', coalesce(p_reason, ''), true);
  UPDATE public.user_permissions SET revoked_at = now(), revoked_by = v_actor WHERE id = ANY (v_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'revoked', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_revoke_permission(uuid, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_permission(uuid, text, text, text, text) TO authenticated;

-- ─── 8. Role templates (incl. Manager, HR, HRD) and full data access ────────

-- Template audit (replaces the 20261007100000 version, which only warned when
-- the audit row could not be written). Now an audit failure aborts the change.
CREATE OR REPLACE FUNCTION public.hrms_log_role_template_change(
  p_action text, p_id uuid, p_role text, p_permission text, p_scope text, p_scope_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, new_values, source)
  VALUES (auth.uid(), NULL, p_action, 'role_permission_grant', p_id,
          jsonb_build_object('role', p_role, 'permission', p_permission, 'scope', p_scope,
                             'scope_id', p_scope_id, 'reason', p_reason), 'PERMISSION_MANAGER');
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_log_role_template_change(text, uuid, text, text, text, text, text) FROM public, anon, authenticated;

-- '@MANAGER' or a normalised role; NULL when the name cannot have a template.
CREATE OR REPLACE FUNCTION public.hrms_template_role(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN upper(btrim(coalesce(p_role, ''))) IN ('@MANAGER', 'MANAGER_TEMPLATE') THEN '@MANAGER'
    WHEN public.normalize_profile_role(p_role) IN ('', 'SYSTEM_ADMIN', 'ADMIN') THEN NULL
    ELSE public.normalize_profile_role(p_role)
  END;
$$;

-- Replace a role template with exactly p_grants
-- ([{"capability","scope","scope_id"}]). Role admins only.
CREATE OR REPLACE FUNCTION public.rpc_admin_set_role_template(p_role text, p_grants jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_role    text := public.hrms_template_role(p_role);
  v_item    jsonb;
  v_norm    record;
  v_want    jsonb := '[]'::jsonb;
  v_row     public.role_permission_grants%ROWTYPE;
  v_added   integer := 0;
  v_removed integer := 0;
  v_errors  jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.hrms_is_role_admin(v_actor) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ROLE_ADMIN_REQUIRED', 'message', public.hrms_permission_error_message('ROLE_ADMIN_REQUIRED'));
  END IF;
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ROLE', 'message', public.hrms_permission_error_message('INVALID_ROLE'));
  END IF;
  IF jsonb_typeof(coalesce(p_grants, '[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPTY_REQUEST', 'message', 'Send a list of permissions.');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) LOOP
    SELECT * INTO v_norm FROM public.hrms_normalize_grant(
      v_item->>'capability',
      CASE WHEN v_role = '@MANAGER' THEN 'REPORTS_TO' ELSE v_item->>'scope' END,
      CASE WHEN v_role = '@MANAGER' THEN NULL ELSE v_item->>'scope_id' END);
    IF v_norm.error IS NULL AND v_norm.capability LIKE 'permissions.%' THEN
      v_norm.error := 'ADMIN_ONLY_PERMISSION';
    END IF;
    IF v_norm.error IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('capability', v_item->>'capability',
                    'error', v_norm.error, 'message', public.hrms_permission_error_message(v_norm.error)));
    ELSE
      v_want := v_want || jsonb_build_array(jsonb_build_object('permission', v_norm.capability,
                    'scope', v_norm.scope, 'scope_id', v_norm.scope_id));
    END IF;
  END LOOP;
  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'VALIDATION_FAILED', 'errors', v_errors,
      'message', 'Some permissions are not valid for this template; nothing was saved.');
  END IF;

  -- remove what is no longer wanted
  FOR v_row IN
    SELECT * FROM public.role_permission_grants rg
    WHERE rg.revoked_at IS NULL
      AND CASE WHEN v_role = '@MANAGER' THEN rg.role = '@MANAGER'
               ELSE rg.role <> '@MANAGER' AND public.normalize_profile_role(rg.role) = v_role END
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_want) w
                      WHERE w->>'permission' = rg.permission AND w->>'scope' = rg.scope
                        AND coalesce(w->>'scope_id', '') = coalesce(rg.scope_id, ''))
  LOOP
    UPDATE public.role_permission_grants SET revoked_at = now(), revoked_by = v_actor WHERE id = v_row.id;
    PERFORM public.hrms_log_role_template_change('ROLE_REVOKE', v_row.id, v_role, v_row.permission, v_row.scope, v_row.scope_id, p_reason);
    v_removed := v_removed + 1;
  END LOOP;

  -- add what is missing
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_want) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.role_permission_grants rg
      WHERE rg.revoked_at IS NULL AND rg.permission = v_item->>'permission' AND rg.scope = v_item->>'scope'
        AND coalesce(rg.scope_id, '') = coalesce(v_item->>'scope_id', '')
        AND CASE WHEN v_role = '@MANAGER' THEN rg.role = '@MANAGER'
                 ELSE rg.role <> '@MANAGER' AND public.normalize_profile_role(rg.role) = v_role END) THEN
      INSERT INTO public.role_permission_grants (role, permission, scope, scope_id, reason, created_by)
      VALUES (v_role, v_item->>'permission', v_item->>'scope', v_item->>'scope_id',
              nullif(btrim(coalesce(p_reason, '')), ''), v_actor)
      RETURNING * INTO v_row;
      PERFORM public.hrms_log_role_template_change('ROLE_GRANT', v_row.id, v_role, v_row.permission, v_row.scope, v_row.scope_id, p_reason);
      v_added := v_added + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'role', v_role, 'added', v_added, 'removed', v_removed,
    'affected_people', (SELECT count(*) FROM public.hrms_role_members(v_role)));
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_set_role_template(text, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_role_template(text, jsonb, text) TO authenticated;

-- Old single-row template RPC: same rules (HR / HRD / Manager allowed now).
CREATE OR REPLACE FUNCTION public.rpc_admin_grant_role_permission(
  p_role text, p_permission text, p_scope text DEFAULT 'REPORTS_TO', p_scope_id text DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.hrms_template_role(p_role);
  v_norm record;
  v_id   uuid;
BEGIN
  IF NOT public.hrms_is_role_admin(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', public.hrms_permission_error_message('ROLE_ADMIN_REQUIRED'));
  END IF;
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ROLE', 'message', public.hrms_permission_error_message('INVALID_ROLE'));
  END IF;
  SELECT * INTO v_norm FROM public.hrms_normalize_grant(p_permission,
    CASE WHEN v_role = '@MANAGER' THEN 'REPORTS_TO' ELSE p_scope END,
    CASE WHEN v_role = '@MANAGER' THEN NULL ELSE p_scope_id END);
  IF v_norm.error IS NULL AND v_norm.capability LIKE 'permissions.%' THEN v_norm.error := 'ADMIN_ONLY_PERMISSION'; END IF;
  IF v_norm.error IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_norm.error, 'message', public.hrms_permission_error_message(v_norm.error));
  END IF;
  SELECT rg.id INTO v_id FROM public.role_permission_grants rg
  WHERE rg.revoked_at IS NULL AND rg.permission = v_norm.capability AND rg.scope = v_norm.scope
    AND coalesce(rg.scope_id, '') = coalesce(v_norm.scope_id, '')
    AND CASE WHEN v_role = '@MANAGER' THEN rg.role = '@MANAGER'
             ELSE rg.role <> '@MANAGER' AND public.normalize_profile_role(rg.role) = v_role END;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'id', v_id, 'existing', true);
  END IF;
  INSERT INTO public.role_permission_grants (role, permission, scope, scope_id, reason, created_by)
  VALUES (v_role, v_norm.capability, v_norm.scope, v_norm.scope_id, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.hrms_log_role_template_change('ROLE_GRANT', v_id, v_role, v_norm.capability, v_norm.scope, v_norm.scope_id, p_reason);
  RETURN jsonb_build_object('success', true, 'id', v_id, 'existing', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_revoke_role_permission(p_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.role_permission_grants%ROWTYPE;
BEGIN
  IF NOT public.hrms_is_role_admin(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', public.hrms_permission_error_message('ROLE_ADMIN_REQUIRED'));
  END IF;
  UPDATE public.role_permission_grants SET revoked_at = now(), revoked_by = auth.uid()
  WHERE id = p_id AND revoked_at IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOTHING_TO_REVOKE', 'revoked', 0, 'message', 'This template entry was already removed.');
  END IF;
  PERFORM public.hrms_log_role_template_change('ROLE_REVOKE', v_row.id, v_row.role, v_row.permission, v_row.scope, v_row.scope_id, p_reason);
  RETURN jsonb_build_object('success', true, 'revoked', 1);
END;
$$;

-- HR / HRD (or any non-admin role): full data access on / off.
CREATE OR REPLACE FUNCTION public.rpc_admin_set_role_full_access(p_role text, p_enabled boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role  text := public.hrms_template_role(p_role);
  v_old   boolean;
  v_missing jsonb;
BEGIN
  IF NOT public.hrms_is_role_admin(v_actor) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ROLE_ADMIN_REQUIRED', 'message', public.hrms_permission_error_message('ROLE_ADMIN_REQUIRED'));
  END IF;
  IF v_role IS NULL OR v_role = '@MANAGER' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ROLE',
      'message', 'System Admin and Admin always have full access; the Manager template cannot have it.');
  END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED', 'message', public.hrms_permission_error_message('REASON_REQUIRED'));
  END IF;
  SELECT full_data_access INTO v_old FROM public.hrms_role_access WHERE role = v_role;

  -- Switching off must not silently remove access: the role's template has to
  -- give every data capability company-wide first. Reduce the template
  -- afterwards, explicitly (each change is audited).
  IF NOT coalesce(p_enabled, false) AND coalesce(v_old, false) THEN
    SELECT coalesce(jsonb_agg(c.key ORDER BY c.sort_order), '[]'::jsonb) INTO v_missing
    FROM public.permission_capabilities c
    WHERE c.is_active AND c.key NOT LIKE 'permissions.%'
      AND NOT EXISTS (SELECT 1 FROM public.role_permission_grants rg
                      WHERE rg.revoked_at IS NULL AND rg.role <> '@MANAGER'
                        AND public.normalize_profile_role(rg.role) = v_role
                        AND rg.permission = c.key AND rg.scope = 'GLOBAL');
    IF jsonb_array_length(v_missing) > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'TEMPLATE_INCOMPLETE', 'missing', v_missing,
        'message', format('The %s template does not yet give everything full access gives (%s missing). Complete it first, then switch off and trim it.',
                          v_role, jsonb_array_length(v_missing)));
    END IF;
  END IF;

  INSERT INTO public.hrms_role_access (role, full_data_access, updated_by, updated_at)
  VALUES (v_role, coalesce(p_enabled, false), v_actor, now())
  ON CONFLICT (role) DO UPDATE SET full_data_access = EXCLUDED.full_data_access,
                                   updated_by = EXCLUDED.updated_by, updated_at = now();
  -- Audit is part of the change: if it cannot be written, nothing changes.
  INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, old_values, new_values, source)
  VALUES (v_actor, NULL, CASE WHEN p_enabled THEN 'ROLE_FULL_ACCESS_ON' ELSE 'ROLE_FULL_ACCESS_OFF' END,
          'role_access', NULL, jsonb_build_object('role', v_role, 'full_data_access', v_old),
          jsonb_build_object('role', v_role, 'full_data_access', coalesce(p_enabled, false), 'reason', p_reason),
          'PERMISSION_MANAGER');
  RETURN jsonb_build_object('success', true, 'role', v_role, 'full_data_access', coalesce(p_enabled, false),
    'affected_people', (SELECT count(*) FROM public.hrms_role_members(v_role)));
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_set_role_full_access(text, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_role_full_access(text, boolean, text) TO authenticated;

-- Everything the Templates tab shows.
CREATE OR REPLACE FUNCTION public.rpc_admin_role_templates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.hrms_is_permission_admin(auth.uid(), 'view') OR public.hrms_is_permission_admin(auth.uid(), 'assign')) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'can_edit', public.hrms_is_role_admin(auth.uid()),
    'templates', coalesce((
      SELECT jsonb_agg(t ORDER BY t->>'sort', t->>'role')
      FROM (
        SELECT jsonb_build_object(
          'role', r.role,
          'label', CASE WHEN r.role = '@MANAGER' THEN 'Managers (whole reporting tree)' ELSE r.role END,
          'sort', CASE WHEN r.role = '@MANAGER' THEN '0' WHEN r.role IN ('HR', 'HRD') THEN '1' ELSE '2' END,
          'locked', r.role IN ('SYSTEM_ADMIN', 'ADMIN'),
          'full_data_access', r.role IN ('SYSTEM_ADMIN', 'ADMIN')
                              OR coalesce((SELECT a.full_data_access FROM public.hrms_role_access a WHERE a.role = r.role), false),
          'members', (SELECT count(*) FROM public.hrms_role_members(r.role)),
          'grants', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                     'id', rg.id, 'capability', coalesce(public.hrms_capability_for(rg.permission), rg.permission),
                     'permission', rg.permission, 'scope', rg.scope, 'scope_id', rg.scope_id,
                     'scope_label', CASE WHEN rg.scope = 'REPORTS_TO' AND rg.scope_id IS NULL
                                         THEN 'Their own reporting tree'
                                         ELSE public.hrms_scope_label(rg.scope, rg.scope_id) END,
                     'reason', rg.reason, 'created_at', rg.created_at)
                   ORDER BY rg.permission)
            FROM public.role_permission_grants rg
            WHERE rg.revoked_at IS NULL
              AND CASE WHEN r.role = '@MANAGER' THEN rg.role = '@MANAGER'
                       ELSE rg.role <> '@MANAGER' AND public.normalize_profile_role(rg.role) = r.role END), '[]'::jsonb)) AS t
        FROM (
          SELECT '@MANAGER' AS role
          UNION SELECT unnest(ARRAY['SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD'])
          UNION SELECT public.normalize_profile_role(p.role) FROM public.profiles p
                WHERE p.role IS NOT NULL AND btrim(p.role) <> '' AND coalesce(p.is_active, true)
          UNION SELECT public.normalize_profile_role(rg.role) FROM public.role_permission_grants rg
                WHERE rg.revoked_at IS NULL AND rg.role <> '@MANAGER'
          UNION SELECT a.role FROM public.hrms_role_access a
        ) r
      ) x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_role_templates() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_role_templates() TO authenticated;

-- ─── 9. What the app and the Permission Manager read ────────────────────────

CREATE OR REPLACE FUNCTION public.get_permission_catalog_v2()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'modules', coalesce((
      SELECT jsonb_agg(jsonb_build_object('module', m.module, 'capabilities', m.caps) ORDER BY m.first_sort)
      FROM (
        SELECT c.module, min(c.sort_order) AS first_sort,
               jsonb_agg(jsonb_build_object(
                 'key', c.key, 'label', c.label, 'description', c.description, 'level', c.level,
                 'risk', c.risk_level, 'scoped', c.scoped, 'grants', to_jsonb(c.grants),
                 'implies', to_jsonb(c.implies), 'sort', c.sort_order) ORDER BY c.sort_order) AS caps
        FROM public.permission_capabilities c
        WHERE c.is_active
        GROUP BY c.module
      ) m), '[]'::jsonb),
    'screens', coalesce((SELECT jsonb_object_agg(s.route, to_jsonb(s.keys)) FROM public.permission_screen_access s), '{}'::jsonb),
    'scopes', jsonb_build_array('GLOBAL', 'OFFICE', 'OFFICE_TREE', 'TEAM', 'TEAM_TREE', 'REPORTS_TO', 'DEPARTMENT'));
$$;
REVOKE ALL ON FUNCTION public.get_permission_catalog_v2() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_permission_catalog_v2() TO authenticated;

-- The signed-in user's own access (the app's permission source).
CREATE OR REPLACE FUNCTION public.get_my_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'user_id', v_uid,
    'version', coalesce((SELECT v.version FROM public.user_permission_versions v WHERE v.user_id = v_uid), 0),
    'full_data_access', public.hrms_is_admin_user(v_uid),
    'role_admin', public.hrms_is_role_admin(v_uid),
    'permission_admin', jsonb_build_object(
      'view', public.hrms_is_permission_admin(v_uid, 'view'),
      'assign', public.hrms_is_permission_admin(v_uid, 'assign'),
      'revoke', public.hrms_is_permission_admin(v_uid, 'revoke')),
    'has_reports', EXISTS (SELECT 1 FROM public.profiles r WHERE r.reports_to = v_uid AND r.id <> v_uid AND coalesce(r.is_active, true)),
    'grants', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'permission', g.permission, 'scope', g.scope, 'scope_id', g.scope_id,
               'scope_label', CASE WHEN g.scope = 'REPORTS_TO' AND g.scope_id IS NULL THEN 'My reporting tree'
                                   ELSE public.hrms_scope_label(g.scope, g.scope_id) END,
               'source', g.source, 'expires_at', g.expires_at))
      FROM public.hrms_active_grants(v_uid) g), '[]'::jsonb),
    'screens', coalesce((SELECT jsonb_object_agg(s.route, to_jsonb(s.keys)) FROM public.permission_screen_access s), '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_access() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_access() TO authenticated;

-- One person's access for the Permission Manager, grouped by capability with
-- where it comes from, how many people each grant covers, and expired grants.
CREATE OR REPLACE FUNCTION public.get_user_access(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_user public.profiles%ROWTYPE;
  v_all  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_user_id <> v_uid AND NOT (public.hrms_is_permission_admin(v_uid, 'view')
                                 OR public.hrms_is_permission_admin(v_uid, 'assign')
                                 OR public.hrms_is_permission_admin(v_uid, 'revoke')) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_user FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'USER_NOT_FOUND');
  END IF;
  SELECT count(*) INTO v_all FROM public.profiles WHERE coalesce(is_active, true);

  RETURN jsonb_build_object(
    'user', jsonb_build_object('id', v_user.id, 'name', v_user.name, 'role', v_user.role,
                               'is_active', v_user.is_active, 'office_id', v_user.office_id,
                               'team_id', v_user.team_id, 'reports_to', v_user.reports_to),
    'full_data_access', public.hrms_is_admin_user(p_user_id),
    'role_admin', EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = p_user_id AND a.is_active = true
                          AND public.normalize_profile_role(a.role) IN ('SYSTEM_ADMIN', 'ADMIN')),
    'reports', (SELECT count(*) FROM public.hrms_scope_member_ids('REPORTS_TO', NULL, p_user_id)),
    'grants', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', g.grant_id, 'permission', g.permission,
               'capability', public.hrms_capability_for(g.permission),
               'legacy', g.permission IS DISTINCT FROM public.hrms_capability_for(g.permission),
               'scope', g.scope, 'scope_id', g.scope_id,
               'scope_label', CASE WHEN g.scope = 'REPORTS_TO' AND g.scope_id IS NULL THEN 'Their reporting tree'
                                   ELSE public.hrms_scope_label(g.scope, g.scope_id) END,
               'covers', CASE WHEN g.scope = 'GLOBAL' THEN v_all
                              ELSE (SELECT count(*) FROM public.hrms_scope_member_ids(g.scope, g.scope_id, p_user_id)) END,
               'source', g.source, 'expires_at', g.expires_at,
               'granted_at', coalesce(up.created_at, rg.created_at),
               'granted_by', (SELECT a.name FROM public.profiles a WHERE a.id = coalesce(up.created_by, rg.created_by)),
               'reason', coalesce(up.reason, rg.reason))
             ORDER BY public.hrms_capability_for(g.permission), g.source)
      FROM public.hrms_raw_grants(p_user_id) g
      LEFT JOIN public.user_permissions up ON g.source = 'USER' AND up.id = g.grant_id
      LEFT JOIN public.role_permission_grants rg ON g.source <> 'USER' AND rg.id = g.grant_id), '[]'::jsonb),
    'expired', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', up.id, 'permission', up.permission, 'capability', public.hrms_capability_for(up.permission),
               'scope', up.scope::text, 'scope_id', up.scope_id,
               'scope_label', public.hrms_scope_label(up.scope::text, up.scope_id),
               'expires_at', up.expires_at, 'reason', up.reason)
             ORDER BY up.expires_at DESC)
      FROM public.user_permissions up
      WHERE up.user_id = p_user_id AND up.revoked_at IS NULL
        AND up.expires_at <= now() AND up.expires_at > now() - interval '90 days'), '[]'::jsonb),
    'effective_keys', coalesce((SELECT jsonb_agg(DISTINCT g.permission) FROM public.hrms_active_grants(p_user_id) g), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_user_access(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_access(uuid) TO authenticated;

-- Access of many people at once (Matrix view): capability, source, scope.
CREATE OR REPLACE FUNCTION public.rpc_admin_access_matrix(p_user_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.hrms_is_permission_admin(auth.uid(), 'view') OR public.hrms_is_permission_admin(auth.uid(), 'assign')) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_user_ids), 0) > 500 THEN
    RAISE EXCEPTION 'TOO_MANY' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'user_id', p.id,
             'full_data_access', public.hrms_is_admin_user(p.id),
             'grants', coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', g.grant_id, 'capability', public.hrms_capability_for(g.permission),
                        'source', g.source, 'scope', g.scope, 'scope_id', g.scope_id,
                        'scope_label', CASE WHEN g.scope = 'REPORTS_TO' AND g.scope_id IS NULL THEN 'Their reporting tree'
                                            ELSE public.hrms_scope_label(g.scope, g.scope_id) END,
                        'expires_at', g.expires_at))
               FROM public.hrms_raw_grants(p.id) g), '[]'::jsonb)))
    FROM public.profiles p
    WHERE p.id = ANY (p_user_ids)), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_access_matrix(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_access_matrix(uuid[]) TO authenticated;

-- Who can see / act on one employee, and why.
CREATE OR REPLACE FUNCTION public.rpc_who_can_access(p_target uuid, p_capability text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap text := CASE WHEN nullif(btrim(coalesce(p_capability, '')), '') IS NULL THEN NULL
                     ELSE public.hrms_capability_for(p_capability) END;
BEGIN
  IF NOT (public.hrms_is_permission_admin(auth.uid(), 'view') OR public.hrms_is_permission_admin(auth.uid(), 'assign')) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'name')
    FROM (
      SELECT jsonb_build_object('user_id', p.id, 'name', p.name, 'role', p.role,
               'full_data_access', true, 'via', jsonb_build_array(jsonb_build_object('source', 'FULL_ACCESS'))) AS x
      FROM public.profiles p
      WHERE p.id <> p_target AND public.hrms_is_admin_user(p.id)
      UNION ALL
      SELECT jsonb_build_object('user_id', p.id, 'name', p.name, 'role', p.role, 'full_data_access', false,
               'via', jsonb_agg(DISTINCT jsonb_build_object(
                        'capability', public.hrms_capability_for(g.permission), 'source', g.source,
                        'scope', g.scope, 'scope_label', CASE WHEN g.scope = 'REPORTS_TO' AND g.scope_id IS NULL
                                                             THEN 'Their reporting tree'
                                                             ELSE public.hrms_scope_label(g.scope, g.scope_id) END,
                        'expires_at', g.expires_at)))
      FROM public.profiles p
      CROSS JOIN LATERAL public.hrms_raw_grants(p.id) g
      WHERE p.id <> p_target AND coalesce(p.is_active, true) AND NOT public.hrms_is_admin_user(p.id)
        AND g.permission NOT LIKE 'permissions.%'
        AND (v_cap IS NULL OR public.hrms_capability_for(g.permission) = v_cap
             OR v_cap = ANY (public.hrms_capability_keys(g.permission)))
        AND (g.scope = 'GLOBAL' OR p_target IN (SELECT public.hrms_scope_member_ids(g.scope, g.scope_id, p.id)))
      GROUP BY p.id, p.name, p.role
    ) rows), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_who_can_access(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_who_can_access(uuid, text) TO authenticated;

-- One history for direct grants, templates and full-access switches.
CREATE OR REPLACE FUNCTION public.rpc_permission_history(
  p_user_id    uuid DEFAULT NULL,
  p_actor_id   uuid DEFAULT NULL,
  p_capability text DEFAULT NULL,
  p_limit      integer DEFAULT 50,
  p_offset     integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_cap   text := nullif(btrim(coalesce(p_capability, '')), '');
  v_rows  jsonb;
BEGIN
  IF NOT (public.hrms_is_permission_admin(auth.uid(), 'view') OR public.hrms_is_permission_admin(auth.uid(), 'assign')) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(h ORDER BY (h->>'at')::timestamptz DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT to_jsonb(e) AS h FROM (
      SELECT * FROM (
        SELECT l.created_at AS at, 'USER' AS kind, l.action,
               coalesce(l.permission_key, l.permission) AS permission,
               public.hrms_capability_for(coalesce(l.permission_key, l.permission)) AS capability,
               l.scope::text AS scope, l.scope_id,
               CASE WHEN l.scope IS NULL THEN NULL ELSE public.hrms_scope_label(l.scope::text, l.scope_id) END AS scope_label,
               l.target_user_id, (SELECT p.name FROM public.profiles p WHERE p.id = l.target_user_id) AS target_name,
               NULL::text AS role,
               coalesce(l.actor_user_id, l.actor_id) AS actor_id,
               (SELECT p.name FROM public.profiles p WHERE p.id = coalesce(l.actor_user_id, l.actor_id)) AS actor_name,
               l.reason
        FROM public.permission_audit_logs l
        WHERE (p_user_id IS NULL OR l.target_user_id = p_user_id)
          AND (p_actor_id IS NULL OR coalesce(l.actor_user_id, l.actor_id) = p_actor_id)
        UNION ALL
        SELECT ev.created_at, CASE WHEN ev.entity_type = 'role_access' THEN 'FULL_ACCESS' ELSE 'TEMPLATE' END,
               ev.action, ev.new_values->>'permission',
               public.hrms_capability_for(ev.new_values->>'permission'),
               ev.new_values->>'scope', ev.new_values->>'scope_id',
               CASE WHEN ev.new_values ? 'scope' THEN public.hrms_scope_label(ev.new_values->>'scope', ev.new_values->>'scope_id') END,
               NULL::uuid, NULL::text, ev.new_values->>'role',
               ev.actor_user_id, (SELECT p.name FROM public.profiles p WHERE p.id = ev.actor_user_id),
               ev.new_values->>'reason'
        FROM public.hrms_audit_events ev
        WHERE ev.source = 'PERMISSION_MANAGER'
          AND ev.entity_type IN ('role_permission_grant', 'role_access')
          AND p_user_id IS NULL
          AND (p_actor_id IS NULL OR ev.actor_user_id = p_actor_id)
      ) u
      WHERE v_cap IS NULL OR u.capability = public.hrms_capability_for(v_cap) OR u.permission = v_cap
      ORDER BY u.at DESC
      LIMIT v_limit + 1 OFFSET greatest(coalesce(p_offset, 0), 0)
    ) e
  ) rows;
  RETURN jsonb_build_object(
    'rows', CASE WHEN jsonb_array_length(v_rows) > v_limit THEN v_rows - v_limit ELSE v_rows END,
    'has_more', jsonb_array_length(v_rows) > v_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_permission_history(uuid, uuid, text, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_permission_history(uuid, uuid, text, integer, integer) TO authenticated;

-- Simulator: same shape as before; knows capabilities, Manager and full access.
CREATE OR REPLACE FUNCTION public.explain_access(p_user uuid, p_permission text, p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_user   public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_target_json jsonb;
  v_user_json jsonb;
  v_grants jsonb;
  v_cap    text := coalesce(public.hrms_capability_for(p_permission), p_permission);
  v_label  text;
  v_keys   text[];
  v_parts  text[];
  v_part   text;
  v_missing text[] := ARRAY[]::text[];
  v_match  record;
  v_src    text;
BEGIN
  IF v_caller IS NULL OR NOT (public.hrms_is_permission_admin(v_caller, 'view')
                              OR public.hrms_is_permission_admin(v_caller, 'assign')) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(c.label, v_cap) INTO v_label FROM public.permission_capabilities c WHERE c.key = v_cap;
  v_label := coalesce(v_label, p_permission);
  -- What must be held: every key of the capability (a merged capability needs
  -- all of its parts in scope, exactly like the server checks each key); an
  -- individual key asked for directly needs only itself.
  IF EXISTS (SELECT 1 FROM public.permission_capabilities c WHERE c.key = p_permission) THEN
    SELECT c.grants INTO v_parts FROM public.permission_capabilities c WHERE c.key = p_permission;
  ELSE
    v_parts := ARRAY[p_permission];
  END IF;
  v_keys := ARRAY(SELECT DISTINCT k FROM unnest(v_parts) part, unnest(public.hrms_permission_keys(part)) k);

  SELECT * INTO v_user FROM public.profiles WHERE id = p_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'reason', 'USER_NOT_FOUND'); END IF;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_target;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'reason', 'TARGET_NOT_FOUND'); END IF;

  v_user_json := jsonb_build_object('id', v_user.id, 'name', v_user.name, 'role', v_user.role, 'is_active', v_user.is_active);
  v_target_json := jsonb_build_object(
    'id', v_target.id, 'name', v_target.name,
    'office_id', v_target.office_id,
    'office_name', (SELECT o.name FROM public.offices o WHERE o.id = v_target.office_id),
    'team_id', v_target.team_id,
    'team_name', (SELECT t.name FROM public.teams t WHERE t.id = v_target.team_id),
    'reports_to', v_target.reports_to,
    'reports_to_name', (SELECT m.name FROM public.profiles m WHERE m.id = v_target.reports_to),
    'department', v_target.department);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'permission', g.permission, 'scope', g.scope, 'scope_id', g.scope_id,
           'scope_label', public.hrms_scope_label(g.scope, g.scope_id),
           'source', g.source, 'expires_at', g.expires_at,
           'covers_target', g.scope = 'GLOBAL'
             OR p_target IN (SELECT public.hrms_scope_member_ids(g.scope, g.scope_id, p_user)))), '[]'::jsonb)
  INTO v_grants
  FROM public.hrms_active_grants(p_user) g
  WHERE g.permission = ANY (v_keys);

  IF NOT coalesce(v_user.is_active, true) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'USER_INACTIVE',
      'explanation', format('%s is deactivated: no access.', v_user.name),
      'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
  END IF;
  IF p_user = p_target THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'SELF',
      'explanation', 'Everyone can access their own records.',
      'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
  END IF;
  IF v_cap LIKE 'permissions.%' THEN
    IF public.hrms_is_permission_admin(p_user, split_part(v_cap, '.', 2)) THEN
      RETURN jsonb_build_object('allowed', true, 'reason', 'PERMISSION_ADMIN',
        'explanation', format('%s may manage permissions.', v_user.name),
        'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
    END IF;
  ELSIF public.hrms_is_admin_user(p_user) THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'ADMIN_ROLE',
      'explanation', format('%s''s role (%s) has full data access: everything, for all employees.', v_user.name, v_user.role),
      'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
  END IF;

  FOREACH v_part IN ARRAY v_parts LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.hrms_active_grants(p_user) g
      WHERE g.permission = ANY (public.hrms_permission_keys(v_part))
        AND (g.scope = 'GLOBAL' OR p_target IN (SELECT public.hrms_scope_member_ids(g.scope, g.scope_id, p_user)))) THEN
      v_missing := v_missing || v_part;
    END IF;
  END LOOP;

  IF cardinality(v_missing) > 0 AND cardinality(v_missing) < cardinality(v_parts) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'PARTIAL_CAPABILITY', 'missing', to_jsonb(v_missing),
      'explanation', format('%s has only part of "%s" for %s: missing %s.', v_user.name, v_label, v_target.name,
                            array_to_string(v_missing, ', ')),
      'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
  END IF;

  SELECT g.scope, g.scope_id, g.source, g.expires_at INTO v_match
  FROM public.hrms_active_grants(p_user) g
  WHERE cardinality(v_missing) = 0
    AND g.permission = ANY (public.hrms_permission_keys(v_parts[1]))
    AND (g.scope = 'GLOBAL' OR p_target IN (SELECT public.hrms_scope_member_ids(g.scope, g.scope_id, p_user)))
  ORDER BY (g.source = 'USER') DESC
  LIMIT 1;

  IF FOUND THEN
    v_src := CASE WHEN v_match.source = 'USER' THEN ''
                  WHEN v_match.source = 'MANAGER' THEN ' (as their manager, from the Manager template)'
                  ELSE ' (from the ' || substr(v_match.source, 6) || ' role template)' END;
    RETURN jsonb_build_object('allowed', true,
      'reason', CASE WHEN v_match.source = 'USER' THEN 'SCOPED_GRANT'
                     WHEN v_match.source = 'MANAGER' THEN 'MANAGER_HIERARCHY' ELSE 'ROLE_TEMPLATE' END,
      'matched_grant', jsonb_build_object('scope', v_match.scope, 'scope_id', v_match.scope_id,
                                          'scope_label', CASE WHEN v_match.scope = 'REPORTS_TO' AND v_match.scope_id IS NULL
                                                              THEN 'their reporting tree'
                                                              ELSE public.hrms_scope_label(v_match.scope, v_match.scope_id) END,
                                          'source', v_match.source, 'expires_at', v_match.expires_at),
      'explanation', format('%s has "%s" for %s%s, which includes %s.', v_user.name, v_label,
                            CASE WHEN v_match.scope = 'REPORTS_TO' AND v_match.scope_id IS NULL
                                 THEN 'their reporting tree'
                                 ELSE public.hrms_scope_label(v_match.scope, v_match.scope_id) END,
                            v_src, v_target.name),
      'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
  END IF;

  RETURN jsonb_build_object('allowed', false,
    'reason', CASE WHEN jsonb_array_length(v_grants) = 0 THEN 'NO_GRANT' ELSE 'TARGET_OUTSIDE_SCOPE' END,
    'explanation', CASE WHEN jsonb_array_length(v_grants) = 0
      THEN format('%s does not have "%s".', v_user.name, v_label)
      ELSE format('%s has "%s", but none of their scopes include %s.', v_user.name, v_label, v_target.name) END,
    'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
END;
$$;
REVOKE ALL ON FUNCTION public.explain_access(uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.explain_access(uuid, text, uuid) TO authenticated;

-- ─── 10. Security fixes ─────────────────────────────────────────────────────

-- 10a. Grants and templates change only through the RPCs above (which check
-- the ceiling and audit). A delegate could previously write any row directly.
DROP POLICY IF EXISTS hrms_user_permissions_admin_write ON public.user_permissions;
-- any other write rule on the permission tables too (only read rules stay)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND cmd <> 'SELECT'
             AND tablename IN ('user_permissions', 'role_permission_grants', 'permission_capabilities',
                               'permission_screen_access', 'hrms_role_access', 'user_permission_versions') LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    RAISE NOTICE 'dropped write rule %.%', r.tablename, r.policyname;
  END LOOP;
END $$;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_permissions FROM PUBLIC, authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.role_permission_grants FROM PUBLIC, authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.permission_capabilities, public.permission_screen_access,
  public.hrms_role_access, public.user_permission_versions FROM PUBLIC, authenticated, anon;

-- 10b. Approval fields of leave and regularization requests change only
-- through the approval RPCs (which run as the database owner). Direct client
-- updates may still edit other fields their access rules allow, and the
-- employee may cancel their own pending request.
CREATE OR REPLACE FUNCTION public.hrms_guard_review_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old     jsonb := to_jsonb(OLD);
  v_new     jsonb := to_jsonb(NEW);
  v_key     text;
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    IF v_key ~ '^(status|approved_by|approved_at|approver_id|reviewed_by|reviewed_at|review_[a-z_]+|rejected_[a-z_]+|rejection_reason|decided_[a-z_]+|decision[a-z_]*|manager_status|hr_status|admin_status|final_status|approval_[a-z_]+)$'
       AND v_old->v_key IS DISTINCT FROM v_new->v_key THEN
      v_changed := v_changed || v_key;
    END IF;
  END LOOP;
  IF cardinality(v_changed) = 0 THEN
    RETURN NEW;
  END IF;
  IF v_changed = ARRAY['status'] AND v_old->>'user_id' = auth.uid()::text
     AND upper(coalesce(v_old->>'status', '')) = 'PENDING'
     AND upper(coalesce(v_new->>'status', '')) IN ('CANCELLED', 'CANCELED', 'WITHDRAWN') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'REVIEW_FIELDS_LOCKED: % can only change through the approval screen', array_to_string(v_changed, ', ')
    USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_guard_review_fields() FROM public, anon, authenticated;

DO $$
DECLARE
  v_table text;
BEGIN
  -- Every table whose access rules let a reviewer UPDATE an employee's row
  -- (inventory from the 2026-10-20 production dry run). The two request
  -- tables are required; a missing one stops the migration.
  FOREACH v_table IN ARRAY ARRAY['leave_requests', 'attendance_regularization_requests', 'leaves', 'on_duty_events'] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      IF v_table IN ('leave_requests', 'attendance_regularization_requests') THEN
        RAISE EXCEPTION 'required table public.% is missing; approval guard not installed', v_table;
      END IF;
      RAISE NOTICE 'approval guard: optional table public.% not present, skipped', v_table;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS hrms_guard_review_fields_trg ON public.%I', v_table);
    EXECUTE format('CREATE TRIGGER hrms_guard_review_fields_trg BEFORE UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.hrms_guard_review_fields()', v_table);
  END LOOP;
END $$;

-- 10c. A task is created by the signed-in user (no forged assigned_by), for
-- themselves or for someone in their tasks.manage scope (managers: their tree).
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.tasks') IS NULL THEN RETURN; END IF;
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'tasks' AND cmd = 'INSERT' LOOP
    EXECUTE format('DROP POLICY %I ON public.tasks', r.policyname);
  END LOOP;
  CREATE POLICY hrms_tasks_insert ON public.tasks
    FOR INSERT TO authenticated
    WITH CHECK (
      assigned_by = auth.uid()
      AND (assigned_to IS NULL OR assigned_to = auth.uid()
           OR assigned_to IN (SELECT public.authorized_user_ids('tasks.manage'))));
END $$;

-- 10d. Leave balance: nobody adjusts their own (role admins included; another
-- admin can). Comp-off RPCs already block self.
DO $$
BEGIN
  IF to_regprocedure('public.hrms_install_permission_wrapper(text, text, text, text, text)') IS NULL THEN
    RAISE NOTICE 'permission wrapper generator missing: wrappers skipped';
    RETURN;
  END IF;
  PERFORM public.hrms_install_permission_wrapper('rpc_admin_adjust_leave_balance',
    $k$ARRAY['leave.balance.manage']$k$, $t$ARRAY[p_user_id]$t$, NULL, $x$p_user_id <> auth.uid()$x$);

  -- 11a. Role-only admin functions that already accept the delegated flag.
  PERFORM public.hrms_install_permission_wrapper('rpc_admin_event_audience_options',
    $k$ARRAY['events.manage','notifications.send']$k$);
  PERFORM public.hrms_install_permission_wrapper('rpc_list_unmapped_biometric_employees',
    $k$ARRAY['biometric.manage']$k$);
  PERFORM public.hrms_install_permission_wrapper('rpc_admin_import_employee_profiles_v2',
    $k$ARRAY['employees.manage']$k$, NULL, NULL,
    $x$public.hrms_has_global_permission(ARRAY['employees.manage'])
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows ELSE '[]'::jsonb END) r
         WHERE public.normalize_profile_role(r->>'role') IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD'))$x$);
END $$;

-- The wrapper bypass for full data access does not apply to self-adjustment.
DO $$
DECLARE
  v_def text;
  v_oid oid;
BEGIN
  FOR v_oid IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = 'rpc_admin_adjust_leave_balance' LOOP
    v_def := pg_get_functiondef(v_oid);
    IF position('HRMS_NO_SELF_LEAVE_ADJUST' IN v_def) = 0 AND position('v__uid' IN v_def) > 0 THEN
      v_def := regexp_replace(v_def, 'BEGIN\s+IF public\.hrms_is_admin_user\(v__uid\) THEN',
        E'BEGIN\n  -- HRMS_NO_SELF_LEAVE_ADJUST\n  IF p_user_id = v__uid THEN\n    RAISE EXCEPTION ''SELF_ADJUSTMENT_FORBIDDEN'' USING ERRCODE = ''42501'',\n      HINT = ''Another administrator must adjust your leave balance.'';\n  END IF;\n  IF public.hrms_is_admin_user(v__uid) THEN');
      EXECUTE v_def;
    END IF;
  END LOOP;
END $$;

-- ─── 11. Role-only checks → permissions ────────────────────────────────────

-- Rewrites part of a function body; NOTICE (not an error) when the text is
-- not there (already converted, or the function differs in this database).
CREATE OR REPLACE FUNCTION public.hrms_patch_function_body(p_name text, p_pattern text, p_replacement text)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  v_n   integer := 0;
BEGIN
  FOR v_oid IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = p_name LOOP
    v_def := pg_get_functiondef(v_oid);
    v_new := regexp_replace(v_def, p_pattern, p_replacement, 'gi');
    IF v_new <> v_def THEN
      EXECUTE v_new;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  IF v_n = 0 THEN
    RAISE NOTICE 'permission patch: % unchanged (already converted or not present)', p_name;
  END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_patch_function_body(text, text, text) FROM public, anon, authenticated;

SELECT public.hrms_patch_function_body('rpc_admin_reset_all_leave_balances',
  $p$upper\(role\)\s+IN\s*\(\s*'SYSTEM_ADMIN',\s*'SUPER_ADMIN',\s*'ADMIN',\s*'HR',\s*'HRD'\s*\)$p$,
  $r$(public.hrms_is_admin_user(id) OR public.hrms_has_global_permission(ARRAY['leave.balance.manage']))$r$);
SELECT public.hrms_patch_function_body('rpc_assign_biometric_employee_code',
  $p$coalesce\(v_role,\s*''\)\s+not\s+in\s*\(\s*'SYSTEM_ADMIN',\s*'SUPER_ADMIN',\s*'ADMIN',\s*'HR',\s*'HRD'\s*\)$p$,
  $r$NOT (public.hrms_is_admin_user(v_actor) OR public.hrms_has_permission('biometric.manage'))$r$);
SELECT public.hrms_patch_function_body('rpc_unassign_biometric_employee_code',
  $p$coalesce\(v_role,\s*''\)\s+not\s+in\s*\(\s*'SYSTEM_ADMIN',\s*'SUPER_ADMIN',\s*'ADMIN',\s*'HR',\s*'HRD'\s*\)$p$,
  $r$NOT (public.hrms_is_admin_user(v_actor) OR public.hrms_has_permission('biometric.manage'))$r$);
SELECT public.hrms_patch_function_body('reprocess_unmatched_biometric_punches',
  $p$not\s+public\.is_profile_admin\(\)$p$,
  $r$NOT (public.is_profile_admin() OR public.hrms_has_permission('biometric.manage'))$r$);
SELECT public.hrms_patch_function_body('rpc_admin_sync_smartoffice_profiles_batch',
  $p$(public\.)?is_hrms_admin\(v_actor\)$p$,
  $r$(public.hrms_is_admin_user(v_actor) OR public.hrms_has_permission('biometric.manage'))$r$);

-- ─── 12. Birthdays through an RPC (direct profile updates are blocked) ──────

CREATE OR REPLACE FUNCTION public.rpc_admin_set_birthday(p_profile_id uuid, p_date_of_birth date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old date;
BEGIN
  PERFORM public.hrms_require_permission(ARRAY['birthdays.manage', 'employees.manage']);
  IF p_date_of_birth IS NOT NULL AND (p_date_of_birth > current_date OR p_date_of_birth < date '1900-01-01') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_DATE', 'message', 'Enter a real date of birth.');
  END IF;
  SELECT date_of_birth INTO v_old FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND', 'message', 'Employee not found.');
  END IF;
  IF NOT public.hrms_has_permission('birthdays.manage')
     AND NOT public.can_access_user_data(p_profile_id, 'employees.manage') THEN
    RAISE EXCEPTION 'TARGET_OUTSIDE_SCOPE' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET date_of_birth = p_date_of_birth WHERE id = p_profile_id;
  INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, old_values, new_values, source)
  VALUES (auth.uid(), p_profile_id, 'BIRTHDAY_SET', 'profile', p_profile_id,
          jsonb_build_object('date_of_birth', v_old), jsonb_build_object('date_of_birth', p_date_of_birth), 'BIRTHDAY_MANAGER');
  RETURN jsonb_build_object('success', true, 'id', p_profile_id, 'date_of_birth', p_date_of_birth);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_set_birthday(uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_birthday(uuid, date) TO authenticated;

-- CSV import: [{"name","phone","date_of_birth"}]; a row is applied only when it
-- matches exactly one employee (name, plus phone when given).
CREATE OR REPLACE FUNCTION public.rpc_admin_import_birthdays(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row     jsonb;
  v_ids     uuid[];
  v_dob     date;
  v_updated integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_res     jsonb;
BEGIN
  PERFORM public.hrms_require_permission(ARRAY['birthdays.manage']);
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 5000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ROWS', 'message', 'Send up to 5000 rows.');
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_dob := (v_row->>'date_of_birth')::date;
    EXCEPTION WHEN others THEN
      v_dob := NULL;
    END;
    IF v_dob IS NULL THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('name', v_row->>'name', 'reason', 'Invalid date'));
      CONTINUE;
    END IF;
    v_ids := ARRAY(
      SELECT p.id FROM public.profiles p
      WHERE lower(btrim(p.name)) = lower(btrim(coalesce(v_row->>'name', '')))
        AND (nullif(btrim(coalesce(v_row->>'phone', '')), '') IS NULL
             OR regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
                LIKE '%' || right(regexp_replace(v_row->>'phone', '\D', '', 'g'), 10)));
    IF cardinality(v_ids) <> 1 THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('name', v_row->>'name',
                     'reason', CASE WHEN cardinality(v_ids) = 0 THEN 'No matching employee' ELSE 'More than one match' END));
      CONTINUE;
    END IF;
    v_res := public.rpc_admin_set_birthday(v_ids[1], v_dob);
    IF coalesce((v_res->>'success')::boolean, false) THEN
      v_updated := v_updated + 1;
    ELSE
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('name', v_row->>'name', 'reason', v_res->>'message'));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'updated', v_updated, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_import_birthdays(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_import_birthdays(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
