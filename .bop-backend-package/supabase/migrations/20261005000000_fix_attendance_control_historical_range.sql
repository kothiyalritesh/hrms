-- =============================================================================

-- Migration: 20261005000000_fix_attendance_control_historical_range.sql

--

-- Fixes: rpc_attendance_canonical_range used greatest(joining_date, p_start_date)

-- in generate_series, silently hiding attendance records before joining_date

-- even when an HR/admin explicitly requested an earlier date range.

--

-- Strategy:

--   1. Recreate v_attendance_daily_canonical (establishes the authoritative

--      column definition that the RPC return type is validated against).

--   2. Recreate rpc_attendance_canonical_range with p_start_date as the sole

--      lower bound — joining_date no longer overrides the admin's date range.

--   3. Restore rpc_my_attendance_daily_v3.

-- =============================================================================



-- ─── STEP 1: Recreate the view ───────────────────────────────────────────────

-- This must come first so the RPC's RETURNS SETOF resolves against the correct

-- column list. The view body is identical to 20261002010000 — no logic change.



DROP VIEW IF EXISTS public.v_attendance_daily_canonical CASCADE;



CREATE VIEW public.v_attendance_daily_canonical

WITH (security_invoker = true) AS

WITH employee_days AS (

  SELECT p.id user_id, day::date work_date, p.name employee_name, p.employee_number,

    p.office_id, o.name office_name, p.team_id, COALESCE(t.name, p.team) team_name,

    p.reports_to team_head_id, manager.name team_head_name, p.role, p.show_on_tv,

    p.joining_date, p.is_active

  FROM public.profiles p

  LEFT JOIN public.offices o ON o.id = p.office_id

  LEFT JOIN public.teams t ON t.id = p.team_id

  LEFT JOIN public.profiles manager ON manager.id = p.reports_to

  CROSS JOIN LATERAL generate_series(

    greatest(COALESCE(p.joining_date, (p.created_at AT TIME ZONE 'Asia/Kolkata')::date), date '2024-01-01'),

    least(COALESCE(p.last_working_date, (now() AT TIME ZONE 'Asia/Kolkata')::date), (now() AT TIME ZONE 'Asia/Kolkata')::date),

    INTERVAL '1 day') day

  WHERE p.attendance_reporting_enabled

    AND (day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR p.is_active)

), evidence AS (

SELECT employee.*,

  attendance.id attendance_log_id,

  attendance.office_id check_in_office_id,

  ci_office.name check_in_office_name,

  attendance.checkin_source attendance_source,

  COALESCE(attendance.app_checkin_time,

    CASE WHEN upper(COALESCE(attendance.checkin_source, attendance.attendance_type, '')) LIKE 'APP%'

         THEN attendance.checkin_time END) app_first_in,

  COALESCE(attendance.biometric_first_punch, biometric.first_punch) biometric_first_in,

  visit.first_in field_visit_first_in,

  attendance.checkout_time raw_checkout,

  CASE WHEN upper(COALESCE(attendance.checkout_source, ''))

         NOT IN ('ADMIN', 'REGULARIZATION', 'SYSTEM', 'BIOMETRIC', 'FIELD_VISIT')

       THEN attendance.checkout_time END app_checkout,

  regularization.requested_checkout approved_regularization_checkout,

  CASE WHEN regularization.id IS NULL

         AND upper(COALESCE(attendance.checkout_source, '')) = 'ADMIN'

       THEN attendance.checkout_time END admin_corrected_checkout,

  COALESCE(attendance.biometric_last_punch, biometric.last_punch) biometric_last_punch_evidence,

  visit.last_out field_visit_checkout,

  visit.has_visit, visit.active_id, visit.active_name, visit.distance_m, visit.active_site_name,

  policy.late_checkin_time, policy.allow_field_visit_checkout, policy.policy_id,

  calendar.value calendar_value,

  leave_request.leave_type,

  attendance.warning attendance_warning,

  NULL::timestamptz latest_ping_at,

  NULL::numeric  latest_accuracy_m,

  NULL::text     latest_tracking_status,

  NULL::numeric  distance_from_office_m,

  NULL::text     tracking_session_status,

  NULL::text     tracking_health_reason,

  settings.tv_tracking_stale_minutes

FROM employee_days employee

LEFT JOIN LATERAL (

  SELECT a.* FROM public.attendance_logs a

  WHERE a.user_id = employee.user_id AND a.date = employee.work_date

  ORDER BY a.created_at, a.id LIMIT 1) attendance ON true

LEFT JOIN public.offices ci_office ON ci_office.id = attendance.office_id

LEFT JOIN LATERAL (

  SELECT min(d.log_date) first_punch, max(d.log_date) last_punch

  FROM public.smartoffice_device_logs d

  WHERE d.user_id = employee.user_id

    AND d.log_date_only = employee.work_date) biometric ON true

LEFT JOIN LATERAL (

  SELECT

    min(public.hrms_timestamp(v.checkin_time))  first_in,

    max(public.hrms_timestamp(v.checkout_time)) last_out,

    bool_or(v.checkin_time IS NOT NULL) has_visit,

    (array_agg(v.id ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)

      FILTER (WHERE v.status IN ('CHECKED_IN', 'IN_TRANSIT', 'PENDING')))[1] active_id,

    (array_agg(COALESCE(v.project_name, v.location_name)

      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)

      FILTER (WHERE v.status IN ('CHECKED_IN', 'IN_TRANSIT', 'PENDING')))[1] active_name,

    (array_agg(v.last_distance_m ORDER BY v.last_distance_at DESC NULLS LAST))[1] distance_m,

    (array_agg(COALESCE(v.project_name, v.location_name)

      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)

      FILTER (WHERE v.status IN ('CHECKED_IN', 'IN_TRANSIT', 'PENDING')))[1] active_site_name

  FROM public.field_visits v

  WHERE v.user_id = employee.user_id AND v.date = employee.work_date

    AND COALESCE(v.verification_status, 'PENDING') <> 'REJECTED') visit ON true

LEFT JOIN LATERAL (

  SELECT r.id, r.requested_checkout

  FROM public.attendance_regularization_requests r

  WHERE r.attendance_id = attendance.id AND r.status = 'APPROVED'

  ORDER BY r.reviewed_at DESC NULLS LAST, r.created_at DESC LIMIT 1) regularization ON true

LEFT JOIN LATERAL (

  SELECT p.id policy_id, p.late_checkin_time, p.allow_field_visit_checkout

  FROM public.attendance_policies p

  WHERE p.is_active

    AND employee.work_date BETWEEN p.effective_from AND COALESCE(p.effective_to, 'infinity'::date)

    AND (p.office_id = employee.office_id OR p.office_id IS NULL)

    AND lower(COALESCE(p.role, 'all')) IN (lower(COALESCE(employee.role, '')), 'all')

  ORDER BY CASE

    WHEN p.office_id = employee.office_id AND lower(p.role) = lower(COALESCE(employee.role, '')) THEN 1

    WHEN p.office_id = employee.office_id AND lower(COALESCE(p.role, 'all')) = 'all' THEN 2

    WHEN p.office_id IS NULL AND lower(p.role) = lower(COALESCE(employee.role, '')) THEN 3

    ELSE 4 END

  LIMIT 1) policy ON true

LEFT JOIN LATERAL (

  SELECT public.resolve_hrms_calendar_day(employee.user_id, employee.work_date) value) calendar ON true

LEFT JOIN LATERAL (

  SELECT r.leave_type

  FROM public.leave_requests r

  WHERE r.user_id = employee.user_id AND r.status = 'APPROVED'

    AND employee.work_date BETWEEN r.start_date AND r.end_date

  ORDER BY r.created_at DESC LIMIT 1) leave_request ON true

CROSS JOIN (

  SELECT COALESCE(current_setting('app.tv_tracking_stale_minutes', true), '15')::integer tv_tracking_stale_minutes

) settings

)

