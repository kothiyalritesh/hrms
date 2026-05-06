-- ============================================================
-- Add meeting_details column + rebuild admin view
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add meeting_details JSONB column to activity_logs
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS meeting_details JSONB;

-- 2. Rebuild admin daily view to include meeting_details
DROP VIEW IF EXISTS admin_daily_employee_log;
CREATE VIEW admin_daily_employee_log AS
SELECT
  p.id                                          AS user_id,
  p.name                                        AS employee_name,
  p.employee_number,
  p.role,
  al.date                                       AS work_date,
  al.checkin_time,
  al.checkin_location,
  al.checkout_time,
  al.checkout_location,
  al.status                                     AS attendance_status,
  al.attendance_type,
  al.distance_from_office,
  al.warning                                    AS attendance_warning,
  o.name                                        AS office_name,

  (
    SELECT json_agg(
      json_build_object(
        'id',              act.id,
        'time',            to_char(act.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
        'location_type',   act.location_type,
        'location_name',   act.location_name,
        'activity_type',   act.activity_type,
        'summary',         act.summary,
        'client_name',     act.client_name,
        'company_name',    act.company_name,
        'notes',           act.notes,
        'is_billable',     act.is_billable_activity,
        'confidence',      act.confidence_score,
        'flag',            act.flag,
        'meeting_details', act.meeting_details
      )
      ORDER BY act.timestamp ASC
    )
    FROM activity_logs act
    WHERE act.user_id = p.id
      AND DATE(act.timestamp) = al.date
  )                                             AS activities,

  (
    SELECT COUNT(*)
    FROM activity_logs act
    WHERE act.user_id = p.id
      AND DATE(act.timestamp) = al.date
  )                                             AS total_activities,

  (
    SELECT COUNT(*)
    FROM activity_logs act
    WHERE act.user_id = p.id
      AND DATE(act.timestamp) = al.date
      AND act.is_billable_activity = true
  )                                             AS billable_activities

FROM attendance_logs al
JOIN profiles p ON al.user_id = p.id
LEFT JOIN offices o ON al.office_id = o.id
ORDER BY al.date DESC, p.name ASC;

SELECT 'meeting_details column + view updated!' AS status;
