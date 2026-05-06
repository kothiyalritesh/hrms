-- ============================================================
-- Disable RLS on Activity Logs
-- Since the app uses custom OTP authentication (not Supabase auth),
-- RLS policies won't work. Disable RLS to allow data access.
-- ============================================================

-- Disable RLS on activity_logs
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;

-- Verify RLS is disabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'activity_logs';

-- Test: Fetch all activities
SELECT COUNT(*) as total_activities FROM activity_logs;

-- Test: Fetch activities by user
SELECT 
  user_id,
  COUNT(*) as count,
  MAX(timestamp) as latest
FROM activity_logs
GROUP BY user_id;