SELECT e.*,

  -- effective_checkout (backward compat alias)

  COALESCE(

    e.approved_regularization_checkout,

    e.admin_corrected_checkout,

    CASE WHEN COALESCE(e.allow_field_visit_checkout, true)

         THEN COALESCE(e.app_checkout, e.field_visit_checkout)

         ELSE e.app_checkout END,

    e.app_checkout,

    e.raw_checkout,

    e.biometric_last_punch_evidence

  ) effective_checkout,

  -- official_last_out (enterprise alias)

  COALESCE(

    e.approved_regularization_checkout,

    e.admin_corrected_checkout,

    CASE WHEN COALESCE(e.allow_field_visit_checkout, true)

         THEN COALESCE(e.app_checkout, e.field_visit_checkout)

         ELSE e.app_checkout END,

    e.app_checkout,

    e.raw_checkout,

    e.biometric_last_punch_evidence

  ) official_last_out,

  CASE

    WHEN e.approved_regularization_checkout IS NOT NULL THEN 'REGULARIZATION'

    WHEN e.admin_corrected_checkout IS NOT NULL         THEN 'ADMIN_CORRECTED'

    WHEN e.app_checkout IS NOT NULL                     THEN 'APP'

    WHEN COALESCE(e.allow_field_visit_checkout, true)

     AND e.field_visit_checkout IS NOT NULL             THEN 'FIELD_VISIT'

    WHEN e.raw_checkout IS NOT NULL                     THEN 'SYSTEM'

    WHEN e.biometric_last_punch_evidence IS NOT NULL    THEN 'BIOMETRIC'

    ELSE 'NO_DATA'

  END last_out_source,

  -- effective_checkin (backward compat alias)

  COALESCE(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) effective_checkin,

  -- official_first_in (enterprise alias)

  COALESCE(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) official_first_in,

  CASE

    WHEN e.app_first_in IS NOT NULL          THEN 'APP'

    WHEN e.field_visit_first_in IS NOT NULL  THEN 'FIELD_VISIT'

    WHEN e.biometric_first_in IS NOT NULL    THEN 'BIOMETRIC'

    ELSE 'NO_DATA'

  END first_in_source,

  CASE

    WHEN e.app_first_in IS NOT NULL          THEN 'APP'

    WHEN e.biometric_first_in IS NOT NULL    THEN 'BIOMETRIC'

    WHEN e.field_visit_first_in IS NOT NULL  THEN 'FIELD_VISIT'

    ELSE 'NO_DATA'

  END presence_source,

  -- effective_status

  (CASE

    WHEN e.leave_type IS NOT NULL                    THEN 'LEAVE'

    WHEN e.calendar_value->>'kind' = 'WEEKLY_OFF'    THEN 'WEEKLY_OFF'

    WHEN e.calendar_value->>'kind' = 'HOLIDAY'       THEN 'HOLIDAY'

    WHEN e.app_first_in IS NOT NULL

      OR e.biometric_first_in IS NOT NULL

      OR e.field_visit_first_in IS NOT NULL THEN

      CASE

        WHEN e.raw_checkout IS NOT NULL

          OR e.approved_regularization_checkout IS NOT NULL

          OR e.admin_corrected_checkout IS NOT NULL

          OR e.biometric_last_punch_evidence IS NOT NULL THEN 'CHECKED_OUT'

        ELSE 'CHECKED_IN'

      END

    ELSE 'ABSENT'

  END) effective_status,

  -- attendance_status (enterprise alias, same logic)

  (CASE

    WHEN e.leave_type IS NOT NULL                    THEN 'LEAVE'

    WHEN e.calendar_value->>'kind' = 'WEEKLY_OFF'    THEN 'WEEKLY_OFF'

    WHEN e.calendar_value->>'kind' = 'HOLIDAY'       THEN 'HOLIDAY'

    WHEN e.app_first_in IS NOT NULL

      OR e.biometric_first_in IS NOT NULL

      OR e.field_visit_first_in IS NOT NULL THEN

      CASE

        WHEN e.raw_checkout IS NOT NULL

          OR e.approved_regularization_checkout IS NOT NULL

          OR e.admin_corrected_checkout IS NOT NULL

          OR e.biometric_last_punch_evidence IS NOT NULL THEN 'CHECKED_OUT'

        ELSE 'CHECKED_IN'

      END

    ELSE 'ABSENT'

  END) attendance_status,

  EXISTS(

    SELECT 1 FROM public.attendance_logs a

    WHERE a.id = e.attendance_log_id AND a.auto_closed = true

  ) is_auto_closed,

  COALESCE(e.has_visit, false) has_field_visit,

  -- enterprise columns

  CASE

    WHEN COALESCE(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) IS NOT NULL

     AND COALESCE(

           e.approved_regularization_checkout,

           e.admin_corrected_checkout,

           CASE WHEN COALESCE(e.allow_field_visit_checkout, true)

                THEN COALESCE(e.app_checkout, e.field_visit_checkout)

                ELSE e.app_checkout END,

           e.app_checkout, e.raw_checkout, e.biometric_last_punch_evidence

         ) IS NOT NULL

    THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (

      COALESCE(

        e.approved_regularization_checkout,

        e.admin_corrected_checkout,

        CASE WHEN COALESCE(e.allow_field_visit_checkout, true)

             THEN COALESCE(e.app_checkout, e.field_visit_checkout)

             ELSE e.app_checkout END,

        e.app_checkout, e.raw_checkout, e.biometric_last_punch_evidence

      ) -

      COALESCE(e.app_first_in, e.field_visit_first_in, e.biometric_first_in)

    )) / 60))::integer

    ELSE NULL

  END working_minutes,

  CASE

    WHEN e.attendance_warning IS NOT NULL THEN e.attendance_warning::text

    WHEN COALESCE(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) IS NOT NULL

     AND COALESCE(

           e.approved_regularization_checkout, e.admin_corrected_checkout,

           e.app_checkout, e.raw_checkout, e.biometric_last_punch_evidence

         ) IS NULL                             THEN 'No checkout'

    ELSE NULL

  END warning,

  COALESCE(

    e.latest_ping_at IS NULL

    OR e.latest_ping_at < now() - make_interval(mins => e.tv_tracking_stale_minutes),

    true

  ) ping_is_stale,

  e.active_id    active_field_visit_id,

  e.active_name  active_field_visit_name,

  e.distance_m   distance_from_destination_m

