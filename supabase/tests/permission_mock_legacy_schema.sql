\set ON_ERROR_STOP 1
-- SAFETY GUARD: local throwaway test database only. NEVER run in Supabase /
-- production (this file creates mock tables and can drop/alter real data).
DO $guard$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL OR to_regclass('storage.objects') IS NOT NULL
     OR current_database() = 'postgres' THEN
    RAISE EXCEPTION 'LOCAL_TEST_DATABASE_ONLY: this test file must not run on a Supabase/production database';
  END IF;
END $guard$;
-- Minimal Supabase-like mock in the LEGACY shape the live DB most likely has.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TYPE public.permission_scope AS ENUM ('GLOBAL','OFFICE','DEPARTMENT','TEAM','SELF');

CREATE TABLE public.offices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_active boolean DEFAULT true);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, name text, role text, is_active boolean DEFAULT true,
  office_id uuid REFERENCES public.offices(id), team_id uuid, team text, department text,
  reports_to uuid, employee_number text, attendance_reporting_enabled boolean DEFAULT true,
  show_on_tv boolean DEFAULT true, joining_date date, last_working_date date);
CREATE TABLE public.teams (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  office_id uuid REFERENCES public.offices(id), team_head_id uuid, is_active boolean DEFAULT true);

CREATE FUNCTION public.normalize_profile_role(p_role text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE regexp_replace(upper(btrim(coalesce(p_role,''))),'[^A-Z0-9]+','_','g')
    WHEN 'SUPER_ADMIN' THEN 'SYSTEM_ADMIN' WHEN 'HR_MANAGER' THEN 'HR'
    ELSE regexp_replace(upper(btrim(coalesce(p_role,''))),'[^A-Z0-9]+','_','g') END $$;

-- the escalation bug as it is live
CREATE FUNCTION public.is_profile_admin() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('SYSTEM_ADMIN','ADMIN','HR','HRD')) THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM user_permissions WHERE user_id = auth.uid() AND revoked_at IS NULL);
END $$;
CREATE FUNCTION public.require_profile_admin() RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN RETURN 'X'; END $$;

-- user_permissions: legacy shape
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission text NOT NULL, granted_by uuid, granted_at timestamptz NOT NULL DEFAULT now(),
  constraint user_permissions_unique unique (user_id, permission));
ALTER TABLE public.user_permissions
  ADD COLUMN scope text NOT NULL DEFAULT 'GLOBAL' CHECK (scope in ('GLOBAL','DEPARTMENT','BRANCH','TEAM','SELF')),
  ADD COLUMN scope_id uuid DEFAULT null, ADD COLUMN revoked_at timestamptz, ADD COLUMN created_by uuid;
ALTER TABLE public.user_permissions DROP CONSTRAINT user_permissions_unique;
CREATE UNIQUE INDEX idx_user_permissions_unique_scoped ON public.user_permissions(user_id, permission, scope,
  coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE revoked_at IS NULL;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_permissions_select ON public.user_permissions FOR SELECT USING (true);

CREATE TABLE public.permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), permission_key text NOT NULL UNIQUE,
  module text NOT NULL, action text NOT NULL, description text, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE TABLE public.roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.role_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_id uuid);
CREATE TABLE public.user_permission_overrides (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.permission_audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performed_by uuid, target_user_id uuid, target_role_id uuid, permission_id uuid, old_scope_id uuid,
  reason text, created_at timestamptz NOT NULL DEFAULT now(),
  check (target_user_id is not null or target_role_id is not null));
