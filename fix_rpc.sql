-- Fix the RPC for Canonical Attendance

DROP FUNCTION IF EXISTS public.rpc_admin_attendance_daily_v3(date, date);
DROP FUNCTION IF EXISTS public.rpc_admin_attendance_daily_v3(text, text, int, int);
DROP FUNCTION IF EXISTS public.rpc_admin_attendance_daily_v3(date, date, int, int);

CREATE OR REPLACE FUNCTION public.rpc_admin_attendance_daily_v3(
    p_start text,
    p_end text,
    p_offset int DEFAULT 0,
    p_limit int DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_res jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(v.*)), '[]'::jsonb)
    INTO v_res
    FROM (
        SELECT 
            c.*,
            -- Map effective_checkin -> official_first_in (alias used by frontend)
            c.effective_checkin as official_first_in,
            c.effective_checkout as official_last_out,
            c.effective_status as attendance_status,
            COALESCE(c.is_late, false) as is_late
        FROM public.v_attendance_daily_canonical c
        WHERE c.work_date >= p_start::date 
          AND c.work_date <= p_end::date
        ORDER BY c.work_date DESC, c.employee_name ASC
        OFFSET p_offset
        LIMIT p_limit
    ) v;
    
    RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_attendance_daily_v3(text, text, int, int) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
