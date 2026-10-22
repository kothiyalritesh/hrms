\set ON_ERROR_STOP 1
-- SAFETY GUARD: local throwaway test database only. NEVER run in Supabase /
-- production (this file creates mock tables and can drop/alter real data).
DO $guard$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL OR to_regclass('storage.objects') IS NOT NULL
     OR current_database() = 'postgres' THEN
    RAISE EXCEPTION 'LOCAL_TEST_DATABASE_ONLY: this test file must not run on a Supabase/production database';
  END IF;
END $guard$;
\set ON_ERROR_STOP 1
-- Checkout rule: app checkout | last biometric >= 18:30 IST | auto 20:00 IST.
-- Run after correction_mock_schema.sql + migrations through 20261006170000.
\set sys '''10000000-0000-0000-0000-000000000001'''
\set u1  '''20000000-0000-0000-0000-000000000001'''
\set u2  '''20000000-0000-0000-0000-000000000002'''
\set u3  '''20000000-0000-0000-0000-000000000003'''
\set u4  '''20000000-0000-0000-0000-000000000004'''
\set u5  '''20000000-0000-0000-0000-000000000005'''
\set u6  '''20000000-0000-0000-0000-000000000006'''

RESET ROLE;
INSERT INTO profiles(id, name, role, office_id) VALUES
 (:u1, 'Abhishek Tripathi', 'Agent', '00000000-0000-0000-0000-000000000136'),
 (:u2, 'Late Leaver',       'Agent', '00000000-0000-0000-0000-000000000136'),
 (:u3, 'App Leaver',        'Agent', '00000000-0000-0000-0000-000000000136'),
 (:u4, 'Old Bad Close',     'Agent', '00000000-0000-0000-0000-000000000136'),
 (:u5, 'Today Tapper',      'Agent', '00000000-0000-0000-0000-000000000136'),
 (:u6, 'After Eight',       'Agent', '00000000-0000-0000-0000-000000000136');

-- Past day 2026-10-02 (20:00 IST has passed)
-- u1: biometric 10:25 + 10:27 only (the reported bug)
INSERT INTO bio_punches VALUES (:u1, '2026-10-02 10:25+05:30'), (:u1, '2026-10-02 10:27+05:30');
-- u2: biometric 10:20 + 18:45
INSERT INTO bio_punches VALUES (:u2, '2026-10-02 10:20+05:30'), (:u2, '2026-10-02 18:45+05:30');
-- u3: app check-in 10:10, app checkout 17:00 (user pressed check-out)
INSERT INTO attendance_logs(user_id, date, checkin_time, app_checkin_time, checkin_source, checkout_time, checkout_source, status)
VALUES (:u3, '2026-10-02', '2026-10-02 10:10+05:30', '2026-10-02 10:10+05:30', 'APP', '2026-10-02 17:00+05:30', 'APP', 'CHECKED_OUT');
-- u4: app check-in 11:30, old job wrote SYSTEM checkout 13:03 (a midday punch)
INSERT INTO attendance_logs(user_id, date, checkin_time, app_checkin_time, checkin_source, checkout_time, checkout_source, status)
VALUES (:u4, '2026-10-02', '2026-10-02 11:30+05:30', '2026-10-02 11:30+05:30', 'APP', '2026-10-02 13:03+05:30', 'SYSTEM', 'AUTO_CHECKED_OUT');
INSERT INTO bio_punches VALUES (:u4, '2026-10-02 13:03+05:30');
-- u5: TODAY, taps at 10:25 and 10:27
INSERT INTO bio_punches VALUES
 (:u5, ((now() AT TIME ZONE 'Asia/Kolkata')::date::text || ' 10:25')::timestamp AT TIME ZONE 'Asia/Kolkata'),
 (:u5, ((now() AT TIME ZONE 'Asia/Kolkata')::date::text || ' 10:27')::timestamp AT TIME ZONE 'Asia/Kolkata');
