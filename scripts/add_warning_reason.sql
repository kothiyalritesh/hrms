-- ============================================================
-- Add warning_reason column to attendance_logs
-- Run in Supabase SQL Editor
-- ============================================================

-- Add warning_reason column if not exists
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS warning_reason TEXT;

-- Update existing records with basic warning reasons
UPDATE attendance_logs
SET warning_reason = CASE 
    WHEN distance_from_office > 50 AND distance_from_office <= 100 THEN 'Check-in GPS >50m from office'
    WHEN distance_from_office > 100 THEN 'Check-in GPS >100m from office'
    ELSE NULL
END
WHERE warning = true AND warning_reason IS NULL;

-- Verify
SELECT COUNT(*) AS total_attendance_records FROM attendance_logs;
SELECT COUNT(*) AS with_warnings FROM attendance_logs WHERE warning = true;
SELECT COUNT(*) AS with_warning_reason FROM attendance_logs WHERE warning_reason IS NOT NULL;

SELECT 'warning_reason column added successfully' AS status;
