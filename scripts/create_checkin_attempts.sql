-- Run this in Supabase SQL Editor
-- Logs every check-in attempt (success or failed/blocked)

CREATE TABLE IF NOT EXISTS checkin_attempts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  attempted_at timestamptz DEFAULT now(),
  latitude double precision,
  longitude double precision,
  nearest_office_name text,
  nearest_office_distance_m int,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'blocked')),
  failure_reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE checkin_attempts DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS checkin_attempts_user_idx ON checkin_attempts(user_id);
CREATE INDEX IF NOT EXISTS checkin_attempts_attempted_at_idx ON checkin_attempts(attempted_at DESC);
