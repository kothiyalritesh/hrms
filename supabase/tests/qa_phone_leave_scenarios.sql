\set ON_ERROR_STOP 1
-- SAFETY GUARD: local throwaway test database only. NEVER run in Supabase /
-- production (this file creates mock tables and can drop/alter real data).
DO $guard$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL OR to_regclass('storage.objects') IS NOT NULL
     OR current_database() = 'postgres' THEN
    RAISE EXCEPTION 'LOCAL_TEST_DATABASE_ONLY: this test file must not run on a Supabase/production database';
  END IF;
END $guard$;
-- Local test for 20261006190000_qa_phone_uniqueness_and_leave_reset.sql
-- Run against a throwaway database (see run_permission_tests.sh for the pattern):
--   psql -v ON_ERROR_STOP=1 -d qa_test -f qa_phone_leave_scenarios.sql
-- Creates a minimal mock schema, applies the migration, checks behaviour.

\set QUIET on
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, email text, phone text, employee_number text, role text, role_id uuid,
  office_id uuid, team text, is_active boolean DEFAULT true, gender text,
  date_of_joining date, is_service_account boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz
);
CREATE TABLE public.hrms_audit_events (
  id bigserial PRIMARY KEY, actor_user_id uuid, target_user_id uuid, action text,
  entity_type text, entity_id uuid NOT NULL, new_values jsonb, source text
);
CREATE TABLE public.leave_balance (
  user_id uuid PRIMARY KEY, sick numeric DEFAULT 0, casual numeric DEFAULT 0,
  earned numeric DEFAULT 0, comp_off numeric DEFAULT 0, updated_at timestamptz
);
CREATE TABLE public.leave_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, leave_type text,
  transaction_type text, quantity numeric, balance_before numeric, balance_after numeric,
  effective_date date, accrual_month date, source_type text, source_id uuid, reason text,
  created_by uuid, idempotency_key text UNIQUE
);
CREATE FUNCTION public.log_audit_event(text, text, text, jsonb, jsonb) RETURNS void
LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.require_profile_admin() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; BEGIN
  SELECT upper(role) INTO r FROM public.profiles WHERE id = auth.uid();
  IF r NOT IN ('SYSTEM_ADMIN','ADMIN','HR','HRD') OR r IS NULL THEN RAISE EXCEPTION 'PROFILE_ADMIN_REQUIRED'; END IF;
  RETURN r; END $$;
