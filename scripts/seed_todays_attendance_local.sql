-- Seed today's attendance data for local testing
-- This script creates sample attendance records for today

-- First, get today's date in IST
WITH today_date AS (
  SELECT (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::text as today
)
INSERT INTO attendance_logs (
  id,
  user_id,
  date,
  checkin_time,
  checkout_time,
  office_id,
  status,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  p.id,
  (SELECT today FROM today_date),
  (SELECT today FROM today_date) || 'T09:' || LPAD((RANDOM() * 59)::int::text, 2, '0') || ':00+05:30',
  (SELECT today FROM today_date) || 'T18:' || LPAD((RANDOM() * 59)::int::text, 2, '0') || ':00+05:30',
  o.id,
  'CHECKED_OUT',
  NOW(),
  NOW()
FROM profiles p
LEFT JOIN offices o ON p.office_id = o.id
WHERE p.is_active = true
  AND o.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM attendance_logs al
    WHERE al.user_id = p.id
      AND al.date = (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::text
  )
LIMIT 20;

-- Verify the data was inserted
SELECT 
  COUNT(*) as total_records,
  COUNT(DISTINCT user_id) as unique_employees,
  MIN(date) as earliest_date,
  MAX(date) as latest_date
FROM attendance_logs
WHERE date = (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::text;

-- Show sample records
SELECT 
  a.date,
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
