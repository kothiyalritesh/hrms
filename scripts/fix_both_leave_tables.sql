-- Check which table has data
SELECT 'leaves' as tbl, COUNT(*) as rows FROM leaves
UNION ALL
SELECT 'leave_requests' as tbl, COUNT(*) as rows FROM leave_requests;

-- Check RLS status on both
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('leaves', 'leave_requests');

-- Disable RLS on BOTH to be safe
ALTER TABLE leaves DISABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests DISABLE ROW LEVEL SECURITY;

-- Add rejection_reason to both
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Show sample data from both
SELECT id, status, user_id FROM leaves LIMIT 3;
SELECT id, status, user_id FROM leave_requests LIMIT 3;
