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
\set sys  '''10000000-0000-0000-0000-000000000001'''
\set hr   '''10000000-0000-0000-0000-000000000002'''
\set bday '''10000000-0000-0000-0000-000000000005'''
\set kir  '''10000000-0000-0000-0000-000000000099'''
\set log  '''40000000-0000-0000-0000-000000000001'''

RESET ROLE;
INSERT INTO profiles(id, name, role, office_id) VALUES (:kir, 'Kiranpal Singh', 'EMPLOYEE', '00000000-0000-0000-0000-000000000136');
-- app check-in 10:22 IST, single biometric punch 10:16 IST
INSERT INTO attendance_logs(id, user_id, date, checkin_time, app_checkin_time, checkin_source, status)
VALUES (:log, :kir, '2026-10-05', '2026-10-05T04:52:21+00', '2026-10-05T04:52:21+00', 'APP', 'CHECKED_IN');
INSERT INTO bio_punches VALUES (:kir, '2026-10-05T04:46:26+00');

CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;

-- canonical row as an admin sees it
SELECT set_config('request.jwt.claim.sub', :sys, false); SET ROLE authenticated;
SELECT pg_temp.expect(
  (SELECT official_first_in = '2026-10-05T04:46:26+00' AND first_in_source = 'BIOMETRIC'
     AND official_last_out = '2026-10-05 20:00+05:30' AND last_out_source = 'AUTO_8PM'
   FROM rpc_attendance_canonical_range('2026-10-05','2026-10-05', NULL, NULL, :kir::uuid)),
  'Kiranpal: first-in = earliest punch 10:16; single punch is NOT a checkout; past day auto-closes at 20:00');
RESET ROLE;

-- employee spoofing p_admin_id
SELECT set_config('request.jwt.claim.sub', :bday, false); SET ROLE authenticated;
SELECT pg_temp.expect(rpc_admin_correct_attendance(:sys::uuid, :log::uuid, NULL, '2026-10-05T12:30:00+00', NULL, 'spoof')->>'error' = 'FORBIDDEN',
  'employee passing an admin id is FORBIDDEN (old RPC trusted it)');
RESET ROLE;

-- employee correcting own record
SELECT set_config('request.jwt.claim.sub', :kir, false); SET ROLE authenticated;
SELECT pg_temp.expect(rpc_admin_correct_attendance(NULL, :log::uuid, NULL, '2026-10-05T12:30:00+00', NULL, 'mine')->>'error' = 'SELF_CORRECTION_FORBIDDEN',
  'self correction forbidden');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', :hr, false); SET ROLE authenticated;
SELECT pg_temp.expect(rpc_admin_correct_attendance(NULL, :log::uuid, NULL, '2026-10-05T04:46:26+00', NULL, 'bad')->>'error' = 'CHECKOUT_BEFORE_CHECKIN',
  'checkout 10:16 before check-in 10:22 rejected');
SELECT pg_temp.expect(rpc_admin_correct_attendance(NULL, :log::uuid, '2026-10-09T04:00:00+00', NULL, NULL, 'wrong day')->>'error' = 'CHECKIN_WRONG_DAY',
  'check-in on another IST day rejected');
SELECT pg_temp.expect(rpc_admin_correct_attendance(NULL, :log::uuid, NULL, NULL, NULL, 'none')->>'error' = 'NOTHING_TO_CHANGE',
  'empty correction rejected');
SELECT pg_temp.expect((rpc_admin_correct_attendance(NULL, :log::uuid, '2026-10-05T05:10:00+00', '2026-10-05T12:45:00+00', NULL, 'App failed; arrived 10:40 per guard register')->>'success')::boolean,
  'HR correction 10:40 -> 18:15 IST saved');
RESET ROLE;

SELECT pg_temp.expect((SELECT is_late FROM attendance_logs WHERE id = :log), 'late recomputed: 10:40 >= 10:32 -> LATE');
SELECT pg_temp.expect((SELECT checkin_source = 'ADMIN' AND checkout_source = 'ADMIN' FROM attendance_logs WHERE id = :log), 'sources marked ADMIN');
SELECT pg_temp.expect((SELECT old_checkin_at = '2026-10-05T04:52:21+00' AND new_checkin_at = '2026-10-05T05:10:00+00'
                       FROM attendance_audit_logs WHERE action = 'ADMIN_CORRECT' ORDER BY id DESC LIMIT 1), 'audit keeps old and new check-in');

SELECT set_config('request.jwt.claim.sub', :sys, false); SET ROLE authenticated;
SELECT pg_temp.expect(
  (SELECT official_first_in = '2026-10-05T05:10:00+00' AND first_in_source = 'ADMIN_CORRECTED'
     AND official_last_out = '2026-10-05T12:45:00+00' AND working_minutes = 455 AND attendance_status = 'CHECKED_OUT'
   FROM rpc_attendance_canonical_range('2026-10-05','2026-10-05', NULL, NULL, :kir::uuid)),
  'reports show the corrected times (admin correction beats earlier biometric punch), 455 min');
RESET ROLE;

-- 10:31:59 vs 10:32:00 boundary through the correction path
SELECT set_config('request.jwt.claim.sub', :hr, false); SET ROLE authenticated;
SELECT rpc_admin_correct_attendance(NULL, :log::uuid, '2026-10-05T05:01:59+00', NULL, NULL, 'boundary 10:31:59');
RESET ROLE;
SELECT pg_temp.expect((SELECT NOT is_late FROM attendance_logs WHERE id = :log), '10:31:59 IST is on time');
SELECT set_config('request.jwt.claim.sub', :hr, false); SET ROLE authenticated;
SELECT rpc_admin_correct_attendance(NULL, :log::uuid, '2026-10-05T05:02:00+00', NULL, NULL, 'boundary 10:32:00');
RESET ROLE;
SELECT pg_temp.expect((SELECT is_late FROM attendance_logs WHERE id = :log), '10:32:00 IST is late');
\echo CORRECTION_SCENARIOS_DONE
