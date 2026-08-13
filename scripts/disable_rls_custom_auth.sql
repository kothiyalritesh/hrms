-- ============================================================
-- IMPORTANT: This app uses custom auth (profiles table),
-- NOT Supabase Auth. So auth.uid() is always NULL and all
-- RLS policies silently fail. Run this to fix approve/reject.
-- ============================================================

-- 1. Disable RLS on leaves (app-level security handles access)
ALTER TABLE leaves DISABLE ROW LEVEL SECURITY;

-- 2. Add rejection_reason column if missing
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 3. Also disable RLS on other tables the app uses with custom auth
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

-- 4. Verify leaves is accessible
SELECT id, status FROM leaves LIMIT 5;

SELECT 'Done - RLS disabled, approve/reject will now work' as status;
