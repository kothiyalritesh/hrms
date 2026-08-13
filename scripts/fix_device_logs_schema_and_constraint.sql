-- Step 1: Add missing columns that the sync service tries to insert
ALTER TABLE smartoffice_device_logs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS log_datetime TEXT,   -- "YYYY-MM-DD HH:MM:SS" IST string
  ADD COLUMN IF NOT EXISTS log_time TEXT,        -- "HH:MM:SS" 24h IST
  ADD COLUMN IF NOT EXISTS log_date_only DATE;   -- actual date part (log_date col is TIMESTAMPTZ)

-- Step 2: Drop the old broken constraint (serial_number NULL breaks dedup)
ALTER TABLE smartoffice_device_logs
  DROP CONSTRAINT IF EXISTS unique_device_log;

ALTER TABLE smartoffice_device_logs
  DROP CONSTRAINT IF EXISTS uq_device_log;

-- Step 3: Add correct constraint on (employee_code, log_datetime)
ALTER TABLE smartoffice_device_logs
  ADD CONSTRAINT uq_device_log UNIQUE (employee_code, log_datetime);

-- Step 4: Add indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_sdl_user_date ON smartoffice_device_logs(user_id, log_date_only);
CREATE INDEX IF NOT EXISTS idx_sdl_log_date_only ON smartoffice_device_logs(log_date_only);

-- Step 5: Fix RLS to allow HR/HRD roles to read
DROP POLICY IF EXISTS "Admins can view all device logs" ON smartoffice_device_logs;
CREATE POLICY "admins_read_device_logs" ON smartoffice_device_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid()
    AND role IN ('ADMIN', 'SUPER_ADMIN', 'HR', 'HRD')
  ));

CREATE POLICY IF NOT EXISTS "system_update_device_logs" ON smartoffice_device_logs
  FOR UPDATE USING (true);
