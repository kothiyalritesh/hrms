-- ============================================================
-- Run this in Supabase SQL Editor to fix field_visits
-- ============================================================

-- 1. Drop and recreate with correct constraints
DROP TABLE IF EXISTS field_visits CASCADE;

CREATE TABLE field_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity_log_id UUID REFERENCES activity_logs(id) ON DELETE SET NULL,
  predefined_site_id UUID REFERENCES predefined_sites(id) ON DELETE SET NULL,

  visit_type VARCHAR(20) NOT NULL CHECK (visit_type IN ('site', 'meeting', 'office', 'others')),
  location_name VARCHAR(255) NOT NULL,
  location_address TEXT,
  destination_coords JSONB,              -- {latitude, longitude} of the target site
  checkin_radius_m INTEGER DEFAULT 100,  -- geo-fence radius: 100m for sites, 500m for offices
  meeting_type VARCHAR(30) CHECK (meeting_type IN ('client', 'channel_partner')),
  contact_name VARCHAR(255),
  contact_phone VARCHAR(50),
  company_name VARCHAR(255),
  project_name VARCHAR(255),
  notes TEXT,

  checkin_time TIMESTAMP,
  checkin_location JSONB,
  checkout_time TIMESTAMP,
  checkout_location JSONB,
  checkout_notes TEXT,

  -- Origin tracking for In Transit status
  origin_lat NUMERIC,
  origin_lon NUMERIC,
  origin_name TEXT,

  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CHECKED_IN', 'COMPLETED', 'MISSED', 'IN_TRANSIT')),

  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_visits_user_id ON field_visits(user_id);
CREATE INDEX IF NOT EXISTS idx_field_visits_date ON field_visits(date);
CREATE INDEX IF NOT EXISTS idx_field_visits_status ON field_visits(status);

-- 2. Disable RLS (app uses custom auth)
ALTER TABLE field_visits DISABLE ROW LEVEL SECURITY;

SELECT 'field_visits ready' AS status;
