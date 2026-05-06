-- ============================================================
-- ATTENDANCE DATA RECOVERY - COMPLETE WORKING SCRIPT
-- Copy and paste this ENTIRE script into Supabase SQL Editor
-- ============================================================

-- ============================================================
-- STEP 1: CHECK IF BACKUP DATA EXISTS
-- ============================================================

SELECT 'CHECKING FOR DELETED RECORDS...' as step;

SELECT COUNT(*) as deleted_records_count
FROM attendance_logs_backup;

-- ============================================================
-- STEP 2: VIEW DELETED RECORDS (Optional - to see what will be restored)
-- ============================================================

SELECT 'DELETED RECORDS AVAILABLE:' as info;

SELECT 
  alb.original_id,
  p.name as employee_name,
  alb.date,
  alb.checkin_time,
  alb.checkout_time,
  alb.status,
  alb.deleted_at,
  alb.deletion_reason
FROM attendance_logs_backup alb
LEFT JOIN profiles p ON alb.user_id = p.id
WHERE alb.backup_restored_at IS NULL
ORDER BY alb.deleted_at DESC
LIMIT 100;

-- ============================================================
-- STEP 3: RESTORE ALL DELETED RECORDS
-- ============================================================

SELECT 'RESTORING DELETED RECORDS...' as step;

INSERT INTO attendance_logs (
  id,
  user_id,
  date,
  checkin_time,
  checkout_time,
  checkin_location,
  checkout_location,
  attendance_type,
  office_id,
  distance_from_office,
  warning,
  status,
  created_at
)
SELECT 
  alb.original_id,
  alb.user_id,
  alb.date,
  alb.checkin_time,
  alb.checkout_time,
  alb.checkin_location,
  alb.checkout_location,
  alb.attendance_type,
  alb.office_id,
  alb.distance_from_office,
  alb.warning,
  alb.status,
  now()
FROM attendance_logs_backup alb
WHERE alb.backup_restored_at IS NULL
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 4: MARK BACKUPS AS RESTORED
-- ============================================================

UPDATE attendance_logs_backup
SET backup_restored_at = now()
WHERE backup_restored_at IS NULL;

-- ============================================================
-- STEP 5: VERIFY RESTORATION
-- ============================================================

SELECT 'RESTORATION COMPLETE - VERIFICATION:' as step;

SELECT 
  COUNT(*) as total_restored_records,
  MIN(date) as earliest_date,
  MAX(date) as latest_date,
  COUNT(DISTINCT user_id) as unique_employees
FROM attendance_logs
WHERE created_at >= now() - INTERVAL '1 hour';

-- ============================================================
-- STEP 6: FINAL CHECK - COMPARE BEFORE AND AFTER
-- ============================================================

SELECT 'FINAL STATUS:' as step;

SELECT 
  (SELECT COUNT(*) FROM attendance_logs) as current_total_records,
  (SELECT COUNT(*) FROM attendance_logs_backup WHERE backup_restored_at IS NOT NULL) as restored_from_backup,
  (SELECT COUNT(*) FROM attendance_logs_backup WHERE backup_restored_at IS NULL) as still_deleted;

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================

SELECT '✅ ATTENDANCE DATA RECOVERY COMPLETE!' as final_status;
