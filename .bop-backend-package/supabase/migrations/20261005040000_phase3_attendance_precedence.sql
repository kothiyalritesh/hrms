-- ─── Phase 3: First-in Precedence ───
-- Fixes ATT-05: Establish strict rules for Biometric vs App check-in precedence using LEAST()

CREATE OR REPLACE VIEW public.v_attendance_daily_canonical
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

  LEAST(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) effective_checkin,

  -- official_first_in (enterprise alias)

  LEAST(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) official_first_in,

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

    WHEN LEAST(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) IS NOT NULL

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

      LEAST(e.app_first_in, e.field_visit_first_in, e.biometric_first_in)

    )) / 60))::integer

    ELSE NULL

  END working_minutes,

  CASE

    WHEN e.attendance_warning IS NOT NULL THEN e.attendance_warning::text

    WHEN LEAST(e.app_first_in, e.field_visit_first_in, e.biometric_first_in) IS NOT NULL

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
