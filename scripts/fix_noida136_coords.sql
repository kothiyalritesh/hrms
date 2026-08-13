-- ============================================================
-- Fix office coordinates — run in Supabase SQL Editor
-- ============================================================

-- First, see what coordinates are currently stored
SELECT id, name, latitude, longitude, attendance_radius, is_active
FROM offices
ORDER BY name;

-- Fix Noida 136 — correct coordinates for BOP Sector 136, Noida
-- latitude must be ~28.5 (north), longitude must be ~77.4 (east)
UPDATE offices
SET
  latitude          = 28.5027,
  longitude         = 77.4059,
  attendance_radius = 300,
  is_active         = true
WHERE name = 'Noida 136';

-- Verify final state
SELECT id, name, latitude, longitude, attendance_radius, is_active
FROM offices
ORDER BY name;