FROM evidence e;



-- ─── STEP 2: Recreate the RPC with the joining_date floor removed ─────────────

-- The only change from 20261002010000 is the generate_series lower bound:

--   BEFORE: greatest(COALESCE(p.joining_date, ...), p_start_date)

--   AFTER:  p_start_date

-- Everything else is identical.



CREATE OR REPLACE FUNCTION public.rpc_attendance_canonical_range(

  p_start_date date,

  p_end_date   date,

  p_office_id  uuid DEFAULT NULL,

  p_team_id    uuid DEFAULT NULL,

  p_user_id    uuid DEFAULT NULL

)

RETURNS SETOF public.v_attendance_daily_canonical

LANGUAGE sql

STABLE

SECURITY DEFINER

SET search_path = public, pg_temp

AS $$

WITH employee_days AS (

  SELECT p.id user_id, day::date work_date, p.name employee_name, p.employee_number,

    p.office_id, o.name office_name, p.team_id, COALESCE(t.name, p.team) team_name,

    p.reports_to team_head_id, manager.name team_head_name, p.role, p.show_on_tv,

    p.joining_date, p.is_active

  FROM public.profiles p

  LEFT JOIN public.offices o ON o.id = p.office_id

  LEFT JOIN public.teams t ON t.id = p.team_id

  LEFT JOIN public.profiles manager ON manager.id = p.reports_to

  CROSS JOIN LATERAL generate_series(

    p_start_date,

    least(COALESCE(p.last_working_date, p_end_date), p_end_date),

    INTERVAL '1 day'

  ) day

  WHERE p.attendance_reporting_enabled

    AND (p_office_id IS NULL OR p.office_id = p_office_id)

    AND (p_team_id   IS NULL OR p.team_id   = p_team_id)

    AND (p_user_id   IS NULL OR p.id        = p_user_id)

    AND (day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR p.is_active)

), evidence AS (

  SELECT employee.*,

    attendance.id attendance_log_id,

    attendance.office_id check_in_office_id,

    ci_office.name check_in_office_name,

    attendance.checkin_source attendance_source,

    COALESCE(attendance.app_checkin_time,

      CASE WHEN upper(COALESCE(attendance.checkin_source, attendance.attendance_type, '')) LIKE 'APP%'

           THEN attendance.checkin_time END) app_first_in,

    COALESCE(attendance.biometric_first_punch, biometric.first_punch) biometric_first_in,

    visit.first_in field_visit_first_in,

    attendance.checkout_time raw_checkout,

    CASE WHEN upper(COALESCE(attendance.checkout_source, ''))

           NOT IN ('ADMIN', 'REGULARIZATION', 'SYSTEM', 'BIOMETRIC', 'FIELD_VISIT')

         THEN attendance.checkout_time END app_checkout,

    regularization.requested_checkout approved_regularization_checkout,

    CASE WHEN regularization.id IS NULL

           AND upper(COALESCE(attendance.checkout_source, '')) = 'ADMIN'

         THEN attendance.checkout_time END admin_corrected_checkout,

    COALESCE(attendance.biometric_last_punch, biometric.last_punch) biometric_last_punch_evidence,

    visit.last_out field_visit_checkout,

    visit.has_visit, visit.active_id, visit.active_name, visit.distance_m, visit.active_site_name,

    policy.late_checkin_time, policy.allow_field_visit_checkout, policy.policy_id,

    calendar.value calendar_value,


    leave_request.leave_type,

    attendance.warning attendance_warning,

    NULL::timestamptz latest_ping_at,

    NULL::numeric  latest_accuracy_m,

    NULL::text     latest_tracking_status,

    NULL::numeric  distance_from_office_m,

    NULL::text     tracking_session_status,

    NULL::text     tracking_health_reason,

    settings.tv_tracking_stale_minutes

  FROM employee_days employee

  LEFT JOIN LATERAL (

    SELECT a.* FROM public.attendance_logs a

    WHERE a.user_id = employee.user_id AND a.date = employee.work_date

    ORDER BY a.created_at, a.id LIMIT 1) attendance ON true

  LEFT JOIN public.offices ci_office ON ci_office.id = attendance.office_id

  LEFT JOIN LATERAL (

    SELECT min(d.log_date) first_punch, max(d.log_date) last_punch

    FROM public.smartoffice_device_logs d

    WHERE d.user_id = employee.user_id

      AND d.log_date_only = employee.work_date) biometric ON true

  LEFT JOIN LATERAL (

    SELECT

      min(public.hrms_timestamp(v.checkin_time))  first_in,

      max(public.hrms_timestamp(v.checkout_time)) last_out,

      bool_or(v.checkin_time IS NOT NULL) has_visit,

      (array_agg(v.id ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)

        FILTER (WHERE v.status IN ('CHECKED_IN', 'IN_TRANSIT', 'PENDING')))[1] active_id,

      (array_agg(COALESCE(v.project_name, v.location_name)

        ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)

        FILTER (WHERE v.status IN ('CHECKED_IN', 'IN_TRANSIT', 'PENDING')))[1] active_name,

      (array_agg(v.last_distance_m ORDER BY v.last_distance_at DESC NULLS LAST))[1] distance_m,

      (array_agg(COALESCE(v.project_name, v.location_name)

        ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)

        FILTER (WHERE v.status IN ('CHECKED_IN', 'IN_TRANSIT', 'PENDING')))[1] active_site_name

    FROM public.field_visits v

    WHERE v.user_id = employee.user_id AND v.date = employee.work_date

      AND COALESCE(v.verification_status, 'PENDING') <> 'REJECTED') visit ON true

  LEFT JOIN LATERAL (

    SELECT r.id, r.requested_checkout

    FROM public.attendance_regularization_requests r

    WHERE r.attendance_id = attendance.id AND r.status = 'APPROVED'

    ORDER BY r.reviewed_at DESC NULLS LAST, r.created_at DESC LIMIT 1) regularization ON true

  LEFT JOIN LATERAL (

    SELECT p.id policy_id, p.late_checkin_time, p.allow_field_visit_checkout

    FROM public.attendance_policies p

    WHERE p.is_active

      AND employee.work_date BETWEEN p.effective_from AND COALESCE(p.effective_to, 'infinity'::date)

      AND (p.office_id = employee.office_id OR p.office_id IS NULL)

      AND lower(COALESCE(p.role, 'all')) IN (lower(COALESCE(employee.role, '')), 'all')

    ORDER BY CASE

      WHEN p.office_id = employee.office_id AND lower(p.role) = lower(COALESCE(employee.role, '')) THEN 1

      WHEN p.office_id = employee.office_id AND lower(COALESCE(p.role, 'all')) = 'all' THEN 2

      WHEN p.office_id IS NULL AND lower(p.role) = lower(COALESCE(employee.role, '')) THEN 3

      ELSE 4 END

    LIMIT 1) policy ON true

  LEFT JOIN LATERAL (

    SELECT public.resolve_hrms_calendar_day(employee.user_id, employee.work_date) value) calendar ON true

  LEFT JOIN LATERAL (

    SELECT r.leave_type

    FROM public.leave_requests r

    WHERE r.user_id = employee.user_id AND r.status = 'APPROVED'

      AND employee.work_date BETWEEN r.start_date AND r.end_date

    ORDER BY r.created_at DESC LIMIT 1) leave_request ON true

  CROSS JOIN (

    SELECT COALESCE(current_setting('app.tv_tracking_stale_minutes', true), '15')::integer tv_tracking_stale_minutes

  ) settings

)

