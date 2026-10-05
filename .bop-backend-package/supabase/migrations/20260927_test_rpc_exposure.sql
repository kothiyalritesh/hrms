-- Test if the function is properly exposed to REST API
-- Run this to verify the function exists and is callable

SELECT 
  routine_name,
  routine_schema,
  routine_type
FROM information_schema.routines 
WHERE routine_name = 'rpc_admin_attendance_daily_v3'
  AND routine_schema = 'public';

-- If the above returns a row, the function exists.
-- If it doesn't, the function wasn't created properly.

-- To manually test the function, run:
-- SELECT public.rpc_admin_attendance_daily_v3('2026-08-01'::date, '2026-08-31'::date);

-- If you get a result, the function works but REST API might not be exposing it.
-- This could be due to:
-- 1. Function not being in public schema
-- 2. Permissions not set correctly
-- 3. Supabase cache not refreshed

-- Try refreshing the Supabase schema cache by running:
-- NOTIFY pgrst, 'reload schema';
