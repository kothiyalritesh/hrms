-- SmartOffice normally returns India wall-clock timestamps without an offset.
-- On 2026-08-17 device C269C422CF183228 began returning UTC wall-clock values
-- while the remaining devices continued returning Asia/Kolkata. Keep the
-- interpretation explicit per device and repair the affected punches once.

create table if not exists public.biometric_device_clock_settings (
  device_id text not null,
  source_timezone text not null
    check (source_timezone in ('Asia/Kolkata', 'UTC')),
  effective_from date not null,
  effective_to date,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (device_id, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);

alter table public.biometric_device_clock_settings enable row level security;
revoke all on table public.biometric_device_clock_settings
  from public, anon, authenticated;
grant select on table public.biometric_device_clock_settings to service_role;

insert into public.biometric_device_clock_settings(
  device_id, source_timezone, effective_from, reason
) values (
  'C269C422CF183228', 'UTC', date '2026-08-17',
  'Device wall clock changed from Asia/Kolkata to UTC; normalize at ingestion.'
)
on conflict (device_id, effective_from) do update
set source_timezone = excluded.source_timezone,
    reason = excluded.reason,
    updated_at = now();

create table if not exists public.biometric_clock_correction_audit (
  id uuid primary key default gen_random_uuid(),
  correction_key text not null,
  entity_type text not null
    check (entity_type in ('SMARTOFFICE_LOG', 'RAW_PUNCH', 'ATTENDANCE')),
  entity_id uuid not null,
  user_id uuid references public.profiles(id) on delete set null,
  attendance_date date,
  original_values jsonb not null,
  corrected_values jsonb not null,
  reason text not null,
  corrected_at timestamptz not null default now(),
  unique (correction_key, entity_type, entity_id)
);

alter table public.biometric_clock_correction_audit enable row level security;
revoke all on table public.biometric_clock_correction_audit
  from public, anon, authenticated;
grant select on table public.biometric_clock_correction_audit to service_role;

create or replace function public.repair_biometric_device_clock(
  p_device_id text,
  p_attendance_date date,
  p_offset interval,
  p_correction_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_logs integer := 0;
  v_raw_punches integer := 0;
  v_attendance integer := 0;
begin
  if nullif(btrim(p_device_id), '') is null
     or p_attendance_date is null
     or p_offset is null
     or nullif(btrim(p_correction_key), '') is null then
    raise exception 'INVALID_DEVICE_CLOCK_CORRECTION';
  end if;

  -- Record the original values before changing any imported display fields.
  insert into public.biometric_clock_correction_audit(
    correction_key, entity_type, entity_id, user_id, attendance_date,
    original_values, corrected_values, reason
  )
  select p_correction_key, 'SMARTOFFICE_LOG', log.id, log.user_id,
    log.log_date_only,
    jsonb_build_object(
      'log_datetime', log.log_datetime,
      'log_date', log.log_date,
      'log_date_only', log.log_date_only,
      'log_time', log.log_time
    ),
    jsonb_build_object(
      'log_datetime', to_char(
        (log.log_date + p_offset) at time zone 'Asia/Kolkata',
        'YYYY-MM-DD HH24:MI:SS'
      ),
      'log_date', log.log_date + p_offset,
      'log_date_only', (
        (log.log_date + p_offset) at time zone 'Asia/Kolkata'
      )::date,
      'log_time', to_char(
        (log.log_date + p_offset) at time zone 'Asia/Kolkata',
        'HH24:MI:SS'
      )
    ),
    'DEVICE_TIMEZONE_CORRECTED: device emitted UTC wall-clock values without an offset.'
  from public.smartoffice_device_logs log
  where log.serial_number = p_device_id
    and log.log_date_only = p_attendance_date
    -- Correct only the legacy interpretation. Newly normalized rows arrive
    -- close to their absolute punch time and must never receive the offset twice.
    and extract(epoch from (log.created_at - log.log_date)) / 60 >= 300
    and not exists (
      select 1 from public.biometric_clock_correction_audit audit
      where audit.correction_key = p_correction_key
        and audit.entity_type = 'SMARTOFFICE_LOG'
        and audit.entity_id = log.id
    )
  on conflict (correction_key, entity_type, entity_id) do nothing;

  update public.smartoffice_device_logs log
  set log_date = (audit.corrected_values->>'log_date')::timestamptz,
      log_date_only = (audit.corrected_values->>'log_date_only')::date,
      log_time = audit.corrected_values->>'log_time',
      log_datetime = audit.corrected_values->>'log_datetime'
  from public.biometric_clock_correction_audit audit
  where audit.correction_key = p_correction_key
    and audit.entity_type = 'SMARTOFFICE_LOG'
    and audit.entity_id = log.id
    and log.log_date is distinct from
      (audit.corrected_values->>'log_date')::timestamptz;
  get diagnostics v_logs = row_count;

  insert into public.biometric_clock_correction_audit(
    correction_key, entity_type, entity_id, attendance_date,
    original_values, corrected_values, reason
  )
  select p_correction_key, 'RAW_PUNCH', punch.id, punch.attendance_date,
    jsonb_build_object(
      'punch_timestamp', punch.punch_timestamp,
      'attendance_date', punch.attendance_date
    ),
    jsonb_build_object(
      'punch_timestamp', punch.punch_timestamp + p_offset,
      'attendance_date', (
        (punch.punch_timestamp + p_offset) at time zone 'Asia/Kolkata'
      )::date
    ),
    'DEVICE_TIMEZONE_CORRECTED: device emitted UTC wall-clock values without an offset.'
  from public.biometric_device_punches punch
  where punch.device_id = p_device_id
    and punch.attendance_date = p_attendance_date
    and not exists (
      select 1 from public.biometric_clock_correction_audit audit
      where audit.correction_key = p_correction_key
        and audit.entity_type = 'RAW_PUNCH'
        and audit.entity_id = punch.id
    )
  on conflict (correction_key, entity_type, entity_id) do nothing;

  update public.biometric_device_punches punch
  set punch_timestamp =
        (audit.corrected_values->>'punch_timestamp')::timestamptz,
      attendance_date =
        (audit.corrected_values->>'attendance_date')::date
  from public.biometric_clock_correction_audit audit
  where audit.correction_key = p_correction_key
    and audit.entity_type = 'RAW_PUNCH'
    and audit.entity_id = punch.id
    and punch.punch_timestamp is distinct from
      (audit.corrected_values->>'punch_timestamp')::timestamptz;
  get diagnostics v_raw_punches = row_count;

  -- Snapshot and recompute only biometric-authoritative attendance belonging
  -- to employees whose mapped SmartOffice rows were corrected above.
  with affected_users as (
    select distinct audit.user_id, audit.attendance_date
    from public.biometric_clock_correction_audit audit
    where audit.correction_key = p_correction_key
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
  insert into public.biometric_clock_correction_audit(
    correction_key, entity_type, entity_id, user_id, attendance_date,
    original_values, corrected_values, reason
  )
  select p_correction_key, 'ATTENDANCE', attendance.id,
    attendance.user_id, attendance.date,
    jsonb_build_object(
      'checkin_time', attendance.checkin_time,
      'biometric_first_punch', attendance.biometric_first_punch,
      'biometric_last_punch', attendance.biometric_last_punch,
      'biometric_punch_count', attendance.biometric_punch_count,
      'is_late', attendance.is_late
    ),
    jsonb_build_object(
      'checkin_time', daily.first_punch,
      'biometric_first_punch', daily.first_punch,
      'biometric_last_punch', daily.last_punch,
      'biometric_punch_count', daily.punch_count
    ),
    'DEVICE_TIMEZONE_CORRECTED: attendance recomputed from normalized punches.'
  from daily
  join public.attendance_logs attendance
    on attendance.user_id = daily.user_id
   and attendance.date = daily.attendance_date
  where upper(coalesce(attendance.checkin_source, '')) = 'BIOMETRIC'
    and attendance.checkin_time is distinct from daily.first_punch
  on conflict (correction_key, entity_type, entity_id) do nothing;

  update public.attendance_logs attendance
  set checkin_time =
        (audit.corrected_values->>'checkin_time')::timestamptz,
      biometric_first_punch =
        (audit.corrected_values->>'biometric_first_punch')::timestamptz,
      biometric_last_punch =
        (audit.corrected_values->>'biometric_last_punch')::timestamptz,
      biometric_punch_count =
        (audit.corrected_values->>'biometric_punch_count')::integer,
      updated_at = now()
  from public.biometric_clock_correction_audit audit
  where audit.correction_key = p_correction_key
    and audit.entity_type = 'ATTENDANCE'
    and audit.entity_id = attendance.id
    and attendance.checkin_time is distinct from
      (audit.corrected_values->>'checkin_time')::timestamptz;
  get diagnostics v_attendance = row_count;

  return jsonb_build_object(
    'success', true,
    'device_id', p_device_id,
    'attendance_date', p_attendance_date,
    'smartoffice_logs_corrected', v_logs,
    'raw_punches_corrected', v_raw_punches,
    'attendance_rows_corrected', v_attendance
  );
end
$$;

revoke all on function public.repair_biometric_device_clock(
  text, date, interval, text
) from public, anon, authenticated, service_role;

select public.repair_biometric_device_clock(
  'C269C422CF183228',
  date '2026-08-17',
  interval '5 hours 30 minutes',
  'C269C422CF183228:2026-08-17:UTC_TO_IST_V1'
);
