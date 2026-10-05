CREATE OR REPLACE FUNCTION public.rpc_admin_notification_monitoring_summary(
  p_start_date date default null,
  p_end_date date default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'type', type,
      'total_sent', total_sent,
      'read_count', read_count,
      'unread_count', unread_count,
      'delivery_rate', CASE WHEN total_sent > 0 THEN round((read_count::numeric / total_sent) * 100, 2) ELSE 0 END,
      'last_sent', last_sent
    )
  )
  INTO v_result
  FROM (
    SELECT 
      type,
      count(*) as total_sent,
      count(*) FILTER (WHERE read = true) as read_count,
      count(*) FILTER (WHERE coalesce(read, false) = false) as unread_count,
      max(created_at) as last_sent
    FROM public.notifications
    WHERE type IN ('hr_announcement', 'policy', 'emergency')
      AND (p_start_date IS NULL OR (created_at at time zone 'Asia/Kolkata')::date >= p_start_date)
      AND (p_end_date IS NULL OR (created_at at time zone 'Asia/Kolkata')::date <= p_end_date)
    GROUP BY type
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_notification_monitoring_summary(date, date) TO authenticated;
