\set ON_ERROR_STOP 1
-- SAFETY GUARD: local throwaway test database only. NEVER run in Supabase /
-- production (this file creates mock tables and can drop/alter real data).
DO $guard$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL OR to_regclass('storage.objects') IS NOT NULL
     OR current_database() = 'postgres' THEN
    RAISE EXCEPTION 'LOCAL_TEST_DATABASE_ONLY: this test file must not run on a Supabase/production database';
  END IF;
END $guard$;
-- Scenarios for 20261007100000_permission_engine_v2 + 20261007110000_scoped_admin_surface.
-- Run after: permission_mock_legacy_schema.sql, 20261006100000, 110000, 120000,
-- permission_v2_mock_extra.sql, 20261007100000, 20261007110000 (see run_permission_tests.sh).
\set QUIET on

\set A  '''a0000000-0000-0000-0000-000000000001'''
\set H  '''a0000000-0000-0000-0000-000000000002'''
\set L  '''a0000000-0000-0000-0000-000000000003'''
\set E1 '''a0000000-0000-0000-0000-000000000004'''
\set E2 '''a0000000-0000-0000-0000-000000000005'''
\set E3 '''a0000000-0000-0000-0000-000000000006'''
\set X  '''a0000000-0000-0000-0000-000000000007'''
\set Y  '''a0000000-0000-0000-0000-000000000008'''
\set Z  '''a0000000-0000-0000-0000-000000000009'''
\set N  '''a0000000-0000-0000-0000-000000000010'''
\set O1 '''b0000000-0000-0000-0000-000000000001'''
\set O2 '''b0000000-0000-0000-0000-000000000002'''

INSERT INTO public.offices (id, name) VALUES (:O1, 'Noida 63'), (:O2, 'Gurgaon');
INSERT INTO public.profiles (id, name, role, office_id, reports_to) VALUES
  (:A,  'Admin',   'ADMIN',     :O1, NULL),
  (:H,  'HR',      'HR',        :O1, NULL),
  (:L,  'Lead',    'TEAM_LEAD', :O1, NULL),
  (:E1, 'Emp1',    'EMPLOYEE',  :O1, :L),
  (:E2, 'Emp2',    'EMPLOYEE',  :O1, :E1),
  (:E3, 'Emp3',    'EMPLOYEE',  :O2, NULL),
  (:X,  'Scoped',  'EMPLOYEE',  :O1, NULL),
  (:Y,  'Legacy',  'EMPLOYEE',  :O1, NULL),
  (:Z,  'Expired', 'EMPLOYEE',  :O1, NULL),
  (:N,  'Nobody',  'EMPLOYEE',  :O1, NULL);

-- grants written directly (as legacy data / older UI would have)
INSERT INTO public.user_permissions (user_id, permission, scope, scope_id) VALUES
  (:X, 'attendance.view', 'OFFICE', :O2),
  (:Y, 'screen.attendance_control', 'GLOBAL', NULL);
INSERT INTO public.user_permissions (user_id, permission, scope, scope_id, expires_at) VALUES
  (:Z, 'attendance.view', 'GLOBAL', NULL, now() - interval '1 hour');

INSERT INTO public.attendance_logs (user_id, date, checkin_time, status)
SELECT u, (now() AT TIME ZONE 'Asia/Kolkata')::date, now() - interval '2 hours', 'CHECKED_IN'
FROM unnest(ARRAY[:E1, :E3]::uuid[]) u;
INSERT INTO public.leave_requests (user_id, status) VALUES (:E1, 'pending'), (:E3, 'pending');

CREATE TEMP TABLE r (name text, pass boolean, detail text);
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claim.sub', p::text, false) $$;

-- 1. scoped grant, other areas denied
SELECT pg_temp.as_user(:X);
INSERT INTO r SELECT 'x_has_attendance', public.hrms_has_permission('attendance.view'), NULL;
INSERT INTO r SELECT 'x_no_leave', NOT public.hrms_has_permission('leave.view'), NULL;
INSERT INTO r SELECT 'x_scope_is_office2_plus_self',
  (SELECT array_agg(id ORDER BY id) FROM public.authorized_user_ids('attendance.view') id) = ARRAY[:E3, :X]::uuid[]
     OR (SELECT array_agg(id ORDER BY id) FROM public.authorized_user_ids('attendance.view') id) = ARRAY[:X, :E3]::uuid[],
  (SELECT string_agg(id::text, ',') FROM public.authorized_user_ids('attendance.view') id);

-- 2. legacy alias key still works (and maps to the canonical key)
SELECT pg_temp.as_user(:Y);
INSERT INTO r SELECT 'legacy_alias_has_permission', public.hrms_has_permission('attendance.view'), NULL;
INSERT INTO r SELECT 'legacy_alias_global_scope', (SELECT count(*) FROM public.authorized_user_ids('attendance.view')) = 10, NULL;

-- 3. expired grant does nothing
SELECT pg_temp.as_user(:Z);
INSERT INTO r SELECT 'expired_grant_denied', NOT public.hrms_has_permission('attendance.view')
  AND NOT public.can_access_user_data(:E1, 'attendance.view'), NULL;

-- 4. role templates: only role admins
SELECT pg_temp.as_user(:H);
INSERT INTO r SELECT 'hr_cannot_edit_role_templates',
  (public.rpc_admin_grant_role_permission('TEAM_LEAD', 'attendance.view', 'REPORTS_TO', NULL, NULL))->>'error' = 'FORBIDDEN', NULL;
SELECT pg_temp.as_user(:A);
INSERT INTO r SELECT 'admin_role_rejected_as_template',
  (public.rpc_admin_grant_role_permission('HR', 'attendance.view', 'REPORTS_TO', NULL, NULL))->>'error' = 'INVALID_ROLE', NULL;
