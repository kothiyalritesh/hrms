CREATE OR REPLACE FUNCTION public.rpc_admin_audit_logs_summary()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'total_today', (SELECT count(*) FROM audit_logs WHERE performed_at >= current_date),
        'total_week', (SELECT count(*) FROM audit_logs WHERE performed_at >= current_date - interval '7 days'),
        'most_active_admin', (
            SELECT p.name 
            FROM audit_logs a 
            JOIN profiles p ON p.id = a.performed_by 
            WHERE a.performed_at >= current_date - interval '30 days'
            GROUP BY p.name 
            ORDER BY count(*) DESC 
            LIMIT 1
        ),
        'most_modified_table', (
            SELECT table_name 
            FROM audit_logs 
            WHERE performed_at >= current_date - interval '30 days'
            GROUP BY table_name 
            ORDER BY count(*) DESC 
            LIMIT 1
        )
    ) INTO result;
    
    RETURN result;
END;
$$;
