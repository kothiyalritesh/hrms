-- ============================================================
-- Predefined Site Visits — Real Estate Projects
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS predefined_sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_name VARCHAR(255) NOT NULL,
  site_label VARCHAR(255) NOT NULL,          -- display name shown in dropdown
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  checkin_radius_m INTEGER NOT NULL DEFAULT 100,  -- geo-fence radius in metres
  site_type VARCHAR(30) DEFAULT 'site'
    CHECK (site_type IN ('site', 'office', 'meeting')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predefined_sites_project ON predefined_sites(project_name);
CREATE INDEX IF NOT EXISTS idx_predefined_sites_active  ON predefined_sites(is_active);

ALTER TABLE predefined_sites DISABLE ROW LEVEL SECURITY;

-- ── Seed: your actual project sites ──────────────────────────────────────────

INSERT INTO predefined_sites (project_name, site_label, address, latitude, longitude, checkin_radius_m, site_type) VALUES
  (
    'Trelive Trebecca',
    'Trelive Trebecca',
    'Sector 63A, Noida Expressway, Noida, UP',
    28.589207854622877, 77.43124385495594,
    100, 'site'
  ),
  (
    'Migsun Central Market',
    'Migsun Central Market',
    'Sector Mu-II, Greater Noida, UP',
    28.402459910982785, 77.51920250502897,
    100, 'site'
  ),
  (
    'ACP Site',
    'ACP Site',
    'Sector 63, Noida, UP',
    28.597663162983398, 77.444224661994,
    100, 'site'
  ),
  (
    'ALP Site',
    'ALP Site',
    'Sector 63A, Noida, UP',
    28.59126924021967, 77.43279582003274,
    100, 'site'
  ),
  (
    'AU Centurian Park',
    'AU Centurian Park',
    'Sector 63, Noida, UP',
    28.597663162983398, 77.444224661994,
    100, 'site'
  ),
  (
    'Gaurs Bento',
    'Gaurs Bento',
    'Gaur City, Sector 4, Greater Noida West, UP',
    28.306386537361032, 77.55840340805747,
    100, 'site'
  ),
  (
    'Gaur Chrysalis',
    'Gaur Chrysalis — Gaur City 2',
    'Gaur City 2, Sector 16C, Greater Noida West, UP',
    28.279970649306758, 77.54982123725685,
    100, 'site'
  ),
  (
    'Gaur Chrysalis',
    'Gaur Chrysalis — Gaur City 1',
    'Gaur City, Sector 4, Greater Noida West, UP',
    28.306386537361032, 77.55840340805747,
    100, 'site'
  );

SELECT project_name, site_label, latitude, longitude, checkin_radius_m FROM predefined_sites ORDER BY project_name;
