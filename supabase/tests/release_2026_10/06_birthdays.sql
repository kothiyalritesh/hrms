-- Birthdays only for people allowed to see them (migration 20261021100000).
-- SA system admin, HR, M manager -> R1; E employee; V can view O1 birthdays; X in office O2.
\set ON_ERROR_STOP on
\ir mock_permissions.sql
\ir ../../migrations/20261020100000_permission_capabilities_and_hierarchy.sql
\ir ../../migrations/20261021100000_birthday_visibility_and_alerts.sql
\ir ../../migrations/20261021100000_birthday_visibility_and_alerts.sql

INSERT INTO offices (id, name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'O1'), ('00000000-0000-0000-0000-0000000000a2', 'O2');
INSERT INTO profiles (id, name, role, office_id, reports_to, date_of_birth) VALUES
  ('00000000-0000-0000-0000-000000000001', 'SA', 'SYSTEM_ADMIN', '00000000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('00000000-0000-0000-0000-000000000002', 'HR', 'HR', '00000000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('00000000-0000-0000-0000-000000000003', 'M', 'SALES_MANAGER', '00000000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('00000000-0000-0000-0000-000000000004', 'R1', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003',
   ((now() AT TIME ZONE 'Asia/Kolkata')::date - interval '30 years')::date),
  ('00000000-0000-0000-0000-000000000005', 'E', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL,
   ((now() AT TIME ZONE 'Asia/Kolkata')::date + interval '5 days' - interval '25 years')::date),
  ('00000000-0000-0000-0000-000000000006', 'V', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('00000000-0000-0000-0000-000000000009', 'X', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a2', NULL,
   ((now() AT TIME ZONE 'Asia/Kolkata')::date - interval '40 years')::date);
INSERT INTO user_permissions (user_id, permission, scope, scope_id) VALUES
  ('00000000-0000-0000-0000-000000000006', 'birthdays.view', 'OFFICE', '00000000-0000-0000-0000-0000000000a1');

CREATE FUNCTION u(n text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM profiles WHERE name = n $$;
CREATE FUNCTION seen_by(n text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM t_as(u(n));
  SELECT coalesce(string_agg(name, ',' ORDER BY name), '-') INTO v FROM upcoming_birthdays_30_days;
  RETURN v;
END $$;

SELECT t_assert('manage includes view', ('birthdays.view' = ANY (hrms_capability_keys('birthdays.manage')))::text, 'true');
SELECT t_assert('HR template still complete', (SELECT count(*)::text FROM role_permission_grants
  WHERE role = 'HR' AND permission = 'birthdays.view' AND revoked_at IS NULL), '1');

SELECT t_assert('admin sees everyone', seen_by('SA'), 'E,R1,X');
SELECT t_assert('HR sees everyone', seen_by('HR'), 'E,R1,X');
SELECT t_assert('viewer sees their office only', seen_by('V'), 'E,R1');
SELECT t_assert('an employee sees only their own', seen_by('E'), 'E');
SELECT t_assert('a manager without the permission sees nobody else', seen_by('M'), '-');
SELECT t_assert('no birth year in the view',
  (SELECT count(*)::text FROM information_schema.columns
   WHERE table_name = 'upcoming_birthdays_30_days' AND column_name = 'date_of_birth'), '0');

SELECT t_as(NULL);
SELECT t_assert('notifications sent to 3 people', hrms_send_birthday_notifications(NULL)::text, '3');
SELECT t_assert('admins get both birthdays, the O1 viewer only R1',
  (SELECT string_agg(p.name || ':' || n.message, ' | ' ORDER BY p.name) FROM test_notifications n JOIN profiles p ON p.id = n.user_id),
  'HR:Birthdays today: R1, X. | SA:Birthdays today: R1, X. | V:R1 has a birthday today.');
SELECT t_assert('the birthday person and others are not notified',
  (SELECT count(*)::text FROM test_notifications WHERE user_id IN (u('R1'), u('X'), u('E'), u('M'))), '0');
SELECT hrms_send_birthday_notifications(NULL);
SELECT t_assert('running twice sends nothing new', (SELECT count(*)::text FROM test_notifications), '3');

UPDATE profiles SET date_of_birth = '1992-02-29' WHERE name = 'E';
DELETE FROM test_notifications;
SELECT hrms_send_birthday_notifications('2027-02-28');
SELECT t_assert('29 Feb birthday is celebrated on 28 Feb in a normal year',
  (SELECT string_agg(DISTINCT message, '|') FROM test_notifications), 'E has a birthday today.');

SELECT 'PASS 06_birthdays' AS result;
