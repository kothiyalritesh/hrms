\set ON_ERROR_STOP 1
-- SAFETY GUARD: local throwaway test database only. NEVER run in Supabase /
-- production (this file creates mock tables and can drop/alter real data).
DO $guard$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL OR to_regclass('storage.objects') IS NOT NULL
     OR current_database() = 'postgres' THEN
    RAISE EXCEPTION 'LOCAL_TEST_DATABASE_ONLY: this test file must not run on a Supabase/production database';
  END IF;
END $guard$;
-- Mock for testing 20261006150000 (attendance correction + sane canonical times).
-- Loaded AFTER permission_mock_legacy_schema.sql + the 2026-10-06 migrations.
ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS app_checkin_time timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_source text,
  ADD COLUMN IF NOT EXISTS office_id uuid,
  ADD COLUMN IF NOT EXISTS late_by_minutes int,
  ADD COLUMN IF NOT EXISTS last_audit_id integer,
  ADD COLUMN IF NOT EXISTS biometric_last_punch timestamptz,
  ADD COLUMN IF NOT EXISTS auto_checkout boolean,
  ADD COLUMN IF NOT EXISTS auto_checkout_reason text,
  ADD COLUMN IF NOT EXISTS work_hours numeric;
ALTER TABLE public.smartoffice_device_logs
  ADD COLUMN IF NOT EXISTS log_date timestamptz,
  ADD COLUMN IF NOT EXISTS log_date_only date;
CREATE TABLE IF NOT EXISTS public.bio_punches (user_id uuid, punch timestamptz);

-- simplified copy of the live late trigger (10:32 from attendance_policies, IST)
CREATE OR REPLACE FUNCTION public.set_authoritative_attendance_late_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_late time;
BEGIN
  SELECT coalesce(max(late_checkin_time), '10:32') INTO v_late FROM public.attendance_policies WHERE is_active;
  NEW.is_late := (NEW.checkin_time AT TIME ZONE 'Asia/Kolkata')::time >= v_late;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attendance_authoritative_late_status ON public.attendance_logs;
CREATE TRIGGER attendance_authoritative_late_status BEFORE INSERT OR UPDATE OF checkin_time ON public.attendance_logs
FOR EACH ROW EXECUTE FUNCTION public.set_authoritative_attendance_late_status();

-- Rebuild the core with the real column names used by the live canonical output.
DROP FUNCTION IF EXISTS public.rpc_attendance_canonical_range(date,date,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.rpc_attendance_canonical_range_core(date,date,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.rpc_my_attendance_daily_v3(date,date);
DROP VIEW IF EXISTS public.v_attendance_daily_canonical CASCADE;
CREATE VIEW public.v_attendance_daily_canonical WITH (security_invoker = true) AS
SELECT p.id AS user_id, '2026-10-05'::date AS work_date, p.name AS employee_name, p.office_id, p.team_id,
       NULL::text AS office_name, NULL::text AS team_name, NULL::text AS check_in_office_name,
       NULL::uuid AS attendance_log_id, NULL::text AS attendance_source,
       NULL::timestamptz AS app_first_in, NULL::timestamptz AS biometric_first_in, NULL::timestamptz AS field_visit_first_in,
       NULL::timestamptz AS biometric_last_punch_evidence, NULL::time AS late_checkin_time,
       NULL::timestamptz AS effective_checkout, NULL::timestamptz AS official_last_out, NULL::text AS last_out_source,
       NULL::timestamptz AS effective_checkin, NULL::timestamptz AS official_first_in, NULL::text AS first_in_source,
       NULL::text AS effective_status, NULL::text AS attendance_status, NULL::integer AS working_minutes, NULL::text AS warning,
       NULL::timestamptz AS approved_regularization_checkout, NULL::timestamptz AS admin_corrected_checkout,
       NULL::timestamptz AS app_checkout, NULL::timestamptz AS raw_checkout
FROM public.profiles p WHERE false;

CREATE FUNCTION public.rpc_attendance_canonical_range_core(p_start_date date, p_end_date date,
  p_office_id uuid DEFAULT NULL, p_team_id uuid DEFAULT NULL, p_user_id uuid DEFAULT NULL)
RETURNS SETOF public.v_attendance_daily_canonical LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH e AS (
    SELECT p.id user_id, d::date work_date, p.name employee_name, p.office_id, p.team_id,
           a.id log_id, a.checkin_source src,
           coalesce(a.app_checkin_time, CASE WHEN upper(coalesce(a.checkin_source,'')) LIKE 'APP%' THEN a.checkin_time END) app,
           (SELECT min(b.punch) FROM bio_punches b WHERE b.user_id = p.id AND (b.punch AT TIME ZONE 'Asia/Kolkata')::date = d::date) bio,
           (SELECT max(b.punch) FROM bio_punches b WHERE b.user_id = p.id AND (b.punch AT TIME ZONE 'Asia/Kolkata')::date = d::date) bio_last,
           a.checkout_time raw_out,
           CASE WHEN upper(coalesce(a.checkout_source,'')) = 'ADMIN' THEN a.checkout_time END adm_out,
           CASE WHEN upper(coalesce(a.checkout_source,'')) IN ('APP','APP_MANUAL') THEN a.checkout_time END app_out
    FROM profiles p CROSS JOIN generate_series(p_start_date, p_end_date, '1 day') d
    LEFT JOIN attendance_logs a ON a.user_id = p.id AND a.date = d::date
    WHERE (p_user_id IS NULL OR p.id = p_user_id))
  SELECT user_id, work_date, employee_name, office_id, team_id, NULL, NULL, NULL, log_id, src,
         app, bio, NULL::timestamptz, bio_last, '10:32'::time,
         coalesce(raw_out, bio_last), coalesce(raw_out, bio_last), 'BIOMETRIC',
         coalesce(app, bio), coalesce(app, bio), 'APP',
         CASE WHEN coalesce(raw_out, bio_last) IS NOT NULL THEN 'CHECKED_OUT' WHEN coalesce(app,bio) IS NOT NULL THEN 'CHECKED_IN' ELSE 'ABSENT' END,
         CASE WHEN coalesce(raw_out, bio_last) IS NOT NULL THEN 'CHECKED_OUT' WHEN coalesce(app,bio) IS NOT NULL THEN 'CHECKED_IN' ELSE 'ABSENT' END,
         -6, NULL,
         NULL::timestamptz, adm_out, app_out, raw_out
  FROM e $$;
-- the 20261006150000 migration (re)creates the wrapper