SELECT e.*,

  -- effective_checkout (backward compat alias)

  COALESCE(

    e.approved_regularization_checkout,

    e.admin_corrected_checkout,

    CASE WHEN COALESCE(e.allow_field_visit_checkout, true)

         THEN COALESCE(e.app_checkout, e.field_visit_checkout)

         ELSE e.app_checkout END,

    e.app_checkout,

    e.raw_checkout,

    e.biometric_last_punch_evidence

  ) effective_checkout,

  -- official_last_out (enterprise alias)

  COALESCE(

    e.approved_regularization_checkout,

    e.admin_corrected_checkout,

    CASE WHEN COALESCE(e.allow_field_visit_checkout, true)

         THEN COALESCE(e.app_checkout, e.field_visit_checkout)

         ELSE e.app_checkout END,

    e.app_checkout,

    e.raw_checkout,

    e.biometric_last_punch_evidence

  ) official_last_out,

  CASE

    WHEN e.approved_regularization_checkout IS NOT NULL THEN 'REGULARIZATION'

    WHEN e.admin_corrected_checkout IS NOT NULL         THEN 'ADMIN_CORRECTED'

    WHEN e.app_checkout IS NOT NULL                     THEN 'APP'

    WHEN COALESCE(e.allow_field_visit_checkout, true)

     AND e.field_visit_checkout IS NOT NULL             THEN 'FIELD_VISIT'

    WHEN e.raw_checkout IS NOT NULL                     THEN 'SYSTEM'

    WHEN e.biometric_last_punch_evidence IS NOT NULL    THEN 'BIOMETRIC'

    ELSE 'NO_DATA'

  END last_out_source,

  -- effective_checkin (backward compat alias)

  COALESCE(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) effective_checkin,

  -- official_first_in (enterprise alias)

  COALESCE(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) official_first_in,

  CASE

    WHEN e.app_first_in IS NOT NULL          THEN 'APP'

    WHEN e.field_visit_first_in IS NOT NULL  THEN 'FIELD_VISIT'

    WHEN e.biometric_first_in IS NOT NULL    THEN 'BIOMETRIC'

    ELSE 'NO_DATA'

  END first_in_source,

  CASE

    WHEN e.app_first_in IS NOT NULL          THEN 'APP'

    WHEN e.biometric_first_in IS NOT NULL    THEN 'BIOMETRIC'

    WHEN e.field_visit_first_in IS NOT NULL  THEN 'FIELD_VISIT'

    ELSE 'NO_DATA'

  END presence_source,

  -- effective_status

  (CASE

    WHEN e.leave_type IS NOT NULL                    THEN 'LEAVE'

    WHEN e.calendar_value->>'kind' = 'WEEKLY_OFF'    THEN 'WEEKLY_OFF'

    WHEN e.calendar_value->>'kind' = 'HOLIDAY'       THEN 'HOLIDAY'

    WHEN e.app_first_in IS NOT NULL

      OR e.biometric_first_in IS NOT NULL

      OR e.field_visit_first_in IS NOT NULL THEN

      CASE

        WHEN e.raw_checkout IS NOT NULL

          OR e.approved_regularization_checkout IS NOT NULL

          OR e.admin_corrected_checkout IS NOT NULL

          OR e.biometric_last_punch_evidence IS NOT NULL THEN 'CHECKED_OUT'

        ELSE 'CHECKED_IN'

      END

    ELSE 'ABSENT'

  END) effective_status,

  -- attendance_status (enterprise alias, same logic)

  (CASE

    WHEN e.leave_type IS NOT NULL                    THEN 'LEAVE'

    WHEN e.calendar_value->>'kind' = 'WEEKLY_OFF'    THEN 'WEEKLY_OFF'

    WHEN e.calendar_value->>'kind' = 'HOLIDAY'       THEN 'HOLIDAY'

    WHEN e.app_first_in IS NOT NULL

      OR e.biometric_first_in IS NOT NULL

      OR e.field_visit_first_in IS NOT NULL THEN

      CASE

        WHEN e.raw_checkout IS NOT NULL

          OR e.approved_regularization_checkout IS NOT NULL

          OR e.admin_corrected_checkout IS NOT NULL

          OR e.biometric_last_punch_evidence IS NOT NULL THEN 'CHECKED_OUT'

        ELSE 'CHECKED_IN'

      END

    ELSE 'ABSENT'

  END) attendance_status,

  EXISTS(

    SELECT 1 FROM public.attendance_logs a

    WHERE a.id = e.attendance_log_id AND a.auto_closed = true

  ) is_auto_closed,

  COALESCE(e.has_visit, false) has_field_visit,

  -- enterprise columns

  CASE

    WHEN COALESCE(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) IS NOT NULL

     AND COALESCE(

           e.approved_regularization_checkout,

           e.admin_corrected_checkout,

           CASE WHEN COALESCE(e.allow_field_visit_checkout, true)

                THEN COALESCE(e.app_checkout, e.field_visit_checkout)

                ELSE e.app_checkout END,

           e.app_checkout, e.raw_checkout, e.biometric_last_punch_evidence

         ) IS NOT NULL

    THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (

      COALESCE(

        e.approved_regularization_checkout,

        e.admin_corrected_checkout,

        CASE WHEN COALESCE(e.allow_field_visit_checkout, true)

             THEN COALESCE(e.app_checkout, e.field_visit_checkout)

             ELSE e.app_checkout END,

        e.app_checkout, e.raw_checkout, e.biometric_last_punch_evidence

      ) -

      COALESCE(e.app_first_in, e.field_visit_first_in, e.biometric_first_in)

    )) / 60))::integer

    ELSE NULL

  END working_minutes,

  CASE

    WHEN e.attendance_warning IS NOT NULL THEN e.attendance_warning::text

    WHEN COALESCE(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) IS NOT NULL

     AND COALESCE(

           e.approved_regularization_checkout, e.admin_corrected_checkout,

           e.app_checkout, e.raw_checkout, e.biometric_last_punch_evidence

         ) IS NULL                             THEN 'No checkout'

    ELSE NULL

  END warning,

  COALESCE(

    e.latest_ping_at IS NULL

    OR e.latest_ping_at < now() - make_interval(mins => e.tv_tracking_stale_minutes),

    true

  ) ping_is_stale,

  e.active_id    active_field_visit_id,

  e.active_name  active_field_visit_name,

  e.distance_m   distance_from_destination_m

