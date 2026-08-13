-- ============================================================
-- DEBUG: Check attendance data for today
-- Run this in Supabase SQL Editor to see what data exists
-- ============================================================

-- 1. Show current database time
SELECT NOW() as current_db_time, CURRENT_DATE as current_db_date;

-- 2. Show all attendance records (last 7 days)
SELECT 
  date,
  COUNT(*) as total_records,
  COUNT(CASE WHEN status = 'CHECKED_IN' THEN 1 END) as checked_in,
  COUNT(CASE WHEN status = 'CHECKED_OUT' THEN 1 END) as checked_out
FROM attendance_logs
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY date
ORDER BY date DESC;

-- 3. Show today's attendance in detail
SELECT 
  a.user_id,
  p.name,
  p.role,
  a.date,
  a.checkin_time,
  a.checkout_time,
  a.status,
  a.office_id,
  o.name as office_name,
  a.distance_from_office,
  a.warning
FROM attendance_logs a
LEFT JOIN profiles p ON a.user_id = p.id
LEFT JOIN offices o ON a.office_id = o.id
WHERE a.date = CURRENT_DATE
ORDER BY a.checkin_time DESC;

-- 4. Check RLS status on critical tables
SELECT 
  schemaname,
  tablename, 
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename IN ('attendance_logs', 'profiles', 'offices', 'field_visits', 'location_tracking')
ORDER BY tablename;

-- 5. Show active users
SELECT COUNT(*) as active_users FROM profiles WHERE is_active = true;

-- 6. Show active offices
SELECT id, name, latitude, longitude, attendance_radius 
FROM offices 
WHERE is_active = true;

-- 7. Check if there are ANY attendance records at all
SELECT 
  MIN(date) as earliest_attendance,
  MAX(date) as latest_attendance,
  COUNT(*) as total_records
FROM attendance_logs;
