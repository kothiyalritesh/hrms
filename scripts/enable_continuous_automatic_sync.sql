-- ============================================================================
-- enable_continuous_automatic_sync.sql
-- Enables instant automatic check-in when users punch on the biometric machine
-- ============================================================================

-- 1. Create a secure RPC function to ingest & check-in biometric punches directly
CREATE OR REPLACE FUNCTION public.rpc_sync_biometric_punches(p_punches jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_inserted_logs integer := 0;
  v_updated_attendance integer := 0;
BEGIN
  IF p_punches IS NULL OR jsonb_array_length(p_punches) = 0 THEN
    RETURN jsonb_build_object('success', true, 'updated', 0, 'message', 'No punches provided');
  END IF;

  -- A. Insert into smartoffice_device_logs
  INSERT INTO public.smartoffice_device_logs (
    employee_code,
    log_datetime,
    serial_number,
    punch_direction,
    temperature
  )
  SELECT
    trim(r->>'EmployeeCode'),
    trim(r->>'LogDate'),
    coalesce(r->>'SerialNumber', ''),
    coalesce(r->>'PunchDirection', ''),
    coalesce((r->>'Temperature')::numeric, 0)
  FROM jsonb_array_elements(p_punches) AS r
  WHERE nullif(trim(r->>'EmployeeCode'), '') IS NOT NULL
    AND nullif(trim(r->>'LogDate'), '') IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted_logs = ROW_COUNT;

  -- B. Link any unlinked logs to active employee profiles
  UPDATE public.smartoffice_device_logs dl
  SET user_id = p.id
  FROM public.profiles p
  WHERE (
      lower(trim(p.smartoffice_employee_code)) = lower(trim(dl.employee_code))
      OR lower(trim(p.employee_number)) = lower(trim(dl.employee_code))
    )
    AND p.is_active = true
    AND dl.user_id IS NULL;

  -- C. Upsert attendance_logs for today with CHECKED_IN status and exact punch times
  WITH parsed_punches AS (
    SELECT
      dl.user_id,
      p.office_id,
      v_today AS att_date,
      (trim(dl.log_datetime) || '+05:30')::timestamptz AS punch_ts
    FROM public.smartoffice_device_logs dl
    JOIN public.profiles p ON p.id = dl.user_id
    WHERE dl.user_id IS NOT NULL
      AND length(trim(dl.log_datetime)) >= 10
      AND substring(trim(dl.log_datetime) from 1 for 10) = v_today::text
  ),
  daily_group AS (
    SELECT
      user_id,
      office_id,
      att_date,
      min(punch_ts) AS first_punch,
      max(punch_ts) AS last_punch,
      count(*)::int AS punch_cnt
    FROM parsed_punches
    GROUP BY user_id, office_id, att_date
  )
  INSERT INTO public.attendance_logs(
    user_id,
    office_id,
    date,
    checkin_time,
    checkin_source,
    checkout_time,
    checkout_source,
    status,
    attendance_status,
    day_status,
    attendance_type,
    smartoffice_imported,
    biometric_first_punch,
    biometric_last_punch,
    biometric_punch_count,
    work_hours,
    updated_at
  )
  SELECT
    g.user_id,
    g.office_id,
    g.att_date,
    g.first_punch,
    'BIOMETRIC',
    NULL,
    NULL,
    'CHECKED_IN',
    'PRESENT',
    'P',
    'BIOMETRIC',
    true,
    g.first_punch,
    g.last_punch,
    g.punch_cnt,
    NULL,
    now()
  FROM daily_group g
  ON CONFLICT (user_id, date) DO UPDATE
  SET
    checkin_time = coalesce(attendance_logs.checkin_time, EXCLUDED.checkin_time),
    checkin_source = 'BIOMETRIC',
    -- Earliest punch wins across Biometric and Mobile App
    checkin_time = CASE
      WHEN attendance_logs.checkin_time IS NULL THEN EXCLUDED.checkin_time
      WHEN EXCLUDED.checkin_time < attendance_logs.checkin_time THEN EXCLUDED.checkin_time
      ELSE attendance_logs.checkin_time
    END,
    -- Source reflects whichever was earlier
    checkin_source = CASE
      WHEN attendance_logs.checkin_time IS NULL THEN 'BIOMETRIC'
      WHEN EXCLUDED.checkin_time < attendance_logs.checkin_time THEN 'BIOMETRIC'
      ELSE coalesce(attendance_logs.checkin_source, 'BIOMETRIC')
    END,
    smartoffice_imported = true,
    biometric_first_punch = EXCLUDED.biometric_first_punch,
    biometric_last_punch = EXCLUDED.biometric_last_punch,
    biometric_punch_count = EXCLUDED.biometric_punch_count,
    attendance_status = 'PRESENT',
    day_status = 'P',
    status = CASE
      WHEN attendance_logs.checkout_time IS NULL THEN 'CHECKED_IN'
      ELSE attendance_logs.status
    END,
    updated_at = now();

  GET DIAGNOSTICS v_updated_attendance = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_raw_punches', v_inserted_logs,
    'updated_attendance_count', v_updated_attendance,
    'date', v_today
  );
END;
$$;

-- Grant execution to anon, authenticated and service_role
GRANT EXECUTE ON FUNCTION public.rpc_sync_biometric_punches(jsonb) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
