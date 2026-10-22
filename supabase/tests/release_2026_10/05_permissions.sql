-- Permission Manager v3 (migration 20261020100000) on top of the engine as deployed.
-- People:  SA system admin, HR, M manager -> R1, R2; R1 -> R3 (M's tree = R1, R2, R3)
--          P peer in office O1, D delegate in O1 (permissions.assign + attendance.view OFFICE O1), X in O2.
\set ON_ERROR_STOP on
\ir mock_permissions.sql

INSERT INTO offices (id, name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'O1'), ('00000000-0000-0000-0000-0000000000a2', 'O2');
INSERT INTO profiles (id, name, role, office_id, reports_to, phone) VALUES
  ('00000000-0000-0000-0000-000000000001', 'SA', 'SYSTEM_ADMIN', '00000000-0000-0000-0000-0000000000a1', NULL, '9000000001'),
  ('00000000-0000-0000-0000-000000000002', 'HR', 'HR', '00000000-0000-0000-0000-0000000000a1', NULL, '9000000002'),
  ('00000000-0000-0000-0000-000000000003', 'M', 'SALES_MANAGER', '00000000-0000-0000-0000-0000000000a1', NULL, '9000000003'),
  ('00000000-0000-0000-0000-000000000004', 'R1', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', '9000000004'),
  ('00000000-0000-0000-0000-000000000005', 'R2', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', '9000000005'),
  ('00000000-0000-0000-0000-000000000006', 'R3', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000004', '9000000006'),
  ('00000000-0000-0000-0000-000000000007', 'P', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL, '9000000007'),
  ('00000000-0000-0000-0000-000000000008', 'D', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL, '9000000008'),
  ('00000000-0000-0000-0000-000000000009', 'X', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a2', NULL, '9000000009');
INSERT INTO user_permissions (user_id, permission, scope, scope_id) VALUES
  ('00000000-0000-0000-0000-000000000008', 'permissions.assign', 'GLOBAL', NULL),
  ('00000000-0000-0000-0000-000000000008', 'permissions.revoke', 'GLOBAL', NULL),
  ('00000000-0000-0000-0000-000000000008', 'attendance.view', 'OFFICE', '00000000-0000-0000-0000-0000000000a1');

SET check_function_bodies = off;   -- helpers call functions the migration creates
CREATE FUNCTION u(n text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM profiles WHERE name = n $$;
CREATE FUNCTION as_name(n text) RETURNS void LANGUAGE sql AS $$ SELECT t_as(u(n)) $$;
CREATE FUNCTION keys_of(n text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(DISTINCT g.permission, ',' ORDER BY g.permission) FROM hrms_active_grants(u(n)) g $$;
CREATE FUNCTION can(viewer text, target text, k text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('test.uid', u(viewer)::text, false);
  SELECT can_access_user_data(u(target), k)::text $$;
CREATE FUNCTION bulk(actor text, people text[], grants jsonb, reason text DEFAULT 'test') RETURNS jsonb LANGUAGE sql AS $$
  SELECT set_config('test.uid', u(actor)::text, false);
  SELECT admin_set_access_bulk(ARRAY(SELECT u(x) FROM unnest(people) x), grants, NULL, reason, false) $$;
CREATE FUNCTION g(cap text, scope text DEFAULT 'GLOBAL', sid text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('capability', cap, 'scope', scope, 'scope_id', sid)) $$;
CREATE FUNCTION direct(n text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(permission || '@' || scope, ',' ORDER BY permission, scope), '-')
  FROM user_permissions WHERE user_id = u(n) AND revoked_at IS NULL $$;
CREATE FUNCTION ver(n text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT version FROM user_permission_versions WHERE user_id = u(n)), 0) $$;

RESET check_function_bodies;

-- production also has the older leaves table with a reviewer UPDATE rule
CREATE TABLE public.leaves (id uuid PRIMARY KEY, user_id uuid, status text);
GRANT ALL ON public.leaves TO authenticated;

-- the migration runs twice without error (idempotent)
\ir ../../migrations/20261020100000_permission_capabilities_and_hierarchy.sql
\ir ../../migrations/20261020100000_permission_capabilities_and_hierarchy.sql

SELECT t_assert('templates seeded once (manager 7, HR all data capabilities)',
  (SELECT count(*) FILTER (WHERE role = '@MANAGER') || '/' || count(*) FILTER (WHERE role = 'HR')
   FROM role_permission_grants WHERE revoked_at IS NULL),
  '7/' || (SELECT count(*) FROM permission_capabilities WHERE key NOT LIKE 'permissions.%'));

SELECT t_assert('baseline of access before the migration was kept',
  (to_regclass('public.hrms_access_baseline_20261020') IS NOT NULL)::text, 'true');
SELECT t_assert('parity: no active person lost a key they had before',
  (SELECT count(*)::text FROM hrms_access_baseline_20261020 b
   JOIN profiles p ON p.id = b.user_id AND coalesce(p.is_active, true)
   WHERE b.permission IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM hrms_active_grants(b.user_id) n
                     WHERE n.permission = ANY (hrms_permission_keys(b.permission))
                       AND n.scope = b.scope AND coalesce(n.scope_id, '') = coalesce(b.scope_id, ''))), '0');
SELECT t_assert('nobody (incl. PUBLIC) can write the permission tables directly',
  (SELECT count(*)::text FROM (VALUES ('user_permissions'), ('role_permission_grants'), ('hrms_role_access'),
                                      ('permission_capabilities'), ('user_permission_versions')) t(n),
          (VALUES ('authenticated'), ('anon')) r(role), (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) a(priv)
   WHERE has_table_privilege(r.role, 'public.' || t.n, a.priv)), '0');
SELECT t_assert('approval guard on every reviewer-writable request table',
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
   WHERE tg.tgname = 'hrms_guard_review_fields_trg'), 'attendance_regularization_requests,leave_requests,leaves');
SELECT t_assert('tracking does not quietly include attendance or field visits',
  (SELECT string_agg(k, ',' ORDER BY k) FROM unnest(hrms_capability_keys('tracking.view')) k),
  'activity_analysis.view,live_tracking.view,tracking.view');

-- ── capabilities and levels ──
SELECT t_assert('merged capability: attendance.correct gives both keys and the views',
  (SELECT string_agg(k, ',' ORDER BY k) FROM unnest(hrms_capability_keys('attendance.correct')) k),
  'attendance.backdate_correct,attendance.correct,attendance.regularize,attendance.view,regularization.view');
SELECT t_assert('approve includes view',
  (SELECT string_agg(k, ',' ORDER BY k) FROM unnest(hrms_capability_keys('leave.approve')) k),
  'leave.approve,leave.view,manage_leave');
SELECT t_assert('old regularization.approve grant gets its views, not the other half',
  (SELECT string_agg(k, ',' ORDER BY k) FROM unnest(hrms_capability_keys('regularization.approve')) k),
  'attendance.approve,attendance.view,regularization.approve,regularization.view');
SELECT t_assert('alias maps to its capability', hrms_capability_for('screen.live_tracking'), 'tracking.view');
SELECT t_assert('retired key without a capability is rejected',
  (SELECT error FROM hrms_normalize_grant('manage_everything', 'GLOBAL', NULL)), 'INVALID_PERMISSION_KEY');

-- ── one hierarchy rule: Manager template = whole reporting tree ──
SELECT t_assert('manager sees grandchild (tree)', can('M', 'R3', 'attendance.view'), 'true');
SELECT t_assert('manager sees direct report', can('M', 'R1', 'leave.view'), 'true');
SELECT t_assert('manager does not see a peer', can('M', 'P', 'attendance.view'), 'false');
SELECT t_assert('manager does not see another office', can('M', 'X', 'attendance.view'), 'false');
SELECT t_assert('mid manager sees own report', can('R1', 'R3', 'attendance.view'), 'true');
SELECT t_assert('mid manager does not see sibling', can('R1', 'R2', 'attendance.view'), 'false');
SELECT t_assert('mid manager does not see upward', can('R1', 'M', 'attendance.view'), 'false');
SELECT t_assert('employee without reports has no manager access', can('R3', 'R1', 'attendance.view'), 'false');
SELECT as_name('M');
SELECT t_assert('current_user_can_review follows the tree',
  current_user_can_review(u('R3'))::text || current_user_can_review(u('P'))::text, 'truefalse');
SELECT t_assert('tracking follows the template', hrms_can_view_location(u('R3'))::text, 'true');

-- access rules rewritten to the set lookup
SELECT t_assert('rules no longer call the per-row helpers',
  (SELECT count(*)::text FROM pg_policies
   WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '(current_user_can_review|can_view_tracking_user)\('), '0');
SELECT t_assert('leave update rule uses the approve capability',
  (SELECT (qual ~ 'leave\.approve')::text FROM pg_policies WHERE policyname = 'leave_self_or_review_update'), 'true');

INSERT INTO attendance_logs (user_id, date) SELECT u(n), current_date FROM unnest(ARRAY['M','R1','R3','P','X']) n;
SET ROLE authenticated;
SELECT as_name('M');
SELECT t_assert('RLS: manager reads self + tree', (SELECT count(*)::text FROM attendance_logs), '3');
SELECT as_name('P');
SELECT t_assert('RLS: employee reads only self', (SELECT count(*)::text FROM attendance_logs), '1');
RESET ROLE;

-- an empty Manager template switches manager access off; restoring brings it back
SELECT as_name('SA');
SELECT t_assert('manager template emptied',
  (rpc_admin_set_role_template('@MANAGER', '[]'::jsonb, 'test')->>'removed'), '7');
SELECT t_assert('no template = no tree access', can('M', 'R3', 'attendance.view'), 'false');
SELECT as_name('SA');
SELECT t_assert('manager template restored', (rpc_admin_set_role_template('@MANAGER',
  '[{"capability":"attendance.view"},{"capability":"leave.approve"},{"capability":"tasks.manage"},
    {"capability":"tracking.view"},{"capability":"employees.view"}]'::jsonb, 'test')->>'added'), '5');
SELECT t_assert('manager template scope forced to the tree',
  (SELECT string_agg(DISTINCT scope || coalesce(scope_id, '-'), ',') FROM role_permission_grants
   WHERE role = '@MANAGER' AND revoked_at IS NULL), 'REPORTS_TO-');
SELECT t_assert('tree access back', can('M', 'R3', 'attendance.view'), 'true');

-- ── delegation ceiling (D: attendance.view for office O1 + permissions.assign) ──
SELECT t_assert('delegate cannot give company-wide',
  bulk('D', ARRAY['P'], g('attendance.view'))->'results'->0->>'error', 'OUTSIDE_YOUR_ACCESS');
SELECT t_assert('delegate cannot give what they lack',
  bulk('D', ARRAY['P'], g('leave.approve', 'OFFICE', '00000000-0000-0000-0000-0000000000a1'))->'results'->0->>'error',
  'OUTSIDE_YOUR_ACCESS');
SELECT t_assert('delegate cannot give another office',
  bulk('D', ARRAY['P'], g('attendance.view', 'OFFICE', '00000000-0000-0000-0000-0000000000a2'))->'results'->0->>'error',
  'OUTSIDE_YOUR_ACCESS');
SELECT t_assert('delegate cannot give permission rights',
  bulk('D', ARRAY['P'], g('permissions.assign'))->'results'->0->>'error', 'ADMIN_ONLY_PERMISSION');
SELECT t_assert('delegate cannot change own access',
  bulk('D', ARRAY['D'], g('attendance.view', 'OFFICE', '00000000-0000-0000-0000-0000000000a1'))->'results'->0->>'error',
  'SELF_GRANT_FORBIDDEN');
SELECT t_assert('delegate cannot grant to someone outside their scope',
  bulk('D', ARRAY['X'], g('attendance.view', 'OFFICE', '00000000-0000-0000-0000-0000000000a1'))->'results'->0->>'error',
  'TARGET_OUTSIDE_YOUR_SCOPE');
SELECT t_assert('nothing written by refused grants', direct('P'), '-');
SELECT t_assert('delegate can give what they hold, within their scope',
  bulk('D', ARRAY['P'], g('attendance.view', 'OFFICE', '00000000-0000-0000-0000-0000000000a1'))->>'added', '1');
SELECT t_assert('mutual escalation blocked: P (now O1 viewer) has no assign right',
  bulk('P', ARRAY['D'], g('attendance.view'))->>'error', 'FORBIDDEN');

-- ── bulk: atomic, several people x several capabilities, reasons, expiry ──
SELECT as_name('SA');
SELECT t_assert('one bad person = nothing applied',
  (SELECT (r->>'success') || '/' || direct('R2') FROM (SELECT admin_set_access_bulk(
     ARRAY[u('R2'), '00000000-0000-0000-0000-0000000000ff'::uuid], g('tasks.view'), NULL, 'x') r) s), 'false/-');
SELECT as_name('SA');
SELECT t_assert('2 people x 2 capabilities',
  bulk('SA', ARRAY['R2', 'X'], '[{"capability":"tasks.view","scope":"GLOBAL"},{"capability":"leave.view","scope":"GLOBAL"}]')->>'added', '4');
SELECT t_assert('high risk needs a reason',
  bulk('SA', ARRAY['X'], g('attendance.correct'), NULL)->'results'->0->>'error', 'REASON_REQUIRED');
SELECT t_assert('dry run writes nothing',
  (SELECT (admin_set_access_bulk(ARRAY[u('X')], g('audit.view'), NULL, 'why', true)->>'dry_run') || '/' ||
          (SELECT count(*) FROM user_permissions WHERE user_id = u('X') AND permission = 'audit.view')), 'true/0');
SELECT t_assert('re-grant with an expiry keeps a permanent grant',
  (SELECT (admin_set_access_bulk(ARRAY[u('X')], g('tasks.view'), now() + interval '5 days', 'x')->'results'->0->>'status')
          || '/' || coalesce((SELECT expires_at::text FROM user_permissions WHERE user_id = u('X') AND permission = 'tasks.view' AND revoked_at IS NULL), 'permanent')),
  'UNCHANGED/permanent');
SELECT admin_set_access_bulk(ARRAY[u('X')], g('feedback.view'), now() + interval '10 days', 'x');
SELECT t_assert('a shorter re-grant does not shorten',
  admin_set_access_bulk(ARRAY[u('X')], g('feedback.view'), now() + interval '2 days', 'x')->'results'->0->>'status', 'UNCHANGED');
SELECT t_assert('a longer re-grant extends',
  admin_set_access_bulk(ARRAY[u('X')], g('feedback.view'), now() + interval '20 days', 'x')->'results'->0->>'status', 'EXTENDED');
SELECT t_assert('explicit shorten through admin_set_grant_expiry',
  admin_set_grant_expiry((SELECT id FROM user_permissions WHERE user_id = u('X') AND permission = 'feedback.view' AND revoked_at IS NULL),
                         now() + interval '1 day', 'x')->>'success', 'true');
SELECT t_assert('legacy single grant goes through the same rules',
  admin_grant_permission(u('X'), 'screen.live_tracking', 'GLOBAL', NULL, 'why', NULL)->>'status', 'ADDED');
SELECT t_assert('stored as the capability', (direct('X') ~ 'tracking\.view@GLOBAL')::text, 'true');

-- ── revoke: aliases, merged keys, honest results ──
INSERT INTO user_permissions (user_id, permission, scope) VALUES (u('R2'), 'manage_leave', 'GLOBAL'), (u('R2'), 'regularization.approve', 'GLOBAL');
SELECT as_name('SA');
SELECT t_assert('revoke by capability covers the alias',
  admin_revoke_access_bulk(ARRAY[u('R2')], ARRAY['leave.approve'], 'x')->>'revoked', '1');
SELECT t_assert('revoke by capability covers the old merged key',
  admin_revoke_access_bulk(ARRAY[u('R2')], ARRAY['attendance.requests.approve'], 'x')->>'revoked', '1');
SELECT t_assert('nothing to revoke is reported',
  admin_revoke_access_bulk(ARRAY[u('R2')], ARRAY['audit.view'], 'x')->'results'->0->>'status', 'NOTHING_TO_REVOKE');
SELECT t_assert('old revoke no longer claims success for 0 rows',
  admin_revoke_permission(u('R2'), 'audit.view')->>'error', 'NOTHING_TO_REVOKE');
SELECT t_assert('template access is named when a direct grant is removed',
  admin_revoke_access_bulk(ARRAY[u('M')], ARRAY['leave.approve'], 'x')->'results'->0->>'still_from', '["MANAGER"]');
SELECT t_assert('delegate cannot revoke outside their reach',
  (SELECT set_config('test.uid', u('D')::text, false) IS NOT NULL
          AND admin_revoke_access_bulk(ARRAY[u('X')], ARRAY['tasks.view'], 'x')->>'error' = 'VALIDATION_FAILED')::text, 'true');

-- ── writes only through RPCs ──
SET ROLE authenticated;
SELECT as_name('D');
DO $$ BEGIN
  INSERT INTO user_permissions (user_id, permission, scope) VALUES ('00000000-0000-0000-0000-000000000007', 'audit.view', 'GLOBAL');
  RAISE EXCEPTION 'FAIL direct insert into user_permissions was allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  direct grant writes are blocked';
END $$;
RESET ROLE;

-- ── approval fields only through the approval RPCs ──
INSERT INTO leave_requests (id, user_id, status, reason) VALUES
  ('00000000-0000-0000-0000-00000000c001', u('P'), 'PENDING', 'a'),
  ('00000000-0000-0000-0000-00000000c002', u('P'), 'PENDING', 'b'),
  ('00000000-0000-0000-0000-00000000c003', u('R1'), 'PENDING', 'c');
SET ROLE authenticated;
SELECT as_name('P');
DO $$ BEGIN
  UPDATE leave_requests SET status = 'APPROVED' WHERE id = '00000000-0000-0000-0000-00000000c001';
  RAISE EXCEPTION 'FAIL employee approved own leave';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  employee cannot approve own leave';
END $$;
UPDATE leave_requests SET status = 'CANCELLED' WHERE id = '00000000-0000-0000-0000-00000000c002';
SELECT as_name('M');
DO $$ BEGIN
  UPDATE leave_requests SET status = 'APPROVED', approved_by = auth.uid() WHERE id = '00000000-0000-0000-0000-00000000c003';
  RAISE EXCEPTION 'FAIL manager approved by direct update';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  manager cannot approve by direct update';
END $$;
UPDATE leave_requests SET reason = 'edited' WHERE id = '00000000-0000-0000-0000-00000000c003';
RESET ROLE;
SELECT t_assert('owner cancel allowed, other fields editable',
  (SELECT string_agg(status || ':' || reason, ',' ORDER BY id) FROM leave_requests),
  'PENDING:a,CANCELLED:b,PENDING:edited');

-- ── tasks: no forged assigned_by, assignee in tasks.manage scope ──
SET ROLE authenticated;
SELECT as_name('P');
DO $$ BEGIN
  INSERT INTO tasks (title, assigned_to, assigned_by) VALUES ('forged', '00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FAIL forged assigned_by accepted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  forged assigned_by rejected';
END $$;
DO $$ BEGIN
  INSERT INTO tasks (title, assigned_to, assigned_by) VALUES ('peer', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000007');
  RAISE EXCEPTION 'FAIL task for someone outside scope accepted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  task outside scope rejected';
END $$;
INSERT INTO tasks (title, assigned_to, assigned_by) VALUES ('own', u('P'), u('P'));
SELECT as_name('M');
INSERT INTO tasks (title, assigned_to, assigned_by) VALUES ('to tree', u('R3'), u('M'));
RESET ROLE;
SELECT t_assert('own task and manager-to-tree task saved',
  (SELECT string_agg(title, ',' ORDER BY title) FROM tasks), 'own,to tree');

-- ── HR: full access switch + pre-filled template ──
SELECT as_name('HR');
SELECT t_assert('HR starts with full access', hrms_is_admin_user(u('HR'))::text, 'true');
SELECT as_name('SA');
SELECT t_assert('reason required to switch', rpc_admin_set_role_full_access('HR', false, NULL)->>'error', 'REASON_REQUIRED');
SELECT t_assert('admin roles cannot be switched', rpc_admin_set_role_full_access('ADMIN', false, 'x')->>'error', 'INVALID_ROLE');
UPDATE role_permission_grants SET revoked_at = now() WHERE role = 'HR' AND permission = 'audit.view';
SELECT t_assert('switch-off refused while the HR template is incomplete',
  rpc_admin_set_role_full_access('HR', false, 'test')->>'error', 'TEMPLATE_INCOMPLETE');
INSERT INTO role_permission_grants (role, permission, scope) VALUES ('HR', 'audit.view', 'GLOBAL');
SELECT as_name('SA');
ALTER TABLE hrms_audit_events ADD CONSTRAINT t_block_audit CHECK (action <> 'ROLE_FULL_ACCESS_OFF');
DO $$ BEGIN
  PERFORM rpc_admin_set_role_full_access('HR', false, 'test');
  RAISE EXCEPTION 'FAIL access changed without an audit row';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  no audit row = no change';
END $$;
ALTER TABLE hrms_audit_events DROP CONSTRAINT t_block_audit;
SELECT t_assert('HR still has full access after the failed change', hrms_is_admin_user(u('HR'))::text, 'true');
SELECT t_assert('HR switched to its template', rpc_admin_set_role_full_access('HR', false, 'test')->>'full_data_access', 'false');
SELECT t_assert('HR no longer a full-access role', hrms_is_admin_user(u('HR'))::text, 'false');
SELECT t_assert('HR template gives every data key company-wide',
  (SELECT count(*)::text FROM (
     SELECT DISTINCT unnest(grants) k FROM permission_capabilities WHERE key NOT LIKE 'permissions.%'
     EXCEPT SELECT permission FROM hrms_active_grants(u('HR')) WHERE scope = 'GLOBAL') missing), '0');
SELECT t_assert('HR still reaches another office through the template', can('HR', 'X', 'attendance.view'), 'true');
SELECT as_name('SA');
SELECT rpc_admin_set_role_full_access('HR', true, 'test');
SELECT t_assert('HR full access back on', hrms_is_admin_user(u('HR'))::text, 'true');

-- ── location: attendance.view no longer reveals live location ──
SELECT bulk('SA', ARRAY['P'], g('attendance.view'), 'x');
SELECT as_name('P');
SELECT t_assert('company-wide attendance.view does not show location', hrms_can_view_location(u('X'))::text, 'false');

-- ── live refresh versions ──
SELECT t_assert('a grant bumps the person''s version', (ver('P') > 0)::text, 'true');
SELECT as_name('SA');
SELECT ver('M') AS v_before \gset
SELECT rpc_admin_set_role_template('@MANAGER',
  '[{"capability":"attendance.view"},{"capability":"leave.approve"},{"capability":"tasks.manage"},
    {"capability":"tracking.view"},{"capability":"employees.view"},{"capability":"field_visits.view"}]'::jsonb, 'x');
SELECT t_assert('a Manager template change bumps every manager', (ver('M') > :v_before)::text, 'true');

-- ── leave balance: nobody adjusts their own ──
SELECT as_name('SA');
DO $$ BEGIN
  PERFORM rpc_admin_adjust_leave_balance(auth.uid(), 5);
  RAISE EXCEPTION 'FAIL admin adjusted own leave balance';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  admin cannot adjust own leave balance';
END $$;
SELECT t_assert('admin adjusts someone else', rpc_admin_adjust_leave_balance(u('P'), 5)->>'success', 'true');

-- ── role-only checks now follow permissions ──
SELECT t_assert('reset-all leave checks leave.balance.manage',
  (pg_get_functiondef('rpc_admin_reset_all_leave_balances(text,numeric,numeric,text)'::regprocedure) ~ 'leave\.balance\.manage')::text, 'true');
SELECT t_assert('biometric assign/unassign check biometric.manage',
  ((pg_get_functiondef('rpc_assign_biometric_employee_code(uuid,text)'::regprocedure) ~ 'biometric\.manage')
   AND (pg_get_functiondef('rpc_unassign_biometric_employee_code(uuid)'::regprocedure) ~ 'biometric\.manage'))::text, 'true');
SELECT t_assert('biometric reprocess and profile sync check biometric.manage',
  ((SELECT bool_and(pg_get_functiondef(p.oid) ~ 'biometric\.manage') FROM pg_proc p
    WHERE proname IN ('reprocess_unmatched_biometric_punches', 'rpc_admin_sync_smartoffice_profiles_batch')))::text, 'true');

-- ── simulator agrees with the engine for merged capabilities ──
INSERT INTO user_permissions (user_id, permission, scope) VALUES (u('R2'), 'attendance.regularize', 'GLOBAL'),
  (u('R2'), 'live_tracking.view', 'GLOBAL');
SELECT as_name('SA');
SELECT t_assert('only one half of Correct attendance = partial',
  explain_access(u('R2'), 'attendance.correct', u('X'))->>'reason', 'PARTIAL_CAPABILITY');
SELECT t_assert('only live tracking = Tracking & activity is partial',
  explain_access(u('R2'), 'tracking.view', u('X'))->>'reason', 'PARTIAL_CAPABILITY');
SELECT t_assert('the single key itself is allowed',
  explain_access(u('R2'), 'attendance.regularize', u('X'))->>'allowed', 'true');
SELECT t_assert('engine agrees: regularize yes, backdate_correct no',
  can('R2', 'X', 'attendance.regularize') || '/' || can('R2', 'X', 'attendance.backdate_correct'), 'true/false');
INSERT INTO user_permissions (user_id, permission, scope) VALUES (u('R2'), 'attendance.backdate_correct', 'GLOBAL'),
  (u('R2'), 'activity_analysis.view', 'GLOBAL');
SELECT as_name('SA');
SELECT t_assert('both halves held = allowed',
  (explain_access(u('R2'), 'attendance.correct', u('X'))->>'allowed') || '/' ||
  (explain_access(u('R2'), 'tracking.view', u('X'))->>'allowed'), 'true/true');
SELECT t_assert('merged capability out of scope = denied',
  explain_access(u('D'), 'attendance.correct', u('X'))->>'allowed', 'false');

-- ── refresh: catalog and hierarchy changes bump the right people ──
SELECT ver('P') AS p0, ver('M') AS m0, ver('R1') AS r10 \gset
UPDATE permission_capabilities SET description = description WHERE key = 'audit.view';
SELECT t_assert('a catalog change bumps everyone', (ver('P') > :p0)::text, 'true');
SELECT ver('M') AS m1, ver('R1') AS r11 \gset
UPDATE profiles SET reports_to = u('R2') WHERE name = 'R3';
SELECT t_assert('moving R3 bumps the old manager and every manager above',
  (ver('R1') > :r11 AND ver('M') > :m1)::text, 'true');
UPDATE profiles SET reports_to = u('R1') WHERE name = 'R3';

-- ── what the Permission Manager reads ──
SELECT as_name('SA');
SELECT t_assert('explain: manager access is named',
  explain_access(u('M'), 'attendance.view', u('R3'))->>'reason', 'MANAGER_HIERARCHY');
SELECT t_assert('explain: merged capability by name',
  explain_access(u('M'), 'tracking.view', u('R3'))->>'allowed', 'true');
SELECT t_assert('who can see R3 (non-admins)',
  (SELECT string_agg(x->>'name', ',' ORDER BY x->>'name') FROM jsonb_array_elements(rpc_who_can_access(u('R3'), 'attendance.view')) x
   WHERE NOT (x->>'full_data_access')::boolean), 'D,M,P,R1,R2');
SELECT t_assert('catalog has modules and the screen map',
  (SELECT (jsonb_array_length(c->'modules') >= 8 AND c->'screens' ? 'LiveTracking')::text FROM get_permission_catalog_v2() c), 'true');
SELECT t_assert('effective access lists sources',
  (SELECT string_agg(DISTINCT x->>'source', ',' ORDER BY x->>'source') FROM jsonb_array_elements(get_user_access(u('M'))->'grants') x), 'MANAGER');
SELECT t_assert('history has direct and template changes',
  (SELECT string_agg(DISTINCT x->>'kind', ',' ORDER BY x->>'kind') FROM jsonb_array_elements(rpc_permission_history(NULL, NULL, NULL, 200, 0)->'rows') x),
  'FULL_ACCESS,TEMPLATE,USER');
SELECT t_assert('matrix: manager row shows the tree grants',
  (SELECT (x->'grants' @> '[{"capability":"tracking.view","source":"MANAGER"}]')::text
   FROM jsonb_array_elements(rpc_admin_access_matrix(ARRAY[u('M'), u('P')])) x WHERE x->>'user_id' = u('M')::text), 'true');
SELECT t_assert('copy access previews per person',
  admin_copy_access(u('X'), ARRAY[u('R2')], 'copy', NULL, true)->>'dry_run', 'true');
SELECT as_name('M');
SELECT t_assert('my access: manager has reports and tree grants',
  (SELECT (a->>'has_reports') || '/' || (a->'grants' @> '[{"source":"MANAGER","permission":"live_tracking.view"}]')::text FROM get_my_access() a),
  'true/true');

-- ── birthdays ──
SELECT as_name('SA');
SELECT t_assert('birthday saved by RPC', rpc_admin_set_birthday(u('P'), '1990-05-04')->>'success', 'true');
SELECT t_assert('CSV import matches name + phone',
  rpc_admin_import_birthdays('[{"name":"r1","phone":"+91 90000 00004","date_of_birth":"1991-01-02"},{"name":"nobody","date_of_birth":"1990-01-01"}]')->>'updated', '1');
SELECT as_name('P');
DO $$ BEGIN
  PERFORM rpc_admin_set_birthday('00000000-0000-0000-0000-000000000004', '1990-01-01');
  RAISE EXCEPTION 'FAIL birthday saved without permission';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  birthday needs birthdays.manage';
END $$;

SELECT 'PASS 05_permissions' AS result;