INSERT INTO r SELECT 'unscoped_permission_needs_global',
  (public.rpc_admin_grant_role_permission('TEAM_LEAD', 'offices.manage', 'REPORTS_TO', NULL, NULL))->>'error' = 'INVALID_SCOPE', NULL;
INSERT INTO r SELECT 'template_granted',
  (public.rpc_admin_grant_role_permission('team_lead', 'attendance.view', 'REPORTS_TO', NULL, 'leads see their line'))->>'success' = 'true', NULL;

-- 5. relationship: the lead covers direct + indirect reports only
SELECT pg_temp.as_user(:L);
INSERT INTO r SELECT 'lead_has_permission_from_role', public.hrms_has_permission('attendance.view'), NULL;
INSERT INTO r SELECT 'lead_covers_direct_and_indirect',
  public.can_access_user_data(:E1, 'attendance.view') AND public.can_access_user_data(:E2, 'attendance.view')
  AND NOT public.can_access_user_data(:E3, 'attendance.view'), NULL;
INSERT INTO r SELECT 'lead_my_permissions_show_template',
  public.get_my_permissions() @> '[{"permission":"attendance.view","source":"ROLE:TEAM_LEAD"}]'::jsonb,
  public.get_my_permissions()::text;
-- transfer: E2 moves away from the line -> access follows the org chart
RESET request.jwt.claim.sub;
UPDATE public.profiles SET reports_to = NULL WHERE id = :E2;
SELECT pg_temp.as_user(:L);
INSERT INTO r SELECT 'transfer_removes_access', NOT public.can_access_user_data(:E2, 'attendance.view'), NULL;

-- 6. dashboard summary
SELECT pg_temp.as_user(:X);
CREATE TEMP TABLE dx AS SELECT public.rpc_admin_dashboard_summary() AS s;
INSERT INTO r SELECT 'dash_scoped_attendance_count', (s->>'today_attendance')::int = 1, s::text FROM dx;
INSERT INTO r SELECT 'dash_scoped_hides_other_areas',
  s->'total_employees' = 'null'::jsonb AND s->'pending_leaves' = 'null'::jsonb AND (s->>'scoped')::boolean, s::text FROM dx;
SELECT pg_temp.as_user(:N);
DO $$ BEGIN
  PERFORM public.rpc_admin_dashboard_summary();
  INSERT INTO r VALUES ('dash_no_permission_403', false, 'allowed');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO r VALUES ('dash_no_permission_403', SQLERRM LIKE 'PERMISSION_REQUIRED%', SQLERRM);
END $$;
SELECT pg_temp.as_user(:H);
CREATE TEMP TABLE dh AS SELECT public.rpc_admin_dashboard_summary() AS s;
INSERT INTO r SELECT 'dash_hr_sees_all',
  (s->>'today_attendance')::int = 2 AND (s->>'pending_leaves')::int = 2 AND (s->>'total_employees')::int = 10
  AND NOT (s->>'scoped')::boolean, s::text FROM dh;

-- 7. grants with expiry + scope rules
SELECT pg_temp.as_user(:A);
INSERT INTO r SELECT 'grant_with_future_expiry',
  (public.admin_grant_permission(:N, 'leave.view', 'OFFICE', :O1::text, 'cover', now() + interval '2 hours'))->>'success' = 'true', NULL;
INSERT INTO r SELECT 'grant_past_expiry_rejected',
  (public.admin_grant_permission(:N, 'leave.view', 'GLOBAL', NULL, NULL, now() - interval '1 minute'))->>'error' = 'INVALID_EXPIRY', NULL;
INSERT INTO r SELECT 'unscoped_permission_office_rejected',
  (public.admin_grant_permission(:N, 'offices.manage', 'OFFICE', :O1::text, NULL, NULL))->>'error' = 'INVALID_SCOPE', NULL;
SELECT pg_temp.as_user(:N);
INSERT INTO r SELECT 'temporary_grant_active', public.hrms_has_permission('leave.view'), NULL;

-- 8. permission management stays with admins
SELECT pg_temp.as_user(:H);
INSERT INTO r SELECT 'hr_not_permission_admin', NOT public.hrms_has_permission('permissions.assign')
  AND public.hrms_has_permission('employees.view'), NULL;
SELECT pg_temp.as_user(:A);
INSERT INTO r SELECT 'admin_permission_admin', public.hrms_has_permission('permissions.assign'), NULL;

-- 9. simulator explains template + scope
INSERT INTO r SELECT 'simulator_template_reason',
  (public.explain_access(:L, 'attendance.view', :E1))->>'reason' = 'ROLE_TEMPLATE', NULL;
INSERT INTO r SELECT 'simulator_outside_scope',
  (public.explain_access(:X, 'attendance.view', :E1))->>'reason' = 'TARGET_OUTSIDE_SCOPE', NULL;
INSERT INTO r SELECT 'simulator_alias',
  (public.explain_access(:Y, 'attendance.view', :E3))->>'allowed' = 'true', NULL;

-- 10. require_permission raises 403
SELECT pg_temp.as_user(:X);
DO $$ BEGIN
  PERFORM public.hrms_require_permission(ARRAY['leave.approve']);
  INSERT INTO r VALUES ('require_permission_raises', false, 'allowed');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO r VALUES ('require_permission_raises', true, SQLERRM);
END $$;

RESET request.jwt.claim.sub;
\set QUIET off
SELECT name, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, left(coalesce(detail, ''), 160) AS detail FROM r ORDER BY name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE pass IS NOT TRUE) AS failed FROM r;
SELECT 'PERMISSION_V2_SCENARIOS_DONE';
