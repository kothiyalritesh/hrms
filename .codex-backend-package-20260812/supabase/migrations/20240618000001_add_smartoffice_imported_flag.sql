-- Add SmartOffice imported flag to attendance_logs
ALTER TABLE attendance_logs 
ADD COLUMN IF NOT EXISTS smartoffice_imported BOOLEAN DEFAULT FALSE;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_attendance_smartoffice_imported 
ON attendance_logs(smartoffice_imported);

SELECT 'SmartOffice imported column added to attendance_logs' AS status;
