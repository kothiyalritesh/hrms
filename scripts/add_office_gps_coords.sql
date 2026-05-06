-- ============================================================
-- Add GPS coordinates to offices table (geo-fence support)
-- Run this in Supabase SQL Editor
-- ============================================================

-- Ensure columns exist (safe to run multiple times)
ALTER TABLE offices
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- ============================================================
-- Set GPS coordinates for existing offices
-- Replace the lat/lon values below with the real coordinates
-- Tip: use maps.google.com -> right-click -> "What's here?"
-- ============================================================

-- BOP Sector 63, Noida  (28°37'23.1"N  77°22'48.1"E)
UPDATE offices
SET latitude = 28.6231, longitude = 77.3800
WHERE name = 'Sector 63';

-- BOP Greater Noida 136  (28°30'09.6"N  77°24'21.1"E)
UPDATE offices
SET latitude = 28.5027, longitude = 77.4059
WHERE name = 'Greater Noida 136';

-- BOP Gurugram  (28°25'11.9"N  77°02'17.6"E)
UPDATE offices
SET latitude = 28.4200, longitude = 77.0382
WHERE name = 'Gurugram';

-- BOP Alpha 1  (28°28'15.1"N  77°30'41.0"E)
UPDATE offices
SET latitude = 28.4709, longitude = 77.5114
WHERE name = 'Greater Noida Alpha 2';

-- Verify
SELECT id, name, latitude, longitude, attendance_radius
FROM offices
ORDER BY name;