CREATE FUNCTION public.apply_leave_transaction(
  p_user_id uuid,p_leave_type text,p_transaction_type text,p_quantity numeric,
  p_effective_date date,p_accrual_month date,p_source_type text,p_source_id uuid,
  p_reason text,p_created_by uuid,p_idempotency_key text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_column text:=lower(p_leave_type);v_before numeric;v_after numeric;v_id uuid;
BEGIN
 INSERT INTO public.leave_balance(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
 EXECUTE format('select coalesce(%I,0) from public.leave_balance where user_id=$1',v_column) INTO v_before USING p_user_id;
 v_after:=v_before+p_quantity;
 IF v_after<0 THEN RAISE EXCEPTION 'INSUFFICIENT_LEAVE_BALANCE'; END IF;
 EXECUTE format('update public.leave_balance set %I=$1 where user_id=$2',v_column) USING v_after,p_user_id;
 INSERT INTO public.leave_transactions(user_id,leave_type,transaction_type,quantity,balance_before,balance_after,
   effective_date,source_type,reason,created_by,idempotency_key)
 VALUES(p_user_id,upper(p_leave_type),p_transaction_type,p_quantity,v_before,v_after,p_effective_date,
   p_source_type,p_reason,p_created_by,p_idempotency_key) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

-- legacy data: two rows already share a number in different formats
INSERT INTO public.profiles(id,name,phone,role,gender) VALUES
 ('00000000-0000-0000-0000-0000000000a1','HR Admin','9000000001','HR','FEMALE'),
 ('00000000-0000-0000-0000-0000000000b1','Legacy A','919811111111','EMPLOYEE','MALE'),
 ('00000000-0000-0000-0000-0000000000b2','Legacy B','9811111111','EMPLOYEE','FEMALE'),
 ('00000000-0000-0000-0000-0000000000c1','Asha','9822222222','EMPLOYEE','FEMALE');
INSERT INTO public.profiles(id,name,phone,role,gender,is_service_account) VALUES
 ('00000000-0000-0000-0000-0000000000d1','Bot',NULL,'EMPLOYEE','MALE',true);

\i ../migrations/20261006190000_qa_phone_uniqueness_and_leave_reset.sql
\set QUIET off

SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);

CREATE TEMP TABLE results(name text, pass boolean, detail text);

-- 1. new employee with +91 form of an existing number is rejected
DO $$ BEGIN
  PERFORM public.rpc_admin_save_profile(null, '{"name":"Dup","phone":"+91 98222 22222","role":"ADMIN"}');
  INSERT INTO results VALUES ('plus91_duplicate_rejected', false, 'accepted');
EXCEPTION WHEN unique_violation THEN
  INSERT INTO results VALUES ('plus91_duplicate_rejected', SQLERRM = 'PHONE_NUMBER_ALREADY_EXISTS', SQLERRM);
END $$;

-- 2. leading 0 form also rejected
DO $$ BEGIN
  PERFORM public.rpc_admin_save_profile(null, '{"name":"Dup","phone":"09822222222"}');
  INSERT INTO results VALUES ('zero_prefix_duplicate_rejected', false, 'accepted');
EXCEPTION WHEN unique_violation THEN
  INSERT INTO results VALUES ('zero_prefix_duplicate_rejected', true, SQLERRM);
END $$;

-- 3. new number stored normalised to 10 digits
CREATE TEMP TABLE saved AS
SELECT public.rpc_admin_save_profile(null, '{"name":"New","phone":"+91-98333-33333","gender":"female"}') r;
INSERT INTO results
SELECT 'new_number_normalised',
       (r->>'phone') = '9833333333' AND (SELECT phone FROM public.profiles WHERE id = (r->>'profile_id')::uuid) = '9833333333',
       r::text
FROM saved;

-- 4. editing a legacy duplicate without changing its number still works
INSERT INTO results
SELECT 'legacy_duplicate_still_editable', (r->>'success')::boolean, r::text
FROM (SELECT public.rpc_admin_save_profile('00000000-0000-0000-0000-0000000000b2',
      '{"name":"Legacy B renamed","phone":"9811111111"}') r) x;

-- 5. changing someone's number to a taken number is rejected
DO $$ BEGIN
  PERFORM public.rpc_admin_save_profile('00000000-0000-0000-0000-0000000000c1', '{"name":"Asha","phone":"9000000001"}');
  INSERT INTO results VALUES ('edit_to_taken_number_rejected', false, 'accepted');
EXCEPTION WHEN unique_violation THEN
  INSERT INTO results VALUES ('edit_to_taken_number_rejected', true, SQLERRM);
END $$;

-- 6. trigger catches direct inserts (bulk import / SQL)
DO $$ BEGIN
  INSERT INTO public.profiles(name, phone) VALUES ('Direct', '919000000001');
  INSERT INTO results VALUES ('trigger_blocks_direct_insert', false, 'accepted');
EXCEPTION WHEN unique_violation THEN
  INSERT INTO results VALUES ('trigger_blocks_direct_insert', true, SQLERRM);
END $$;

-- 7. updating other columns of a legacy duplicate is not blocked
DO $$ BEGIN
  UPDATE public.profiles SET name = 'Legacy A2' WHERE id = '00000000-0000-0000-0000-0000000000b1';
  INSERT INTO results VALUES ('legacy_row_other_column_update_ok', true, null);
EXCEPTION WHEN others THEN
  INSERT INTO results VALUES ('legacy_row_other_column_update_ok', false, SQLERRM);
END $$;

-- 8. reset all: female 2, male 1 sick days; service accounts skipped
INSERT INTO public.leave_balance(user_id, sick) VALUES ('00000000-0000-0000-0000-0000000000c1', 5);
INSERT INTO results
SELECT 'reset_all_runs', (r->>'success')::boolean, r::text
FROM (SELECT public.rpc_admin_reset_all_leave_balances('sick', 2, 1, 'Monthly Allocation') r) x;
INSERT INTO results
SELECT 'reset_all_values',
  (SELECT sick FROM public.leave_balance WHERE user_id = '00000000-0000-0000-0000-0000000000c1') = 2
  AND (SELECT sick FROM public.leave_balance WHERE user_id = '00000000-0000-0000-0000-0000000000b1') = 1
  AND NOT EXISTS (SELECT 1 FROM public.leave_balance WHERE user_id = '00000000-0000-0000-0000-0000000000d1'),
  (SELECT string_agg(user_id || '=' || sick, ', ') FROM public.leave_balance);

-- 9. reset all rejected for a non-admin
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000c1',false);
DO $$ BEGIN
  PERFORM public.rpc_admin_reset_all_leave_balances('sick', 2, 1, 'Monthly Allocation');
  INSERT INTO results VALUES ('reset_all_non_admin_rejected', false, 'accepted');
EXCEPTION WHEN others THEN
  INSERT INTO results VALUES ('reset_all_non_admin_rejected', SQLERRM = 'ADMIN_PERMISSION_REQUIRED', SQLERRM);
END $$;

SELECT name, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, detail FROM results ORDER BY name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass OR pass IS NULL) AS failed FROM results;
