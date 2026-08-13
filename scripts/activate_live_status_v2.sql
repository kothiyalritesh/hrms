-- ============================================================
-- Update LiveTrackingScreenNew to use v2 view
-- Run in Supabase SQL Editor
-- ============================================================

-- First, drop the old view if we want to replace it
DROP VIEW IF EXISTS employee_live_status;

-- Rename v2 to be the main view
ALTER VIEW employee_live_status_v2 RENAME TO employee_live_status;

-- Verify
SELECT COUNT(*) as total_employees FROM employee_live_status;
SELECT COUNT(*) as with_location_data FROM employee_live_status WHERE has_location_data = true;
SELECT COUNT(*) as with_gps_ping FROM employee_live_status WHERE has_gps_ping = true;
SELECT COUNT(*) as gps_off FROM employee_live_status WHERE gps_available = false;

SELECT 'employee_live_status view updated' AS status;
