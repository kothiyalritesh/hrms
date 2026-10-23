-- Employee bulk import saves every template column (migration 20261023120000).
-- rpc_admin_save_profile is reduced to the parts the import depends on, with
-- the production rules: gender becomes MALE when not given, email and employee
-- number are overwritten, joining date is kept when blank, birth date only
-- changes when the key is sent.
\set ON_ERROR_STOP on
ALTER TABLE profiles ADD COLUMN phone text, ADD COLUMN email text, ADD COLUMN gender text,
  ADD COLUMN date_of_joining date, ADD COLUMN team text, ADD COLUMN role_id uuid,
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz;
CREATE TABLE roles (id uuid PRIMARY KEY, name text);
INSERT INTO roles VALUES ('00000000-0000-0000-0000-0000000000e1', 'EMPLOYEE');
INSERT INTO offices (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Noida 136');
INSERT INTO profiles (id, name, role) VALUES ('00000000-0000-0000-0000-000000000001', 'HR', 'HR');
INSERT INTO profiles (id, name, role, phone, email, employee_number, gender, date_of_joining, date_of_birth, weekly_off_day)
VALUES ('00000000-0000-0000-0000-000000000002', 'Anjali', 'EMPLOYEE', '9876500001', 'anjali@x.in', '446',
        'FEMALE', '2024-04-01', '1995-05-05', 0);

CREATE FUNCTION require_profile_admin() RETURNS text LANGUAGE sql AS $$ SELECT 'HR' $$;
CREATE FUNCTION hrms_profile_dob_from_values(p_values jsonb, p_current date) RETURNS date LANGUAGE sql AS
$$ SELECT CASE WHEN p_values ? 'date_of_birth' THEN nullif(p_values->>'date_of_birth', '')::date ELSE p_current END $$;
CREATE FUNCTION rpc_admin_save_profile(p_profile_id uuid, p_values jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := p_profile_id;
  v_gender text := coalesce(upper(btrim(p_values->>'gender')), 'MALE');
  v_doj date := nullif(p_values->>'date_of_joining', '')::date;
BEGIN
  IF v_id IS NULL THEN
    INSERT INTO profiles (id, name, email, phone, employee_number, role, role_id, office_id, team, is_active, gender,
                          date_of_joining, date_of_birth)
    VALUES (gen_random_uuid(), p_values->>'name', nullif(p_values->>'email', ''), p_values->>'phone',
            nullif(p_values->>'employee_number', ''), p_values->>'role', (p_values->>'role_id')::uuid,
            (p_values->>'office_id')::uuid, p_values->>'team', true, v_gender, v_doj,
            hrms_profile_dob_from_values(p_values, NULL))
    RETURNING id INTO v_id;
  ELSE
    UPDATE profiles SET name = p_values->>'name', email = nullif(btrim(p_values->>'email'), ''),
      employee_number = nullif(btrim(p_values->>'employee_number'), ''), role = p_values->>'role',
      office_id = (p_values->>'office_id')::uuid, team = p_values->>'team', gender = v_gender,
      date_of_joining = coalesce(v_doj, date_of_joining),
      date_of_birth = hrms_profile_dob_from_values(p_values, date_of_birth)
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'profile_id', v_id);
END $$;

-- Production: the 2026-07-30 import sits behind the permission wrapper as __core.
\ir ../../migrations/20260730110000_idempotent_employee_import.sql
ALTER FUNCTION rpc_admin_import_employee_profiles_v2(uuid, jsonb) RENAME TO rpc_admin_import_employee_profiles_v2__core;
\ir ../../migrations/20261023120000_employee_import_all_columns.sql
\ir ../../migrations/20261023120000_employee_import_all_columns.sql

SELECT t_as('00000000-0000-0000-0000-000000000001');
CREATE FUNCTION row_json(extra jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('row_number', '2', 'name', 'Anjali', 'phone', '9876500001',
    'role_id', '00000000-0000-0000-0000-0000000000e1', 'office_id', '00000000-0000-0000-0000-0000000000a1') || extra $$;
CREATE FUNCTION err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'no error'; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
CREATE FUNCTION anjali() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('|', email, employee_number, gender, date_of_joining, date_of_birth, weekly_off_day, joining_date)
  FROM profiles WHERE phone = '9876500001' $$;

CREATE FUNCTION rohit() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('|', gender, date_of_joining, weekly_off_day) FROM profiles WHERE phone = '9876500002' $$;

SELECT t_assert('the live function body was replaced',
  (SELECT (pg_get_functiondef('rpc_admin_import_employee_profiles_v2__core(uuid,jsonb)'::regprocedure) LIKE '%date_of_joining%')::text), 'true');

SELECT t_assert('re-importing with blank optional cells keeps everything (gender no longer reset to MALE)',
  (rpc_admin_import_employee_profiles_v2__core(gen_random_uuid(), jsonb_build_array(row_json('{}')))->>'updated') || ' ' || anjali(),
  '1 anjali@x.in|446|FEMALE|2024-04-01|1995-05-05|0');

SELECT t_assert('filled cells are saved; joining date goes to the real joining date only',
  (rpc_admin_import_employee_profiles_v2__core(gen_random_uuid(), jsonb_build_array(row_json(
     '{"email": "a@new.in", "employee_number": "447", "gender": "FEMALE", "date_of_joining": "2023-02-01",
       "date_of_birth": "1996-06-06", "weekly_off_day": 6}')))->>'success') || ' ' || anjali(),
  'true a@new.in|447|FEMALE|2023-02-01|1996-06-06|6');

SELECT t_assert('a new employee gets every column',
  (rpc_admin_import_employee_profiles_v2__core(gen_random_uuid(), jsonb_build_array(row_json(
     '{"name": "Rohit", "phone": "9876500002", "gender": "MALE", "date_of_joining": "2026-10-20", "weekly_off_day": 2}')))->>'inserted')
  || ' ' || rohit(),
  '1 MALE|2026-10-20|2');

SELECT t_assert('an unreadable date stops the import with the row number',
  err($$SELECT rpc_admin_import_employee_profiles_v2__core(gen_random_uuid(),
          jsonb_build_array(row_json('{"date_of_joining": "31/02/2026"}')))$$), 'ROW_2_INVALID_DATE_OF_JOINING');
SELECT t_assert('a bad weekly off stops it too',
  err($$SELECT rpc_admin_import_employee_profiles_v2__core(gen_random_uuid(),
          jsonb_build_array(row_json('{"weekly_off_day": 9}')))$$), 'ROW_2_INVALID_WEEKLY_OFF');
SELECT t_assert('nothing was half-saved by the failed imports', anjali(), 'a@new.in|447|FEMALE|2023-02-01|1996-06-06|6');

SELECT 'PASS 11_employee_import' AS result;