CREATE TABLE public.work_schedule_configs (id serial PRIMARY KEY);
CREATE TABLE public.audit_logs (id serial, performed_at timestamptz DEFAULT now(), performed_by uuid, table_name text);
CREATE TABLE public.smartoffice_device_logs (id serial PRIMARY KEY, user_id uuid);
ALTER TABLE public.smartoffice_device_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "System can insert device logs" ON public.smartoffice_device_logs FOR INSERT WITH CHECK (true);
CREATE FUNCTION public.rpc_sync_biometric_punches(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.rpc_admin_attendance_daily_v3(date, date) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '[]'::jsonb $$;
CREATE FUNCTION public.rpc_admin_audit_logs_summary() RETURNS json LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::json $$;
CREATE FUNCTION public.get_my_permissions() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT '[]'::jsonb $$;
CREATE FUNCTION public.can_access_user_data(p_target_user_id uuid, p_permission text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.admin_grant_permission(p_user_id uuid, p_permission text, p_scope text, p_scope_id text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.admin_revoke_permission(p_user_id uuid, p_permission text, p_scope text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.admin_revoke_permission(p_user_id uuid, p_permission text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;

-- attendance
CREATE TABLE public.attendance_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, date date,
  checkin_time timestamptz, checkout_time timestamptz, status text, checkout_source text, corrected_by uuid,
  correction_reason text, undo_token text, undo_expires_at timestamptz, updated_at timestamptz, is_late boolean);
CREATE TABLE public.attendance_audit_logs (id serial, attendance_id uuid, user_id uuid, action text, old_status text,
  new_status text, old_checkout_at timestamptz, new_checkout_at timestamptz, reason text, source text);
CREATE TABLE public.attendance_regularization_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
  attendance_id uuid, status text, requested_checkout timestamptz, reason text, reviewed_by uuid, reviewed_at timestamptz,
  review_notes text, created_at timestamptz DEFAULT now());
CREATE TABLE public.attendance_policies (id serial, office_id uuid, role text, is_active boolean, late_checkin_time time NOT NULL DEFAULT '10:30',
  min_work_duration_minutes int, earliest_checkout_time text, auto_close_time text, allow_night_shift boolean,
  require_early_checkout_reason boolean, undo_checkout_minutes int, checkin_reminder_time time, checkout_reminder_time time);

CREATE VIEW public.v_attendance_daily_canonical WITH (security_invoker = true) AS
  SELECT p.id user_id, d::date work_date, p.name employee_name, p.office_id, p.team_id,
         NULL::text office_name, NULL::text team_name, NULL::text check_in_office_name, NULL::text attendance_status,
         NULL::timestamptz official_first_in, NULL::text first_in_source, NULL::timestamptz official_last_out, NULL::text last_out_source
  FROM public.profiles p CROSS JOIN generate_series('2026-09-01'::date, '2026-09-01'::date, '1 day') d;

CREATE FUNCTION public.rpc_attendance_canonical_range(p_start_date date, p_end_date date,
  p_office_id uuid DEFAULT NULL, p_team_id uuid DEFAULT NULL, p_user_id uuid DEFAULT NULL)
RETURNS SETOF public.v_attendance_daily_canonical LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, d::date, p.name, p.office_id, p.team_id, NULL::text, NULL::text, NULL::text, NULL::text,
         NULL::timestamptz, NULL::text, NULL::timestamptz, NULL::text
  FROM public.profiles p CROSS JOIN LATERAL generate_series(p_start_date, p_end_date, '1 day') d
  WHERE (p_office_id IS NULL OR p.office_id = p_office_id) AND (p_team_id IS NULL OR p.team_id = p_team_id)
    AND (p_user_id IS NULL OR p.id = p_user_id)
  ORDER BY 2 DESC, 3 $$;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_canonical_range(date,date,uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.rpc_my_attendance_daily_v3(p_start date, p_end date)
RETURNS SETOF public.v_attendance_daily_canonical LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM public.rpc_attendance_canonical_range(p_start, p_end, NULL, NULL, auth.uid()) $$;

-- the abandoned draft objects, as if Combined/draft SQL had been pasted
CREATE FUNCTION public.is_profile_admin(p_user_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY permissions_admin ON public.permissions FOR ALL TO authenticated USING (public.is_profile_admin(auth.uid()));
CREATE POLICY audit_insert ON public.permission_audit_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE FUNCTION public.rpc_attendance_canonical_range(p_start_date date, p_end_date date,
  p_office_id uuid, p_team_id uuid, p_user_id uuid, p_search text DEFAULT NULL)
RETURNS SETOF public.v_attendance_daily_canonical LANGUAGE sql AS $$ SELECT * FROM public.v_attendance_daily_canonical LIMIT 0 $$;
