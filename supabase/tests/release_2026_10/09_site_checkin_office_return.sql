-- Site check-in from Home + office return (migration 20261022100000).
-- Office O1 (radius 200 m). Sites: Nimbus Arista and Tower B (~40 m apart),
-- Old Site (inactive). VK = Viral-like employee, B and C other employees.
\set ON_ERROR_STOP on
\ir mock_permissions.sql
\ir mock_geofence.sql
\ir ../../migrations/20261020100000_permission_capabilities_and_hierarchy.sql
\ir ../../migrations/20261021110000_office_exit_reviews.sql
\ir ../../migrations/20261021120000_location_monitor_and_exit_reasons.sql

-- Stand-ins for helpers outside this scenario.
CREATE TABLE risk_calls (visit_id uuid);
CREATE FUNCTION public.hrms_apply_field_visit_risk(p_visit_id uuid) RETURNS void LANGUAGE sql AS
$$ INSERT INTO risk_calls VALUES (p_visit_id) $$;
CREATE FUNCTION public.hrms_auto_checkout_at(p_date date) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
$$ SELECT (p_date::text || ' 20:00')::timestamp AT TIME ZONE 'Asia/Kolkata' $$;

\ir ../../migrations/20261022100000_site_checkin_and_office_return.sql
\ir ../../migrations/20261022100000_site_checkin_and_office_return.sql
\ir ../../migrations/20261022110000_biometric_device_linking.sql
\ir ../../migrations/20261022110000_biometric_device_linking.sql
\ir ../../migrations/20261022120000_attendance_day_events.sql
\ir ../../migrations/20261022120000_attendance_day_events.sql

INSERT INTO offices (id, name, latitude, longitude, allowed_radius_meters) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Noida 136', 28.6, 77.2, 200);
INSERT INTO predefined_sites (id, site_label, project_name, latitude, longitude, checkin_radius_m, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'Nimbus Arista', 'Nimbus', 28.62, 77.22, 100, true),
  ('00000000-0000-0000-0000-0000000000b2', 'Tower B', 'Nimbus', 28.6203, 77.2203, 100, true),
  ('00000000-0000-0000-0000-0000000000b3', 'Old Site', NULL, 28.6201, 77.2201, 100, false);
