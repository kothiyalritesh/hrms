-- ============================================================================
-- QUICK SEED: Today's Attendance Data for Local Testing
-- ============================================================================
-- Copy and paste this entire script into Supabase SQL Editor and execute
-- This will create 20 sample attendance records for today
-- ============================================================================

-- Step 1: Get today's date in IST
WITH today_date AS (
  SELECT (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::text as today
),

-- Step 2: Get active employees and offices
employees_offices AS (
  SELECT 
    p.id as user_id,
    p.name,
    COALESCE(p.office_id, o.id) as office_id,
    o.name as office_name,
    ROW_NUMBER() OVER (ORDER BY p.id) as row_num
  FROM profiles p
  LEFT JOIN offices o ON p.office_id = o.id
  WHERE p.is_active = true
    AND o.is_active = true
  LIMIT 20
)

-- Step 3: Insert attendance records
INSERT INTO attendance_logs (
  id,
  user_id,
  date,
  checkin_time,
  checkout_time,
  office_id,
  status,
  warning,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  eo.user_id,
  td.today,
  td.today || 'T' || 
    LPAD((9 + (eo.row_num % 2))::text, 2, '0') || ':' ||
    LPAD((RANDOM() * 59)::int::text, 2, '0') || ':00+05:30',
  td.today || 'T' || 
    LPAD((17 + (eo.row_num % 2))::text, 2, '0') || ':' ||
    LPAD((RANDOM() * 59)::int::text, 2, '0') || ':00+05:30',
  eo.office_id,
  'CHECKED_OUT',
  false,
  NOW(),
  NOW()
FROM employees_offices eo
CROSS JOIN today_date td
WHERE NOT EXISTS (
  SELECT 1 FROM attendance_logs al
  WHERE al.user_id = eo.user_id
    AND al.date = td.today
);

-- Step 4: Verify the insertion
SELECT 
  COUNT(*) as total_records,
  COUNT(DISTINCT user_id) as unique_employees,
  MIN(date) as date
FROM attendance_logs
WHERE date = (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::text;

-- Step 5: Show sample records
SELECT 
  p.name as employee_name,
  o.name as office_name,
  a.checkin_time,
  a.checkout_time,
  a.status
FROM attendance_logs a
LEFT JOIN profiles p ON a.user_id = p.id
LEFT JOIN offices o ON a.office_id = o.id
WHERE a.date = (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::text
ORDER BY a.created_at DESC
LIMIT 10;
