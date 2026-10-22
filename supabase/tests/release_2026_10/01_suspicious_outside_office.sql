-- Suspicious attendance = check-in attempted outside the office area
-- (migration 20261014100000). Stops on the first wrong result.
\set ON_ERROR_STOP on
\ir ../../migrations/20261014100000_suspicious_only_outside_office.sql
\ir ../../migrations/20261014100000_suspicious_only_outside_office.sql

INSERT INTO offices (id, name, latitude, longitude, allowed_radius_meters, attendance_radius)
VALUES ('00000000-0000-0000-0000-00000000000f', 'Noida HQ', 28.5355, 77.3910, 100, 50);
INSERT INTO profiles (id, name, employee_number, office_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'Asha', 'E1', '00000000-0000-0000-0000-00000000000f'),
  ('00000000-0000-0000-0000-0000000000b2', 'Ravi', 'E2', '00000000-0000-0000-0000-00000000000f');

SELECT t_assert('migration applies twice (v2 patched once)',
  ((length(pg_get_functiondef('rpc_attendance_checkin_v2(uuid,jsonb)'::regprocedure))
    - length(replace(pg_get_functiondef('rpc_attendance_checkin_v2(uuid,jsonb)'::regprocedure), 'HRMS_OUTSIDE_RADIUS_SIGNAL', '')))
   / length('HRMS_OUTSIDE_RADIUS_SIGNAL'))::text, '1');
SELECT t_assert('v3 manager warning uses the office radius',
  (position('HRMS_RADIUS_MANAGER_WARNING' IN pg_get_functiondef('rpc_attendance_checkin_v3(uuid,jsonb)'::regprocedure)) > 0)::text, 'true');
SELECT t_assert('checkin_attempts accepts geo_fence_blocked and keeps old values',
  (SELECT pg_get_constraintdef(oid) LIKE '%geo_fence_blocked%' AND pg_get_constraintdef(oid) LIKE '%blocked%'
          AND pg_get_constraintdef(oid) LIKE '%success%'
   FROM pg_constraint WHERE conrelid = 'checkin_attempts'::regclass AND contype = 'c')::text, 'true');

SELECT t_as('00000000-0000-0000-0000-0000000000b1');
SELECT t_assert('normal check-in analysis records nothing',
  (rpc_analyze_attendance_fraud('00000000-0000-0000-0000-0000000000b1', NULL, 'checkin', 28.53568, 77.3910, 15) ->> 'recorded'), 'false');
SELECT t_assert('no fraud rows after a normal check-in', (SELECT count(*) FROM attendance_fraud_events)::text, '0');

-- 60 m away with 50 m GPS uncertainty: blocked (110 > 100) but the reading is inside -> not suspicious
SELECT t_assert('inside reading, poor accuracy: blocked',
  rpc_attendance_checkin_v3('00000000-0000-0000-0000-00000000000f', '{"latitude":28.536039,"longitude":77.3910,"accuracy":50}') ->> 'error',
  'OUTSIDE_OFFICE_RADIUS');
SELECT t_assert('inside reading, poor accuracy: not suspicious', (SELECT count(*) FROM attendance_fraud_events)::text, '0');
SELECT t_assert('blocked attempt is logged', (SELECT status FROM checkin_attempts ORDER BY attempted_at DESC LIMIT 1), 'geo_fence_blocked');

-- 250 m away: outside -> one SUSPICIOUS signal + HR/manager alert
SELECT t_assert('250 m: blocked',
  rpc_attendance_checkin_v3('00000000-0000-0000-0000-00000000000f', '{"latitude":28.537746,"longitude":77.3910,"accuracy":10}') ->> 'error',
  'OUTSIDE_OFFICE_RADIUS');
SELECT t_assert('250 m: suspicious signal',
  (SELECT severity || '/' || event_type FROM attendance_fraud_events), 'SUSPICIOUS/OUTSIDE_OFFICE_RADIUS');
SELECT t_assert('250 m: HR alerted', (SELECT count(*) FROM test_notifications)::text, '1');
SELECT t_assert('300 m: blocked',
  rpc_attendance_checkin_v2('00000000-0000-0000-0000-00000000000f', '{"latitude":28.538195,"longitude":77.3910,"accuracy":10}') ->> 'error',
  'OUTSIDE_OFFICE_RADIUS');
SELECT t_assert('same day again: still one entry', (SELECT count(*) FROM attendance_fraud_events)::text, '1');

-- Attempt blocked on the phone, reported by the app
SELECT t_as('00000000-0000-0000-0000-0000000000b2');
SELECT t_assert('report 40 m: not recorded',
  rpc_report_outside_office_checkin('00000000-0000-0000-0000-00000000000f', '{"latitude":28.535859,"longitude":77.3910,"accuracy":70}') ->> 'recorded', 'false');
SELECT t_assert('report with 150 m accuracy: ignored',
  rpc_report_outside_office_checkin('00000000-0000-0000-0000-00000000000f', '{"latitude":28.539992,"longitude":77.3910,"accuracy":150}') ->> 'reason', 'GPS_NOT_PRECISE');
SELECT t_assert('report 499 m: recorded',
  rpc_report_outside_office_checkin('00000000-0000-0000-0000-00000000000f', '{"latitude":28.539992,"longitude":77.3910,"accuracy":20}') ->> 'recorded', 'true');
SELECT t_as(NULL);
SELECT t_assert('report without sign-in refused',
  rpc_report_outside_office_checkin('00000000-0000-0000-0000-00000000000f', '{"latitude":28.539992,"longitude":77.3910,"accuracy":20}') ->> 'error', 'AUTHENTICATION_REQUIRED');
SELECT t_assert('anon cannot execute the report RPC',
  has_function_privilege('anon', 'rpc_report_outside_office_checkin(uuid,jsonb)', 'EXECUTE')::text, 'false');
\echo 01_suspicious_outside_office: PASS
