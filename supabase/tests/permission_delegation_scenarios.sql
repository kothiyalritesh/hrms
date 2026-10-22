\set ON_ERROR_STOP 1
-- SAFETY GUARD: local throwaway test database only. NEVER run in Supabase /
-- production (this file creates mock tables and can drop/alter real data).
DO $guard$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL OR to_regclass('storage.objects') IS NOT NULL
     OR current_database() = 'postgres' THEN
    RAISE EXCEPTION 'LOCAL_TEST_DATABASE_ONLY: this test file must not run on a Supabase/production database';
  END IF;
END $guard$;
-- Scenarios for 20261007120000_permission_delegation.sql
\set QUIET on
\set A  '''c0000000-0000-0000-0000-000000000001'''
\set M  '''c0000000-0000-0000-0000-000000000002'''
\set E1 '''c0000000-0000-0000-0000-000000000003'''
\set E2 '''c0000000-0000-0000-0000-000000000004'''
\set E3 '''c0000000-0000-0000-0000-000000000005'''
\set N  '''c0000000-0000-0000-0000-000000000006'''
\set HR '''c0000000-0000-0000-0000-000000000007'''
\set O1 '''d0000000-0000-0000-0000-000000000001'''
\set O2 '''d0000000-0000-0000-0000-000000000002'''

INSERT INTO public.offices (id, name) VALUES (:O1, 'Noida'), (:O2, 'Gurgaon');
INSERT INTO public.profiles (id, name, role, office_id) VALUES
  (:A, 'Admin', 'ADMIN', :O1), (:M, 'Manager', 'EMPLOYEE', :O1), (:E1, 'Emp1', 'EMPLOYEE', :O1),
  (:E2, 'Emp2', 'EMPLOYEE', :O1), (:E3, 'Emp3', 'EMPLOYEE', :O2), (:N, 'Nobody', 'EMPLOYEE', :O1),
  (:HR, 'HR person', 'HR', :O1);
-- M: delegated Noida manager
INSERT INTO public.user_permissions (user_id, permission, scope, scope_id) VALUES
  (:M, 'leave.balance.manage', 'OFFICE', :O1), (:M, 'leave.approve', 'OFFICE', :O1),
  (:M, 'employees.manage', 'OFFICE', :O1), (:M, 'attendance.calendar.manage', 'GLOBAL', NULL),
  (:M, 'live_tracking.view', 'OFFICE', :O1), (:M, 'field_visits.view', 'OFFICE', :O1),
  (:M, 'leave.view', 'OFFICE', :O1);
INSERT INTO public.leave_requests (id, user_id, status) VALUES
  ('e0000000-0000-0000-0000-000000000001', :E1, 'pending'),
  ('e0000000-0000-0000-0000-000000000002', :M, 'pending'),
  ('e0000000-0000-0000-0000-000000000003', :E3, 'pending');
INSERT INTO public.location_alerts (id, user_id) VALUES ('f0000000-0000-0000-0000-000000000001', :E3);
INSERT INTO public.field_visits (user_id, date) VALUES (:E1, current_date), (:E3, current_date);

CREATE TEMP TABLE r (name text, pass boolean, detail text);
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claim.sub', p::text, false) $$;

