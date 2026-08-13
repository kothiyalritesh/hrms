-- ============================================================
-- FIX: Attendance Duplicates Issue
-- Creates proper view with deduplication and validates against active users
-- ============================================================

-- Drop existing view if exists
DROP VIEW IF EXISTS admin_attendance_export;

-- Create deduplicated attendance export view
-- This ensures we only show ONE record per user per date
CREATE OR REPLACE VIEW admin_attendance_export AS
SELECT DISTINCT ON (al.user_id, al.date)
    al.id,
    al.user_id,
    al.date,
    al.checkin_time,
    al.checkout_time,
    al.status,
    al.attendance_type,
    al.location,
    al.remarks,
    al.distance_from_office,
    al.warning,
    al.smartoffice_imported,
    p.name as employee_name,
    p.employee_number,
    p.email,
    o.id as office_id,
    o.name as office_name
FROM attendance_logs al
INNER JOIN profiles p ON al.user_id = p.id
LEFT JOIN offices o ON p.office_id = o.id
WHERE p.is_active = true  -- CRITICAL: Only show active employees
ORDER BY al.user_id, al.date, al.checkin_time DESC;  -- Take latest checkin if duplicates exist

-- Add unique constraint to prevent duplicate imports
-- This ensures user_id + date combination is unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_unique_user_date 
ON attendance_logs(user_id, date);

-- Add constraint to ensure imported records link to actual users
ALTER TABLE attendance_logs
DROP CONSTRAINT IF EXISTS fk_attendance_user_active;

ALTER TABLE attendance_logs
ADD CONSTRAINT fk_attendance_user_active
FOREIGN KEY (user_id) 
REFERENCES profiles(id)
ON DELETE CASCADE;

-- Function to cleanup duplicate attendance records
CREATE OR REPLACE FUNCTION cleanup_duplicate_attendance()
RETURNS void AS $$
BEGIN
    -- Delete duplicate records, keeping only the one with latest checkin_time
    DELETE FROM attendance_logs
    WHERE id IN (
        SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY user_id, date 
                       ORDER BY checkin_time DESC, created_at DESC
                   ) as rn
            FROM attendance_logs
        ) t
        WHERE t.rn > 1
    );
END;
$$ LANGUAGE plpgsql;

-- Run cleanup (remove existing duplicates)
SELECT cleanup_duplicate_attendance();

SELECT 'Attendance duplicates fixed successfully' AS status;
