-- ============================================================
-- DIAGNOSTIC: CHECK ACTUAL COLUMN NAMES
-- ============================================================

-- STEP 1: Check all columns in attendance_logs table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'attendance_logs'
ORDER BY ordinal_position;

-- STEP 2: Check if data exists
SELECT COUNT(*) as total_records FROM attendance_logs;

-- STEP 3: Show first few records with all columns
SELECT * FROM attendance_logs LIMIT 5;

-- STEP 4: Check the view definition
SELECT view_definition
FROM information_schema.views
WHERE table_name = 'admin_attendance_export';

-- STEP 5: Try to see what columns are actually available
SELECT 
  id,
  user_id,
  date
FROM attendance_logs
LIMIT 5;
