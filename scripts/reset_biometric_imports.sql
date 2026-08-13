-- Run this to delete all SmartOffice-imported attendance records
-- Then re-import using the fixed import tool which correctly handles 12h/24h times
DELETE FROM attendance_logs
WHERE smartoffice_imported = true;

-- Verify
SELECT COUNT(*) AS remaining_biometric FROM attendance_logs WHERE smartoffice_imported = true;