-- u6: checked in after 20:00 on the past day
INSERT INTO attendance_logs(user_id, date, checkin_time, app_checkin_time, checkin_source, status)
VALUES (:u6, '2026-10-02', '2026-10-02 20:30+05:30', '2026-10-02 20:30+05:30', 'APP', 'CHECKED_IN');

CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.ist(t timestamptz) RETURNS text LANGUAGE sql AS $$ SELECT to_char(t AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') $$;

SELECT set_config('request.jwt.claim.sub', :sys, false); SET ROLE authenticated;
CREATE TEMP TABLE r AS SELECT * FROM rpc_attendance_canonical_range('2026-10-02', '2026-10-02');
SELECT pg_temp.expect((SELECT pg_temp.ist(official_first_in) = '10:25' AND pg_temp.ist(official_last_out) = '20:00'
                         AND last_out_source = 'AUTO_8PM' AND attendance_status = 'CHECKED_OUT' FROM r WHERE user_id = :u1),
  'Abhishek: 10:25/10:27 taps are NOT a checkout; past day closes at 20:00 AUTO');
SELECT pg_temp.expect((SELECT pg_temp.ist(official_last_out) = '18:45' AND last_out_source = 'BIOMETRIC' FROM r WHERE user_id = :u2),
  'last biometric punch after 18:30 is the checkout (18:45)');
SELECT pg_temp.expect((SELECT pg_temp.ist(official_last_out) = '17:00' AND last_out_source = 'APP' FROM r WHERE user_id = :u3),
  'app checkout counts even before 18:30 (17:00)');
SELECT pg_temp.expect((SELECT pg_temp.ist(official_last_out) = '20:00' AND last_out_source = 'AUTO_8PM' FROM r WHERE user_id = :u4),
  'old 13:03 SYSTEM close is ignored on screen -> 20:00');
SELECT pg_temp.expect((SELECT official_last_out IS NULL AND attendance_status = 'CHECKED_IN' FROM r WHERE user_id = :u6),
  'check-in after 20:00 is not auto-closed at 20:00');
DROP TABLE r;

SELECT pg_temp.expect(
  (SELECT CASE WHEN now() < (((now() AT TIME ZONE 'Asia/Kolkata')::date::text || ' 20:00')::timestamp AT TIME ZONE 'Asia/Kolkata')
               THEN official_last_out IS NULL AND attendance_status = 'CHECKED_IN'
               ELSE pg_temp.ist(official_last_out) = '20:00' END
   FROM rpc_attendance_canonical_range((now() AT TIME ZONE 'Asia/Kolkata')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date)
   WHERE user_id = :u5),
  'today: 10:25/10:27 taps keep the employee CHECKED_IN until 20:00');
RESET ROLE;

-- ===== day-end job =====
INSERT INTO attendance_logs(id, user_id, date, checkin_time, app_checkin_time, checkin_source, status) VALUES
 ('21000000-0000-0000-0000-000000000001', :u1, '2026-10-02', '2026-10-02 10:25+05:30', NULL, 'BIOMETRIC', 'CHECKED_IN'),
 ('21000000-0000-0000-0000-000000000002', :u2, '2026-10-02', '2026-10-02 10:20+05:30', NULL, 'BIOMETRIC', 'CHECKED_IN');
INSERT INTO smartoffice_device_logs(user_id, log_date, log_date_only) VALUES
 (:u1, '2026-10-02 10:25+05:30', '2026-10-02'), (:u1, '2026-10-02 10:27+05:30', '2026-10-02'),
 (:u2, '2026-10-02 10:20+05:30', '2026-10-02'), (:u2, '2026-10-02 18:45+05:30', '2026-10-02'),
 (:u4, '2026-10-02 13:03+05:30', '2026-10-02');

SELECT pg_temp.expect((public.hrms_apply_day_end_checkouts('2026-10-02')->>'closed')::int = 2, 'job closes the 2 open days');
SELECT pg_temp.expect((SELECT pg_temp.ist(checkout_time) = '20:00' AND checkout_source = 'SYSTEM' AND auto_checkout_reason LIKE 'AUTO_8PM%'
                       FROM attendance_logs WHERE id = '21000000-0000-0000-0000-000000000001'), 'job: no punch after 18:30 -> 20:00');
SELECT pg_temp.expect((SELECT pg_temp.ist(checkout_time) = '18:45' AND auto_checkout_reason LIKE 'BIOMETRIC_LAST_PUNCH_AFTER_1830%'
                       FROM attendance_logs WHERE id = '21000000-0000-0000-0000-000000000002'), 'job: biometric 18:45 -> 18:45');
SELECT pg_temp.expect((SELECT pg_temp.ist(checkout_time) = '20:00' FROM attendance_logs WHERE user_id = :u4 AND date = '2026-10-02'),
  'job: old 13:03 SYSTEM close corrected to 20:00 when that date is run');
SELECT pg_temp.expect((SELECT pg_temp.ist(checkout_time) = '17:00' AND checkout_source = 'APP' FROM attendance_logs WHERE user_id = :u3),
  'job: app checkout left untouched');
SELECT pg_temp.expect((SELECT checkout_time IS NULL FROM attendance_logs WHERE user_id = :u6), 'job: after-20:00 check-in left open');
SELECT pg_temp.expect((SELECT count(*) FROM attendance_audit_logs WHERE action = 'CHECKOUT_AUTO') = 3, 'job: one audit row per change');
SELECT pg_temp.expect((public.hrms_apply_day_end_checkouts('2026-10-02')->>'closed')::int = 0
                      AND (public.hrms_apply_day_end_checkouts('2026-10-02')->>'corrected')::int = 0, 'job: second run changes nothing');

-- later biometric punch after the 20:00 auto close is picked up by the 23:58 run
INSERT INTO smartoffice_device_logs(user_id, log_date, log_date_only) VALUES (:u1, '2026-10-02 21:10+05:30', '2026-10-02');
SELECT pg_temp.expect((public.hrms_apply_day_end_checkouts('2026-10-02')->>'corrected')::int = 1, 'job: punch at 21:10 upgrades the 20:00 auto close');
SELECT pg_temp.expect((SELECT pg_temp.ist(checkout_time) = '21:10' FROM attendance_logs WHERE id = '21000000-0000-0000-0000-000000000001'), 'job: checkout now 21:10');

-- sync wrote the FIRST punch after 18:30 (18:35); the employee punched again at 19:10
INSERT INTO profiles(id, name, role, office_id) VALUES ('20000000-0000-0000-0000-000000000007', 'Two Evening Punches', 'Agent', '00000000-0000-0000-0000-000000000136');
INSERT INTO attendance_logs(id, user_id, date, checkin_time, checkin_source, checkout_time, checkout_source, status) VALUES
 ('21000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007', '2026-10-02', '2026-10-02 10:05+05:30', 'BIOMETRIC', '2026-10-02 18:35+05:30', 'BIOMETRIC', 'CHECKED_OUT');
INSERT INTO smartoffice_device_logs(user_id, log_date, log_date_only) VALUES
 ('20000000-0000-0000-0000-000000000007', '2026-10-02 10:05+05:30', '2026-10-02'),
 ('20000000-0000-0000-0000-000000000007', '2026-10-02 18:35+05:30', '2026-10-02'),
 ('20000000-0000-0000-0000-000000000007', '2026-10-02 19:10+05:30', '2026-10-02');
SELECT public.hrms_apply_day_end_checkouts('2026-10-02');
SELECT pg_temp.expect((SELECT pg_temp.ist(checkout_time) = '19:10' FROM attendance_logs WHERE id = '21000000-0000-0000-0000-000000000007'),
  'job: sync kept first evening punch 18:35 -> upgraded to LAST punch 19:10');
\echo CHECKOUT_RULE_SCENARIOS_DONE
