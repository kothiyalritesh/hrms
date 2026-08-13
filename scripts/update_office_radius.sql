-- ============================================================
-- Check current office coordinates and update radius
-- Run this in Supabase SQL Editor
-- ============================================================

-- First verify what's stored
SELECT id, name, latitude, longitude, attendance_radius FROM offices ORDER BY name;

-- Update radius to 500m for all offices (GPS accuracy on phones indoors is 10-50m,
-- plus building size, parking etc — 500m is a reasonable geo-fence)
UPDATE offices SET attendance_radius = 300 WHERE is_active = true;

-- Verify after update
SELECT id, name, latitude, longitude, attendance_radius FROM offices ORDER BY name;
