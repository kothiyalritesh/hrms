-- ============================================================
-- Add GPS coordinates for Lucknow Office
-- Run in Supabase SQL Editor → New Query → Run
-- ============================================================

-- Step 1: Set coordinates and make sure it is active
UPDATE offices
SET
  latitude          = 26.865333350879812,
  longitude         = 80.9983684941455,
  attendance_radius = 300,
  is_active         = true
WHERE name = 'Lucknow Office';

-- Step 2: If the row didn't exist yet, insert it
INSERT INTO offices (name, latitude, longitude, attendance_radius, is_active)
SELECT
  'Lucknow Office',
  26.865333350879812,
  80.9983684941455,
  300,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM offices WHERE name = 'Lucknow Office'
);

-- Step 3: Verify all offices
SELECT id, name, latitude, longitude, attendance_radius, is_active
FROM offices
ORDER BY name;