INSERT INTO profiles (id, name, role, office_id, phone) VALUES
  ('00000000-0000-0000-0000-000000000002', 'HR', 'HR', '00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-000000000011', 'VK', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', '9876543210'),
  ('00000000-0000-0000-0000-000000000012', 'B', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-000000000013', 'C', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-000000000014', 'D', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-000000000015', 'E', 'EMPLOYEE', '00000000-0000-0000-0000-0000000000a1', NULL);

CREATE FUNCTION u(n text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM profiles WHERE name = n $$;
CREATE FUNCTION loc(lat double precision, lon double precision, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS
$$ SELECT jsonb_build_object('latitude', lat, 'longitude', lon, 'accuracy', 10, 'captured_at', now()) || extra $$;
CREATE FUNCTION site_checkin(n text, site text, l jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t_as(u(n));
  r := rpc_attendance_checkin_at_site((SELECT id FROM predefined_sites WHERE site_label = site), l);
  PERFORM t_as(NULL);
  RETURN r;
END $$;
CREATE FUNCTION visits(n text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(v.location_name || ':' || v.status || coalesce(':' || v.auto_close_reason, ''), ',' ORDER BY v.checkin_time), '-')
  FROM field_visits v WHERE v.user_id = u(n) $$;
CREATE FUNCTION days(n text) RETURNS text LANGUAGE sql AS $$
  SELECT count(*)::text || ':' || coalesce(max(attendance_state), '-') || ':' || coalesce(max(attendance_type), '-')
         || ':' || coalesce((bool_or(checkout_time IS NOT NULL))::text, '-')
  FROM attendance_logs WHERE user_id = u(n) $$;

-- ── Home check-in at a predefined site ──────────────────────────────────────
SELECT t_assert('sites nearby: both close sites, nearest first, inactive hidden',
  (SELECT string_agg(e->>'name', ',' ORDER BY o) FROM jsonb_array_elements(
     (SELECT rpc_checkin_sites_nearby(loc(28.62, 77.22)) FROM (SELECT t_as(u('VK'))) x)) WITH ORDINALITY t(e, o)),
  'Nimbus Arista,Tower B');
SELECT t_assert('no site far away', (SELECT rpc_checkin_sites_nearby(loc(28.7, 77.3)))::text, '[]');
SELECT t_as(NULL);

SELECT t_assert('outside the site radius is refused',
  site_checkin('VK', 'Nimbus Arista', loc(28.63, 77.22))->>'error', 'OUTSIDE_SITE_RADIUS');
SELECT t_assert('mock location is refused',
  site_checkin('VK', 'Nimbus Arista', loc(28.62, 77.22, '{"mocked": true}'))->>'error', 'GPS_NOT_TRUSTED');
SELECT t_assert('an old GPS reading is refused',
  site_checkin('VK', 'Nimbus Arista', loc(28.62, 77.22) || jsonb_build_object('captured_at', now() - interval '5 minutes'))->>'error',
  'GPS_NOT_TRUSTED');
SELECT t_assert('an inactive site is refused',
  site_checkin('VK', 'Old Site', loc(28.6201, 77.2201))->>'error', 'SITE_NOT_AVAILABLE');
SELECT t_assert('nothing was created by refused attempts', visits('VK') || '|' || days('VK'), '-|0:-:-:-');

SELECT t_assert('check-in at the site starts the day',
  site_checkin('VK', 'Nimbus Arista', loc(28.62, 77.22))->>'mode', 'STARTED_DAY');
SELECT t_assert('one attendance row, on the visit, through the existing link',
  days('VK'), '1:ON_FIELD_VISIT:FIELD_VISIT:false');
SELECT t_assert('a checked-in site visit, marked as a Home site check-in',
  (SELECT location_name || ':' || status || ':' || journey_status || ':' || visit_type FROM field_visits WHERE user_id = u('VK')),
  'Nimbus Arista:CHECKED_IN:SITE_CHECKED_IN:site');
SELECT t_assert('a repeated tap returns the same visit',
  site_checkin('VK', 'Nimbus Arista', loc(28.62, 77.22))->>'mode', 'ALREADY_AT_SITE');
SELECT t_assert('still one visit and one day', visits('VK') || '|' || days('VK'),
  'Nimbus Arista:CHECKED_IN|1:ON_FIELD_VISIT:FIELD_VISIT:false');

SELECT t_assert('moving to the next site switches the work place',
  site_checkin('VK', 'Tower B', loc(28.6203, 77.2203))->>'mode', 'SWITCHED_TO_SITE');
SELECT t_assert('the first site ends (kept), the new one is active, still one day',
  visits('VK') || '|' || days('VK'),
  'Nimbus Arista:COMPLETED:SITE_CHANGE,Tower B:CHECKED_IN|1:ON_FIELD_VISIT:FIELD_VISIT:false');
SELECT t_assert('audit row per site check-in',
  (SELECT count(*)::text FROM hrms_audit_events WHERE action = 'SITE_CHECKIN_FROM_HOME' AND target_user_id = u('VK')), '2');

-- ── Office return ───────────────────────────────────────────────────────────
-- GPS saw VK leave Tower B 30 min after check-in; office punch 60 min after.
UPDATE field_visits SET departed_at = checkin_time + interval '30 minutes'
WHERE user_id = u('VK') AND location_name = 'Tower B';
INSERT INTO smartoffice_device_logs (user_id, employee_code, log_date, log_date_only, office_id)
SELECT u('VK'), '101', checkin_time + interval '60 minutes', date, '00000000-0000-0000-0000-0000000000a1'
FROM field_visits WHERE user_id = u('VK') AND location_name = 'Tower B';

SELECT t_assert('office punch ends the site visit (history kept)',
  visits('VK'), 'Nimbus Arista:COMPLETED:SITE_CHANGE,Tower B:COMPLETED:OFFICE_RETURN_BIOMETRIC');
SELECT t_assert('the visit ends when GPS saw them leave, at the punch office',
  (SELECT (checkout_time = departed_at)::text || ':' || (checkout_office_id = '00000000-0000-0000-0000-0000000000a1')::text
   FROM field_visits WHERE user_id = u('VK') AND location_name = 'Tower B'), 'true:true');
SELECT t_assert('the workday is not checked out; back to working', days('VK'), '1:WORKING:FIELD_VISIT:false');
SELECT t_assert('running it again changes nothing',
  hrms_close_visits_on_office_return(u('VK'), (now() AT TIME ZONE 'Asia/Kolkata')::date)::text, '0');

-- A late-arriving punch from BEFORE the visit never closes it.
SELECT site_checkin('B', 'Nimbus Arista', loc(28.62, 77.22));
INSERT INTO smartoffice_device_logs (user_id, employee_code, log_date, log_date_only, office_id)
VALUES (u('B'), '102', now() - interval '3 hours', (now() AT TIME ZONE 'Asia/Kolkata')::date, '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert('a punch older than the visit is ignored', visits('B'), 'Nimbus Arista:CHECKED_IN');
-- A device not mapped to an office proves nothing about the office.
INSERT INTO smartoffice_device_logs (user_id, employee_code, log_date, log_date_only, office_id)
VALUES (u('B'), '102', now() + interval '1 hour', (now() AT TIME ZONE 'Asia/Kolkata')::date, NULL);
SELECT t_assert('a punch from an unmapped device is ignored', visits('B'), 'Nimbus Arista:CHECKED_IN');

-- The punch import is never blocked by reconciliation.
CREATE OR REPLACE FUNCTION public.hrms_apply_field_visit_risk(p_visit_id uuid) RETURNS void LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'risk engine down'; END $$;
INSERT INTO smartoffice_device_logs (user_id, employee_code, log_date, log_date_only, office_id)
VALUES (u('B'), '102', now() + interval '2 hours', (now() AT TIME ZONE 'Asia/Kolkata')::date, '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert('the punch is stored even when reconciliation fails',
  (SELECT count(*)::text FROM smartoffice_device_logs WHERE user_id = u('B')), '3');
SELECT t_assert('and the visit stays as it was (rolled back, retried on the next punch)', visits('B'), 'Nimbus Arista:CHECKED_IN');
CREATE OR REPLACE FUNCTION public.hrms_apply_field_visit_risk(p_visit_id uuid) RETURNS void LANGUAGE sql AS
$$ INSERT INTO risk_calls VALUES (p_visit_id) $$;

-- Checked out for the day: no site check-in.
UPDATE attendance_logs SET checkout_time = now() WHERE user_id = u('B');
SELECT t_assert('no site check-in after the day is checked out',
  site_checkin('B', 'Tower B', loc(28.6203, 77.2203))->>'error', 'ALREADY_CHECKED_OUT');

-- ── Location Monitor: a left site is no longer the place ────────────────────
SELECT site_checkin('C', 'Nimbus Arista', loc(28.62, 77.22));
UPDATE field_visits SET departed_at = now() - interval '5 minutes' WHERE user_id = u('C');
INSERT INTO tracking_sessions (user_id, attendance_log_id, started_at)
SELECT user_id, id, now() - interval '1 hour' FROM attendance_logs WHERE user_id = u('C');
INSERT INTO location_tracking (user_id, latitude, longitude, recorded_at, accuracy, quality_status, client_event_id)
VALUES (u('C'), 28.6001, 77.2, now() - interval '2 minutes', 10, 'RELIABLE', gen_random_uuid());
SELECT t_as(u('HR'));
SELECT t_assert('left site: compared with the office again, and the left site is named',
  (SELECT concat_ws('|', e->>'status', e->>'reference_kind', e->>'reference_name', e->>'left_site_name')
   FROM jsonb_array_elements(rpc_location_monitor()->'employees') e WHERE e->>'name' = 'C'),
  'INSIDE|OFFICE|Noida 136|Nimbus Arista');
SELECT t_as(NULL);

-- ── HR Panel -> Biometric Devices ───────────────────────────────────────────
-- D is at a site; the office machine (not linked yet) records D afterwards.
SELECT site_checkin('D', 'Nimbus Arista', loc(28.62, 77.22));
INSERT INTO smartoffice_device_logs (user_id, employee_code, serial_number, log_date, log_date_only)
SELECT u('D'), '104', 'CEXJ203660057', checkin_time + interval '45 minutes', date
FROM field_visits WHERE user_id = u('D');
SELECT t_assert('an unlinked machine proves nothing: the visit stays open', visits('D'), 'Nimbus Arista:CHECKED_IN');

SELECT t_as(u('D'));
SELECT t_assert('employees cannot see or link devices',
  (SELECT count(*)::text FROM (SELECT 1 WHERE public.hrms_can_manage_biometric()) x), '0');
SELECT t_as(u('HR'));
SELECT t_assert('HR sees the machine as not linked, with its office suggested',
  (SELECT concat_ws('|', e->>'serial', coalesce(e->>'linked_office_name', 'NOT LINKED'), e->>'suggested_office_name', e->>'punches_without_office')
   FROM jsonb_array_elements(rpc_biometric_device_overview()) e WHERE e->>'serial' = 'CEXJ203660057'),
  'CEXJ203660057|NOT LINKED|Noida 136|1');
SELECT t_assert('linking fills its punches and ends the visit it proves over',
  (SELECT r->>'punches_given_office' || '|' || (r->>'visits_closed')
   FROM (SELECT rpc_link_biometric_device('CEXJ203660057', '00000000-0000-0000-0000-0000000000a1') r) x), '1|1');
SELECT t_assert('linking again changes nothing more',
  (SELECT r->>'punches_given_office' || '|' || (r->>'visits_closed')
   FROM (SELECT rpc_link_biometric_device('CEXJ203660057', '00000000-0000-0000-0000-0000000000a1') r) x), '0|0');
SELECT t_assert('now shown as linked', (SELECT e->>'linked_office_name' FROM jsonb_array_elements(rpc_biometric_device_overview()) e
  WHERE e->>'serial' = 'CEXJ203660057'), 'Noida 136');
SELECT t_assert('linking is audited',
  (SELECT count(*)::text FROM hrms_audit_events WHERE action = 'BIOMETRIC_DEVICE_LINKED'), '2');
SELECT t_as(NULL);
SELECT t_assert('D: visit ended by the office punch, day still open',
  visits('D') || '|' || days('D'), 'Nimbus Arista:COMPLETED:OFFICE_RETURN_BIOMETRIC|1:WORKING:FIELD_VISIT:false');
INSERT INTO smartoffice_device_logs (user_id, employee_code, serial_number, log_date, log_date_only)
VALUES (u('D'), '104', 'CEXJ203660057', now() + interval '3 hours', (now() AT TIME ZONE 'Asia/Kolkata')::date);
SELECT t_assert('new punches from the linked machine get its office automatically',
  (SELECT count(*)::text FROM smartoffice_device_logs WHERE serial_number = 'CEXJ203660057' AND office_id IS NULL), '0');

-- ── One story per day: every interaction, in time order ────────────────────
CREATE FUNCTION story(viewer text, n text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM t_as(u(viewer));
  SELECT string_agg(ev->>'type', ',' ORDER BY o) INTO v
  FROM jsonb_array_elements(rpc_attendance_day_events((now() AT TIME ZONE 'Asia/Kolkata')::date,
                                                       (now() AT TIME ZONE 'Asia/Kolkata')::date)) d,
       jsonb_array_elements(d->'events') WITH ORDINALITY t(ev, o)
  WHERE d->>'user_id' = u(n)::text;
  PERFORM t_as(NULL);
  RETURN coalesce(v, '-');
END $$;

SELECT t_assert('site in the morning, then the office machine: both in one story',
  story('HR', 'D'), 'CHECK_IN,SITE_IN,SITE_OUT,BIO_PUNCH,BIO_PUNCH');
SELECT t_as(u('HR'));
SELECT t_assert('the punch names its office once the machine is linked',
  (SELECT ev->>'place' || '|' || (ev->>'verified')
   FROM jsonb_array_elements(rpc_attendance_day_events((now() AT TIME ZONE 'Asia/Kolkata')::date,
                                                       (now() AT TIME ZONE 'Asia/Kolkata')::date)) d,
        jsonb_array_elements(d->'events') ev
   WHERE d->>'user_id' = u('D')::text AND ev->>'type' = 'BIO_PUNCH' LIMIT 1), 'Noida 136|true');
SELECT t_assert('two sites, then back at the office, in order',
  story('HR', 'VK'), 'CHECK_IN,SITE_IN,SITE_OUT,SITE_IN,SITE_OUT,BIO_PUNCH');
SELECT t_as(u('HR'));
SELECT t_assert('the visit end says why',
  (SELECT string_agg(ev->>'title', ' / ' ORDER BY o)
   FROM jsonb_array_elements(rpc_attendance_day_events((now() AT TIME ZONE 'Asia/Kolkata')::date,
                                                       (now() AT TIME ZONE 'Asia/Kolkata')::date)) d,
        jsonb_array_elements(d->'events') WITH ORDINALITY t(ev, o)
   WHERE d->>'user_id' = u('VK')::text AND ev->>'type' = 'SITE_OUT'),
  'Site visit ended (moved to next site) / Site visit ended (back at office)');
SELECT t_assert('an employee sees only their own day',
  (SELECT count(*)::text FROM jsonb_array_elements(
     (SELECT rpc_attendance_day_events((now() AT TIME ZONE 'Asia/Kolkata')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date)
      FROM (SELECT t_as(u('D'))) x)) d WHERE d->>'user_id' <> u('D')::text), '0');
SELECT t_as(NULL);

-- E: office day with an event, a 50-minute GPS gap and an approved correction.
INSERT INTO attendance_logs (user_id, date, office_id, checkin_time, status, checkin_source, checkin_location_name)
VALUES (u('E'), (now() AT TIME ZONE 'Asia/Kolkata')::date, '00000000-0000-0000-0000-0000000000a1',
        now() - interval '3 hours', 'CHECKED_IN', 'APP', 'Noida 136');
INSERT INTO location_tracking (user_id, latitude, longitude, recorded_at, accuracy, quality_status, client_event_id) VALUES
  (u('E'), 28.6, 77.2, now() - interval '100 minutes', 10, 'RELIABLE', gen_random_uuid()),
  (u('E'), 28.6, 77.2, now() - interval '50 minutes', 10, 'RELIABLE', gen_random_uuid());
INSERT INTO events (id, title) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Site launch');
INSERT INTO event_checkins (event_id, user_id, checkin_time, checkout_time)
VALUES ('00000000-0000-0000-0000-0000000000e1', u('E'), now() - interval '40 minutes', now() - interval '20 minutes');
INSERT INTO attendance_regularization_requests (attendance_id, user_id, request_type, status, reviewed_at)
SELECT id, user_id, 'CHECKOUT', 'APPROVED', now() - interval '10 minutes' FROM attendance_logs WHERE user_id = u('E');
SELECT t_assert('app day, location gap, event and correction in one story',
  story('HR', 'E'), 'CHECK_IN,GPS_GAP,EVENT_IN,EVENT_OUT,REGULARIZED');
SELECT t_as(u('HR'));
SELECT t_assert('the gap says how long',
  (SELECT ev->>'title' FROM jsonb_array_elements(rpc_attendance_day_events((now() AT TIME ZONE 'Asia/Kolkata')::date,
                                                                          (now() AT TIME ZONE 'Asia/Kolkata')::date)) d,
          jsonb_array_elements(d->'events') ev
   WHERE d->>'user_id' = u('E')::text AND ev->>'type' = 'GPS_GAP'), 'No location for 50 min');

SELECT 'PASS 09_site_checkin_office_return' AS result;
