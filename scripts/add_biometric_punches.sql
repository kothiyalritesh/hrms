-- Add column to store all biometric punch entries for a day
-- Each entry: { in: "HH:MM", out: "HH:MM" | null }
ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS biometric_punches jsonb DEFAULT NULL;
