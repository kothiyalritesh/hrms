-- ==========================================
-- COMBINED HRMS MIGRATIONS (PHASE 3 & 4) - V3 CORRECTED
-- PART 2: Functions, Tables, Permissions (WITHOUT Canonical View)
-- ==========================================

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
-- MIGRATION COMPLETE - PART 2
-- ==========================================
-- This part includes:
-- - Unified activity log RPC
-- - Anonymous feedback tables and RLS
-- - Screen permissions seeding
-- - Audit logs summary RPC
-- - Security hardening (REVOKE/GRANT)
--
-- NOTE: Canonical view is deployed separately via FIX_CANONICAL_VIEW_DROP_RECREATE.sql
