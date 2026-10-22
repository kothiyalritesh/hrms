-- HR backdated corrections + employee regularization requests
-- (migration 20261014120000). Stops on the first wrong result.
\set ON_ERROR_STOP on
\ir ../../migrations/20261014120000_backdated_attendance_corrections.sql
\ir ../../migrations/20261014120000_backdated_attendance_corrections.sql

INSERT INTO offices (id, name, latitude, longitude, allowed_radius_meters)
VALUES ('00000000-0000-0000-0000-00000000000f', 'Noida HQ', 28.5355, 77.3910, 100),
       ('00000000-0000-0000-0000-0000000000ff', 'Pune', 18.52, 73.85, 100);
INSERT INTO profiles (id, name, employee_number, office_id, role, joining_date) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'HR One',   'H1', '00000000-0000-0000-0000-00000000000f', 'HR',       '2024-01-01'),
  ('00000000-0000-0000-0000-0000000000a2', 'HR Two',   'H2', '00000000-0000-0000-0000-00000000000f', 'HR',       '2024-01-01'),
  ('00000000-0000-0000-0000-0000000000a9', 'HR Pune',  'H9', '00000000-0000-0000-0000-0000000000ff', 'HR',       '2024-01-01'),
  ('00000000-0000-0000-0000-0000000000ad', 'Admin',    'A1', NULL,                                   'ADMIN',    '2024-01-01'),
  ('00000000-0000-0000-0000-0000000000a3', 'Scoped',   'S1', '00000000-0000-0000-0000-00000000000f', 'EMPLOYEE', '2024-01-01'),
  ('00000000-0000-0000-0000-0000000000a4', 'Approver', 'M1', '00000000-0000-0000-0000-00000000000f', 'MANAGER',  '2024-01-01'),
  ('00000000-0000-0000-0000-0000000000e1', 'Emp One',  'E1', '00000000-0000-0000-0000-00000000000f', 'EMPLOYEE', '2024-01-01'),
  ('00000000-0000-0000-0000-0000000000e2', 'Emp Two',  'E2', '00000000-0000-0000-0000-00000000000f', 'EMPLOYEE', '2024-01-01'),
  ('00000000-0000-0000-0000-0000000000e3', 'Emp Three','E3', '00000000-0000-0000-0000-00000000000f', 'EMPLOYEE', '2024-01-01'),
  ('00000000-0000-0000-0000-0000000000e4', 'Emp Four', 'E4', '00000000-0000-0000-0000-00000000000f', 'EMPLOYEE', '2024-01-01');
INSERT INTO user_permissions (user_id, permission) VALUES
  ('00000000-0000-0000-0000-0000000000a3', 'attendance.backdate_correct'),
  ('00000000-0000-0000-0000-0000000000a4', 'attendance.backdate_approve');

-- Working days (not Sunday, the weekly off) in the last 6 days, a recent Sunday, today (IST)
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today),
d AS (SELECT g::date AS d FROM t, generate_series(t.today - 6, t.today - 1, interval '1 day') g
      WHERE extract(dow FROM g) <> 0)
SELECT (SELECT today FROM t) AS today,
       (SELECT d FROM d ORDER BY d DESC OFFSET 0 LIMIT 1) AS w1,
       (SELECT d FROM d ORDER BY d DESC OFFSET 1 LIMIT 1) AS w2,
       (SELECT d FROM d ORDER BY d DESC OFFSET 2 LIMIT 1) AS w3,
       (SELECT d FROM d ORDER BY d DESC OFFSET 3 LIMIT 1) AS w4,
       (SELECT g::date FROM t, generate_series(t.today - 7, t.today - 1, interval '1 day') g
        WHERE extract(dow FROM g) = 0 LIMIT 1) AS sun,
       (SELECT (date_trunc('month', today) - interval '1 month' - interval '1 day')::date FROM t) AS too_old
\gset

CREATE FUNCTION t_hr(actor uuid, emp uuid, d date, cin text, cout text, ev text DEFAULT 'VERIFIED',
  ack boolean DEFAULT true, remarks text DEFAULT 'Site visit, no mobile network; verified with site manager',
  k uuid DEFAULT gen_random_uuid()) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t_as(actor);
  r := rpc_attendance_correction_submit(emp, d, 'REMOTE_SITE_VISIT', remarks,
         CASE WHEN cin IS NULL THEN NULL ELSE (d::text || ' ' || cin || '+05:30')::timestamptz END,
         CASE WHEN cout IS NULL THEN NULL ELSE (d::text || ' ' || cout || '+05:30')::timestamptz END,
         'WHATSAPP_LOCATION', 'WhatsApp from employee', ev, ack, 'v1', k, 'Site A', NULL, NULL);
  RETURN coalesce(r->>'status', r->>'error') || CASE WHEN (r->>'replayed')::boolean THEN '+replayed' ELSE '' END;
