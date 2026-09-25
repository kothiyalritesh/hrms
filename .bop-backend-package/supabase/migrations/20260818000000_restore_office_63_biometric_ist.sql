-- Office 63 restored its device wall clock to India time on 18 August 2026.
-- The prior UTC setting caused offset-less local punches to display 5:30 ahead
-- in HRMS. Correct only the immediately-ingested, demonstrably shifted rows.

update public.biometric_device_clock_settings
set effective_to = date '2026-08-17',
    updated_at = now()
where device_id = 'C269C422CF183228'
  and source_timezone = 'UTC'
  and effective_from = date '2026-08-17'
  and effective_to is null;

insert into public.biometric_device_clock_settings(
  device_id, source_timezone, effective_from, reason
) values (
  'C269C422CF183228', 'Asia/Kolkata', date '2026-08-18',
  'Office 63 device clock restored to India wall-clock time.'
)
on conflict (device_id, effective_from) do update
set source_timezone = excluded.source_timezone,
    reason = excluded.reason,
    updated_at = now();

-- The source clock was local IST, but was interpreted as UTC. Such rows were
-- saved 5:30 ahead of their near-simultaneous import time. The four-to-seven
-- hour window prevents altering delayed imports or correctly normalized rows.
with candidates as (
  select log.*
  from public.smartoffice_device_logs log
  where log.serial_number = 'C269C422CF183228'
    and log.log_date_only = date '2026-08-18'
    and log.created_at - log.log_date
      between interval '-7 hours' and interval '-4 hours'
)
insert into public.biometric_clock_correction_audit(
  correction_key, entity_type, entity_id, user_id, attendance_date,
  original_values, corrected_values, reason
)
select
  'C269C422CF183228:2026-08-18:UTC_TO_IST_ROLLBACK_V1',
  'SMARTOFFICE_LOG', log.id, log.user_id, log.log_date_only,
  jsonb_build_object(
    'employee_code', log.employee_code,
    'log_datetime', log.log_datetime,
    'log_date', log.log_date,
    'log_date_only', log.log_date_only,
    'log_time', log.log_time
  ),
  jsonb_build_object(
    'log_datetime', to_char(
      (log.log_date - interval '5 hours 30 minutes') at time zone 'Asia/Kolkata',
      'YYYY-MM-DD HH24:MI:SS'
    ),
    'log_date', log.log_date - interval '5 hours 30 minutes',
    'log_date_only', (
      (log.log_date - interval '5 hours 30 minutes') at time zone 'Asia/Kolkata'
    )::date,
    'log_time', to_char(
      (log.log_date - interval '5 hours 30 minutes') at time zone 'Asia/Kolkata',
      'HH24:MI:SS'
    )
  ),
  'DEVICE_TIMEZONE_CORRECTED: Office 63 local IST time was interpreted as UTC.'
from candidates log
on conflict (correction_key, entity_type, entity_id) do nothing;

update public.smartoffice_device_logs log
set log_date = (audit.corrected_values->>'log_date')::timestamptz,
    log_date_only = (audit.corrected_values->>'log_date_only')::date,
    log_time = audit.corrected_values->>'log_time',
    log_datetime = audit.corrected_values->>'log_datetime'
from public.biometric_clock_correction_audit audit
where audit.correction_key = 'C269C422CF183228:2026-08-18:UTC_TO_IST_ROLLBACK_V1'
  and audit.entity_type = 'SMARTOFFICE_LOG'
  and audit.entity_id = log.id
  and log.log_date is distinct from (audit.corrected_values->>'log_date')::timestamptz;

-- Correct the corresponding raw-punch evidence only when it exactly matches
-- an audited SmartOffice log and would not collide with an existing punch.
insert into public.biometric_clock_correction_audit(
  correction_key, entity_type, entity_id, attendance_date,
  original_values, corrected_values, reason
)
select
  'C269C422CF183228:2026-08-18:UTC_TO_IST_ROLLBACK_V1',
  'RAW_PUNCH', punch.id, punch.attendance_date,
  jsonb_build_object(
    'punch_timestamp', punch.punch_timestamp,
    'attendance_date', punch.attendance_date
  ),
  jsonb_build_object(
    'punch_timestamp', punch.punch_timestamp - interval '5 hours 30 minutes',
    'attendance_date', (
      (punch.punch_timestamp - interval '5 hours 30 minutes') at time zone 'Asia/Kolkata'
    )::date
  ),
  'DEVICE_TIMEZONE_CORRECTED: Office 63 local IST time was interpreted as UTC.'
from public.biometric_device_punches punch
join public.biometric_clock_correction_audit log_audit
  on log_audit.correction_key = 'C269C422CF183228:2026-08-18:UTC_TO_IST_ROLLBACK_V1'
 and log_audit.entity_type = 'SMARTOFFICE_LOG'
 and punch.device_id = 'C269C422CF183228'
 and punch.biometric_employee_code = log_audit.original_values->>'employee_code'
 and punch.punch_timestamp = (log_audit.original_values->>'log_date')::timestamptz
where not exists (
  select 1
  from public.biometric_device_punches duplicate
  where duplicate.device_id = punch.device_id
    and duplicate.biometric_employee_code = punch.biometric_employee_code
    and duplicate.punch_timestamp = punch.punch_timestamp - interval '5 hours 30 minutes'
    and duplicate.source_event_id = punch.source_event_id
)
on conflict (correction_key, entity_type, entity_id) do nothing;

update public.biometric_device_punches punch
set punch_timestamp = (audit.corrected_values->>'punch_timestamp')::timestamptz,
    attendance_date = (audit.corrected_values->>'attendance_date')::date
from public.biometric_clock_correction_audit audit
where audit.correction_key = 'C269C422CF183228:2026-08-18:UTC_TO_IST_ROLLBACK_V1'
  and audit.entity_type = 'RAW_PUNCH'
  and audit.entity_id = punch.id
  and punch.punch_timestamp is distinct from
    (audit.corrected_values->>'punch_timestamp')::timestamptz;

-- Recalculate only biometric-authoritative attendance from the corrected
-- Office 63 logs. App-based check-ins and check-outs remain untouched.
with affected_users as (
  select distinct audit.user_id, (audit.corrected_values->>'log_date_only')::date attendance_date
  from public.biometric_clock_correction_audit audit
  where audit.correction_key = 'C269C422CF183228:2026-08-18:UTC_TO_IST_ROLLBACK_V1'
    and audit.entity_type = 'SMARTOFFICE_LOG'
    and audit.user_id is not null
), daily as (
  select log.user_id, log.log_date_only attendance_date,
    min(log.log_date) first_punch,
    max(log.log_date) last_punch,
    count(distinct log.log_date)::integer punch_count
  from public.smartoffice_device_logs log
  join affected_users affected
    on affected.user_id = log.user_id
   and affected.attendance_date = log.log_date_only
  group by log.user_id, log.log_date_only
)
update public.attendance_logs attendance
set checkin_time = daily.first_punch,
    biometric_first_punch = daily.first_punch,
    biometric_last_punch = daily.last_punch,
    biometric_punch_count = daily.punch_count,
    updated_at = now()
from daily
where attendance.user_id = daily.user_id
  and attendance.date = daily.attendance_date
  and upper(coalesce(attendance.checkin_source, '')) = 'BIOMETRIC'
  and (
    attendance.checkin_time is distinct from daily.first_punch
    or attendance.biometric_last_punch is distinct from daily.last_punch
    or attendance.biometric_punch_count is distinct from daily.punch_count
  );
