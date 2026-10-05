CREATE OR REPLACE FUNCTION public.rpc_my_unified_activity_log(
  p_category text default 'all',
  p_limit int default 50,
  p_offset int default 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  WITH combined AS (
    -- 1. Attendance (Check-ins/Outs)
    SELECT id, 'attendance' as category, 'Check-in recorded' as title, 'Checked in' as description, checkin_time as log_time
    FROM public.attendance_logs WHERE user_id = v_uid AND checkin_time IS NOT NULL
    UNION ALL
    SELECT id, 'attendance' as category, 'Check-out recorded' as title, 'Checked out' as description, checkout_time as log_time
    FROM public.attendance_logs WHERE user_id = v_uid AND checkout_time IS NOT NULL
    
    -- 2. Leaves
    UNION ALL
    SELECT id, 'leave' as category, 'Leave ' || status as title, leave_type || ' from ' || start_date || ' to ' || end_date as description, created_at as log_time
    FROM public.leave_requests WHERE user_id = v_uid
    
    -- 3. Field Visits (Activity Logs)
    UNION ALL
    SELECT id, 'field_visit' as category, activity_type as title, summary as description, timestamp as log_time
    FROM public.activity_logs WHERE user_id = v_uid
    
    -- 4. System Actions (Audit)
    UNION ALL
    SELECT id, 'system' as category, 'System Action: ' || action as title, 'Table: ' || table_name as description, performed_at as log_time
    FROM public.audit_logs WHERE performed_by = v_uid
  ), filtered AS (
    SELECT * FROM combined
    WHERE p_category = 'all' OR category = p_category
    ORDER BY log_time DESC NULLS LAST
    OFFSET p_offset LIMIT p_limit
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'category', category,
    'title', title,
    'description', description,
    'timestamp', log_time
  )) INTO v_res FROM filtered;
  
  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_my_unified_activity_log(text, int, int) TO authenticated;
