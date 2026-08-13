-- ============================================================
-- Fix: Disable RLS on tables that use custom auth (not Supabase Auth)
-- auth.uid() is always NULL with custom auth, so RLS blocks all queries.
-- Run this in Supabase SQL Editor.
-- ============================================================

ALTER TABLE attendance_logs      DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs        DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        DISABLE ROW LEVEL SECURITY;
ALTER TABLE field_visits         DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles             DISABLE ROW LEVEL SECURITY;
ALTER TABLE offices              DISABLE ROW LEVEL SECURITY;

-- These are already disabled but included for completeness:
-- ALTER TABLE location_tracking    DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE location_alerts      DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE escalation_matrix    DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE escalation_log       DISABLE ROW LEVEL SECURITY;

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
