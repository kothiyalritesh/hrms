-- ============================================================
-- Run this in Supabase SQL Editor
-- 1. Add comp_off column to leave_balance
-- 2. Set up monthly +1 leave increment for all employees
-- ============================================================

-- 1. Add comp_off column
ALTER TABLE leave_balance ADD COLUMN IF NOT EXISTS comp_off INTEGER DEFAULT 0;

-- 2. Create leave_balance rows for employees who don't have one yet
INSERT INTO leave_balance (user_id, sick, casual, earned, comp_off)
SELECT p.id, 12, 12, 15, 0
FROM profiles p
WHERE p.is_active = true
  AND NOT EXISTS (SELECT 1 FROM leave_balance lb WHERE lb.user_id = p.id);

-- 3. Create a function that increments total leave balance by 1 for all active employees each month
CREATE OR REPLACE FUNCTION increment_monthly_leave()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Add 1 casual leave per month to all active employees
  UPDATE leave_balance
  SET casual = casual + 1
  WHERE user_id IN (
    SELECT id FROM profiles WHERE is_active = true
      AND role NOT IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  );
END;
$$;

-- 4. Schedule the function to run on the 1st of every month at midnight
-- Requires pg_cron extension (enable in Supabase Dashboard > Database > Extensions)
-- SELECT cron.schedule('monthly-leave-increment', '0 0 1 * *', 'SELECT increment_monthly_leave()');

-- If pg_cron is not available, you can call this function from your app on login
-- or use a Supabase Edge Function with a cron trigger.

-- 5. Verify
SELECT 'Setup complete' as status;
SELECT user_id, sick, casual, earned, comp_off FROM leave_balance LIMIT 5;
