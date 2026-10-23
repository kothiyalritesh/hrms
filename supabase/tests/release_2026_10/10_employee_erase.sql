-- Delete employee = erase everything; sync health; one joining date
-- (migration 20261023100000).
-- SA system admin, HR, ADM admin, E (erased), E2 colleague who reports to E, PA protected admin.
\set ON_ERROR_STOP on
\ir mock_permissions.sql
\ir ../../migrations/20261020100000_permission_capabilities_and_hierarchy.sql

-- Production shapes the erase must cope with: login table, RESTRICT keys,
-- history guards, a NOT NULL actor column, a delete trigger writing a row.
CREATE TABLE auth.users (id uuid PRIMARY KEY);
ALTER TABLE profiles ADD COLUMN date_of_joining date;
CREATE TABLE protected_system_admin_profiles (profile_id uuid PRIMARY KEY REFERENCES profiles(id));
CREATE TABLE attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
  reviewed_by uuid REFERENCES profiles(id), parent_request_id uuid REFERENCES attendance_corrections(id));
CREATE TABLE attendance_correction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), correction_id uuid NOT NULL REFERENCES attendance_corrections(id),
  actor_user_id uuid NOT NULL REFERENCES profiles(id));
CREATE FUNCTION guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PERMANENT'; END $$;
CREATE TRIGGER hrms_attendance_corrections_guard_trg BEFORE UPDATE OR DELETE ON attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION guard();
CREATE TRIGGER hrms_attendance_correction_events_guard_trg BEFORE UPDATE OR DELETE ON attendance_correction_events
  FOR EACH ROW EXECUTE FUNCTION guard();
ALTER TABLE attendance_logs ADD CONSTRAINT al_user FOREIGN KEY (user_id) REFERENCES profiles(id);
CREATE TABLE attendance_action_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES attendance_logs(id));
ALTER TABLE hrms_audit_events ADD CONSTRAINT ha_actor FOREIGN KEY (actor_user_id) REFERENCES profiles(id),
  ADD CONSTRAINT ha_target FOREIGN KEY (target_user_id) REFERENCES profiles(id);
CREATE TABLE notification_dismissed_keys (event_key text PRIMARY KEY, user_id uuid);
CREATE FUNCTION remember() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO notification_dismissed_keys VALUES (old.event_key, old.user_id) ON CONFLICT DO NOTHING; RETURN old; END $$;
CREATE TRIGGER remember AFTER DELETE ON notifications FOR EACH ROW EXECUTE FUNCTION remember();
CREATE TABLE biometric_sync_state (
  singleton boolean PRIMARY KEY DEFAULT true, last_started_at timestamptz, last_completed_at timestamptz,
  last_status text NOT NULL DEFAULT 'NEVER_RUN', last_error text, last_result jsonb DEFAULT '{}', updated_at timestamptz);
INSERT INTO biometric_sync_state DEFAULT VALUES;
CREATE TABLE biometric_sync_requests (request_id uuid PRIMARY KEY, status text, updated_at timestamptz);
INSERT INTO biometric_sync_requests VALUES (gen_random_uuid(), 'COMMITTED', '2026-10-23 05:19+00'),
                                           (gen_random_uuid(), 'FAILED', '2026-10-23 05:20+00');

\ir ../../migrations/20261023100000_employee_erase_sync_health_joining_date.sql
\ir ../../migrations/20261023100000_employee_erase_sync_health_joining_date.sql

INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-00000000000' || n)::uuid FROM generate_series(1, 6) n;
ALTER TABLE profiles ADD CONSTRAINT p_login FOREIGN KEY (id) REFERENCES auth.users(id);
INSERT INTO profiles (id, name, role, reports_to) VALUES
  ('00000000-0000-0000-0000-000000000001', 'SA', 'SYSTEM_ADMIN', NULL),
  ('00000000-0000-0000-0000-000000000002', 'HR', 'HR', NULL),
  ('00000000-0000-0000-0000-000000000003', 'ADM', 'ADMIN', NULL),
  ('00000000-0000-0000-0000-000000000004', 'Viral  Kumar', 'EMPLOYEE', NULL),
  ('00000000-0000-0000-0000-000000000005', 'E2', 'EMPLOYEE', '00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000006', 'PA', 'EMPLOYEE', NULL);
INSERT INTO protected_system_admin_profiles VALUES ('00000000-0000-0000-0000-000000000006');

