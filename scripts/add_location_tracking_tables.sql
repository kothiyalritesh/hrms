-- ============================================================
-- Location Tracking Tables (run in Supabase SQL Editor)
-- Required for Live GPS / Location Compliance to work
-- ============================================================

CREATE TABLE IF NOT EXISTS user_location_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  accuracy     DOUBLE PRECISION DEFAULT 0,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'IN_ZONE'
                 CHECK (status IN ('IN_ZONE', 'OUT_OF_BOUND', 'WARNING')),
  distance_m   INTEGER DEFAULT 0,
  office_id    UUID REFERENCES offices(id) ON DELETE SET NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  address      TEXT
);

CREATE INDEX IF NOT EXISTS idx_location_logs_user_date
  ON user_location_logs(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_location_logs_session_date
  ON user_location_logs(session_date);
CREATE INDEX IF NOT EXISTS idx_location_logs_timestamp
  ON user_location_logs(timestamp DESC);

CREATE TABLE IF NOT EXISTS location_violations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  office_id    UUID REFERENCES offices(id) ON DELETE SET NULL,
  distance_m   INTEGER DEFAULT 0,
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  violated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  resolution   TEXT,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  escalated    BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_violations_user_date
  ON location_violations(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_violations_unresolved
  ON location_violations(user_id, resolved_at)
  WHERE resolved_at IS NULL;

ALTER TABLE user_location_logs  DISABLE ROW LEVEL SECURITY;
ALTER TABLE location_violations DISABLE ROW LEVEL SECURITY;

SELECT '✅ Location tracking tables ready' AS status;
