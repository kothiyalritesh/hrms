
CREATE OR REPLACE VIEW public.v_attendance_daily_canonical
WITH (security_invoker=true) AS
  WITH employee_days AS (
    SELECT p.id user_id, day::date work_date, p.name employee_name, p.employee_number,
      p.office_id, o.name office_name, p.team_id, COALESCE(t.name,p.team) team_name,
      p.reports_to team_head_id, manager.name team_head_name, p.role, p.show_on_tv,
      p.joining_date, p.is_active
    FROM public.profiles p
    LEFT JOIN public.offices o ON o.id=p.office_id
    LEFT JOIN public.teams t ON t.id=p.team_id
    LEFT JOIN public.profiles manager ON manager.id=p.reports_to
    CROSS JOIN LATERAL generate_series(
      greatest(COALESCE(p.joining_date,(p.created_at AT TIME ZONE 'Asia/Kolkata')::date), date '2020-01-01'),
      least(COALESCE(p.last_working_date,(now() AT TIME ZONE 'Asia/Kolkata')::date),(now() AT TIME ZONE 'Asia/Kolkata')::date),
      INTERVAL '1 day') day
    WHERE p.attendance_reporting_enabled
      AND (day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR p.is_active)
  ), evidence AS (
  SELECT employee.*,
    attendance.id attendance_log_id,
    COALESCE(attendance.app_checkin_time,
      CASE WHEN upper(COALESCE(attendance.checkin_source,attendance.attendance_type,'')) LIKE 'APP%'
           THEN attendance.checkin_time END) app_first_in,
    COALESCE(attendance.biometric_first_punch,biometric.first_punch) biometric_first_in,
    visit.first_in field_visit_first_in,
    attendance.checkout_time raw_checkout,
    CASE WHEN upper(COALESCE(attendance.checkout_source,''))
           NOT IN ('ADMIN','REGULARIZATION','SYSTEM','BIOMETRIC','FIELD_VISIT')
         THEN attendance.checkout_time END app_checkout,
    regularization.requested_checkout approved_regularization_checkout,
    CASE WHEN regularization.id IS NULL
           AND upper(COALESCE(attendance.checkout_source,''))='ADMIN'
         THEN attendance.checkout_time END admin_corrected_checkout,
    COALESCE(attendance.biometric_last_punch,biometric.last_punch) biometric_last_punch_evidence,
    visit.last_out field_visit_checkout, visit.has_visit, visit.active_id, visit.active_name,
    visit.distance_m,
    policy.late_checkin_time, policy.allow_field_visit_checkout, policy.policy_id,
    calendar.value calendar_value, leave_request.leave_type,
    attendance.warning attendance_warning,
    ping.recorded_at latest_ping_at, ping.accuracy latest_accuracy_m,
    ping.status latest_tracking_status,
    ping.distance_from_base distance_from_office_m,
    session.status tracking_session_status,
    health.reason tracking_health_reason,
    settings.tv_tracking_stale_minutes
  FROM employee_days employee
  LEFT JOIN LATERAL (
    SELECT a.* FROM public.attendance_logs a
    WHERE a.user_id=employee.user_id AND a.date=employee.work_date
    ORDER BY a.created_at, a.id LIMIT 1) attendance ON true
  LEFT JOIN LATERAL (
    SELECT
      least(old_bio.first_punch, new_bio.first_punch) first_punch,
      greatest(old_bio.last_punch, new_bio.last_punch) last_punch
    FROM (
      SELECT
        min(COALESCE(d.log_date,(d.log_date_only::text||' '||d.log_time::text)::timestamp AT TIME ZONE 'Asia/Kolkata')) first_punch,
        max(COALESCE(d.log_date,(d.log_date_only::text||' '||d.log_time::text)::timestamp AT TIME ZONE 'Asia/Kolkata')) last_punch
      FROM public.smartoffice_device_logs d
      WHERE d.user_id=employee.user_id AND d.log_date_only=employee.work_date
    ) old_bio
    CROSS JOIN (
      SELECT
        min(punch.punch_timestamp) first_punch,
        max(punch.punch_timestamp) last_punch
      FROM public.biometric_device_punches punch
      WHERE punch.attendance_date = employee.work_date
        AND punch.biometric_employee_code IN (
           SELECT mapping.biometric_employee_code
           FROM public.employee_biometric_mappings mapping
           WHERE mapping.user_id = employee.user_id AND mapping.is_active
        )
    ) new_bio
  ) biometric ON true
  LEFT JOIN LATERAL (
    SELECT
      min(public.hrms_timestamp(v.checkin_time))  first_in,
      max(public.hrms_timestamp(v.checkout_time)) last_out,
      bool_or(v.id IS NOT NULL) has_visit,
      array_agg(v.id ORDER BY v.checkin_time DESC)[1] active_id,
      array_agg(v.client_name ORDER BY v.checkin_time DESC)[1] active_name,
      min(v.distance_m) distance_m
    FROM public.field_visits v
    WHERE v.user_id=employee.user_id AND v.visit_date=employee.work_date
      AND upper(v.status) IN ('ACTIVE','COMPLETED','PENDING_APPROVAL')
  ) visit ON true
  LEFT JOIN LATERAL (
    SELECT r.requested_checkout, r.id FROM public.attendance_regularizations r
    WHERE r.attendance_id=attendance.id AND upper(r.status)='APPROVED'
    ORDER BY r.updated_at DESC, r.id LIMIT 1) regularization ON true
  LEFT JOIN LATERAL (
    SELECT history.late_checkin_time, history.allow_field_visit_checkout, history.id policy_id
    FROM public.attendance_policy_history history
    WHERE history.office_id=employee.office_id
      AND lower(history.role) IN (lower(COALESCE(employee.role,'')),'all')
      AND employee.work_date >= history.effective_from
      AND (history.effective_to IS NULL OR employee.work_date <= history.effective_to)
    ORDER BY CASE WHEN lower(history.role)=lower(COALESCE(employee.role,'')) THEN 0 ELSE 1 END,
      history.verified DESC, history.effective_from DESC, history.id LIMIT 1) policy ON true
  LEFT JOIN LATERAL (
    SELECT public.resolve_hrms_calendar_day_at_assignment(employee.user_id,employee.office_id,employee.team_id,employee.work_date) value
  ) calendar ON true
  LEFT JOIN LATERAL (
    SELECT request.leave_type FROM public.leave_requests request
    WHERE request.user_id=employee.user_id AND lower(request.status)='approved'
      AND employee.work_date BETWEEN request.start_date AND request.end_date
    ORDER BY request.created_at, request.id LIMIT 1) leave_request ON true
  LEFT JOIN LATERAL (
    SELECT ping.recorded_at, ping.accuracy, ping.status, ping.distance_from_base
    FROM public.location_tracking ping
    WHERE ping.user_id=employee.user_id AND ping.recorded_at::date=employee.work_date
    ORDER BY ping.recorded_at DESC LIMIT 1) ping ON true
  LEFT JOIN LATERAL (
    SELECT s.status FROM public.location_tracking_sessions s
    WHERE s.user_id=employee.user_id AND s.date=employee.work_date
    ORDER BY s.created_at DESC LIMIT 1) session ON true
  LEFT JOIN LATERAL (
    SELECT h.reason FROM public.location_tracking_health h
    WHERE h.user_id=employee.user_id AND h.date=employee.work_date
    ORDER BY h.created_at DESC LIMIT 1) health ON true
  CROSS JOIN (
    SELECT COALESCE(
      (SELECT (value->>'tv_tracking_stale_minutes')::integer FROM public.system_settings WHERE key='app_config'),
      60) tv_tracking_stale_minutes
  ) settings
  )
  SELECT evidence.*,
    least(app_first_in, biometric_first_in, field_visit_first_in) official_first_in,
    CASE
      WHEN approved_regularization_checkout IS NOT NULL THEN approved_regularization_checkout
      WHEN admin_corrected_checkout IS NOT NULL THEN admin_corrected_checkout
      WHEN app_checkout IS NOT NULL THEN app_checkout
      WHEN policy_id IS NOT NULL AND NOT allow_field_visit_checkout THEN biometric_last_punch_evidence
      ELSE greatest(app_checkout, biometric_last_punch_evidence, field_visit_checkout)
    END official_last_out,
    CASE
      WHEN approved_regularization_checkout IS NOT NULL THEN 'REGULARIZATION'
      WHEN admin_corrected_checkout IS NOT NULL THEN 'ADMIN'
      WHEN app_checkout IS NOT NULL THEN 'APP'
      WHEN policy_id IS NOT NULL AND NOT allow_field_visit_checkout THEN 'BIOMETRIC'
      WHEN greatest(app_checkout, biometric_last_punch_evidence, field_visit_checkout) = app_checkout THEN 'APP'
      WHEN greatest(app_checkout, biometric_last_punch_evidence, field_visit_checkout) = biometric_last_punch_evidence THEN 'BIOMETRIC'
      WHEN greatest(app_checkout, biometric_last_punch_evidence, field_visit_checkout) = field_visit_checkout THEN 'FIELD_VISIT'
    END last_out_source,
    CASE
      WHEN least(app_first_in, biometric_first_in, field_visit_first_in) = app_first_in THEN 'APP'
      WHEN least(app_first_in, biometric_first_in, field_visit_first_in) = biometric_first_in THEN 'BIOMETRIC'
      WHEN least(app_first_in, biometric_first_in, field_visit_first_in) = field_visit_first_in THEN 'FIELD_VISIT'
      ELSE 'NO_DATA'
    END first_in_source,
    CASE
      WHEN num_nonnulls(app_first_in, biometric_first_in, field_visit_first_in) > 1 THEN 'MULTIPLE'
      WHEN app_first_in IS NOT NULL THEN 'APP'
      WHEN biometric_first_in IS NOT NULL THEN 'BIOMETRIC'
      WHEN field_visit_first_in IS NOT NULL THEN 'FIELD_VISIT'
      ELSE 'NO_DATA'
    END presence_source,
    CASE
      WHEN leave_type IS NOT NULL THEN 'ON_LEAVE'
      WHEN calendar_value->>'kind' = 'HOLIDAY' THEN 'HOLIDAY'
      WHEN calendar_value->>'kind' = 'WEEKLY_OFF' THEN 'WEEKLY_OFF'
      WHEN least(app_first_in, biometric_first_in, field_visit_first_in) IS NOT NULL THEN 'PRESENT'
      ELSE 'ABSENT'
    END attendance_status,
    least(app_first_in, biometric_first_in, field_visit_first_in) IS NOT NULL
      AND late_checkin_time IS NOT NULL
      AND (least(app_first_in, biometric_first_in, field_visit_first_in) AT TIME ZONE 'Asia/Kolkata')::time >= late_checkin_time AS is_late,
    COALESCE(
      extract(epoch from (
        CASE
          WHEN approved_regularization_checkout IS NOT NULL THEN approved_regularization_checkout
          WHEN admin_corrected_checkout IS NOT NULL THEN admin_corrected_checkout
          WHEN app_checkout IS NOT NULL THEN app_checkout
          WHEN policy_id IS NOT NULL AND NOT allow_field_visit_checkout THEN biometric_last_punch_evidence
          ELSE greatest(app_checkout, biometric_last_punch_evidence, field_visit_checkout)
        END
      ) - least(app_first_in, biometric_first_in, field_visit_first_in))/60,
      0
    )::integer working_minutes,
    latest_ping_at IS NOT NULL
      AND latest_ping_at < now() - (tv_tracking_stale_minutes || ' minutes')::interval AS ping_is_stale,
    attendance_warning IS NOT NULL
      OR (latest_ping_at IS NOT NULL AND latest_ping_at < now() - (tv_tracking_stale_minutes || ' minutes')::interval)
      OR tracking_health_reason IS NOT NULL AS has_warning
  FROM evidence;
