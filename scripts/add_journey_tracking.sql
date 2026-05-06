-- ============================================================
-- Journey Tracking: From → To with arrival confirmation
-- Run in Supabase SQL Editor
-- ============================================================

-- Add from-location tracking columns
ALTER TABLE field_visits
  ADD COLUMN IF NOT EXISTS from_location_name  TEXT,
  ADD COLUMN IF NOT EXISTS from_coords         JSONB,   -- {latitude, longitude}
  ADD COLUMN IF NOT EXISTS destination_coords  JSONB,   -- {latitude, longitude} (if already missing)
  ADD COLUMN IF NOT EXISTS location_address    TEXT,    -- destination address (if already missing)
  ADD COLUMN IF NOT EXISTS arrived             BOOLEAN  GENERATED ALWAYS AS (status IN ('CHECKED_IN', 'COMPLETED')) STORED;

-- Index for journey queries
CREATE INDEX IF NOT EXISTS idx_field_visits_user_date
  ON field_visits(user_id, date DESC);

SELECT '✅ Journey tracking columns added' AS status;
