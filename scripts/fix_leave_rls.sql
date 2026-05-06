-- ============================================================
-- Run this in Supabase SQL Editor to fix Leave approve/reject
-- ============================================================

-- 1. Add rejection_reason column if it doesn't exist
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 2. Drop existing leave policies to avoid conflicts
DROP POLICY IF EXISTS "leaves_user_select" ON leaves;
DROP POLICY IF EXISTS "leaves_user_insert" ON leaves;
DROP POLICY IF EXISTS "leaves_admin_select" ON leaves;
DROP POLICY IF EXISTS "leaves_admin_update" ON leaves;
DROP POLICY IF EXISTS "Users can view own leaves" ON leaves;
DROP POLICY IF EXISTS "Users can insert own leaves" ON leaves;
DROP POLICY IF EXISTS "Admins can view all leaves" ON leaves;
DROP POLICY IF EXISTS "Admins can update leaves" ON leaves;

-- 3. Enable RLS (safe to run even if already enabled)
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;

-- 4. Users can view their own leaves
CREATE POLICY "leaves_user_select" ON leaves
  FOR SELECT
  USING (auth.uid() = user_id);

-- 5. Users can insert their own leaves
CREATE POLICY "leaves_user_insert" ON leaves
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 6. Admins can view ALL leaves
CREATE POLICY "leaves_admin_select" ON leaves
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM profiles
      WHERE role IN ('Business Head', 'Team Head', 'admin', 'ADMIN', 'SYSTEM_ADMIN')
    )
  );

-- 7. Admins can UPDATE (approve/reject) any leave
CREATE POLICY "leaves_admin_update" ON leaves
  FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM profiles
      WHERE role IN ('Business Head', 'Team Head', 'admin', 'ADMIN', 'SYSTEM_ADMIN')
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM profiles
      WHERE role IN ('Business Head', 'Team Head', 'admin', 'ADMIN', 'SYSTEM_ADMIN')
    )
  );

-- 8. Verify
SELECT 'Leave RLS setup complete' as status;
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'leaves';
