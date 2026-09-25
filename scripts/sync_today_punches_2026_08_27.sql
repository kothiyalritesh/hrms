-- ============================================================================
-- sync_today_punches_2026_08_27.sql
-- Direct Import & Check-In for Today's Real Machine Punches (28 Punches)
-- ============================================================================

-- 1. Insert today's raw punches into smartoffice_device_logs
INSERT INTO public.smartoffice_device_logs (employee_code, log_datetime, serial_number, punch_direction, temperature)
VALUES
  ('136011', '2026-08-27 10:24:47', 'CEXJ203660057', '', 0),
  ('136011', '2026-08-27 10:24:50', 'CEXJ203660057', '', 0),
  ('248208', '2026-08-27 09:05:20', 'C26238441B14122D', '', 0),
  ('248239', '2026-08-27 08:20:24', 'CEXJ203660057', '', 0),
  ('260151', '2026-08-27 10:21:02', 'C269C422CF183228', '', 0),
  ('260151', '2026-08-27 10:24:10', 'C269C422CF183228', '', 0),
  ('260156', '2026-08-27 10:30:10', 'C269C422CF183228', '', 0),
  ('260168', '2026-08-27 10:28:59', 'C269C422CF183228', '', 0),
  ('260175', '2026-08-27 10:15:36', 'C269C422CF183228', '', 0),
  ('260176', '2026-08-27 10:01:07', 'C269C422CF183228', '', 0),
  ('260194', '2026-08-27 10:11:34', 'C269C422CF183228', '', 0),
  ('260195', '2026-08-27 10:14:22', 'C269C422CF183228', '', 0),
  ('260721', '2026-08-27 10:33:36', 'C269C422CF183228', '', 0),
  ('AA275', '2026-08-27 10:22:59', 'C269C422CF183228', '', 0),
  ('36005', '2026-08-27 10:32:30', 'CEXJ203660057', '', 0),
  ('779', '2026-08-27 10:03:15', 'C2612068A3101C21', '', 0),
  ('800045', '2026-08-27 08:13:43', 'C26238441B240F2F', '', 0),
  ('8135', '2026-08-27 10:22:46', 'C26238441B240F2F', '', 0),
  ('8235', '2026-08-27 05:42:53', 'C26238441B240F2F', '', 0),
  ('8315', '2026-08-27 10:04:31', 'C269C422CF183228', '', 0),
  ('8374', '2026-08-27 10:17:08', 'C2612068A3101C21', '', 0),
  ('8414', '2026-08-27 10:32:56', 'C26238441B240F2F', '', 0),
  ('8441', '2026-08-27 10:09:37', 'C2612068A3101C21', '', 0),
  ('8479', '2026-08-27 10:24:02', 'C269C422CF183228', '', 0),
  ('8485', '2026-08-27 10:30:14', 'C269C422CF183228', '', 0),
  ('AA006', '2026-08-27 10:23:09', 'C269C422CF183228', '', 0),
  ('AA011', '2026-08-27 10:22:41', 'C2612068A3101C21', '', 0),
  ('AA227', '2026-08-27 10:04:04', 'C269C422CF183228', '', 0);

-- 2. Link raw punches to profiles
UPDATE public.smartoffice_device_logs dl
SET user_id = p.id
FROM public.profiles p
WHERE (
    lower(trim(p.smartoffice_employee_code)) = lower(trim(dl.employee_code))
    OR lower(trim(p.employee_number)) = lower(trim(dl.employee_code))
  )
  AND p.is_active = true
  AND dl.user_id IS NULL;

-- 3. Automatically check in all matched employees for today in attendance_logs
WITH parsed_today AS (
  SELECT
    log.user_id,
    '2026-08-27'::date AS att_date,
    (trim(log.log_datetime) || '+05:30')::timestamptz AS punch_ts
  FROM public.smartoffice_device_logs log
  WHERE log.user_id IS NOT NULL
    AND length(trim(log.log_datetime)) >= 10
    AND substring(trim(log.log_datetime) from 1 for 10) = '2026-08-27'
),
daily_summary AS (
  SELECT
    user_id,
    att_date,
    min(punch_ts) AS first_punch,
    max(punch_ts) AS last_punch,
    count(*)::int AS punch_cnt
  FROM parsed_today
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
  checkin_time = EXCLUDED.checkin_time,
  checkin_source = 'BIOMETRIC',
  smartoffice_imported = true,
  biometric_first_punch = EXCLUDED.biometric_first_punch,
  biometric_last_punch = EXCLUDED.biometric_last_punch,
  biometric_punch_count = EXCLUDED.biometric_punch_count,
  attendance_status = 'PRESENT',
  day_status = 'P',
  status = 'CHECKED_IN',
  updated_at = now();

-- 4. Display all employees checked in for today
SELECT 
  p.name,
  p.employee_number,
  p.smartoffice_employee_code,
  a.date,
  (a.checkin_time AT TIME ZONE 'Asia/Kolkata')::time AS punch_time_ist,
  a.checkin_source,
  a.status,
  a.biometric_punch_count
FROM public.attendance_logs a
JOIN public.profiles p ON p.id = a.user_id
WHERE a.date = '2026-08-27'
ORDER BY a.checkin_time ASC;
