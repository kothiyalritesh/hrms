-- Fix activity_logs RLS (app uses custom auth, auth.uid() is always NULL)
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;

-- Verify
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'activity_logs';

-- Check if today's logs exist
SELECT id, user_id, timestamp, location_type, notes 
FROM activity_logs 
WHERE DATE(timestamp) = CURRENT_DATE
ORDER BY timestamp DESC;
