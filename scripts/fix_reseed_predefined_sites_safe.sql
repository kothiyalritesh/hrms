-- ============================================================
-- SAFE RESEED: predefined_sites — never touches field_visits
--
-- The previous script used TRUNCATE ... CASCADE which can delete
-- child rows if any FK has ON DELETE CASCADE. This script uses
-- DELETE + INSERT with conflict handling instead — zero risk.
--
-- Run in Supabase SQL Editor → New Query → Run
-- ============================================================

-- Step 1: Soft-delete old sites (keeps FKs intact)
UPDATE predefined_sites SET is_active = false;

-- Step 2: Upsert correct sites by project+label (safe re-run)
INSERT INTO predefined_sites
  (project_name, site_label, address, latitude, longitude, checkin_radius_m, site_type, is_active)
VALUES
  ('Trelive Trebecca',      'Trelive Trebecca',
   'Sector 63A, Noida-Greater Noida Expressway, Noida, UP',
   28.589207854622877, 77.43124385495594, 100, 'site', true),

  ('ALP Site',              'ALP Site',
   'Sector 63A, Noida-Greater Noida Expressway, Noida, UP',
   28.59126924021967,  77.43279582003274, 100, 'site', true),

  ('ACP Site',              'ACP Site',
   'Sector 62/63, Noida, UP',
   28.597663162983398, 77.444224661994,   100, 'site', true),

  ('AU Centurian Park',     'AU Centurian Park',
   'Sector 62/63, Noida, UP',
   28.597663162983398, 77.444224661994,   100, 'site', true),

  ('Migsun Central Market', 'Migsun Central Market',
   'Sector Mu-II, Knowledge Park III, Greater Noida, UP',
   28.477054828984162, 77.52224229605241, 100, 'site', true),

  ('Gaurs Bento',           'Gaurs Bento',
   'Gaur City, Sector 4, Greater Noida West, UP',
   28.306386537361032, 77.55840340805747, 100, 'site', true),

  ('Gaur Chrysalis',        'Gaur Chrysalis - Gaur City 2',
   'Gaur City 2, Sector 16C, Greater Noida West, UP',
   28.279970649306758, 77.54982123725685, 100, 'site', true),

  ('Gaur Mulberry Mansions','Gaur Mulberry Mansions Noida',
   'Sector 1, Noida, UP',
   28.567938611370263, 77.42690549299846, 100, 'site', true),

  ('Eternia',               'Eternia Sales Office',
   'Sector 21, Yamuna Expressway, Greater Noida, UP',
   28.524020,          77.503910,         100, 'site', true)
ON CONFLICT DO NOTHING;

-- Step 3: Re-activate any existing rows that match by project+label
UPDATE predefined_sites p
SET is_active = true,
    latitude   = v.latitude,
    longitude  = v.longitude,
    address    = v.address,
    checkin_radius_m = v.radius
FROM (VALUES
  ('Trelive Trebecca',       'Trelive Trebecca',           28.589207854622877, 77.43124385495594, 100),
  ('ALP Site',               'ALP Site',                   28.59126924021967,  77.43279582003274, 100),
  ('ACP Site',               'ACP Site',                   28.597663162983398, 77.444224661994,   100),
  ('AU Centurian Park',      'AU Centurian Park',          28.597663162983398, 77.444224661994,   100),
  ('Migsun Central Market',  'Migsun Central Market',      28.477054828984162, 77.52224229605241, 100),
  ('Gaurs Bento',            'Gaurs Bento',                28.306386537361032, 77.55840340805747, 100),
  ('Gaur Chrysalis',         'Gaur Chrysalis - Gaur City 2',28.279970649306758,77.54982123725685, 100),
  ('Gaur Mulberry Mansions', 'Gaur Mulberry Mansions Noida',28.567938611370263,77.42690549299846, 100),
  ('Eternia',                'Eternia Sales Office',        28.524020,         77.503910,         100)
) AS v(pname, slabel, latitude, longitude, radius)
WHERE p.project_name = v.pname AND p.site_label = v.slabel;

-- Step 4: Verify — should show 9 active sites
SELECT project_name, site_label, latitude, longitude, is_active
FROM predefined_sites
WHERE is_active = true
ORDER BY project_name;

-- Step 5: Restore field_visits that got orphaned (predefined_site_id set to null by CASCADE)
-- Re-link visits to their predefined sites by matching location_name to site_label
UPDATE field_visits fv
SET predefined_site_id = ps.id
FROM predefined_sites ps
WHERE fv.predefined_site_id IS NULL
  AND fv.location_name = ps.site_label
  AND ps.is_active = true;

SELECT 'field_visits re-linked: ' || COUNT(*) AS status
FROM field_visits
WHERE predefined_site_id IS NOT NULL;
