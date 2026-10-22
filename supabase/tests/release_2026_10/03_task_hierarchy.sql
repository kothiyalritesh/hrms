-- Tasks follow the reporting line (migration 20261015130000).
-- A manages E and B; E manages C and D; B manages F, G and H.
\set ON_ERROR_STOP on
\ir ../../migrations/20261015130000_task_hierarchy_visibility.sql
\ir ../../migrations/20261015130000_task_hierarchy_visibility.sql

INSERT INTO profiles (id, name, employee_number, reports_to) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'A', 'A', NULL),
  ('00000000-0000-0000-0000-00000000000e', 'E', 'E', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b', 'B', 'B', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000c', 'C', 'C', '00000000-0000-0000-0000-00000000000e'),
  ('00000000-0000-0000-0000-00000000000d', 'D', 'D', '00000000-0000-0000-0000-00000000000e'),
  ('00000000-0000-0000-0000-0000000000f1', 'F', 'F', '00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-0000000000f2', 'G', 'G', '00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-0000000000f3', 'H', 'H', '00000000-0000-0000-0000-00000000000b');

CREATE FUNCTION who(t text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(p.name, ',' ORDER BY p.name), '-')
  FROM task_audience a JOIN profiles p ON p.id = a.user_id JOIN tasks k ON k.id = a.task_id WHERE k.title = t $$;
CREATE FUNCTION as_name(n text) RETURNS void LANGUAGE sql AS
$$ SELECT t_as((SELECT id FROM profiles WHERE name = n)) $$;
CREATE FUNCTION tk(t text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM tasks WHERE title = t $$;
CREATE FUNCTION my_titles() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg((e->>'title') || ':' || (e->>'relation'), ',' ORDER BY e->>'title'), '-')
  FROM jsonb_array_elements(rpc_my_tasks()) e $$;
CREATE FUNCTION fwd(n text, t text, targets uuid[] DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT as_name(n); SELECT coalesce(r->>'error', 'added ' || (r->>'added')) FROM (SELECT rpc_task_forward(tk(t), targets) r) x $$;

SELECT as_name('E');
INSERT INTO tasks (title, assigned_to, assigned_by) VALUES
  ('E-task', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000e');
SELECT t_assert('E creates -> C and D see it', who('E-task'), 'C,D');
SELECT t_assert('creator recorded', (SELECT p.name FROM tasks t JOIN profiles p ON p.id = t.created_by WHERE title = 'E-task'), 'E');

SELECT as_name('A');
INSERT INTO tasks (title, assigned_to, assigned_by) VALUES
  ('A-task', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a');
SELECT t_assert('A creates -> only E and B', who('A-task'), 'B,E');

SELECT t_assert('E forwards to C and D', fwd('E', 'A-task'), 'added 2');
SELECT t_assert('B forwards only to G', fwd('B', 'A-task', ARRAY['00000000-0000-0000-0000-0000000000f2'::uuid]), 'added 1');
SELECT t_assert('audience after forwarding', who('A-task'), 'B,C,D,E,G');
SELECT t_assert('B cannot forward to E''s team', fwd('B', 'A-task', ARRAY['00000000-0000-0000-0000-00000000000c'::uuid]), 'NOT_YOUR_TEAM');
SELECT t_assert('C has no team to forward to', fwd('C', 'A-task'), 'NO_DIRECT_REPORTS');
SELECT t_assert('F never received it', fwd('F', 'A-task'), 'FORBIDDEN');
SELECT t_assert('forwarding twice adds nobody', fwd('E', 'A-task'), 'added 0');

SELECT as_name('A');
INSERT INTO tasks (title, assigned_to, assigned_by, share_scope) VALUES
  ('A-private', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'PRIVATE');
SELECT t_assert('private task stays private', who('A-private'), '-');

SELECT as_name('A'); SELECT t_assert('A list', my_titles(), 'A-private:ASSIGNED,A-task:ASSIGNED');
SELECT as_name('C'); SELECT t_assert('C list', my_titles(), 'A-task:SHARED,E-task:SHARED');
SELECT as_name('G'); SELECT t_assert('G list', my_titles(), 'A-task:SHARED');
SELECT as_name('H'); SELECT t_assert('H list', my_titles(), '-');
SELECT as_name('C');
SELECT t_assert('shared task is view-only, forwarded by E',
  (SELECT (e->>'can_update') || ' ' || (e->>'shared_by_name') FROM jsonb_array_elements(rpc_my_tasks()) e WHERE e->>'title' = 'A-task'),
  'false E');
SELECT t_assert('people notified',
  (SELECT count(*) FROM test_notifications WHERE type IN ('task_shared', 'task_forwarded'))::text, '7');

-- Row level security as the app's role
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON tasks, profiles TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated;
SELECT as_name('C'); SET ROLE authenticated;
SELECT t_assert('RLS: C reads A-task and E-task', (SELECT string_agg(title, ',' ORDER BY title) FROM tasks), 'A-task,E-task');
RESET ROLE;
SELECT as_name('H'); SET ROLE authenticated;
SELECT t_assert('RLS: H reads nothing', (SELECT count(*) FROM tasks)::text, '0');
SELECT t_assert('RLS: H cannot add himself to an audience',
  has_table_privilege('authenticated', 'task_audience', 'INSERT')::text, 'false');
RESET ROLE;
SELECT as_name('A'); SET ROLE authenticated;
SELECT t_assert('RLS: A reads own private task', (SELECT count(*) FROM tasks WHERE title = 'A-private')::text, '1');
RESET ROLE;
\echo 03_task_hierarchy: PASS