CREATE FUNCTION pg_temp.try(p_name text, p_sql text, p_expect text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v;
    INSERT INTO r VALUES (p_name, p_expect = 'OK', coalesce(v, 'null'));
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (p_name, SQLERRM LIKE p_expect || '%', SQLERRM);
  END;
END $$;

-- admin path unchanged
SELECT pg_temp.as_user(:A);
SELECT pg_temp.try('admin_summary_all', $$SELECT count(*)::text FROM public.rpc_admin_leave_balance_summary()$$, 'OK');
INSERT INTO r SELECT 'admin_summary_sees_everyone', (SELECT count(*) FROM public.rpc_admin_leave_balance_summary()) = (SELECT count(*) FROM public.profiles), NULL;
SELECT pg_temp.try('admin_site_create_fixed',
  $$SELECT public.rpc_admin_mutate_configuration('SITE','CREATE',NULL,'{"project_name":"P","site_label":"S","latitude":"28.5","longitude":"77.3","checkin_radius_m":"150"}')::text$$, 'OK');

-- delegated manager, in scope
SELECT pg_temp.as_user(:M);
INSERT INTO r SELECT 'delegated_summary_scoped',
  (SELECT array_agg(employee_name ORDER BY employee_name) FROM public.rpc_admin_leave_balance_summary()
     WHERE user_id::text LIKE 'c0000000%')
    = ARRAY['Admin','Emp1','Emp2','HR person','Manager','Nobody']
  AND NOT EXISTS (SELECT 1 FROM public.rpc_admin_leave_balance_summary() WHERE user_id = 'c0000000-0000-0000-0000-000000000005'),
  (SELECT string_agg(employee_name, ',') FROM public.rpc_admin_leave_balance_summary());
SELECT pg_temp.try('delegated_adjust_in_scope',
  $$SELECT public.rpc_admin_adjust_leave_balance('c0000000-0000-0000-0000-000000000003','CASUAL',1,'bonus',gen_random_uuid())::text$$, 'OK');
SELECT pg_temp.try('delegated_adjust_out_of_scope',
  $$SELECT public.rpc_admin_adjust_leave_balance('c0000000-0000-0000-0000-000000000005','CASUAL',1,'bonus',gen_random_uuid())::text$$, 'TARGET_OUTSIDE_SCOPE');
SELECT pg_temp.try('delegated_approve_in_scope',
  $$SELECT public.rpc_review_leave_request('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',true)::text$$, 'OK');
SELECT pg_temp.try('delegated_cannot_approve_own',
  $$SELECT public.rpc_review_leave_request('e0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002',true)::text$$, 'NOT_ALLOWED_FOR_DELEGATED_USER');
SELECT pg_temp.try('delegated_approve_out_of_scope',
  $$SELECT public.rpc_review_leave_request('e0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000002',true)::text$$, 'TARGET_OUTSIDE_SCOPE');
SELECT pg_temp.try('delegated_create_employee_own_office',
  $$SELECT public.rpc_admin_save_profile(NULL, '{"name":"New","role":"EMPLOYEE","office_id":"d0000000-0000-0000-0000-000000000001"}')::text$$, 'OK');
SELECT pg_temp.try('delegated_create_in_other_office',
  $$SELECT public.rpc_admin_save_profile(NULL, '{"name":"New2","role":"EMPLOYEE","office_id":"d0000000-0000-0000-0000-000000000002"}')::text$$, 'NOT_ALLOWED_FOR_DELEGATED_USER');
SELECT pg_temp.try('delegated_cannot_create_admin',
  $$SELECT public.rpc_admin_save_profile(NULL, '{"name":"Boss","role":"ADMIN","office_id":"d0000000-0000-0000-0000-000000000001"}')::text$$, 'NOT_ALLOWED_FOR_DELEGATED_USER');
SELECT pg_temp.try('delegated_cannot_edit_hr',
  $$SELECT public.rpc_admin_save_profile('c0000000-0000-0000-0000-000000000007', '{"name":"x","role":"EMPLOYEE","office_id":"d0000000-0000-0000-0000-000000000001"}')::text$$, 'NOT_ALLOWED_FOR_DELEGATED_USER');
SELECT pg_temp.try('delegated_cannot_deactivate_self',
  $$SELECT public.rpc_admin_set_profile_active('c0000000-0000-0000-0000-000000000002', false)::text$$, 'NOT_ALLOWED_FOR_DELEGATED_USER');
SELECT pg_temp.try('delegated_holiday_create',
  $$SELECT public.rpc_admin_mutate_configuration('HOLIDAY','CREATE',NULL,'{"holiday_date":"2026-11-01","name":"Diwali"}')::text$$, 'OK');
SELECT pg_temp.try('delegated_no_office_permission',
  $$SELECT public.rpc_admin_mutate_configuration('OFFICE','SET_RADIUS','d0000000-0000-0000-0000-000000000001','{"attendance_radius":"200"}')::text$$, 'PERMISSION_REQUIRED');
SELECT pg_temp.try('delegated_alert_out_of_scope',
  $$SELECT public.rpc_admin_resolve_location_alert('f0000000-0000-0000-0000-000000000001')::text$$, 'TARGET_OUTSIDE_SCOPE');
SELECT pg_temp.try('delegated_pings_mixed_scope',
  $$SELECT public.rpc_admin_request_location_pings(ARRAY['c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000005']::uuid[])::text$$, 'TARGET_OUTSIDE_SCOPE');
SELECT pg_temp.try('delegated_no_teams_permission',
  $$SELECT public.rpc_admin_update_hierarchy_v2('[1]')::text$$, 'PERMISSION_REQUIRED');
SELECT pg_temp.try('flag_not_left_behind',
  $$SELECT public.require_profile_admin()$$, 'ADMIN_PERMISSION_REQUIRED');
SELECT pg_temp.try('observer_canonical_key',
  $$SELECT public.get_site_visit_observer_data(current_date)::text$$, 'OK');
INSERT INTO r SELECT 'observer_scoped_count',
  (public.get_site_visit_observer_data(current_date)->>'visible')::int = 1,
  public.get_site_visit_observer_data(current_date)::text;

-- no permission at all
SELECT pg_temp.as_user(:N);
SELECT pg_temp.try('nobody_summary_denied', $$SELECT count(*)::text FROM public.rpc_admin_leave_balance_summary()$$, 'PERMISSION_REQUIRED');
SELECT pg_temp.try('nobody_geofence_report_denied', $$SELECT public.rpc_geofence_report(current_date, current_date)::text$$, 'PERMISSION_REQUIRED');
SELECT pg_temp.try('nobody_holiday_denied',
  $$SELECT public.rpc_admin_mutate_configuration('HOLIDAY','CREATE',NULL,'{"holiday_date":"2026-11-02","name":"x"}')::text$$, 'PERMISSION_REQUIRED');

-- HR (data admin) keeps everything
SELECT pg_temp.as_user(:HR);
SELECT pg_temp.try('hr_office_radius', $$SELECT public.rpc_admin_mutate_configuration('OFFICE','SET_RADIUS','d0000000-0000-0000-0000-000000000001','{"attendance_radius":"200"}')::text$$, 'OK');

-- RLS: scoped manager reads leave_requests of Noida only (as the real API role)
RESET request.jwt.claim.sub;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', false);
INSERT INTO r SELECT 'rls_scoped_leave_rows',
  (SELECT count(*) FROM public.leave_requests) = 2,
  (SELECT string_agg(user_id::text, ',') FROM public.leave_requests);
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000006', false);
INSERT INTO r SELECT 'rls_nobody_sees_nothing', (SELECT count(*) FROM public.leave_requests) = 0, NULL;
RESET ROLE;
RESET request.jwt.claim.sub;

\set QUIET off
SELECT name, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, left(coalesce(detail,''), 150) AS detail FROM r ORDER BY name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE pass IS NOT TRUE) AS failed FROM r;
SELECT 'DELEGATION_SCENARIOS_DONE';
