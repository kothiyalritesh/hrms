-- ============================================================
-- RealtyHRM — Location Compliance & Geo-Fencing
-- Safe to run on EXISTING database (fully idempotent)
-- Copy & paste this entire file into Supabase SQL Editor
-- ============================================================


-- ============================================================
-- STEP 1: Create user_location_logs table
-- ============================================================

CREATE TABLE IF NOT EXISTS user_location_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  accuracy     DOUBLE PRECISION DEFAULT 0,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT DEFAULT 'IN_ZONE'
                 CHECK (status IN ('IN_ZONE', 'OUT_OF_BOUND', 'WARNING')),
  distance_m   INTEGER DEFAULT 0,
  office_id    UUID REFERENCES offices(id) ON DELETE SET NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  address      TEXT
);

-- Add address column if table already existed without it
ALTER TABLE user_location_logs ADD COLUMN IF NOT EXISTS address TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_loc_logs_user_date  ON user_location_logs(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_loc_logs_timestamp  ON user_location_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_loc_logs_status     ON user_location_logs(status);


-- ============================================================
-- STEP 2: Create location_violations table
-- ============================================================

CREATE TABLE IF NOT EXISTS location_violations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  office_id    UUID REFERENCES offices(id) ON DELETE SET NULL,
  distance_m   INTEGER NOT NULL,
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  violated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  resolution   TEXT CHECK (resolution IN ('returned', 'checked_out', 'auto_escalated', 'acknowledged')),
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  escalated    BOOLEAN DEFAULT false
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_violations_user_date ON location_violations(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_violations_open
  ON location_violations(user_id, session_date)
  WHERE resolved_at IS NULL;


-- ============================================================
-- STEP 3: Disable RLS (app uses custom auth, not Supabase Auth)
-- ============================================================

ALTER TABLE user_location_logs  DISABLE ROW LEVEL SECURITY;
ALTER TABLE location_violations DISABLE ROW LEVEL SECURITY;


-- ============================================================
-- STEP 4: View — latest ping per user per day
-- Used by admin live map dashboard for efficient queries
-- ============================================================

CREATE OR REPLACE VIEW user_latest_location AS
SELECT DISTINCT ON (user_id, session_date)
  id,
  user_id,
  latitude,
  longitude,
  accuracy,
  timestamp,
  status,
  distance_m,
  office_id,
  session_date,
  address
FROM user_location_logs
ORDER BY user_id, session_date, timestamp DESC;


-- ============================================================
-- STEP 5: Verification — confirm everything was created
-- ============================================================

SELECT
  'user_location_logs'  AS object_name, 'table' AS type, COUNT(*) AS rows
  FROM user_location_logs
UNION ALL
SELECT
  'location_violations' AS object_name, 'table' AS type, COUNT(*) AS rows
  FROM location_violations
UNION ALL
SELECT
  'user_latest_location' AS object_name, 'view' AS type, COUNT(*) AS rows
  FROM user_latest_location;

SELECT '✅ Location compliance schema ready' AS status;