END $$;
CREATE FUNCTION t_emp(actor uuid, d date, cin text, cout text, declared boolean DEFAULT true,
  expl text DEFAULT 'At the project site, no internet so the app could not check me in',
  k uuid DEFAULT gen_random_uuid(), parent uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t_as(actor);
  r := rpc_regularization_request_submit(d,
         CASE WHEN cin IS NULL THEN NULL ELSE (d::text || ' ' || cin || '+05:30')::timestamptz END,
         CASE WHEN cout IS NULL THEN NULL ELSE (d::text || ' ' || cout || '+05:30')::timestamptz END,
         'POOR_NETWORK', expl, 'WHATSAPP_LOCATION', 'WhatsApp location to manager 09:40', declared, 'v1', k,
         'Site A', NULL, 'Live location shared 09:40 IST', parent);
  RETURN coalesce(r->>'status', r->>'error') || CASE WHEN (r->>'replayed')::boolean THEN '+replayed' ELSE '' END;
END $$;
CREATE FUNCTION t_last(emp uuid, d date) RETURNS uuid LANGUAGE sql AS
$$ SELECT id FROM attendance_corrections WHERE user_id = emp AND business_date = d ORDER BY requested_at DESC LIMIT 1 $$;
CREATE FUNCTION t_decide(actor uuid, emp uuid, d date, ok boolean, notes text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t_as(actor);
  r := rpc_attendance_correction_decide(t_last(emp, d), ok, notes);
  RETURN coalesce(r->>'status', r->>'error');
END $$;

\set HR1 '00000000-0000-0000-0000-0000000000a1'
\set HR2 '00000000-0000-0000-0000-0000000000a2'
\set SCOPED '00000000-0000-0000-0000-0000000000a3'
\set APPR '00000000-0000-0000-0000-0000000000a4'
\set E1 '00000000-0000-0000-0000-0000000000e1'
\set E2 '00000000-0000-0000-0000-0000000000e2'
\set E3 '00000000-0000-0000-0000-0000000000e3'
\set E4 '00000000-0000-0000-0000-0000000000e4'

SELECT t_assert('biometric sync keeps HR check-in (patched once)',
  (position('HRMS_KEEP_ADMIN_CHECKIN' IN pg_get_functiondef('rpc_sync_biometric_punches(jsonb)'::regprocedure)) > 0)::text, 'true');

-- ---- HR entry: who and what is refused ----
SELECT t_assert('not signed in',            t_hr(NULL,  :'E1', :'w1', '09:30', '18:15'), 'AUTHENTICATION_REQUIRED');
SELECT t_assert('employee without permission', t_hr(:'E3', :'E1', :'w1', '09:30', '18:15'), 'FORBIDDEN');
SELECT t_assert('HR corrects own attendance', t_hr(:'HR1', :'HR1', :'w1', '09:30', '18:15'), 'SELF_CORRECTION_FORBIDDEN');
SELECT t_assert('older than previous month',  t_hr(:'HR1', :'E1', :'too_old', '09:30', '18:15'), 'DATE_OUTSIDE_WINDOW');
SELECT t_assert('future date',                t_hr(:'HR1', :'E1', (:'today'::date + 1), '09:30', '18:15'), 'DATE_OUTSIDE_WINDOW');
SELECT t_assert('checkout before check-in',   t_hr(:'HR1', :'E1', :'w1', '18:00', '09:00'), 'CHECKOUT_BEFORE_CHECKIN');
SELECT t_assert('past day without checkout',  t_hr(:'HR1', :'E1', :'w1', '09:30', NULL), 'CHECKOUT_REQUIRED');
SELECT t_assert('no acknowledgement',         t_hr(:'HR1', :'E1', :'w1', '09:30', '18:15', 'VERIFIED', false), 'ACKNOWLEDGEMENT_REQUIRED');
SELECT t_assert('remarks too short',          t_hr(:'HR1', :'E1', :'w1', '09:30', '18:15', 'VERIFIED', true, 'no net'), 'REMARKS_REQUIRED');
SELECT t_assert('more than 16 hours',         t_hr(:'HR1', :'E1', :'w1', '06:00', '23:30'), 'SHIFT_TOO_LONG');

-- ---- HR entry: routine applies at once, retry is idempotent ----
SELECT t_assert('routine correction applies', t_hr(:'HR1', :'E1', :'w1', '09:30', '18:15', 'VERIFIED', true,
  'Site visit, no mobile network; verified with site manager', '11111111-1111-1111-1111-111111111111'), 'APPLIED');
SELECT t_assert('attendance row written',
  (SELECT to_char(checkin_time AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') || '-' || to_char(checkout_time AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')
          || ' ' || checkin_source || ' ' || status || ' ' || (app_checkin_time = checkin_time)
   FROM attendance_logs WHERE user_id = :'E1' AND date = :'w1'), '09:30-18:15 ADMIN ADMIN_CORRECTED true');
SELECT t_assert('audit row by HR1',
  (SELECT action || ' ' || (actor_user_id = :'HR1'::uuid) FROM attendance_audit_logs WHERE user_id = :'E1'), 'BACKDATED_CORRECTION true');
SELECT t_assert('employee notified', (SELECT title FROM test_notifications WHERE user_id = :'E1'), 'Attendance corrected');
SELECT t_assert('retry with same key is replayed', t_hr(:'HR1', :'E1', :'w1', '09:30', '18:15', 'VERIFIED', true,
  'Site visit, no mobile network; verified with site manager', '11111111-1111-1111-1111-111111111111'), 'APPLIED+replayed');
SELECT t_assert('still one correction', (SELECT count(*) FROM attendance_corrections WHERE user_id = :'E1' AND business_date = :'w1')::text, '1');

-- ---- HR entry: high risk waits; separation of duties ----
INSERT INTO attendance_logs (user_id, date, checkin_time, app_checkin_time, checkin_source, status)
VALUES (:'E2', :'w1', (:'w1'::text || ' 11:40+05:30')::timestamptz, (:'w1'::text || ' 11:40+05:30')::timestamptz, 'APP', 'CHECKED_IN');
SELECT t_assert('existing check-in -> waits', t_hr(:'HR1', :'E2', :'w1', '09:30', '18:15'), 'PENDING_APPROVAL');
SELECT t_assert('record unchanged while pending',
  (SELECT to_char(checkin_time AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') FROM attendance_logs WHERE user_id = :'E2' AND date = :'w1'), '11:40');
SELECT t_assert('second open request same day', t_hr(:'HR2', :'E2', :'w1', '09:45', '18:15'), 'PENDING_CORRECTION_EXISTS');
SELECT t_assert('submitter cannot approve', t_decide(:'HR1', :'E2', :'w1', true), 'SEPARATION_OF_DUTIES');
SELECT t_assert('employee cannot approve',  t_decide(:'E2',  :'E2', :'w1', true), 'SEPARATION_OF_DUTIES');
SELECT t_assert('no permission cannot approve', t_decide(:'E3', :'E2', :'w1', true), 'FORBIDDEN');
SELECT t_assert('other HR approves', t_decide(:'HR2', :'E2', :'w1', true), 'APPLIED');
SELECT t_assert('approved times applied',
  (SELECT to_char(checkin_time AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') || ' ' || checkin_source FROM attendance_logs WHERE user_id = :'E2' AND date = :'w1'), '09:30 ADMIN');
SELECT t_assert('cannot decide twice', t_decide(:'APPR', :'E2', :'w1', true), 'ALREADY_DECIDED');

-- ---- HR entry: weekly off + unverified -> reject needs a note; leave rules ----
SELECT t_assert('weekly off + unverified waits', t_hr(:'HR1', :'E3', :'sun', '10:00', '16:00', 'UNVERIFIED'), 'PENDING_APPROVAL');
SELECT t_assert('reject needs a note', t_decide(:'APPR', :'E3', :'sun', false), 'NOTES_REQUIRED');
SELECT t_assert('approver grant rejects', t_decide(:'APPR', :'E3', :'sun', false, 'Location screenshot does not match'), 'REJECTED');
SELECT t_assert('nothing written for rejected day', (SELECT count(*) FROM attendance_logs WHERE user_id = :'E3' AND date = :'sun')::text, '0');
INSERT INTO leave_requests (user_id, status, start_date, end_date, leave_type, is_half_day) VALUES
  (:'E3', 'approved', :'w2', :'w2', 'CL', false), (:'E3', 'approved', :'w3', :'w3', 'CL', true);
SELECT t_assert('full-day leave blocks', t_hr(:'HR1', :'E3', :'w2', '09:30', '18:15'), 'ON_APPROVED_LEAVE');
SELECT t_assert('half-day leave waits', t_hr(:'HR1', :'E3', :'w3', '09:30', '13:30'), 'PENDING_APPROVAL');
SELECT t_assert('scoped officer can submit', t_hr(:'SCOPED', :'E1', :'w2', '09:30', '18:15'), 'APPLIED');
SELECT t_assert('scoped officer cannot approve', t_decide(:'SCOPED', :'E3', :'w3', true), 'FORBIDDEN');
SELECT t_assert('approver grant approves', t_decide(:'APPR', :'E3', :'w3', true), 'APPLIED');
SELECT t_assert('same-day checkout passes the protected-checkout trigger',
  t_hr(:'HR1', :'E2', :'today',
       to_char(greatest(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 minute',
                        now() AT TIME ZONE 'Asia/Kolkata' - interval '90 minutes'), 'HH24:MI'),
       to_char(now() AT TIME ZONE 'Asia/Kolkata' - interval '1 minute', 'HH24:MI')), 'APPLIED');

-- ---- Employee requests ----
SELECT t_as(:'E4');
SELECT t_assert('policy window default', rpc_my_regularization_policy() ->> 'window_days', '7');
SELECT t_assert('older than window', t_emp(:'E4', (:'today'::date - 9), '09:30', '18:15'), 'OUTSIDE_REQUEST_WINDOW');
SELECT t_assert('future date',       t_emp(:'E4', (:'today'::date + 1), '09:30', '18:15'), 'FUTURE_DATE');
SELECT t_assert('no declaration',    t_emp(:'E4', :'w1', '09:30', '18:15', false), 'DECLARATION_REQUIRED');
SELECT t_assert('short explanation', t_emp(:'E4', :'w1', '09:30', '18:15', true, 'no net'), 'EXPLANATION_REQUIRED');
SELECT t_assert('no checkout',       t_emp(:'E4', :'w1', '09:30', NULL), 'TIMES_REQUIRED');
SELECT t_assert('valid request waits', t_emp(:'E4', :'w1', '09:30', '18:15', true,
  'At the project site, no internet so the app could not check me in', '22222222-2222-2222-2222-222222222222'), 'PENDING_APPROVAL');
SELECT t_assert('attendance unchanged until approved', (SELECT count(*) FROM attendance_logs WHERE user_id = :'E4' AND date = :'w1')::text, '0');
SELECT t_assert('admins + same-office HR notified (not other office, not employee)',
  (SELECT string_agg(p.name, ',' ORDER BY p.name) FROM test_notifications n JOIN profiles p ON p.id = n.user_id
   WHERE n.type = 'attendance_regularization_request'), 'Admin,HR One,HR Two');
SELECT t_assert('retry is replayed', t_emp(:'E4', :'w1', '09:30', '18:15', true,
  'At the project site, no internet so the app could not check me in', '22222222-2222-2222-2222-222222222222'), 'PENDING_APPROVAL+replayed');
SELECT t_assert('second open request refused', t_emp(:'E4', :'w1', '10:00', '18:15'), 'REQUEST_ALREADY_OPEN');
INSERT INTO attendance_logs (user_id, date, checkin_time, app_checkin_time, checkin_source, status)
VALUES (:'E4', :'w4', (:'w4'::text || ' 10:05+05:30')::timestamptz, (:'w4'::text || ' 10:05+05:30')::timestamptz, 'APP', 'CHECKED_IN');
SELECT t_assert('day with attendance refused', t_emp(:'E4', :'w4', '09:30', '18:15'), 'ATTENDANCE_EXISTS');

SELECT t_as(:'E4');
SELECT t_assert('employee cannot review own request',
  rpc_attendance_correction_return(t_last(:'E4', :'w1'), 'please add a photo') ->> 'error', 'FORBIDDEN');
SELECT t_as(:'HR1');
SELECT t_assert('HR returns for information',
  rpc_attendance_correction_return(t_last(:'E4', :'w1'), 'Share the site visit photo or supervisor name') ->> 'status', 'NEEDS_INFO');
SELECT t_as(:'E3');
SELECT t_assert('someone else cannot answer',
  rpc_regularization_request_respond(t_last(:'E4', :'w1'), 'hello there') ->> 'error', 'NOT_FOUND');
SELECT t_as(:'E4');
SELECT t_assert('employee answers',
  rpc_regularization_request_respond(t_last(:'E4', :'w1'), 'Supervisor confirmed; photo sent on WhatsApp') ->> 'status', 'PENDING_APPROVAL');
SELECT t_assert('HR approves', t_decide(:'HR1', :'E4', :'w1', true, 'Verified with supervisor'), 'APPLIED');
SELECT t_assert('request applied to attendance',
  (SELECT to_char(checkin_time AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') || '-' || to_char(checkout_time AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') || ' ' || checkin_source
   FROM attendance_logs WHERE user_id = :'E4' AND date = :'w1'), '09:30-18:15 ADMIN');
SELECT t_assert('employee told it was approved',
  (SELECT count(*) FROM test_notifications WHERE user_id = :'E4' AND title = 'Regularization approved')::text, '1');
SELECT t_as(:'E4');
SELECT t_assert('history in order',
  (SELECT string_agg(e->>'event_type', ',') FROM jsonb_array_elements((rpc_my_regularization_requests() -> 0) -> 'events') e),
  'SUBMITTED,RETURNED_FOR_INFO,INFO_PROVIDED,APPROVED,APPLIED');
SELECT t_assert('employee sees only own requests', jsonb_array_length(rpc_my_regularization_requests())::text, '1');

SELECT t_assert('request for rejection test', t_emp(:'E1', :'w3', '09:30', '18:15'), 'PENDING_APPROVAL');
SELECT t_assert('rejected', t_decide(:'APPR', :'E1', :'w3', false, 'No evidence matches the site'), 'REJECTED');
SELECT t_assert('linked re-request allowed', t_emp(:'E1', :'w3', '09:30', '18:15', true,
  'Appeal: supervisor confirmation from Mr. Sharma attached', gen_random_uuid(),
  (SELECT id FROM attendance_corrections WHERE user_id = :'E1' AND business_date = :'w3' AND status = 'REJECTED')), 'PENDING_APPROVAL');
SELECT t_assert('re-request flagged for reviewer',
  (SELECT risk_reasons::text FROM attendance_corrections WHERE user_id = :'E1' AND business_date = :'w3' AND status = 'PENDING_APPROVAL'),
  '["Earlier request for this day was rejected"]');
SELECT t_as(:'E1');
SELECT t_assert('employee withdraws', rpc_attendance_correction_cancel(t_last(:'E1', :'w3')) ->> 'status', 'CANCELLED');

UPDATE attendance_runtime_settings SET regularization_request_window_days = 10;
SELECT t_assert('window setting is honoured', t_emp(:'E2', (:'today'::date - 9), '09:30', '18:15'), 'PENDING_APPROVAL');

-- ---- records are permanent ----
DO $$ BEGIN
  UPDATE attendance_corrections SET remarks = 'x';
  RAISE EXCEPTION 'FAIL: correction edited outside the workflow';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  corrections cannot be edited directly'; END $$;
DO $$ BEGIN
  DELETE FROM attendance_corrections;
  RAISE EXCEPTION 'FAIL: correction deleted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  corrections cannot be deleted'; END $$;
DO $$ BEGIN
  DELETE FROM attendance_correction_events;
  RAISE EXCEPTION 'FAIL: history deleted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  history cannot be deleted'; END $$;
SELECT t_assert('clients cannot write corrections directly',
  (has_table_privilege('authenticated', 'attendance_corrections', 'INSERT')
   OR has_table_privilege('authenticated', 'attendance_corrections', 'UPDATE'))::text, 'false');
SELECT t_assert('anon cannot submit', has_function_privilege('anon',
  'rpc_regularization_request_submit(date,timestamptz,timestamptz,text,text,text,text,boolean,text,uuid,text,text,text,uuid)', 'EXECUTE')::text, 'false');

-- ---- a biometric sync after the correction keeps HR's check-in ----
SELECT rpc_sync_biometric_punches(jsonb_build_array(jsonb_build_object(
  'EmployeeCode', 'E2', 'LogDate', to_char(:'today'::date, 'YYYY-MM-DD') || ' 00:00:30', 'SerialNumber', 'D1')));
SELECT t_assert('HR check-in kept after an earlier punch',
  (SELECT checkin_source || ' ' || (biometric_first_punch IS NOT NULL) FROM attendance_logs WHERE user_id = :'E2' AND date = :'today'),
  'ADMIN true');
\echo 02_corrections_and_regularization: PASS
