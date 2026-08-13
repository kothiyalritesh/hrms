-- Check what's in attendance_logs for today (2026-07-16)
SELECT * FROM attendance_logs WHERE date = '2026-07-16';

-- Check ALL attendance records to see what dates exist
SELECT date, COUNT(*) as count 
FROM attendance_logs 
GROUP BY date 
ORDER BY date DESC 
LIMIT 10;

-- Check if RLS is blocking queries
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename = 'attendance_logs';

-- Try to see if there are ANY records at all
SELECT COUNT(*) as total_records FROM attendance_logs;

-- Check if the user who just checked in has a record
SELECT a.*, p.name, o.name as office_name
FROM attendance_logs a
LEFT JOIN profiles p ON a.user_id = p.id
LEFT JOIN offices o ON a.office_id = o.id
ORDER BY a.created_at DESC NULLS LAST, a.checkin_time DESC NULLS LAST
LIMIT 5;

