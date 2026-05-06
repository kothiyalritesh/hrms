-- ============================================================
-- Real-Time Location Compliance Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. User location heartbeat logs
CREATE TABLE IF NOT EXISTS user_location_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  accuracy    DOUBLE PRECISION DEFAULT 0,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT DEFAULT 'IN_ZONE'
                CHECK (status IN ('IN_ZONE','OUT_OF_BOUND','WARNING')),
  distance_m  INTEGER DEFAULT 0,
  office_id   UUID REFERENCES offices(id) ON DELETE SET NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  address     TEXT
);

CREATE INDEX IF NOT EXISTS idx_loc_logs_user_date ON user_location_logs(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_loc_logs_timestamp  ON user_location_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_loc_logs_status     ON user_location_logs(status);

-- 2. Location violations (one row per violation event)
CREATE TABLE IF NOT EXISTS location_violations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  office_id       UUID REFERENCES offices(id) ON DELETE SET NULL,
  distance_m      INTEGER NOT NULL,
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  violated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT CHECK (resolution IN ('returned','checked_out','auto_escalated','acknowledged')),
  session_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  escalated       BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_violations_user_date ON location_violations(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_violations_open
  ON location_violations(user_id, session_date)
  WHERE resolved_at IS NULL;

-- 3. Disable RLS (custom auth)
ALTER TABLE user_location_logs  DISABLE ROW LEVEL SECURITY;
ALTER TABLE location_violations DISABLE ROW LEVEL SECURITY;

-- Migration: add address column if upgrading from earlier schema
ALTER TABLE user_location_logs ADD COLUMN IF NOT EXISTS address TEXT;

-- View: latest ping per user per day (efficient admin dashboard query)
CREATE OR REPLACE VIEW user_latest_location AS
SELECT DISTINCT ON (user_id, session_date)
  id, user_id, latitude, longitude, accuracy,
  timestamp, status, distance_m, office_id, session_date, address
FROM user_location_logs
ORDER BY user_id, session_date, timestamp DESC;

SELECT '✅ Location compliance schema ready' AS status;
