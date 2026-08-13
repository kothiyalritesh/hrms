CREATE TABLE IF NOT EXISTS otp_login_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_login_phone_created
  ON otp_login_challenges(phone, created_at DESC);

ALTER TABLE otp_login_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE otp_login_challenges FROM anon, authenticated;