FROM evidence e
ORDER BY e.work_date DESC, e.employee_name ASC;

$$;



-- ─── STEP 3: Restore rpc_my_attendance_daily_v3 ──────────────────────────────



DROP FUNCTION IF EXISTS public.rpc_my_attendance_daily_v3(date, date);

CREATE OR REPLACE FUNCTION public.rpc_my_attendance_daily_v3(p_start date, p_end date)

RETURNS SETOF public.v_attendance_daily_canonical

LANGUAGE sql STABLE SECURITY DEFINER

SET search_path = public, pg_temp

AS $$

  SELECT * FROM public.rpc_attendance_canonical_range(p_start, p_end, NULL, NULL, auth.uid());

$$;



-- ─── STEP 3b: Restore rpc_admin_list_attendance_regularization ───────────────

-- Dropped by CASCADE above. Body is identical to 20261001000001.



CREATE OR REPLACE FUNCTION public.rpc_admin_list_attendance_regularization(

  p_status    text    DEFAULT 'PENDING',

  p_offset    integer DEFAULT 0,

  p_limit     integer DEFAULT 200,

  p_office_id uuid    DEFAULT NULL

)

RETURNS jsonb

LANGUAGE plpgsql

SECURITY DEFINER

SET search_path = public, pg_temp

AS $$

