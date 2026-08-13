-- ============================================================
-- Replace duplicate Gaur Chrysalis — Gaur City 1 entry with
-- Gaur Mulberry Mansions Noida
--
-- Context:
--   Both "Gaur Chrysalis — Gaur City 1" and "Gaurs Bento" share
--   the SAME coordinates (28.306386, 77.558403) — one is redundant.
--   We replace "Gaur Chrysalis — Gaur City 1" (the duplicate pin)
--   with Gaur Mulberry Mansions Noida.
--
-- Run in Supabase SQL Editor
-- ============================================================

-- Step 1: Replace the duplicate Gaur Chrysalis — Gaur City 1 row
UPDATE predefined_sites
SET
  project_name      = 'Gaur Mulberry Mansions',
  site_label        = 'Gaur Mulberry Mansions Noida',
  address           = 'Sector 1, Noida, UP',
  latitude          = 28.567938611370263,
  longitude         = 77.42690549299846,
  checkin_radius_m  = 100,
  site_type         = 'site',
  is_active         = true
WHERE
  project_name = 'Gaur Chrysalis'
  AND site_label = 'Gaur Chrysalis — Gaur City 1';

-- Step 2: Verify — confirm no duplicate coordinates remain
SELECT project_name, site_label, address, latitude, longitude, checkin_radius_m, is_active
FROM predefined_sites
ORDER BY project_name;

-- Step 3: Check for any remaining shared pins
SELECT
  latitude, longitude,
  COUNT(*) AS shared_by,
  STRING_AGG(site_label, ' + ') AS sites
FROM predefined_sites
WHERE is_active = true
GROUP BY latitude, longitude
HAVING COUNT(*) > 1;
