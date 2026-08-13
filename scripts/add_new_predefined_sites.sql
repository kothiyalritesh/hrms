-- ============================================================
-- Add new predefined sites (Lucknow + Chandigarh locations)
-- Appends to existing predefined_sites table
--
-- New locations:
--   1. Migsun Lucknow central   — 26.779116596655218, 80.9860402795777
--   2. Migsun Janpath           — 26.79125331427634,  80.9965283372489
--   3. Urban axis joy street    — 26.868035971293512, 81.00639753725186
--   4. Omaxe cassia             — 30.79183803187914,  76.72294738783522
--
-- Run in Supabase SQL Editor → New Query → Run
-- ============================================================

INSERT INTO predefined_sites (project_name, site_label, address, latitude, longitude, checkin_radius_m, site_type, is_active)
VALUES
  ('Migsun Lucknow central', 'Migsun Lucknow central',
   'Lucknow, Uttar Pradesh',
   26.779116596655218, 80.9860402795777, 100, 'site', true),

  ('Migsun Janpath', 'Migsun Janpath',
   'Janpath, Lucknow, Uttar Pradesh',
   26.79125331427634, 80.9965283372489, 100, 'site', true),

  ('Urban Axis Joy Street', 'Urban axis joy street',
   'Joy Street, Lucknow, Uttar Pradesh',
   26.868035971293512, 81.00639753725186, 100, 'site', true),

  ('Omaxe Cassia', 'Omaxe cassia',
   'Chandigarh, Punjab',
   30.79183803187914, 76.72294738783522, 100, 'site', true)
ON CONFLICT DO NOTHING;

-- Verify: show all active sites ordered by project_name
SELECT project_name, site_label, latitude, longitude, checkin_radius_m
FROM predefined_sites
WHERE is_active = true
ORDER BY project_name;