DECLARE

  v_actor_role text;

  v_records    jsonb;

  v_total      integer;

BEGIN

  SELECT upper(coalesce(role, '')) INTO v_actor_role

  FROM public.profiles

  WHERE id = auth.uid() AND is_active = true;



  SELECT count(*) INTO v_total

  FROM public.attendance_regularization_requests r

  JOIN public.profiles p ON p.id = r.user_id

  WHERE r.status = upper(p_status)

    AND (p_office_id IS NULL OR p.office_id = p_office_id);



  SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC), '[]'::jsonb)

  INTO v_records

  FROM (

    SELECT r.*,

           jsonb_build_object('name', p.name, 'employee_number', p.employee_number) AS profiles,

           jsonb_build_object('date', a.date, 'checkin_time', a.checkin_time,

             'checkout_time', a.checkout_time, 'is_late', a.is_late) AS attendance_logs,

           c.official_first_in, c.first_in_source,

           c.official_last_out AS current_official_last_out, c.last_out_source,

           CASE WHEN r.status = 'APPROVED' THEN r.requested_checkout END AS final_approved_checkout,

           c.team_name, c.office_name, c.check_in_office_name, c.attendance_status

    FROM public.attendance_regularization_requests r

    JOIN public.profiles p ON p.id = r.user_id

    JOIN public.attendance_logs a ON a.id = r.attendance_id

    LEFT JOIN public.v_attendance_daily_canonical c

      ON c.user_id = r.user_id AND c.work_date = a.date

    WHERE r.status = upper(p_status)

      AND (p_office_id IS NULL OR p.office_id = p_office_id)

    ORDER BY r.created_at DESC

    OFFSET p_offset LIMIT p_limit

  ) page;



  RETURN jsonb_build_object(

    'success', true,

    'records', v_records,

    'total', v_total,

    'has_more', p_offset + jsonb_array_length(v_records) < v_total

  );

END;

$$;



REVOKE ALL ON FUNCTION public.rpc_admin_list_attendance_regularization(text, integer, integer, uuid)

  FROM public, anon;

GRANT EXECUTE ON FUNCTION public.rpc_admin_list_attendance_regularization(text, integer, integer, uuid)

  TO authenticated;

-- ─── STEP 3c: Restore v_attendance_daily_enterprise and rpc_admin_attendance_report_v4

-- Both dropped by CASCADE. Bodies are identical to 20260817030000.



