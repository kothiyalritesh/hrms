-- Migration: 20260927_rpc_admin_attendance_daily_v3.sql
-- RPC function for daily attendance data retrieval used by AttendanceIntelligenceScreen

CREATE OR REPLACE FUNCTION public.rpc_admin_attendance_daily_v3(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_start_date date;
  v_end_date date;
BEGIN
  -- Default to current month if not provided
  v_start_date := COALESCE(p_start_date, date_trunc('month', CURRENT_DATE)::date);
  v_end_date := COALESCE(p_end_date, CURRENT_DATE);

  SELECT jsonb_agg(
    jsonb_build_object(
      'date', att.date,
      'day_label', to_char(att.date, 'Dy, MMM DD'),
      'present_count', att.present_count,
      'present_missing_out_count', att.present_missing_out_count,
      'absent_count', att.absent_count,
      'leave_count', att.leave_count,
      'weekly_off_count', att.weekly_off_count,
      'holiday_count', att.holiday_count,
      'late_count', att.late_count,
      'attendance_rate', att.attendance_rate
    )
    ORDER BY att.date
  )
  INTO v_result
  FROM (
    SELECT
      al.date,
      COUNT(*) FILTER (WHERE al.status = 'PRESENT') as present_count,
      COUNT(*) FILTER (WHERE al.status = 'PRESENT_MISSING_OUT') as present_missing_out_count,
      COUNT(*) FILTER (WHERE al.status = 'ABSENT') as absent_count,
      COUNT(*) FILTER (WHERE al.status = 'APPROVED_LEAVE') as leave_count,
      COUNT(*) FILTER (WHERE al.status = 'WEEKLY_OFF') as weekly_off_count,
      COUNT(*) FILTER (WHERE al.status = 'HOLIDAY') as holiday_count,
      COUNT(*) FILTER (WHERE al.is_late = true) as late_count,
      CASE
        WHEN COUNT(*) FILTER (WHERE al.status NOT IN ('HOLIDAY', 'WEEKLY_OFF', 'NO_SOURCE_DATA')) > 0
        THEN ROUND(
          (COUNT(*) FILTER (WHERE al.status IN ('PRESENT', 'PRESENT_MISSING_OUT'))::numeric /
           COUNT(*) FILTER (WHERE al.status NOT IN ('HOLIDAY', 'WEEKLY_OFF', 'NO_SOURCE_DATA'))) * 100,
          2
        )
        ELSE 100
      END as attendance_rate
    FROM public.attendance_logs al
    WHERE al.date >= v_start_date
      AND al.date <= v_end_date
    GROUP BY al.date
  ) att;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_attendance_daily_v3(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_attendance_daily_v3(date, date) TO authenticated, anon;
