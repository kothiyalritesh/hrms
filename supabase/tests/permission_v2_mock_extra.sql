\set ON_ERROR_STOP 1
-- SAFETY GUARD: local throwaway test database only. NEVER run in Supabase /
-- production (this file creates mock tables and can drop/alter real data).
DO $guard$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL OR to_regclass('storage.objects') IS NOT NULL
     OR current_database() = 'postgres' THEN
    RAISE EXCEPTION 'LOCAL_TEST_DATABASE_ONLY: this test file must not run on a Supabase/production database';
  END IF;
END $guard$;
-- Extra mock objects needed by 20261007100000 / 20261007110000.
CREATE TABLE IF NOT EXISTS public.leave_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text);
CREATE TABLE IF NOT EXISTS public.tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assigned_to uuid, status text, due_date date);
CREATE TABLE IF NOT EXISTS public.support_tickets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text);
CREATE TABLE IF NOT EXISTS public.location_tracking (id bigserial PRIMARY KEY, user_id uuid, recorded_at timestamp,
  latitude double precision, longitude double precision);
CREATE TABLE IF NOT EXISTS public.hrms_audit_events (id bigserial PRIMARY KEY, actor_user_id uuid, target_user_id uuid,
  action text, entity_type text, entity_id uuid, new_values jsonb, source text);
CREATE OR REPLACE FUNCTION public.hrms_timestamp(p timestamp) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
$$ SELECT p AT TIME ZONE 'Asia/Kolkata' $$;
