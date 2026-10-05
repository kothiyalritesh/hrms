-- Minimal stub function to prevent 404 errors
-- The frontend computes attendance data client-side, so this just needs to exist

DROP FUNCTION IF EXISTS public.rpc_admin_attendance_daily_v3(date, date) CASCADE;

CREATE FUNCTION public.rpc_admin_attendance_daily_v3(
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT '[]'::jsonb;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_attendance_daily_v3(date, date) TO authenticated, anon;

-- Force schema reload
NOTIFY pgrst, 'reload schema';
