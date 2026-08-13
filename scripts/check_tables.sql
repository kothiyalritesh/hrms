-- ============================================================
-- Step 1: Find what tables actually exist
-- Run this first and tell me what tables you see
-- ============================================================
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;
