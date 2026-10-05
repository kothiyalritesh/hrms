SELECT routine_name, data_type, routine_type, routine_schema
FROM information_schema.routines
WHERE routine_name = 'rpc_admin_attendance_daily_v3';

SELECT p.proname, pg_get_function_arguments(p.oid) as args 
FROM pg_proc p 
WHERE p.proname = 'rpc_admin_attendance_daily_v3';
