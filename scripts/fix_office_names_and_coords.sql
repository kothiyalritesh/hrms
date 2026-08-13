-- ============================================================
-- Fix office names and GPS coordinates
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Rename Alpha 2 → Alpha 1
UPDATE offices
SET name = 'Greater Noida Alpha 1'
WHERE name = 'Greater Noida Alpha 2';

-- 2. Fix GPS coords for Noida 136 (was stored as 'Greater Noida 136' in old script)
--    Run both to cover whichever name exists in the DB
UPDATE offices
SET latitude = 28.5027, longitude = 77.4059
WHERE name IN ('Noida 136', 'Greater Noida 136');

-- 3. Set GPS coords for Alpha 1 (BOP Alpha 1: 28°28'15.1"N  77°30'41.0"E)
UPDATE offices
SET latitude = 28.4709, longitude = 77.5114
WHERE name = 'Greater Noida Alpha 1';

-- 4. Verify
SELECT id, name, latitude, longitude, attendance_radius, is_active
FROM offices
ORDER BY name;