CREATE OR REPLACE VIEW public.v_attendance_daily_enterprise

WITH (security_invoker = true) AS

WITH historical AS (

  SELECT

    canonical.*,

    assignment.employee_name historical_employee_name,

    assignment.employee_number historical_employee_number,

    assignment.office_id historical_office_id,

    assignment.office_name historical_office_name,

    assignment.team historical_team_name,

    assignment.reports_to historical_team_head_id,

    assignment.manager_name historical_team_head_name,

    assignment.role historical_role,

    COALESCE(assignment.verified, false) assignment_verified,

    resolved_team.id historical_team_id,

    policy.late_checkin_time historical_late_checkin_time,

    COALESCE(policy.verified, false) policy_verified,

    public.resolve_hrms_calendar_day_at_assignment(

      canonical.user_id, assignment.office_id,

      resolved_team.id, canonical.work_date

    ) historical_calendar_value,


    fraud.severity fraud_severity,

    fraud.score fraud_score,

    fraud.reasons fraud_reasons

  FROM public.v_attendance_daily_canonical canonical

  LEFT JOIN LATERAL (

    SELECT history.*

    FROM public.employee_assignment_history history

    WHERE history.profile_id = canonical.user_id

      AND canonical.work_date >= history.effective_from

      AND (history.effective_to IS NULL OR canonical.work_date <= history.effective_to)

    ORDER BY history.verified DESC, history.effective_from DESC,

      history.recorded_at DESC, history.id

    LIMIT 1

  ) assignment ON true

  LEFT JOIN public.teams resolved_team

    ON lower(btrim(resolved_team.name)) = lower(btrim(assignment.team))

  LEFT JOIN LATERAL (

    SELECT history.late_checkin_time, history.verified

    FROM public.attendance_policy_history history

    WHERE history.office_id = assignment.office_id

      AND lower(history.role) IN (lower(COALESCE(assignment.role, '')), 'all')

      AND canonical.work_date >= history.effective_from

      AND (history.effective_to IS NULL OR canonical.work_date <= history.effective_to)

    ORDER BY

      CASE WHEN lower(history.role) = lower(COALESCE(assignment.role, '')) THEN 0 ELSE 1 END,

      history.verified DESC, history.effective_from DESC, history.id

    LIMIT 1

  ) policy ON true

  LEFT JOIN LATERAL (

    SELECT event.severity, event.score, event.reasons

    FROM public.attendance_fraud_events event

    WHERE event.attendance_id = canonical.attendance_log_id

    ORDER BY event.created_at DESC, event.id LIMIT 1

  ) fraud ON true

), classified AS (

  SELECT historical.*,

    historical.assignment_verified AND historical.policy_verified

      AND historical.historical_office_id IS NOT NULL AS enterprise_history_verified,

    CASE

      WHEN NOT historical.assignment_verified THEN 'ASSIGNMENT_HISTORY_NOT_VERIFIED'

      WHEN historical.historical_office_id IS NULL THEN 'HISTORICAL_OFFICE_NOT_ASSIGNED'

      WHEN NOT historical.policy_verified THEN 'POLICY_HISTORY_NOT_VERIFIED'

      ELSE NULL

    END configuration_issue

  FROM historical

)

SELECT

  attendance_log_id, user_id, work_date,

  COALESCE(historical_employee_name, employee_name) employee_name,

  COALESCE(historical_employee_number, employee_number) employee_number,

  historical_office_id office_id, historical_office_name office_name,

  historical_team_id team_id, historical_team_name team_name,

  historical_team_head_id team_head_id, historical_team_head_name team_head_name,

  historical_role role,

  app_first_in, biometric_first_in, field_visit_first_in,

  official_first_in, first_in_source,

  app_checkout, approved_regularization_checkout, admin_corrected_checkout,

  official_last_out, last_out_source,

  biometric_last_punch_evidence, field_visit_checkout,

  presence_source,

  CASE

    WHEN NOT enterprise_history_verified THEN 'CONFIG_REQUIRED'

    WHEN classified.leave_type IS NOT NULL THEN 'ON_LEAVE'

    WHEN historical_calendar_value->>'kind' = 'HOLIDAY' THEN 'HOLIDAY'

    WHEN historical_calendar_value->>'kind' = 'WEEKLY_OFF' THEN 'WEEKLY_OFF'

    WHEN official_first_in IS NULL THEN 'ABSENT'

    WHEN official_last_out IS NOT NULL THEN 'CHECKED_OUT'

    WHEN has_field_visit THEN 'FIELD_VISIT'

    WHEN historical_late_checkin_time IS NOT NULL

      AND (official_first_in AT TIME ZONE 'Asia/Kolkata')::time

        >= historical_late_checkin_time THEN 'LATE'

    ELSE 'PRESENT'

  END attendance_status,

  enterprise_history_verified

    AND official_first_in IS NOT NULL

    AND historical_late_checkin_time IS NOT NULL

    AND (official_first_in AT TIME ZONE 'Asia/Kolkata')::time

      >= historical_late_checkin_time AS is_late,

  working_minutes,

  CASE

    WHEN configuration_issue IS NOT NULL THEN configuration_issue

    WHEN tracking_health_reason IS NOT NULL THEN tracking_health_reason

    WHEN warning IS NOT NULL THEN warning::text

    WHEN official_first_in IS NOT NULL AND official_last_out IS NULL THEN 'No checkout'

    ELSE NULL

  END warning,

  has_field_visit,

  enterprise_history_verified history_verified,

  show_on_tv,

  latest_ping_at, latest_accuracy_m, latest_tracking_status,

  tracking_health_reason, ping_is_stale,

  active_field_visit_id, active_field_visit_name,

  distance_from_destination_m, distance_from_office_m,

  tracking_session_status,

  fraud_severity, fraud_score, fraud_reasons, configuration_issue

