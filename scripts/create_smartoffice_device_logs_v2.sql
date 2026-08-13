-- Table for individual biometric gate punches (every swipe = one row)
-- These are NOT check-ins/check-outs — they are raw device logs
CREATE TABLE IF NOT EXISTS smartoffice_device_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  employee_code TEXT NOT NULL,
  log_datetime  TEXT NOT NULL,          -- stored as IST string "YYYY-MM-DD HH:MM:SS"
  log_date      DATE NOT NULL,
  log_time      TEXT NOT NULL,          -- "HH:MM:SS" 24h IST
  punch_direction TEXT,                 -- "In" / "Out" / null
  serial_number TEXT,
  temperature   NUMERIC,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_device_log UNIQUE (employee_code, log_datetime, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_sdl_user_date ON smartoffice_device_logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_sdl_date      ON smartoffice_device_logs(log_date);

ALTER TABLE smartoffice_device_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins_read_device_logs" ON smartoffice_device_logs;
CREATE POLICY "admins_read_device_logs" ON smartoffice_device_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('ADMIN','SUPER_ADMIN','HR','HRD')));
CREATE POLICY "system_insert_device_logs" ON smartoffice_device_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "system_update_device_logs" ON smartoffice_device_logs FOR UPDATE USING (true);

-- Fix attendance_logs: store biometric checkin/checkout as IST text so no UTC shift
-- checkin_time is TIMESTAMPTZ — we store IST offset explicitly: append +05:30
-- This way Postgres stores correctly without shifting
