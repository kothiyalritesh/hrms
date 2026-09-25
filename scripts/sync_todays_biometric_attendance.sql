-- ============================================================================
-- sync_todays_biometric_attendance.sql
-- Diagnostics & Direct Attendance Sync for Today
-- ============================================================================

-- 1. Check what punches currently exist in smartoffice_device_logs for Today
SELECT 
  employee_code,
  user_id,
  log_datetime,
  punch_direction,
  created_at
FROM public.smartoffice_device_logs
WHERE 
  coalesce(
    log_date_only, 
    NULLIF(SUBSTRING(trim(log_datetime) FROM 1 FOR 10), '')::date,
    (created_at AT TIME ZONE 'Asia/Kolkata')::date
  ) = (now() AT TIME ZONE 'Asia/Kolkata')::date
ORDER BY log_datetime ASC;

-- 2. Link any unlinked device logs for today by employee_number or smartoffice_employee_code
UPDATE public.smartoffice_device_logs dl
SET user_id = p.id
FROM public.profiles p
WHERE (
    lower(trim(p.smartoffice_employee_code)) = lower(trim(dl.employee_code))
    OR lower(trim(p.employee_number)) = lower(trim(dl.employee_code))
  )
  AND p.is_active = true
  AND dl.user_id IS NULL;

-- 3. Sync all matched punches for today directly into attendance_logs
WITH parsed_today AS (
  SELECT
    log.user_id,
    (now() AT TIME ZONE 'Asia/Kolkata')::date AS att_date,
    CASE
      WHEN NULLIF(trim(log.log_datetime), '') IS NOT NULL THEN
        CASE 
          WHEN trim(log.log_datetime) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' 
            THEN (trim(log.log_datetime) || '+05:30')::timestamptz
          WHEN trim(log.log_datetime) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' 
            THEN trim(log.log_datetime)::timestamptz
          ELSE (trim(log.log_datetime) || '+05:30')::timestamptz
        END
      WHEN log.log_date_only IS NOT NULL AND log.log_time IS NOT NULL THEN
        (log.log_date_only::text || ' ' || log.log_time::text || '+05:30')::timestamptz
      ELSE log.created_at
    END AS punch_ts
  FROM public.smartoffice_device_logs log
  WHERE log.user_id IS NOT NULL
    AND coalesce(
      log.log_date_only, 
      NULLIF(SUBSTRING(trim(log.log_datetime) FROM 1 FOR 10), '')::date,
      (log.created_at AT TIME ZONE 'Asia/Kolkata')::date
    ) = (now() AT TIME ZONE 'Asia/Kolkata')::date
),
daily_summary AS (
  SELECT
    user_id,
    att_date,
    min(punch_ts) AS first_punch,
    max(punch_ts) AS last_punch,
    count(*)::int AS punch_cnt
  FROM parsed_today
  WHERE punch_ts IS NOT NULL
  GROUP BY user_id, att_date
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
  d.user_id,
  p.office_id,
  d.att_date,
  d.first_punch,
  'BIOMETRIC',
  NULL,
  NULL,
  'CHECKED_IN',
  'PRESENT',
  'P',
  'BIOMETRIC',
  true,
  d.first_punch,
  d.last_punch,
  d.punch_cnt,
  NULL,
  now()
FROM daily_summary d
JOIN public.profiles p ON p.id = d.user_id
ON CONFLICT (user_id, date) DO UPDATE
SET
  checkin_time = coalesce(attendance_logs.checkin_time, EXCLUDED.checkin_time),
  checkin_source = 'BIOMETRIC',
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

-- 4. Show current attendance for today
SELECT 
  p.name,
  p.employee_number,
  p.smartoffice_employee_code,
  a.date,
  a.checkin_time,
  a.checkin_source,
  a.checkout_time,
  a.status,
  a.biometric_punch_count
FROM public.attendance_logs a
JOIN public.profiles p ON p.id = a.user_id
WHERE a.date = (now() AT TIME ZONE 'Asia/Kolkata')::date
ORDER BY a.checkin_time DESC;