CREATE FUNCTION u(n text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM profiles WHERE name = n $$;
CREATE FUNCTION err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'no error';
EXCEPTION WHEN others THEN RETURN split_part(SQLERRM, ':', 1); END $$;
CREATE FUNCTION rows_of(n text) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(',',
    (SELECT count(*) FROM attendance_logs WHERE user_id = u(n)),
    (SELECT count(*) FROM attendance_action_requests),
    (SELECT count(*) FROM attendance_corrections WHERE user_id = u(n)),
    (SELECT count(*) FROM notifications WHERE user_id = u(n)),
    (SELECT count(*) FROM tasks WHERE assigned_to = u(n)),
    (SELECT count(*) FROM auth.users WHERE id = u(n))) $$;

-- E's own history, and other people's rows that mention E.
INSERT INTO attendance_logs (id, user_id, date) VALUES
  ('00000000-0000-0000-0000-0000000000b1', u('Viral  Kumar'), '2026-10-22'),
  ('00000000-0000-0000-0000-0000000000b2', u('Viral  Kumar'), '2026-10-23'),
  ('00000000-0000-0000-0000-0000000000b3', u('E2'), '2026-10-23');
INSERT INTO attendance_action_requests (attendance_id) VALUES ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO attendance_corrections (id, user_id, reviewed_by) VALUES
  ('00000000-0000-0000-0000-0000000000c1', u('Viral  Kumar'), u('HR')),
  ('00000000-0000-0000-0000-0000000000c2', u('E2'), u('Viral  Kumar'));
INSERT INTO attendance_corrections (user_id, parent_request_id) VALUES (u('Viral  Kumar'), '00000000-0000-0000-0000-0000000000c1');
INSERT INTO attendance_correction_events (correction_id, actor_user_id) VALUES
  ('00000000-0000-0000-0000-0000000000c1', u('Viral  Kumar')),
  ('00000000-0000-0000-0000-0000000000c2', u('Viral  Kumar'));
INSERT INTO notifications (user_id, title, event_key) VALUES (u('Viral  Kumar'), 'hi', 'k1');
INSERT INTO tasks (title, assigned_to, assigned_by) VALUES ('own', u('Viral  Kumar'), u('HR')), ('given', u('E2'), u('Viral  Kumar'));
INSERT INTO hrms_audit_events (actor_user_id, target_user_id, action, entity_type, source) VALUES
  (u('Viral  Kumar'), u('E2'), 'X', 'x', 'test'), (u('HR'), u('Viral  Kumar'), 'Y', 'y', 'test');

-- Who may erase whom
SELECT t_as(u('E2'));
SELECT t_assert('an employee cannot erase anyone', err($$SELECT rpc_admin_erase_employee(u('Viral  Kumar'), 'Viral Kumar')$$), 'PERMISSION_DENIED');
SELECT t_as(u('HR'));
SELECT t_assert('nobody erases themselves', err($$SELECT rpc_admin_erase_employee(u('HR'), 'HR')$$), 'CANNOT_DELETE_CURRENT_USER');
SELECT t_assert('HR cannot erase an admin', err($$SELECT rpc_admin_erase_employee(u('ADM'), 'ADM')$$), 'SYSTEM_ADMIN_PERMISSION_REQUIRED');
SELECT t_assert('protected admin is never erased', err($$SELECT rpc_admin_erase_employee(u('PA'), 'PA')$$), 'PROTECTED_SYSTEM_ADMIN_CANNOT_BE_DELETED');
SELECT t_assert('the typed name must match', err($$SELECT rpc_admin_erase_employee(u('Viral  Kumar'), 'Viral')$$), 'CONFIRM_NAME_MISMATCH');

-- Preview: the real erase, rolled back
SELECT t_assert('preview succeeds', (rpc_admin_erase_employee_preview(u('Viral  Kumar'))->>'ok'), 'true');
SELECT t_assert('preview counts attendance and dependent rows',
  (SELECT concat_ws(',', p->'deleted'->>'attendance_logs', p->'deleted'->>'attendance_action_requests',
                         p->'deleted'->>'attendance_corrections', p->'deleted'->>'attendance_correction_events',
                         p->'cleared'->>'tasks.assigned_by', p->'cleared'->>'attendance_correction_events.actor_user_id')
   FROM rpc_admin_erase_employee_preview(u('Viral  Kumar')) p), '2,1,2,1,1,1');
SELECT t_assert('preview changed nothing', rows_of('Viral  Kumar'), '2,1,2,1,1,1');
SELECT t_assert('guards are on after the preview',
  (SELECT string_agg(tgenabled::text, '') FROM pg_trigger WHERE tgname LIKE 'hrms_attendance_correction%'), 'OO');

-- The erase
SELECT t_assert('erase succeeds (name typed with different spacing/case)',
  (rpc_admin_erase_employee(u('Viral  Kumar'), ' viral kumar ')->>'success'), 'true');
SELECT t_assert('profile and login gone',
  (SELECT count(*)::text FROM profiles WHERE name = 'Viral  Kumar') || (SELECT count(*)::text FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000004'), '00');
SELECT t_assert('all their rows gone',
  (SELECT concat_ws(',', (SELECT count(*) FROM attendance_logs WHERE user_id = '00000000-0000-0000-0000-000000000004'),
     (SELECT count(*) FROM attendance_action_requests),
     (SELECT count(*) FROM attendance_corrections WHERE user_id = '00000000-0000-0000-0000-000000000004'),
     (SELECT count(*) FROM notifications WHERE user_id = '00000000-0000-0000-0000-000000000004'),
     (SELECT count(*) FROM notification_dismissed_keys WHERE user_id = '00000000-0000-0000-0000-000000000004'),
     (SELECT count(*) FROM tasks WHERE assigned_to = '00000000-0000-0000-0000-000000000004'))), '0,0,0,0,0,0');
SELECT t_assert('colleague keeps their rows', rows_of('E2'), '1,0,1,0,1,1');
SELECT t_assert('colleague no longer reports to the erased person', (SELECT coalesce(reports_to::text, 'none') FROM profiles WHERE name = 'E2'), 'none');
SELECT t_assert('a correction they reviewed keeps no reviewer',
  (SELECT coalesce(reviewed_by::text, 'none') FROM attendance_corrections WHERE id = '00000000-0000-0000-0000-0000000000c2'), 'none');
SELECT t_assert('a required actor goes to the person who erased',
  (SELECT actor_user_id = u('HR') FROM attendance_correction_events WHERE correction_id = '00000000-0000-0000-0000-0000000000c2')::text, 'true');
SELECT t_assert('task they gave is kept, giver cleared',
  (SELECT coalesce(assigned_by::text, 'none') FROM tasks WHERE title = 'given'), 'none');
SELECT t_assert('one audit row says who erased whom',
  (SELECT count(*)::text FROM hrms_audit_events WHERE action = 'EMPLOYEE_ERASED' AND actor_user_id = u('HR')
     AND entity_id = '00000000-0000-0000-0000-000000000004' AND old_values->>'name' = 'Viral  Kumar'), '1');
SELECT t_assert('history guards are back on',
  err($$DELETE FROM attendance_corrections WHERE id = '00000000-0000-0000-0000-0000000000c2'$$), 'PERMANENT');
SELECT t_assert('only signed-in staff can call it',
  has_function_privilege('anon', 'public.rpc_admin_erase_employee(uuid, text)', 'EXECUTE')::text
  || has_function_privilege('authenticated', 'public.hrms_erase_rows(regclass, text, integer)', 'EXECUTE')::text, 'falsefalse');

-- Sync health
SELECT t_as(NULL);
SELECT t_assert('last success taken from history', (SELECT last_success_at = '2026-10-23 05:19+00' FROM biometric_sync_state)::text, 'true');
UPDATE biometric_sync_state SET last_completed_at = '2026-10-23 05:30+00', last_status = 'FAILED', last_error = 'SMARTOFFICE_FETCH: SMARTOFFICE_HTTP_502';
UPDATE biometric_sync_state SET last_status = 'RUNNING', last_error = NULL, last_started_at = '2026-10-23 05:31+00';
UPDATE biometric_sync_state SET last_completed_at = '2026-10-23 05:31+00', last_status = 'FAILED', last_error = 'SMARTOFFICE_FETCH: SMARTOFFICE_HTTP_503';
SELECT t_assert('failures counted from the first one',
  (SELECT concat_ws('|', consecutive_failures, failing_since = '2026-10-23 05:30+00', last_failure) FROM biometric_sync_state),
  '2|t|SMARTOFFICE_FETCH: SMARTOFFICE_HTTP_503');
UPDATE biometric_sync_state SET last_completed_at = '2026-10-23 05:32+00', last_status = 'SUCCESS', last_error = NULL;
SELECT t_assert('a success resets it',
  (SELECT concat_ws('|', consecutive_failures, coalesce(failing_since::text, 'none'), last_success_at = '2026-10-23 05:32+00') FROM biometric_sync_state),
  '0|none|t');
SELECT t_as(u('HR'));
SELECT t_assert('HR reads the health', (rpc_biometric_sync_health()->>'consecutive_failures'), '0');
SELECT t_as(u('E2'));
SELECT t_assert('an employee does not', err($$SELECT rpc_biometric_sync_health()$$), 'PERMISSION_DENIED');

-- Joining date columns stay separate (20261023110000 withdraws the copy trigger)
\ir ../../migrations/20261023110000_joining_date_columns_stay_separate.sql
SELECT t_as(NULL);
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000007');
INSERT INTO profiles (id, name, date_of_joining, joining_date) VALUES ('00000000-0000-0000-0000-000000000007', 'J', NULL, '2026-09-01');
UPDATE profiles SET date_of_joining = '2024-05-02' WHERE name = 'J';
SELECT t_assert('the HR form date does not move the report start',
  (SELECT date_of_joining || ' ' || joining_date FROM profiles WHERE name = 'J'), '2024-05-02 2026-09-01');

SELECT 'PASS 10_employee_erase' AS result;
