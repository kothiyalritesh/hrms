-- Reset all employee leave balances to zero
-- Run this once in Supabase SQL editor to clear existing non-zero values

UPDATE leave_balance
SET sick = 0, casual = 0, earned = 0, comp_off = 0;

-- If any employees don't have a leave_balance record, create one with zero balances
INSERT INTO leave_balance (user_id, sick, casual, earned, comp_off)
SELECT id, 0, 0, 0, 0
FROM profiles
WHERE is_active = true
  AND role NOT IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  AND id NOT IN (SELECT user_id FROM leave_balance);
