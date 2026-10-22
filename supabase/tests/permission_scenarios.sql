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
-- ids
\set o136 '''00000000-0000-0000-0000-000000000136'''
\set o63  '''00000000-0000-0000-0000-000000000063'''
\set tA   '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set tB   '''aaaaaaaa-0000-0000-0000-00000000000b'''
\set tC   '''aaaaaaaa-0000-0000-0000-00000000000c'''
\set sys  '''10000000-0000-0000-0000-000000000001'''
\set hr   '''10000000-0000-0000-0000-000000000002'''
\set mgr  '''10000000-0000-0000-0000-000000000003'''
\set th   '''10000000-0000-0000-0000-000000000004'''
\set e1   '''10000000-0000-0000-0000-000000000011'''
\set e2   '''10000000-0000-0000-0000-000000000012'''
\set e3   '''10000000-0000-0000-0000-000000000013'''
\set bday '''10000000-0000-0000-0000-000000000005'''
\set lead '''10000000-0000-0000-0000-000000000006'''

RESET ROLE;
INSERT INTO offices(id,name) VALUES (:o136,'Noida 136'),(:o63,'Sector 63');
INSERT INTO teams(id,name,office_id) VALUES (:tA,'Sales North',:o136),(:tB,'Team B',:o136),(:tC,'Team C',:o63);
UPDATE teams SET parent_id = :tA WHERE id = :tB;
INSERT INTO profiles(id,name,role,office_id,team_id,department,reports_to) VALUES
 (:sys,'Sys','SYSTEM_ADMIN',:o136,NULL,'IT',NULL),
 (:hr,'Hr','HR',:o136,NULL,'HR',NULL),
 (:mgr,'Mgr136','EMPLOYEE',:o136,NULL,'Ops',NULL),
 (:th,'TeamHead','EMPLOYEE',:o136,:tA,'Sales',NULL),
 (:lead,'Lead','EMPLOYEE',:o63,:tC,'Sales',NULL),
 (:e1,'Emp1','EMPLOYEE',:o136,:tA,'Sales',:th),
 (:e2,'Emp2','EMPLOYEE',:o136,:tB,'Sales',:e1),
 (:e3,'Emp3','EMPLOYEE',:o63,:tC,'Sales',:lead),
 (:bday,'Bday','EMPLOYEE',:o63,:tC,'Admin',NULL);
INSERT INTO permissions(permission_key,module,action) VALUES ('screen.birthday_management','SCREENS','view'),('employee.create','EMPLOYEE','create')
ON CONFLICT DO NOTHING;
-- legacy row the old UI could have stored: TEAM with a lead's profile id
INSERT INTO user_permissions(user_id,permission,scope,scope_id) VALUES (:lead,'attendance.view','TEAM',:lead);

CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect(boolean, text) TO authenticated;

-- re-run the engine migration so the legacy TEAM(lead id) row is converted
\i 'supabase/migrations/20261006120000_scope_permission_engine.sql'
SELECT pg_temp.expect((SELECT scope::text FROM user_permissions WHERE user_id = :lead AND revoked_at IS NULL) = 'REPORTS_TO', 'legacy TEAM(lead id) converted to REPORTS_TO');

-- ===== as System Admin: grant via RPC =====
SELECT set_config('request.jwt.claim.sub', :sys, false); SET ROLE authenticated;
SELECT pg_temp.expect((admin_grant_permission(:mgr::uuid,'attendance.view','OFFICE',:o136,'office mgr')->>'success')::boolean, 'S3 grant OFFICE 136 works (old CHECK removed)');
SELECT pg_temp.expect((admin_grant_permission(:mgr::uuid,'attendance.view','OFFICE',:o136)->>'existing')::boolean, 'duplicate grant is idempotent');
SELECT pg_temp.expect((admin_grant_permission(:th::uuid,'attendance.view','TEAM_TREE',:tA)->>'success')::boolean, 'grant TEAM_TREE');
SELECT pg_temp.expect((admin_grant_permission(:bday::uuid,'screen.birthday_management','GLOBAL')->>'success')::boolean, 'grant harmless key');
SELECT pg_temp.expect(NOT (admin_grant_permission(:mgr::uuid,'attendance.view','OFFICE','not-a-uuid')->>'success')::boolean, 'invalid office id rejected');
SELECT pg_temp.expect(NOT (admin_grant_permission(:mgr::uuid,'no.such.key','GLOBAL')->>'success')::boolean, 'unknown key rejected');
SELECT pg_temp.expect((SELECT count(*) FROM rpc_attendance_canonical_range('2026-09-01','2026-09-30')) = 9*30, 'S1 sysadmin sees all 9 employees x 30 days');
SELECT pg_temp.expect((explain_access(:mgr::uuid,'attendance.view',:e1::uuid)->>'allowed')::boolean, 'simulator: mgr -> emp1 ALLOW');
SELECT pg_temp.expect(NOT (explain_access(:mgr::uuid,'attendance.view',:e3::uuid)->>'allowed')::boolean
  AND explain_access(:mgr::uuid,'attendance.view',:e3::uuid)->>'reason' = 'TARGET_OUTSIDE_SCOPE', 'simulator: mgr -> emp3 DENY TARGET_OUTSIDE_SCOPE');
SELECT pg_temp.expect(jsonb_array_length(get_user_permission_grants(:mgr::uuid)->'grants') = 1, 'effective access lists 1 grant');
SELECT pg_temp.expect((SELECT count(*) FROM permission_audit_logs WHERE action = 'GRANT') >= 3, 'grants audited');
RESET ROLE;

-- ===== HR: data admin but NOT permission admin =====
SELECT set_config('request.jwt.claim.sub', :hr, false); SET ROLE authenticated;
SELECT pg_temp.expect(is_profile_admin(), 'HR is data admin');
SELECT pg_temp.expect(NOT (admin_grant_permission(:e1::uuid,'attendance.view','GLOBAL')->>'success')::boolean, 'HR cannot grant permissions');
RESET ROLE;

-- ===== office-scoped manager =====
SELECT set_config('request.jwt.claim.sub', :mgr, false); SET ROLE authenticated;
SELECT pg_temp.expect(NOT is_profile_admin(), 'scoped grant is NOT admin (SEC-02 fixed)');
SELECT pg_temp.expect((SELECT array_agg(DISTINCT employee_name ORDER BY employee_name) FROM rpc_attendance_canonical_range('2026-09-01','2026-09-02'))
   = ARRAY['Emp1','Emp2','Hr','Mgr136','Sys','TeamHead'], 'S2 office 136 only');
SELECT pg_temp.expect((SELECT count(*) FROM rpc_attendance_canonical_range('2026-09-01','2026-09-02', :o63::uuid)) = 0, 'S10 bypass: asking for office 63 returns nothing');
SELECT pg_temp.expect(can_access_user_data(:e1::uuid,'attendance.view') AND NOT can_access_user_data(:e3::uuid,'attendance.view'), 'can_access_user_data office rule');
SELECT pg_temp.expect(NOT (admin_grant_permission(:mgr::uuid,'attendance.view','GLOBAL')->>'success')::boolean, 'cannot self-escalate via RPC');
DO $$ BEGIN
  BEGIN
    INSERT INTO user_permissions(user_id,permission,scope) VALUES (auth.uid(),'attendance.view','GLOBAL');
    RAISE EXCEPTION 'FAIL: direct insert into user_permissions allowed';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: direct self-grant blocked by RLS'; END;
END $$;
RESET ROLE;

-- ===== team tree =====
SELECT set_config('request.jwt.claim.sub', :th, false); SET ROLE authenticated;
SELECT pg_temp.expect((SELECT array_agg(DISTINCT employee_name ORDER BY employee_name) FROM rpc_attendance_canonical_range('2026-09-01','2026-09-01'))
   = ARRAY['Emp1','Emp2','TeamHead'], 'S5 TEAM_TREE: Sales North + child Team B, not Team C');
RESET ROLE;

-- ===== reports_to (converted legacy grant) =====
SELECT set_config('request.jwt.claim.sub', :lead, false); SET ROLE authenticated;
SELECT pg_temp.expect((SELECT array_agg(DISTINCT employee_name ORDER BY employee_name) FROM rpc_attendance_canonical_range('2026-09-01','2026-09-01'))
   = ARRAY['Emp3','Lead'], 'REPORTS_TO: lead sees own report chain');
RESET ROLE;

-- ===== harmless key only =====
SELECT set_config('request.jwt.claim.sub', :bday, false); SET ROLE authenticated;
SELECT pg_temp.expect(NOT is_profile_admin(), 'S8 birthday key holder is not admin');
SELECT pg_temp.expect((SELECT array_agg(DISTINCT employee_name) FROM rpc_attendance_canonical_range('2026-09-01','2026-09-03')) = ARRAY['Bday'], 'S6 self only');
SELECT pg_temp.expect((SELECT count(*) FROM rpc_attendance_canonical_range('2026-09-01','2026-09-03', NULL, NULL, :e1::uuid)) = 0, 'asking for another user returns nothing');
SELECT pg_temp.expect((SELECT count(*) FROM rpc_my_attendance_daily_v3('2026-09-01','2026-09-03')) = 3, 'rpc_my_attendance_daily_v3 still works through wrapper');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM user_permissions WHERE user_id <> auth.uid()), 'cannot read others grants');
RESET ROLE;

-- ===== transfer: emp1 moves to office 63 =====
UPDATE profiles SET office_id = :o63, team_id = :tC WHERE id = :e1;
SELECT set_config('request.jwt.claim.sub', :mgr, false); SET ROLE authenticated;
SELECT pg_temp.expect(NOT can_access_user_data(:e1::uuid,'attendance.view'), 'S12 office transfer removes access automatically');
RESET ROLE;

-- ===== revoke =====
SELECT set_config('request.jwt.claim.sub', :sys, false); SET ROLE authenticated;
SELECT pg_temp.expect((admin_revoke_permission(:mgr::uuid,'attendance.view')->>'revoked')::int = 1, 'S14 revoke (2-arg call is unambiguous)');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :mgr, false); SET ROLE authenticated;
SELECT pg_temp.expect((SELECT array_agg(DISTINCT employee_name) FROM rpc_attendance_canonical_range('2026-09-01','2026-09-01')) = ARRAY['Mgr136'], 'after revoke: own rows only');
RESET ROLE;
SELECT pg_temp.expect((SELECT count(*) FROM permission_audit_logs WHERE action = 'REVOKE') >= 1, 'revoke audited');

-- ===== anon =====
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM rpc_sync_biometric_punches('{}'); RAISE EXCEPTION 'FAIL: anon can call biometric sync';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon blocked from biometric sync'; END;
  BEGIN PERFORM * FROM user_permission_overrides; RAISE EXCEPTION 'FAIL: anon reads overrides';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon blocked from user_permission_overrides'; END;
  BEGIN PERFORM rpc_attendance_canonical_range('2026-09-01','2026-09-01'); RAISE EXCEPTION 'FAIL: anon calls canonical range';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon blocked from canonical range'; END;
END $$;
RESET ROLE;

-- ===== regularization =====
INSERT INTO attendance_logs(id,user_id,date,checkin_time,status) VALUES ('20000000-0000-0000-0000-000000000001', :e2, '2026-09-10', '2026-09-10 04:50+00', 'CHECKED_IN');
INSERT INTO attendance_regularization_requests(id,user_id,attendance_id,status,requested_checkout,reason)
 VALUES ('30000000-0000-0000-0000-000000000001', :e2, '20000000-0000-0000-0000-000000000001','PENDING','2026-09-10 13:30+00','forgot'),
        ('30000000-0000-0000-0000-000000000002', :hr,  '20000000-0000-0000-0000-000000000001','PENDING','2026-09-10 13:30+00','self');
SELECT set_config('request.jwt.claim.sub', :hr, false); SET ROLE authenticated;
SELECT pg_temp.expect(rpc_review_attendance_regularization('30000000-0000-0000-0000-000000000002', NULL, true)->>'error' = 'SELF_REVIEW_FORBIDDEN', 'cannot approve own request');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :bday, false); SET ROLE authenticated;
SELECT pg_temp.expect(rpc_review_attendance_regularization('30000000-0000-0000-0000-000000000001', NULL, true)->>'error' = 'FORBIDDEN', 'out-of-scope reviewer forbidden');
SELECT pg_temp.expect((rpc_admin_list_attendance_regularization('PENDING')->>'total')::int = 0, 'out-of-scope user sees no requests');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :hr, false); SET ROLE authenticated;
SELECT pg_temp.expect((rpc_review_attendance_regularization('30000000-0000-0000-0000-000000000001', NULL, true)->>'success')::boolean, 'HR approves in-scope request');
RESET ROLE;
SELECT pg_temp.expect((SELECT source FROM attendance_audit_logs ORDER BY id DESC LIMIT 1) = 'REGULARIZATION', 'approval audited');

-- ===== late default =====
SELECT pg_temp.expect((SELECT column_default FROM information_schema.columns WHERE table_name='attendance_policies' AND column_name='late_checkin_time') LIKE '''10:32%', 'late default is 10:32');

-- ===== overloads =====
SELECT pg_temp.expect((SELECT count(*) FROM pg_proc WHERE proname='rpc_attendance_canonical_range') = 1, 'exactly one canonical range overload');
SELECT pg_temp.expect((SELECT count(*) FROM pg_proc WHERE proname='admin_revoke_permission') = 1, 'exactly one revoke overload');
SELECT pg_temp.expect((SELECT count(*) FROM pg_proc WHERE proname='is_profile_admin') = 1, 'is_profile_admin(uuid) draft overload removed');
\echo ALL_SCENARIOS_DONE