FROM classified;



REVOKE ALL ON public.v_attendance_daily_enterprise FROM public, anon, authenticated;



CREATE OR REPLACE FUNCTION public.rpc_admin_attendance_report_v4(

  p_start date, p_end date,

  p_offset integer DEFAULT 0, p_limit integer DEFAULT 500,

  p_office_names text[] DEFAULT NULL, p_team_names text[] DEFAULT NULL,

  p_head_names text[] DEFAULT NULL, p_roles text[] DEFAULT NULL,

  p_statuses text[] DEFAULT NULL, p_sources text[] DEFAULT NULL,

  p_search text DEFAULT NULL, p_exceptions_only boolean DEFAULT false

)

RETURNS SETOF public.v_attendance_daily_enterprise

LANGUAGE plpgsql STABLE SECURITY DEFINER

SET search_path = public, pg_temp

AS $$

BEGIN

  PERFORM public.require_profile_admin();

  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start

     OR p_end > (now() AT TIME ZONE 'Asia/Kolkata')::date

     OR p_end - p_start > 366

     OR p_offset < 0 OR p_limit < 1 OR p_limit > 1000 THEN

    RAISE EXCEPTION 'INVALID_ATTENDANCE_REPORT_RANGE';

  END IF;

  RETURN QUERY

  SELECT report.* FROM public.v_attendance_daily_enterprise report

  WHERE report.work_date BETWEEN p_start AND p_end

    AND (COALESCE(CARDINALITY(p_office_names),0)=0 OR regexp_replace(lower(btrim(report.office_name)),'\s+office$','') = ANY(SELECT regexp_replace(lower(btrim(value)),'\s+office$','') FROM unnest(p_office_names) value))

    AND (COALESCE(CARDINALITY(p_team_names),0)=0 OR regexp_replace(lower(btrim(report.team_name)),'\s+team$','') = ANY(SELECT regexp_replace(lower(btrim(value)),'\s+team$','') FROM unnest(p_team_names) value))

    AND (COALESCE(CARDINALITY(p_head_names),0)=0 OR lower(btrim(report.team_head_name)) = ANY(SELECT lower(btrim(value)) FROM unnest(p_head_names) value))

    AND (COALESCE(CARDINALITY(p_roles),0)=0 OR replace(upper(btrim(report.role)),'_',' ') = ANY(SELECT replace(upper(btrim(value)),'_',' ') FROM unnest(p_roles) value))

    AND (COALESCE(CARDINALITY(p_sources),0)=0 OR upper(report.presence_source) = ANY(SELECT upper(btrim(value)) FROM unnest(p_sources) value))

    AND (nullif(btrim(p_search),'') IS NULL OR report.employee_name ILIKE '%'||btrim(p_search)||'%' OR COALESCE(report.employee_number,'') ILIKE '%'||btrim(p_search)||'%')

    AND (COALESCE(CARDINALITY(p_statuses),0)=0 OR EXISTS(SELECT 1 FROM unnest(p_statuses) req(value) WHERE upper(btrim(req.value))=upper(report.attendance_status) OR (upper(btrim(req.value))='NO_CHECKOUT' AND report.official_first_in IS NOT NULL AND report.official_last_out IS NULL) OR (upper(btrim(req.value))='FIELD_VISIT' AND report.has_field_visit) OR (upper(btrim(req.value))='SUSPICIOUS_GPS' AND (upper(COALESCE(report.fraud_severity,''))='SUSPICIOUS' OR report.tracking_health_reason IS NOT NULL OR report.ping_is_stale))))

    AND (NOT p_exceptions_only OR report.attendance_status IN ('ABSENT','LATE','CONFIG_REQUIRED') OR (report.official_first_in IS NOT NULL AND report.official_last_out IS NULL) OR upper(COALESCE(report.fraud_severity,'')) IN ('WARNING','SUSPICIOUS') OR report.tracking_health_reason IS NOT NULL)

  ORDER BY report.work_date DESC, report.employee_number NULLS LAST, report.user_id

  OFFSET p_offset LIMIT p_limit;

END;

$$;



REVOKE ALL ON FUNCTION public.rpc_admin_attendance_report_v4(date,date,integer,integer,text[],text[],text[],text[],text[],text[],text,boolean) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.rpc_admin_attendance_report_v4(date,date,integer,integer,text[],text[],text[],text[],text[],text[],text,boolean) TO authenticated;

-- ─── STEP 4: Grants ──────────────────────────────────────────────────────────



REVOKE ALL ON public.v_attendance_daily_canonical FROM public, anon, authenticated;

GRANT SELECT ON public.v_attendance_daily_canonical TO authenticated;



REVOKE ALL ON FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid) TO authenticated;



REVOKE ALL ON FUNCTION public.rpc_my_attendance_daily_v3(date, date) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.rpc_my_attendance_daily_v3(date, date) TO authenticated;



NOTIFY pgrst, 'reload schema';