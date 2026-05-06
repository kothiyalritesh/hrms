-- ============================================================
-- SIMPLE FIX: VIEW YOUR ATTENDANCE DATA DIRECTLY
-- ============================================================

-- STEP 1: Check your data exists
SELECT COUNT(*) as total_records FROM attendance_logs;

-- STEP 2: View your attendance records directly
SELECT 
  id,
  user_id,
  date,
  status
FROM attendance_logs
ORDER BY date DESC
LIMIT 20;

-- STEP 3: Clear any soft delete flags
UPDATE attendance_logs
SET deleted_at = NULL,
    deleted_by = NULL,
    deletion_reason = NULL
WHERE deleted_at IS NOT NULL;

-- STEP 4: Verify update
SELECT 
  COUNT(*) as total_records,
  COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) as active_records
FROM attendance_logs;

-- STEP 5: Check by date range
SELECT 
  date,
  COUNT(*) as records_count,
  COUNT(DISTINCT user_id) as unique_employees
FROM attendance_logs
WHERE deleted_at IS NULL
GROUP BY date
ORDER BY date DESC
LIMIT 20;

SELECT '✅ YOUR DATA IS READY!' as status;
