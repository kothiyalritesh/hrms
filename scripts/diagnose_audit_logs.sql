-- Check if audit_logs table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'audit_logs'
) as table_exists;

-- Check row count
SELECT COUNT(*) as total_audit_logs FROM audit_logs;

-- Check sample data
SELECT id, action, table_name, record_id, performed_at, performed_by
FROM audit_logs
ORDER BY performed_at DESC
LIMIT 10;

-- Check table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_logs'
ORDER BY ordinal_position;

-- Check RLS status
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'audit_logs';
