-- ============================================================
-- Add missing columns to offices table
-- Run in Supabase SQL Editor
-- ============================================================

-- Add columns if they don't exist
ALTER TABLE offices ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE offices ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE offices ADD COLUMN IF NOT EXISTS attendance_radius INTEGER DEFAULT 50;
ALTER TABLE offices ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 0;

-- Verify columns exist
SELECT 
  column_name, 
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'offices' 
ORDER BY ordinal_position;

-- Show current office data
SELECT 
  id, 
  name, 
  latitude, 
  longitude, 
  attendance_radius, 
  capacity, 
  is_active
FROM offices 
ORDER BY name;

SELECT 'Offices columns check complete' AS status;
