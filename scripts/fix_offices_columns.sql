-- ============================================================
-- Fix offices table - ensure latitude/longitude columns exist
-- Run in Supabase SQL Editor
-- ============================================================

-- Add columns if they don't exist
ALTER TABLE offices ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE offices ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE offices ADD COLUMN IF NOT EXISTS attendance_radius INTEGER DEFAULT 50;

-- Check current state
SELECT id, name, latitude, longitude, attendance_radius, is_active FROM offices ORDER BY name;

SELECT 'Offices columns check complete' AS status;
