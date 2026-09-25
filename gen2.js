const fs = require('fs');

const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/supabase/migrations/20260912000000_field_visit_timestamp_utc_migration.sql';
const lines = fs.readFileSync(file, 'utf8').split('\n');

let viewDef = [];
let insideView = false;
for (const line of lines) {
  if (line.includes('CREATE OR REPLACE VIEW public.v_attendance_daily_canonical')) {
    insideView = true;
  }
  if (insideView) {
    viewDef.push(line);
    if (line.includes('FROM evidence;')) {
      break;
    }
  }
}

let sql = viewDef.join('\n');

const oldBio = `  LEFT JOIN LATERAL (
    SELECT
      min(COALESCE(d.log_date,(d.log_date_only::text||' '||d.log_time::text)::timestamp AT TIME ZONE 'Asia/Kolkata')) first_punch,
      max(COALESCE(d.log_date,(d.log_date_only::text||' '||d.log_time::text)::timestamp AT TIME ZONE 'Asia/Kolkata')) last_punch
    FROM public.smartoffice_device_logs d
    WHERE d.user_id=employee.user_id AND d.log_date_only=employee.work_date) biometric ON true`;

const newBio = `  LEFT JOIN LATERAL (
    SELECT
      least(old_bio.first_punch, new_bio.first_punch) first_punch,
      greatest(old_bio.last_punch, new_bio.last_punch) last_punch
    FROM (
      SELECT
        min(COALESCE(d.log_date,(d.log_date_only::text||' '||d.log_time::text)::timestamp AT TIME ZONE 'Asia/Kolkata')) first_punch,
        max(COALESCE(d.log_date,(d.log_date_only::text||' '||d.log_time::text)::timestamp AT TIME ZONE 'Asia/Kolkata')) last_punch
      FROM public.smartoffice_device_logs d
      WHERE d.user_id=employee.user_id AND d.log_date_only=employee.work_date
    ) old_bio
    CROSS JOIN (
      SELECT
        min(punch.punch_timestamp) first_punch,
        max(punch.punch_timestamp) last_punch
      FROM public.biometric_device_punches punch
      WHERE punch.attendance_date = employee.work_date
        AND punch.biometric_employee_code IN (
           SELECT mapping.biometric_employee_code
           FROM public.employee_biometric_mappings mapping
           WHERE mapping.user_id = employee.user_id AND mapping.is_active
        )
    ) new_bio
  ) biometric ON true`;

sql = sql.replace(oldBio, newBio);

fs.writeFileSync('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/fix_canonical2.sql', sql, 'utf8');
console.log("Generated script cleanly from source");