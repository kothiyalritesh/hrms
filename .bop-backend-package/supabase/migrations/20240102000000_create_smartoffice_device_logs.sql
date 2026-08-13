-- Create table to store raw SmartOffice device logs
CREATE TABLE IF NOT EXISTS smartoffice_device_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL,
  log_date TIMESTAMPTZ NOT NULL,
  serial_number TEXT,
  punch_direction TEXT,
  temperature NUMERIC,
  temperature_state TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes for performance
  CONSTRAINT unique_device_log UNIQUE (employee_code, log_date, serial_number)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_smartoffice_logs_employee ON smartoffice_device_logs(employee_code);
CREATE INDEX IF NOT EXISTS idx_smartoffice_logs_date ON smartoffice_device_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_smartoffice_logs_synced ON smartoffice_device_logs(synced_at);

-- Add RLS policies
ALTER TABLE smartoffice_device_logs ENABLE ROW LEVEL SECURITY;

-- Allow admins to read all logs
CREATE POLICY "Admins can view all device logs" ON smartoffice_device_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('ADMIN', 'SUPER_ADMIN')
    )
  );

-- Allow system to insert logs
CREATE POLICY "System can insert device logs" ON smartoffice_device_logs
  FOR INSERT
  WITH CHECK (true);

SELECT 'smartoffice_device_logs table created successfully' AS status;
