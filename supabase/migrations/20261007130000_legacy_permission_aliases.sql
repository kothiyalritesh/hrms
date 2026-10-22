-- =============================================================================
-- 20261007130000_legacy_permission_aliases.sql
--
-- Run AFTER 20261007120000_permission_delegation.sql.
--
-- Production still has grants under older key names (from earlier Permission
-- Manager versions) that nothing checked. Registering them as aliases of the
-- canonical keys makes those existing grants work, keeping their scope.
-- Then hides every non-canonical key from the Permission Manager picker.
-- No grant is created, changed or deleted. Idempotent.
--
-- Deliberately NOT mapped:
--   view_hr_panel       - the HR panel appears when any HR screen is allowed
--   permissions.manage  - would silently make someone a permission admin;
--                         grant permissions.assign explicitly if intended
-- =============================================================================

WITH mapping(canonical, legacy) AS (VALUES
  ('employees.view',             ARRAY['employee.export']),
  ('employees.manage',           ARRAY['employee.deactivate','employee.delete','employees.create','manage_employee_details']),
  ('teams.manage',               ARRAY['team.hierarchy']),
  ('attendance.view',            ARRAY['attendance.advanced','attendance.view_logs']),
  ('attendance.regularize',      ARRAY['manage_attendance']),
  ('attendance.calendar.manage', ARRAY['attendance.weekly_offs']),
  ('checkin_logs.view',          ARRAY['attendance.checkin_logs']),
  ('suspicious.view',            ARRAY['attendance.view_suspicious']),
  ('devices.manage',             ARRAY['admin.duplicate_devices']),
  ('biometric.manage',           ARRAY['biometric.employee_match','biometric.bulk_import','biometric.imported_data']),
  ('leave.balance.manage',       ARRAY['leave.balance']),
  ('live_tracking.view',         ARRAY['view_live_tracking','view_location_history','team.in_transit','reports.activity_analysis']),
  ('field_visits.view',          ARRAY['field_visit.observer','field_visit.view_site']),
  ('sites.manage',               ARRAY['admin.site_settings']),
  ('offices.manage',             ARRAY['admin.office_settings']),
  ('notifications.send',         ARRAY['admin.send_notification']),
  ('feedback.view',              ARRAY['admin.anonymous_feedback']),
  ('reports.view',               ARRAY['view_reports','view_location_reports']),
  ('audit.view',                 ARRAY['admin.audit_logs']),
  ('permissions.view',           ARRAY['admin.permissions'])
)
UPDATE public.permissions c
SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(c.aliases || m.legacy) a ORDER BY a)
FROM mapping m
WHERE c.permission_key = m.canonical;

-- Only canonical keys are offered in the Permission Manager. Old keys stay
-- valid through the aliases above; unmapped old keys simply grant nothing.
UPDATE public.permissions SET is_active = (permission_key IN (
  'employees.view','employees.manage','teams.manage','birthdays.manage',
  'attendance.view','attendance.export','attendance.regularize','regularization.view',
  'regularization.approve','attendance.calendar.manage','checkin_logs.view','suspicious.view',
  'devices.manage','leave.view','leave.approve','leave.balance.manage','live_tracking.view',
  'field_visits.view','sites.manage','offices.manage','tasks.view','tasks.manage','events.manage',
  'notifications.send','tickets.manage','feedback.view','reports.view','audit.view',
  'permissions.view','permissions.assign','permissions.revoke'));

NOTIFY pgrst, 'reload schema';
