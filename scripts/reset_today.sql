DELETE FROM attendance_logs WHERE date = CURRENT_DATE;
DELETE FROM activity_logs WHERE DATE(timestamp) = CURRENT_DATE;
SELECT 'Reset done' AS status;
