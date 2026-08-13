-- ============================================================
-- Fix admin activity logs view to show ALL employees
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Disable RLS on all relevant tables
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs DISABLE ROW LEVEL SECURITY;

-- 2. Recreate the view to show ALL employees (not just those with attendance)
CREATE OR REPLACE VIEW admin_daily_employee_log AS
SELECT
  p.id AS user_id,
  p.name AS employee_name,
  p.employee_number,
  p.role,
  o.name AS office_name,
  al.date AS work_date,
  al.checkin_time,
  al.checkout_time,
  al.status AS attendance_status,
  al.attendance_type,
  al.warning AS attendance_warning,
  COALESCE(act.total_activities, 0) AS total_activities,
  COALESCE(act.billable_activities, 0) AS billable_activities,
  COALESCE(act.activities, '[]'::json) AS activities
FROM profiles p
LEFT JOIN offices o ON p.office_id = o.id
LEFT JOIN attendance_logs al
  ON al.user_id = p.id
  AND al.date = CURRENT_DATE
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) AS total_activities,
    COUNT(*) FILTER (WHERE is_billable_activity = true) AS billable_activities,
    json_agg(
      json_build_object(
        'id', id,
        'time', timestamp,
        'timestamp', timestamp,
        'activity_type', activity_type,
        'summary', summary,
        'notes', notes,
        'location_name', location_name,
        'client_name', client_name,
        'company_name', company_name,
        'meeting_purpose', meeting_purpose,
        'confidence_score', confidence_score,
        'is_billable', is_billable_activity,
        'flag', flag
      ) ORDER BY timestamp ASC
    ) AS activities
  FROM activity_logs
  WHERE DATE(timestamp) = CURRENT_DATE
  GROUP BY user_id
) act ON act.user_id = p.id
WHERE p.is_active = true
ORDER BY p.name ASC;

-- 3. Verify
SELECT COUNT(*) AS total_employees FROM admin_daily_employee_log;
SELECT 'View updated successfully' AS status;
