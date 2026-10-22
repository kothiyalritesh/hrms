\set ON_ERROR_STOP 1
-- SAFETY GUARD: local throwaway test database only. NEVER run in Supabase /
-- production (this file creates mock tables and can drop/alter real data).
DO $guard$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL OR to_regclass('storage.objects') IS NOT NULL
     OR current_database() = 'postgres' THEN
    RAISE EXCEPTION 'LOCAL_TEST_DATABASE_ONLY: this test file must not run on a Supabase/production database';
  END IF;
END $guard$;
-- Minimal stand-ins for the production functions wrapped by
-- 20261007120000_permission_delegation.sql. Guards match production
-- (require_profile_admin()).

ALTER TABLE public.offices ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.offices ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.offices ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE public.offices ADD COLUMN IF NOT EXISTS attendance_radius integer;
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS allow_field_visit_checkout boolean DEFAULT false;
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS updated_at timestamptz;
CREATE TABLE IF NOT EXISTS public.leave_balance (user_id uuid PRIMARY KEY, casual numeric DEFAULT 0);
CREATE TABLE IF NOT EXISTS public.predefined_sites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_name text, site_label text,
  address text, latitude double precision, longitude double precision, checkin_radius_m int, site_type text, is_active boolean);
CREATE TABLE IF NOT EXISTS public.holiday_calendar (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), holiday_date date, name text,
  office_id uuid, team_id uuid, user_id uuid, is_optional boolean, is_active boolean, created_by uuid);
CREATE TABLE IF NOT EXISTS public.weekly_off_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), office_id uuid, team_id uuid,
  user_id uuid, weekday int, week_of_month int, valid_from date, valid_to date, is_active boolean, created_by uuid);
CREATE TABLE IF NOT EXISTS public.location_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, resolved boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS public.attendance_fraud_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reviewed boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS public.employee_device_bindings (device_fingerprint text, device_name text, platform text,
  app_version text, user_id uuid, last_verified_at timestamptz);
CREATE TABLE IF NOT EXISTS public.notifications (id bigserial PRIMARY KEY, user_id uuid, title text);
CREATE TABLE IF NOT EXISTS public.field_visits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, date date);

CREATE OR REPLACE FUNCTION public.rpc_admin_leave_balance_summary()
RETURNS TABLE(user_id uuid, employee_name text, casual numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.require_profile_admin();
  RETURN QUERY SELECT p.id, p.name, coalesce(b.casual, 0) FROM public.profiles p
    LEFT JOIN public.leave_balance b ON b.user_id = p.id ORDER BY p.name;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_admin_adjust_leave_balance(
  p_user_id uuid, p_leave_type text, p_quantity numeric, p_reason text, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.require_profile_admin();
  INSERT INTO public.leave_balance (user_id, casual) VALUES (p_user_id, p_quantity)
  ON CONFLICT (user_id) DO UPDATE SET casual = public.leave_balance.casual + p_quantity;
  RETURN jsonb_build_object('success', true);
END $$;

CREATE OR REPLACE FUNCTION public.rpc_review_leave_request(p_request_id uuid, p_admin_id uuid, p_approve boolean, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.require_profile_admin();
  UPDATE public.leave_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END WHERE id = p_request_id;
  RETURN jsonb_build_object('success', true);
END $$;

CREATE OR REPLACE FUNCTION public.rpc_admin_save_profile(p_profile_id uuid, p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := public.require_profile_admin(); v_id uuid := p_profile_id;
BEGIN
  IF v_id IS NULL THEN
    INSERT INTO public.profiles (id, name, role, office_id) VALUES (gen_random_uuid(), p_values->>'name', p_values->>'role',
      nullif(p_values->>'office_id','')::uuid) RETURNING id INTO v_id;
  ELSE
    UPDATE public.profiles SET name = p_values->>'name', role = p_values->>'role' WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'profile_id', v_id, 'actor_role', v_role);
END $$;

CREATE OR REPLACE FUNCTION public.rpc_admin_set_profile_active(p_profile_id uuid, p_is_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM public.require_profile_admin();
  UPDATE public.profiles SET is_active = p_is_active WHERE id = p_profile_id;
  RETURN jsonb_build_object('success', true, 'profile_id', p_profile_id); END $$;

CREATE OR REPLACE FUNCTION public.rpc_admin_resolve_location_alert(p_alert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM public.require_profile_admin();
  UPDATE public.location_alerts SET resolved = true WHERE id = p_alert_id;
  RETURN jsonb_build_object('success', true); END $$;

CREATE OR REPLACE FUNCTION public.rpc_admin_request_location_pings(p_target_user_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM public.require_profile_admin(); RETURN jsonb_build_object('success', true, 'n', cardinality(p_target_user_ids)); END $$;

CREATE OR REPLACE FUNCTION public.rpc_admin_update_hierarchy(p_updates jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM public.require_profile_admin(); RETURN jsonb_array_length(p_updates); END $$;

CREATE OR REPLACE FUNCTION public.rpc_admin_update_hierarchy_v2(p_updates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RETURN jsonb_build_object('success', true, 'updated', public.rpc_admin_update_hierarchy(p_updates)); END $$;

CREATE OR REPLACE FUNCTION public.rpc_geofence_report(p_start_date date, p_end_date date, p_user_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL, p_review_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN RETURN jsonb_build_object('rows', (SELECT count(*) FROM public.profiles)); END $$;

CREATE OR REPLACE FUNCTION public.rpc_admin_mutate_configuration(p_entity text, p_action text, p_id uuid DEFAULT NULL, p_values jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM public.require_profile_admin(); RAISE EXCEPTION 'UNSUPPORTED_CONFIGURATION_ACTION'; END $$;

CREATE OR REPLACE FUNCTION public.get_site_visit_observer_data(
  p_date        date,
  p_employee_id uuid DEFAULT NULL,
  p_visit_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_live   boolean;
  v_is_admin  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'AUTHENTICATION_REQUIRED');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')) INTO v_is_admin;
  v_is_live  := (p_date = CURRENT_DATE);

  IF NOT v_is_admin THEN
    IF NOT EXISTS(SELECT 1 FROM public.user_permissions WHERE user_id = auth.uid() AND permission = 'view_site_visit_observer' AND revoked_at IS NULL) THEN
      RETURN jsonb_build_object('error', 'PERMISSION_DENIED');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'visible', (SELECT count(*) FROM public.field_visits fv
    WHERE (v_is_admin OR public.can_access_user_data(fv.user_id,'view_site_visit_observer'))));
END;
$$;

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_leave ON public.leave_requests FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.leave_requests TO authenticated;
