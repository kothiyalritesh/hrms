-- Check if audit triggers exist
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
AND event_object_table IN ('profiles', 'attendance_logs', 'leaves', 'tasks', 'departments', 'designations', 'employee_meta')
ORDER BY event_object_table, trigger_name;

-- Check if audit function exists
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE '%audit%';
