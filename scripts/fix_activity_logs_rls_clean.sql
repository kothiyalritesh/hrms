-- ============================================================
-- Fix Activity Logs RLS Policies
-- Remove conflicting anon policies and keep only authenticated policies
-- ============================================================

-- 1. Drop all existing policies
DROP POLICY IF EXISTS "Users can view own activities" ON activity_logs;
DROP POLICY IF EXISTS "Users can insert own activities" ON activity_logs;
DROP POLICY IF EXISTS "Users can update own activities" ON activity_logs;
DROP POLICY IF EXISTS "Admins can view all activities" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_anon_delete" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_anon_insert" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_anon_select" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_anon_update" ON activity_logs;

-- 2. Disable RLS temporarily to verify data exists
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;

-- 3. Verify data
SELECT COUNT(*) as total_activities FROM activity_logs;

-- 4. Re-enable RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- 5. Create clean RLS policies for authenticated users only

-- Policy 1: Users can view their own activities
CREATE POLICY "Users can view own activities" ON activity_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy 2: Users can insert their own activities
CREATE POLICY "Users can insert own activities" ON activity_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy 3: Users can update their own activities
CREATE POLICY "Users can update own activities" ON activity_logs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy 4: Users can delete their own activities
CREATE POLICY "Users can delete own activities" ON activity_logs
  FOR DELETE
  USING (auth.uid() = user_id);

-- Policy 5: Admins can view all activities
CREATE POLICY "Admins can view all activities" ON activity_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('Business Head', 'Team Head', 'admin')
    )
  );

-- Policy 6: Admins can update any activity
CREATE POLICY "Admins can update all activities" ON activity_logs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('Business Head', 'Team Head', 'admin')
    )
  );

-- 6. Verify policies are in place
SELECT policyname, permissive, roles
FROM pg_policies
WHERE tablename = 'activity_logs'
ORDER BY policyname;
