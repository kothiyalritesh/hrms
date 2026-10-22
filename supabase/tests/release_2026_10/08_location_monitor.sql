-- Office exit end to end + HR location monitor (migration 20261021120000).
-- Office O1 radius 200 m. HR (template: full access), M manages E1.
--   E1 leaves, is confirmed, returns, leaves again (second cycle) and explains.
--   Monitor: E1 outside, E2 no location, E3 stale (last known inside),
--            E4 at an active visit site, E5 travelling to a visit, E6 at the edge,
--            E7 checked out (not listed).
\set ON_ERROR_STOP on
\ir mock_permissions.sql
\ir mock_geofence.sql
\ir ../../migrations/20261020100000_permission_capabilities_and_hierarchy.sql
\ir ../../migrations/20261021110000_office_exit_reviews.sql
\ir ../../migrations/20261021120000_location_monitor_and_exit_reasons.sql
\ir ../../migrations/20261021120000_location_monitor_and_exit_reasons.sql

INSERT INTO offices (id, name, latitude, longitude, allowed_radius_meters) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'O1', 28.6, 77.2, 200);
INSERT INTO profiles (id, name, role, office_id, reports_to, phone) VALUES
  ('00000000-0000-0000-0000-000000000002', 'HR', 'HR', '00000000-0000-0000-0000-0000000000a1', NULL, '9000000002'),
  ('00000000-0000-0000-0000-000000000003', 'M', 'SALES_MANAGER', '00000000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('00000000-0000-0000-0000-000000000011', 'E1', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-000000000003', '9876543210'),
  ('00000000-0000-0000-0000-000000000012', 'E2', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('00000000-0000-0000-0000-000000000013', 'E3', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('00000000-0000-0000-0000-000000000014', 'E4', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('00000000-0000-0000-0000-000000000015', 'E5', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('00000000-0000-0000-0000-000000000016', 'E6', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('00000000-0000-0000-0000-000000000017', 'E7', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL, NULL);

CREATE FUNCTION u(n text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM profiles WHERE name = n $$;
INSERT INTO attendance_logs (user_id, date, office_id, checkin_time, checkout_time, status)
SELECT p.id, (now() AT TIME ZONE 'Asia/Kolkata')::date, p.office_id, now() - interval '3 hours',
       CASE WHEN p.name = 'E7' THEN now() - interval '1 hour' END,
       CASE WHEN p.name = 'E7' THEN 'CHECKED_OUT' ELSE 'CHECKED_IN' END
FROM profiles p WHERE p.name LIKE 'E%';
INSERT INTO tracking_sessions (user_id, attendance_log_id, started_at)
SELECT user_id, id, now() - interval '3 hours' FROM attendance_logs;
INSERT INTO field_visits (user_id, date, status, location_name, destination_coords) VALUES
  (u('E4'), (now() AT TIME ZONE 'Asia/Kolkata')::date, 'CHECKED_IN', 'Site A', '{"latitude": 28.7, "longitude": 77.3}'),
  (u('E5'), (now() AT TIME ZONE 'Asia/Kolkata')::date, 'IN_TRANSIT', 'Site B', '{"latitude": 28.8, "longitude": 77.4}');

-- One stored GPS point; p_eval runs the office geofence like a real ping.
CREATE FUNCTION ping(p_user text, p_lat double precision, p_lng double precision, p_mins_ago int,
                     p_eval boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO location_tracking (user_id, latitude, longitude, recorded_at, accuracy, quality_status,
                                 client_event_id, tracking_session_id)
  VALUES (u(p_user), p_lat, p_lng, now() - make_interval(mins => p_mins_ago), 10, 'RELIABLE', v,
          (SELECT id FROM tracking_sessions WHERE user_id = u(p_user)));
  IF p_eval THEN PERFORM hrms_evaluate_office_geofence(v); END IF;
END $$;
CREATE FUNCTION exits(n text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(status || CASE WHEN returned_at IS NOT NULL THEN '+returned' ELSE '' END, ',' ORDER BY detected_at), '-')
  FROM geofence_events WHERE user_id = u(n) $$;

-- ── Office exit cycle ───────────────────────────────────────────────────────
SELECT ping('E1', 28.6054, 77.2, 30);                      -- ~600 m out
SELECT t_assert('first outside point opens a potential exit', exits('E1'), 'POTENTIAL_EXIT');
SELECT t_as(u('E1'));
SELECT t_assert('employee can explain right away (tap on the first alert)',
  rpc_my_open_geofence_event(NULL)->>'status', 'POTENTIAL_EXIT');
SELECT t_as(NULL);

SELECT ping('E1', 28.6054, 77.2, 19);                      -- still out 11 min later
SELECT t_assert('confirmed after 10 minutes', exits('E1'), 'PENDING_REASON');
SELECT t_assert('employee told, with a link that opens the form',
  (SELECT string_agg((deep_link = '/HRMS/?geofenceEvent=' || (SELECT id FROM geofence_events WHERE user_id = u('E1')))::text, ',')
   FROM test_notifications WHERE user_id = u('E1') AND type = 'geofence_reason_required'), 'true');
SELECT t_assert('manager alert opens the office exits panel',
  (SELECT count(*)::text FROM pg_proc WHERE proname = 'hrms_confirm_office_exit'
     AND pg_get_functiondef(oid) LIKE '%/HRMS/admin/office-exits%'), '1');

SELECT ping('E1', 28.6001, 77.2, 10);                      -- back inside
SELECT t_assert('return keeps the confirmed exit for review', exits('E1'), 'PENDING_REASON+returned');

SELECT ping('E1', 28.6054, 77.2, 5);                       -- leaves again
SELECT t_assert('second exit on the same day is detected', exits('E1'), 'PENDING_REASON+returned,POTENTIAL_EXIT');

SELECT t_as(u('E1'));
SELECT t_assert('without a tapped id the confirmed exit comes first',
  rpc_my_open_geofence_event(NULL)->>'status', 'PENDING_REASON');
SELECT t_assert('the tapped exit is opened',
  rpc_my_open_geofence_event((SELECT id FROM geofence_events WHERE user_id = u('E1') AND status = 'POTENTIAL_EXIT'))->>'status',
  'POTENTIAL_EXIT');
SELECT rpc_submit_geofence_reason((SELECT id FROM geofence_events WHERE user_id = u('E1') AND status = 'POTENTIAL_EXIT'),
                                  'Client meeting at the bank branch');
SELECT t_assert('tapping an answered alert says so',
  rpc_my_open_geofence_event((SELECT g.id FROM geofence_events g JOIN geofence_reasons r ON r.geofence_event_id = g.id))->>'answered',
  'true');
SELECT t_as(u('E2'));
SELECT t_assert('nothing open for someone who did not leave', rpc_my_open_geofence_event(NULL)::text, 'null');
SELECT t_assert('E2 cannot open E1''s exit',
  rpc_my_open_geofence_event((SELECT id FROM geofence_events WHERE status = 'REASON_SUBMITTED'))::text, 'null');

SELECT t_as(u('HR'));
SELECT t_assert('HR review queue: both exits, return time and phone',
  (SELECT string_agg(e->>'status' || ':' || (e->>'returned_at' IS NOT NULL)::text || ':' || coalesce(e->>'phone', '-'), ',' ORDER BY e->>'status')
   FROM jsonb_array_elements(rpc_geofence_review_queue(7)) e),
  'PENDING_REASON:true:9876543210,REASON_SUBMITTED:false:9876543210');
SELECT t_as(NULL);

-- ── Location monitor ────────────────────────────────────────────────────────
SELECT ping('E3', 28.6001, 77.2, 40, false);               -- inside, 40 min ago
SELECT ping('E4', 28.7, 77.3, 2, false);                   -- at site A
SELECT ping('E5', 28.75, 77.35, 1, false);                 -- between office and site B
SELECT ping('E6', 28.6025, 77.2, 3, false);                -- ~280 m: beyond 200 m, within +150 m
SELECT ping('E7', 28.7, 77.2, 70, false);                  -- checked out

CREATE FUNCTION monitor_as(n text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM t_as(u(n));
  SELECT coalesce(string_agg((e->>'name') || ':' || (e->>'status'), ',' ORDER BY o), '-') INTO v
  FROM jsonb_array_elements(rpc_location_monitor()->'employees') WITH ORDINALITY AS t(e, o);
  RETURN v;
END $$;

SELECT t_assert('HR sees everyone checked in, most urgent first', monitor_as('HR'),
  'E1:OUTSIDE,E3:NO_RECENT_LOCATION,E2:NO_LOCATION,E6:NEAR,E5:TRAVELLING,E4:INSIDE');
SELECT t_assert('the manager sees only their team', monitor_as('M'), 'E1:OUTSIDE');
SELECT t_assert('an employee without tracking access sees nobody else',
  (SELECT count(*)::text FROM jsonb_array_elements(
     (SELECT rpc_location_monitor() FROM (SELECT t_as(u('E2'))) x)->'employees') e WHERE e->>'name' <> 'E2'), '0');

SELECT t_as(u('HR'));
CREATE TEMP TABLE m AS SELECT e FROM jsonb_array_elements(rpc_location_monitor()->'employees') e;
SELECT t_assert('outside: distance, radius, phone, last location and open exit',
  (SELECT concat_ws('|', e->>'reference_kind', e->>'reference_name', round((e->>'distance_m')::numeric / 100)::text,
                    e->>'radius_m', e->>'phone', (e->>'latitude' IS NOT NULL)::text,
                    ((e->>'location_age_min')::numeric BETWEEN 4 AND 6)::text, e->>'exit_status', e->>'exit_has_reason')
   FROM m WHERE e->>'name' = 'E1'),
  'OFFICE|O1|6|200|9876543210|true|true|REASON_SUBMITTED|true');
SELECT t_assert('stale: last known place is kept', (SELECT e->>'place_state' FROM m WHERE e->>'name' = 'E3'), 'INSIDE');
SELECT t_assert('no location: no position, not outside',
  (SELECT concat_ws('|', coalesce(e->>'latitude', 'null'), coalesce(e->>'location_at', 'null')) FROM m WHERE e->>'name' = 'E2'), 'null|null');
SELECT t_assert('visit site is the reference', (SELECT e->>'reference_kind' || '|' || (e->>'reference_name') FROM m WHERE e->>'name' = 'E4'), 'SITE|Site A');
SELECT t_as(NULL);

SELECT 'PASS 08_location_monitor' AS result;
