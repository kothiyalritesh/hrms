-- Check row count
SELECT COUNT(*) as total_audit_logs FROM audit_logs;

-- Check sample data
SELECT id, action, table_name, record_id, performed_at, performed_by
FROM audit_logs
ORDER BY performed_at DESC
LIMIT 10;
