-- ============================================================
-- Add missing columns to attendance_logs table
-- Migration: 20240101000000_add_attendance_logs_columns
-- ============================================================

ALTER TABLE attendance_logs 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE attendance_logs 
ADD COLUMN IF NOT EXISTS warning BOOLEAN DEFAULT FALSE;

ALTER TABLE attendance_logs 
ADD COLUMN IF NOT EXISTS warning_reason TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_attendance_logs_user_date 
ON attendance_logs(user_id, date);

SELECT 'attendance_logs columns added successfully' AS status;
