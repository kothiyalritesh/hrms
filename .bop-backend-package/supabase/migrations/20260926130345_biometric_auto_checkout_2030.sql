CREATE OR REPLACE FUNCTION public.reconcile_missing_attendance_checkouts(
  p_target_date date default (now() at time zone 'Asia/Kolkata')::date
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_count int := 0;
BEGIN
  WITH candidates AS (
    SELECT a.id as attendance_id,
           (
             SELECT max(punch_timestamp)
             FROM public.smartoffice_device_logs s
             JOIN public.profiles p ON p.smartoffice_employee_code = s.employee_code
             WHERE p.id = a.user_id 
               AND s.log_date = a.date
               AND (s.punch_timestamp at time zone 'Asia/Kolkata')::time <= time '20:30:00'
               AND s.punch_timestamp > a.checkin_time + interval '5 minutes'
           ) as calculated_checkout
    FROM public.attendance_logs a
    WHERE a.date = p_target_date
      AND a.checkin_time IS NOT NULL
      AND a.checkout_time IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.field_visits fv
        WHERE fv.user_id = a.user_id AND fv.date = p_target_date
          AND fv.status IN ('IN_TRANSIT', 'CHECKED_IN')
      )
  )
  UPDATE public.attendance_logs a
  SET
    checkout_time = c.calculated_checkout,
    auto_closed = true,
    auto_close_reason = 'BIOMETRIC_LAST_PUNCH_BEFORE_2030',
    work_hours = greatest(0, round((extract(epoch from (c.calculated_checkout - a.checkin_time)) / 3600)::numeric, 2)),
    updated_at = now()
  FROM candidates c
  WHERE c.attendance_id = a.id
    AND c.calculated_checkout IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = row_count;

  IF v_updated_count > 0 THEN
    PERFORM public.log_audit_event(
      'ATTENDANCE_AUTO_CLOSED',
      'attendance_logs',
      null, null,
      jsonb_build_object('date', p_target_date, 'closed_count', v_updated_count, 'strategy', 'BIOMETRIC_LAST_PUNCH_BEFORE_2030')
    );
  END IF;

  RETURN v_updated_count;
END $$;
