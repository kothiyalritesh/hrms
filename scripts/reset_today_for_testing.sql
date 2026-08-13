-- Reset today's attendance for all users (for testing only)
DELETE FROM attendance_logs
WHERE date = CURRENT_DATE;

-- Also clear today's activity logs if needed
DELETE FROM activity_logs
WHERE DATE(timestamp) = CURRENT_DATE;

-- Verify
SELECT 'Reset complete. Rows remaining today:' AS status,
  (SELECT COUNT(*) FROM attendance_logs WHERE date = CURRENT_DATE) AS attendance_rows,
  (SELECT COUNT(*) FROM activity_logs WHERE DATE(timestamp) = CURRENT_DATE) AS activity_rows;
