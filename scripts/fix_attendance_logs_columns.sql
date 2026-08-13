-- ============================================================
-- Fix: Add missing columns to attendance_logs table
-- Run in Supabase SQL Editor
-- ============================================================

-- Add updated_at column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'attendance_logs' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE attendance_logs ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Add any other missing columns for attendance warnings functionality
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS warning BOOLEAN DEFAULT FALSE;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS warning_reason TEXT;

-- Verify columns exist
SELECT 
  column_name, 
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'attendance_logs' 
ORDER BY ordinal_position;

SELECT 'attendance_logs columns check complete' AS status;
