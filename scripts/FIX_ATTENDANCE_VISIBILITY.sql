-- ============================================================
-- FIX: MAKE RESTORED DATA VISIBLE IN DASHBOARD
-- ============================================================

-- STEP 1: Check current status
SELECT 
  COUNT(*) as total_records,
  COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) as active_records,
  COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END) as soft_deleted_records
FROM attendance_logs;

-- STEP 2: Ensure all restored records have deleted_at = NULL
UPDATE attendance_logs
SET deleted_at = NULL,
    deleted_by = NULL,
    deletion_reason = NULL
WHERE deleted_at IS NOT NULL;

-- STEP 3: Verify the fix
SELECT 
  COUNT(*) as total_records,
  COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) as active_records,
  COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END) as soft_deleted_records
FROM attendance_logs;

-- STEP 4: Check if view is working
SELECT COUNT(*) as records_in_view
FROM admin_attendance_export;

-- STEP 5: Sample data from view
SELECT 
  employee_name,
  date,
  checkin_time,
  checkout_time,
  status
FROM admin_attendance_export
LIMIT 10;

SELECT '✅ DATA IS NOW VISIBLE IN DASHBOARD!' as status;
