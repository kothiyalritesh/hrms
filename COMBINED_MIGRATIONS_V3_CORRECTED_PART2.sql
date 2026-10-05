-- >>> START: 20260926132004_extend_canonical_view_site_name.sql <<<

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
  settings.tv_tracking_stale_minutes,
  visit.active_site_name
FROM employee_days employee
LEFT JOIN LATERAL (
  SELECT a.* FROM public.attendance_logs a
  WHERE a.user_id=employee.user_id AND a.date=employee.work_date
  ORDER BY a.created_at, a.id LIMIT 1) attendance ON true
LEFT JOIN LATERAL (
  SELECT min(d.log_date) first_punch, max(d.log_date) last_punch
  FROM public.smartoffice_device_logs d
  WHERE d.user_id=employee.user_id AND (d.log_date AT TIME ZONE 'Asia/Kolkata')::date=employee.work_date) biometric ON true
LEFT JOIN LATERAL (
  SELECT
    min(public.hrms_timestamp(v.checkin_time))  first_in,
    max(public.hrms_timestamp(v.checkout_time)) last_out,
    bool_or(v.checkin_time IS NOT NULL) has_visit,
    (array_agg(v.id ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_id,
    (array_agg(COALESCE(v.project_name,v.location_name)
      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_name,
    (array_agg(v.last_distance_m ORDER BY v.last_distance_at DESC NULLS LAST))[1] distance_m,
    (array_agg(s.name
      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_site_name
  FROM public.field_visits v
  LEFT JOIN public.predefined_sites s ON s.id = v.selected_site_id
  WHERE v.user_id=employee.user_id AND v.date=employee.work_date
  AND COALESCE(v.verification_status,'PENDING') <> 'REJECTED') visit ON true
LEFT JOIN LATERAL (
  SELECT r.id, r.requested_checkout
  FROM public.attendance_regularization_requests r
  WHERE r.attendance_id=attendance.id AND r.status='APPROVED'
  ORDER BY r.reviewed_at DESC NULLS LAST, r.created_at DESC LIMIT 1) regularization ON true
LEFT JOIN LATERAL (
  SELECT p.id policy_id, p.late_checkin_time, p.allow_field_visit_checkout
  FROM public.attendance_policies p
  WHERE p.is_active
    AND employee.work_date BETWEEN p.effective_from AND COALESCE(p.effective_to,'infinity'::date)
    AND (p.office_id=employee.office_id OR p.office_id IS NULL)
    AND lower(COALESCE(p.role,'all')) IN (lower(COALESCE(employee.role,'')),'all')
  ORDER BY CASE
    WHEN p.office_id=employee.office_id AND lower(p.role)=lower(COALESCE(employee.role,'')) THEN 1
    WHEN p.office_id=employee.office_id AND lower(COALESCE(p.role,'all'))='all' THEN 2
    WHEN p.office_id IS NULL AND lower(p.role)=lower(COALESCE(employee.role,'')) THEN 3
    ELSE 4 END
  LIMIT 1) policy ON true
LEFT JOIN LATERAL (
  SELECT public.resolve_hrms_calendar_day(employee.user_id,employee.work_date) value) calendar ON true
LEFT JOIN LATERAL (
  SELECT r.leave_type
  FROM public.leave_requests r
  WHERE r.user_id=employee.user_id AND r.status='APPROVED'
    AND employee.work_date BETWEEN r.start_date AND r.end_date
  ORDER BY r.created_at DESC LIMIT 1) leave_request ON true
LEFT JOIN LATERAL (
  SELECT tl.recorded_at, tl.accuracy, tl.distance_from_base, ts.status,
    th.reason
  FROM public.location_tracking tl
  JOIN public.tracking_sessions ts ON ts.id=tl.session_id
  LEFT JOIN public.tracking_health th ON th.session_id=ts.id
  WHERE tl.user_id=employee.user_id
  ORDER BY tl.recorded_at DESC LIMIT 1
) ping ON true
LEFT JOIN LATERAL (
  SELECT t.status
  FROM public.tracking_sessions t
  WHERE t.user_id=employee.user_id AND t.date=employee.work_date
  ORDER BY t.created_at DESC LIMIT 1
) session ON true
LEFT JOIN LATERAL (
  SELECT th.reason
  FROM public.tracking_health th
  JOIN public.tracking_sessions ts ON ts.id=th.session_id
  WHERE ts.user_id=employee.user_id AND ts.date=employee.work_date
  ORDER BY th.created_at DESC LIMIT 1
) health ON true
CROSS JOIN (
  SELECT COALESCE(
    current_setting('app.tv_tracking_stale_minutes', true),
    '15'
  )::integer tv_tracking_stale_minutes
) settings
)
SELECT e.*,
  COALESCE(
    e.approved_regularization_checkout,
    e.admin_corrected_checkout,
    CASE WHEN COALESCE(e.allow_field_visit_checkout,true) THEN COALESCE(e.app_checkout,e.field_visit_checkout) ELSE e.app_checkout END,
    e.app_checkout,
    e.raw_checkout
  ) effective_checkout,
  COALESCE(
    e.app_first_in,
    e.field_visit_first_in,
    e.biometric_first_in
  ) effective_checkin,
  (CASE
    WHEN e.leave_type IS NOT NULL THEN 'LEAVE'
    WHEN e.calendar_value->>'kind'='WEEK_OFF' THEN 'WEEK_OFF'
    WHEN e.calendar_value->>'kind'='HOLIDAY' THEN 'HOLIDAY'
    WHEN e.raw_checkout IS NOT NULL OR e.approved_regularization_checkout IS NOT NULL OR e.admin_corrected_checkout IS NOT NULL THEN 'CHECKED_OUT'
    WHEN e.app_first_in IS NOT NULL OR e.biometric_first_in IS NOT NULL OR e.field_visit_first_in IS NOT NULL THEN 'CHECKED_IN'
    ELSE 'ABSENT'
  END) effective_status,
  EXISTS(
    SELECT 1 FROM public.attendance_logs a
    WHERE a.id=e.attendance_log_id AND a.auto_closed=true
  ) is_auto_closed
FROM evidence e;

-- <<< END: 20260926132004_extend_canonical_view_site_name.sql >>>

-- >>> START: 20260926132549_unified_activity_log.sql <<<

CREATE OR REPLACE FUNCTION public.rpc_my_unified_activity_log(
  p_category text default 'all',
  p_limit int default 50,
  p_offset int default 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  WITH combined AS (
    SELECT id, 'attendance' as category, 'Check-in recorded' as title, 'Checked in' as description, checkin_time as log_time
    FROM public.attendance_logs WHERE user_id = v_uid AND checkin_time IS NOT NULL
    UNION ALL
    SELECT id, 'attendance' as category, 'Check-out recorded' as title, 'Checked out' as description, checkout_time as log_time
    FROM public.attendance_logs WHERE user_id = v_uid AND checkout_time IS NOT NULL
    
    UNION ALL
    SELECT id, 'leave' as category, 'Leave ' || status as title, leave_type || ' from ' || start_date || ' to ' || end_date as description, created_at as log_time
    FROM public.leave_requests WHERE user_id = v_uid
    
    UNION ALL
    SELECT id, 'field_visit' as category, activity_type as title, summary as description, timestamp as log_time
    FROM public.activity_logs WHERE user_id = v_uid
    
    UNION ALL
    SELECT id, 'system' as category, 'System Action: ' || action as title, 'Table: ' || table_name as description, performed_at as log_time
    FROM public.audit_logs WHERE performed_by = v_uid
  ), filtered AS (
    SELECT * FROM combined
    WHERE p_category = 'all' OR category = p_category
    ORDER BY log_time DESC NULLS LAST
    OFFSET p_offset LIMIT p_limit
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'category', category,
    'title', title,
    'description', description,
    'timestamp', log_time
  )) INTO v_res FROM filtered;
  
  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_my_unified_activity_log(text, int, int) TO authenticated;

-- <<< END: 20260926132549_unified_activity_log.sql >>>

-- >>> START: 20260926132726_anonymous_feedback.sql <<<

CREATE TABLE IF NOT EXISTS public.anonymous_feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  message text not null,
  created_at timestamptz not null default now(),
  org_id text
);

CREATE TABLE IF NOT EXISTS public.feedback_audit (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid references public.anonymous_feedback(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  inserted_at timestamptz not null default now()
);

ALTER TABLE public.anonymous_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can insert anonymous feedback" ON public.anonymous_feedback;
CREATE POLICY "Anyone can insert anonymous feedback" ON public.anonymous_feedback
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "HR and Admins can view anonymous feedback" ON public.anonymous_feedback;
CREATE POLICY "HR and Admins can view anonymous feedback" ON public.anonymous_feedback
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRBP', 'DIRECTOR'))
  );

ALTER TABLE public.feedback_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Only system admin can view audit" ON public.feedback_audit;
CREATE POLICY "Only system admin can view audit" ON public.feedback_audit
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'SYSTEM_ADMIN')
  );

CREATE OR REPLACE FUNCTION public.trg_audit_anonymous_feedback()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.feedback_audit (feedback_id, user_id)
  VALUES (NEW.id, auth.uid());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_anonymous_feedback_trg ON public.anonymous_feedback;
CREATE TRIGGER audit_anonymous_feedback_trg
AFTER INSERT ON public.anonymous_feedback
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_anonymous_feedback();

-- Privacy Model Documentation:
-- Model B - Confidential but Auditable
-- - Feedback is submitted anonymously (no user_id in anonymous_feedback table)
-- - Submitter identity is recorded in feedback_audit table
-- - HR/Admin/HRBP/Director can view feedback but cannot identify submitter
-- - SYSTEM_ADMIN can view audit table and identify submitter
-- - This provides accountability while maintaining employee privacy

-- <<< END: 20260926132726_anonymous_feedback.sql >>>

-- >>> START: 20260926132902_seed_screen_permissions.sql <<<

INSERT INTO public.permissions (name, description, category)
VALUES
  ('screen.attendance_control', 'Access Attendance Control Screen', 'screens'),
  ('screen.user_management', 'Access User Management Screen', 'screens'),
  ('screen.leave_balance', 'Access Leave Balance Screen', 'screens'),
  ('screen.audit_logs', 'Access Audit Logs', 'screens'),
  ('screen.birthday_management', 'Access Birthday Management', 'screens'),
  ('screen.task_project_control', 'Access Task/Project Control', 'screens'),
  ('screen.ticket_management', 'Access Ticket Management', 'screens'),
  ('screen.live_tracking', 'Access Live Tracking', 'screens'),
  ('screen.field_visit_admin', 'Access Field Visit Admin', 'screens'),
  ('screen.team_hierarchy', 'Access Team Hierarchy', 'screens'),
  ('screen.check_in_logs', 'Access Check In Logs', 'screens'),
  ('screen.suspicious_attendance', 'Access Suspicious Attendance', 'screens'),
  ('screen.attendance_regularization', 'Access Attendance Regularization', 'screens'),
  ('screen.event_management', 'Access Event Management', 'screens'),
  ('screen.smartoffice_integration', 'Access SmartOffice Integration', 'screens'),
  ('screen.site_settings', 'Access Site Settings', 'screens'),
  ('screen.office_settings', 'Access Office Settings', 'screens'),
  ('screen.notification_management', 'Access Notification Management', 'screens'),
  ('screen.anonymous_feedback', 'Access Anonymous Feedback', 'screens')
ON CONFLICT (name) DO NOTHING;

-- NOTE: Permission assignments to roles/users must be handled separately
-- through the user_permissions table or role-based permission assignment system.

-- <<< END: 20260926132902_seed_screen_permissions.sql >>>

-- >>> START: 20260926135000_audit_logs_summary.sql <<<

CREATE OR REPLACE FUNCTION public.rpc_admin_audit_logs_summary()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result json;
    v_today_start timestamptz;
    v_today_end timestamptz;
    v_week_start timestamptz;
BEGIN
    -- Use IST business date boundaries
    v_today_start := ((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamptz AT TIME ZONE 'Asia/Kolkata';
    v_today_end := (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamptz AT TIME ZONE 'Asia/Kolkata') - interval '1 second';
    v_week_start := ((now() AT TIME ZONE 'Asia/Kolkata')::date - 7)::timestamptz AT TIME ZONE 'Asia/Kolkata';
    
    SELECT json_build_object(
        'total_today', (SELECT count(*) FROM audit_logs WHERE performed_at >= v_today_start AND performed_at <= v_today_end),
        'total_week', (SELECT count(*) FROM audit_logs WHERE performed_at >= v_week_start),
        'most_active_admin', (
            SELECT p.name 
            FROM audit_logs a 
            JOIN profiles p ON p.id = a.performed_by 
            WHERE a.performed_at >= ((now() AT TIME ZONE 'Asia/Kolkata')::date - 30)::timestamptz AT TIME ZONE 'Asia/Kolkata'
            GROUP BY p.name 
            ORDER BY count(*) DESC 
            LIMIT 1
        ),
        'most_modified_table', (
            SELECT table_name 
            FROM audit_logs 
            WHERE performed_at >= ((now() AT TIME ZONE 'Asia/Kolkata')::date - 30)::timestamptz AT TIME ZONE 'Asia/Kolkata'
            GROUP BY table_name 
            ORDER BY count(*) DESC 
            LIMIT 1
        )
    ) INTO result;
    
    RETURN result;
END;
$$;

-- <<< END: 20260926135000_audit_logs_summary.sql >>>

-- ==========================================
-- SECURITY HARDENING (Least Privilege)
-- ==========================================
REVOKE ALL ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_audit_logs_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_audit_logs_summary() TO authenticated;

-- ==========================================
-- MIGRATION COMPLETE
-- ==========================================
-- This migration is now production-ready pending verification of:
-- 1. All dependent tables exist
-- 2. All dependent functions exist
-- 3. Staging environment testing passes
-- 4. Performance testing passes
