const machineUrl = "http://122.176.140.154:81/api/v2/WebAPI/GetDeviceLogs?APIKey=240916062617&FromDate=2026-08-27&ToDate=2026-08-27";

async function fetchLatest() {
  const res = await fetch(machineUrl);
  const data = await res.json();
  const records = Array.isArray(data) ? data : (data.records || data.result || []);
  console.log(`Fetched at ${new Date().toLocaleTimeString()}: ${records.length} punches on machine.`);

  let valuesSql = records.map(r => {
    const emp = (r.EmployeeCode || "").trim().replace(/'/g, "''");
    const dt = (r.LogDate || "").trim().replace(/'/g, "''");
    const sn = (r.SerialNumber || "").trim().replace(/'/g, "''");
    const dir = (r.PunchDirection || "").trim().replace(/'/g, "''");
    const temp = Number(r.Temperature) || 0;
    return `('${emp}', '${dt}', '${sn}', '${dir}', ${temp})`;
  }).join(",\n  ");

  const fullSql = `-- ============================================================================
-- sync_today_punches_live.sql
-- Live Biometric Punch Sync (Fetched: ${new Date().toISOString()})
-- Total Punches on Machine: ${records.length}
-- ============================================================================

-- 1. Insert latest raw punches into smartoffice_device_logs
INSERT INTO public.smartoffice_device_logs (employee_code, log_datetime, serial_number, punch_direction, temperature)
VALUES
  ${valuesSql}
ON CONFLICT DO NOTHING;

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

-- 3. Automatically check in and update with exact biometric punch time
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

-- 4. Display all employees with their exact biometric check-in time
SELECT 
  p.name,
  p.employee_number,
  p.smartoffice_employee_code,
  a.date,
  to_char(a.checkin_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI:SS AM') AS biometric_checkin_ist,
  to_char(a.biometric_last_punch AT TIME ZONE 'Asia/Kolkata', 'HH12:MI:SS AM') AS last_punch_ist,
  a.checkin_source,
  a.status,
  a.biometric_punch_count
FROM public.attendance_logs a
JOIN public.profiles p ON p.id = a.user_id
WHERE a.date = '2026-08-27'
ORDER BY a.checkin_time ASC;
`;

  require("fs").writeFileSync("d:/download/RealtyHRM-fixed/RealtyHRM-fixed/scripts/sync_today_punches_live.sql", fullSql, "utf8");
  console.log("Updated sync_today_punches_live.sql with latest punches!");
}

fetchLatest();
