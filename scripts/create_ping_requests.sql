-- location_ping_requests: admin sends a ping request, employee device responds
CREATE TABLE IF NOT EXISTS location_ping_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requested_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'fulfilled', 'failed')),
  latitude         DOUBLE PRECISION,
  longitude        DOUBLE PRECISION,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  responded_at     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lpr_target ON location_ping_requests(target_user_id, status);
ALTER TABLE location_ping_requests DISABLE ROW LEVEL SECURITY;
