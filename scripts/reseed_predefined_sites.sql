-- ============================================================
-- RE-SEED: Correct site list including Gaur Mulberry Mansions
-- Run this in Supabase SQL Editor
-- ============================================================

TRUNCATE TABLE predefined_sites RESTART IDENTITY CASCADE;

INSERT INTO predefined_sites (project_name, site_label, address, latitude, longitude, checkin_radius_m, site_type)
VALUES
  (
    'Trelive Trebecca',
    'Trelive Trebecca',
    'Sector 63A, Noida–Greater Noida Expressway, Noida, UP',
    28.589207854622877, 77.43124385495594,
    100, 'site'
  ),
  (
    'ALP Site',
    'ALP Site',
    'Sector 63A, Noida–Greater Noida Expressway, Noida, UP',
    28.59126924021967, 77.43279582003274,
    100, 'site'
  ),
  (
    'ACP Site',
    'ACP Site',
    'Sector 62/63, Noida, UP',
    28.597663162983398, 77.444224661994,
    100, 'site'
  ),
  (
    'AU Centurian Park',
    'AU Centurian Park',
    'Sector 62/63, Noida, UP  ⚠️ verify coords — same pin as ACP',
    28.597663162983398, 77.444224661994,
    100, 'site'
  ),
  (
    'Migsun Central Market',
    'Migsun Central Market',
    'Sector Mu-II, Knowledge Park III, Greater Noida, UP',
    28.477054828984162, 77.52224229605241,
    100, 'site'
  ),
  (
    'Gaurs Bento',
    'Gaurs Bento',
    'Gaur City, Sector 4, Greater Noida West (Noida Extension), UP',
    28.306386537361032, 77.55840340805747,
    100, 'site'
  ),
  (
    'Gaur Chrysalis',
    'Gaur Chrysalis — Gaur City 2',
    'Gaur City 2, Sector 16C, Greater Noida West (Noida Extension), UP',
    28.279970649306758, 77.54982123725685,
    100, 'site'
  ),
  (
    'Gaur Mulberry Mansions',
    'Gaur Mulberry Mansions Noida',
    'Sector 1, Noida, UP',
    28.567938611370263, 77.42690549299846,
    100, 'site'
  );

-- Verify
SELECT project_name, site_label, address, latitude, longitude FROM predefined_sites ORDER BY project_name;

-- Check for duplicate coordinates
SELECT latitude, longitude, COUNT(*) as shared_by, STRING_AGG(project_name, ' + ') as projects
FROM predefined_sites
GROUP BY latitude, longitude
HAVING COUNT(*) > 1;
