-- Atomic biometric imports with validation, batch history, and rollback.

alter table public.smartoffice_device_logs
  add column if not exists user_id uuid references public.profiles(id),
  add column if not exists log_datetime text,
  add column if not exists log_date_only date,
  add column if not exists log_time text,
  add column if not exists import_batch_id uuid;

create table if not exists public.biometric_import_batches (
  id uuid primary key,
  source text not null,
  status text not null check (status in ('APPLIED', 'FAILED', 'ROLLED_BACK')),
  requested_by uuid references public.profiles(id) on delete set null,
  row_count integer not null default 0,
  attendance_count integer not null default 0,
  payload_hash text,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.biometric_import_batch_items (
  batch_id uuid not null references public.biometric_import_batches(id)
    on delete cascade,
  user_id uuid not null references public.profiles(id),
  attendance_date date not null,
  attendance_id uuid,
  attendance_existed boolean not null,
  previous_state jsonb,
  primary key (batch_id, user_id, attendance_date)
);

alter table public.smartoffice_device_logs
  drop constraint if exists smartoffice_device_logs_import_batch_id_fkey;
alter table public.smartoffice_device_logs
  add constraint smartoffice_device_logs_import_batch_id_fkey
  foreign key (import_batch_id) references public.biometric_import_batches(id)
  on delete set null;

create unique index if not exists smartoffice_device_logs_import_identity_uidx
  on public.smartoffice_device_logs(
    lower(btrim(employee_code)),
    log_datetime,
    coalesce(serial_number, '')
  )
  where log_datetime is not null;

create unique index if not exists biometric_import_payload_uidx
  on public.biometric_import_batches(source, payload_hash)
  where payload_hash is not null and status <> 'FAILED';

alter table public.biometric_import_batches enable row level security;
alter table public.biometric_import_batch_items enable row level security;
revoke all on public.biometric_import_batches from anon, authenticated;
revoke all on public.biometric_import_batch_items from anon, authenticated;

create or replace function public.apply_biometric_import_batch(
  p_batch_id uuid,
  p_source text,
  p_payload_hash text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row_count integer;
  v_attendance_count integer := 0;
  v_created_count integer := 0;
  v_checkout_count integer := 0;
  v_group record;
  v_before public.attendance_logs%rowtype;
  v_result jsonb;
  v_existed boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_batch_id is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_BIOMETRIC_IMPORT_BATCH';
  end if;

  v_row_count := jsonb_array_length(p_rows);
  if v_row_count < 1 or v_row_count > 50000 then
    raise exception 'BIOMETRIC_IMPORT_ROW_LIMIT';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as r(
      user_id uuid, employee_code text, log_datetime text,
      log_date date, log_time text, punch_timestamp timestamptz,
      punch_direction text, serial_number text, temperature numeric
    )
    left join public.profiles p on p.id = r.user_id
    where r.user_id is null
       or nullif(btrim(r.employee_code), '') is null
       or r.log_date is null
       or r.punch_timestamp is null
       or p.id is null
       or not p.is_active
       or lower(btrim(coalesce(p.smartoffice_employee_code, '')))
            <> lower(btrim(r.employee_code))
       or (r.punch_timestamp at time zone 'Asia/Kolkata')::date <> r.log_date
  ) then
    raise exception 'BIOMETRIC_IMPORT_VALIDATION_FAILED';
  end if;

  insert into public.biometric_import_batches(
    id, source, status, row_count, payload_hash
  ) values (
    p_batch_id, left(coalesce(nullif(btrim(p_source), ''), 'UNKNOWN'), 80),
    'APPLIED', v_row_count, nullif(btrim(p_payload_hash), '')
  );

  insert into public.smartoffice_device_logs(
    user_id, employee_code, log_datetime, log_date, log_date_only, log_time,
    punch_direction, serial_number, temperature, import_batch_id
  )
  select
    r.user_id, btrim(r.employee_code), r.log_datetime, r.punch_timestamp,
    r.log_date, r.log_time,
    r.punch_direction, r.serial_number, r.temperature, p_batch_id
  from jsonb_to_recordset(p_rows) as r(
    user_id uuid, employee_code text, log_datetime text,
    log_date date, log_time text, punch_timestamp timestamptz,
    punch_direction text, serial_number text, temperature numeric
  )
  on conflict (
    lower(btrim(employee_code)), log_datetime, (coalesce(serial_number, ''))
  ) where log_datetime is not null
  do nothing;

  for v_group in
    select
      grouped.user_id,
      grouped.attendance_date,
      grouped.timestamps[1] as first_punch,
      grouped.timestamps[array_length(grouped.timestamps, 1)] as last_punch,
      array_length(grouped.timestamps, 1) as punch_count,
      (
        select min(candidate)
        from unnest(grouped.timestamps) candidate
        where candidate > grouped.timestamps[1]
          and (candidate at time zone 'Asia/Kolkata')::time
            >= time '18:30:00'
      ) as checkout_punch
    from (
      select
        r.user_id,
        r.log_date as attendance_date,
        array_agg(distinct r.punch_timestamp order by r.punch_timestamp)
          as timestamps
      from jsonb_to_recordset(p_rows) as r(
        user_id uuid, employee_code text, log_datetime text,
        log_date date, log_time text, punch_timestamp timestamptz,
        punch_direction text, serial_number text, temperature numeric
      )
      group by r.user_id, r.log_date
    ) grouped
  loop
    select * into v_before
    from public.attendance_logs
    where user_id = v_group.user_id and date = v_group.attendance_date
    for update;
    v_existed := found;

    insert into public.biometric_import_batch_items(
      batch_id, user_id, attendance_date, attendance_id,
      attendance_existed, previous_state
    ) values (
      p_batch_id, v_group.user_id, v_group.attendance_date,
      case when v_existed then v_before.id else null end,
      v_existed,
      case when v_existed then jsonb_build_object(
        'checkin_time', v_before.checkin_time,
        'checkin_source', v_before.checkin_source,
        'checkout_time', v_before.checkout_time,
        'checkout_source', v_before.checkout_source,
        'status', v_before.status,
        'attendance_status', v_before.attendance_status,
        'day_status', v_before.day_status,
        'attendance_type', v_before.attendance_type,
        'smartoffice_imported', v_before.smartoffice_imported,
        'biometric_first_punch', v_before.biometric_first_punch,
        'biometric_last_punch', v_before.biometric_last_punch,
        'biometric_punch_count', v_before.biometric_punch_count,
        'work_hours', v_before.work_hours
      ) else null end
    );

    select public.apply_biometric_daily_punches_v2(
      v_group.user_id, v_group.attendance_date, v_group.first_punch,
      v_group.last_punch, v_group.punch_count, v_group.checkout_punch
    ) into v_result;

    update public.biometric_import_batch_items
    set attendance_id = (v_result->>'attendance_id')::uuid
    where batch_id = p_batch_id
      and user_id = v_group.user_id
      and attendance_date = v_group.attendance_date;

    v_attendance_count := v_attendance_count + 1;
    if coalesce((v_result->>'created')::boolean, false) then
      v_created_count := v_created_count + 1;
    end if;
    if coalesce((v_result->>'checked_out')::boolean, false) then
      v_checkout_count := v_checkout_count + 1;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'rows', v_row_count,
    'attendance_days', v_attendance_count,
    'created', v_created_count,
    'checked_out', v_checkout_count
  );
  update public.biometric_import_batches
  set attendance_count = v_attendance_count,
      result = v_result,
      completed_at = now()
  where id = p_batch_id;
  return v_result;
end;
$$;

revoke all on function public.apply_biometric_import_batch(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_biometric_import_batch(
  uuid, text, text, jsonb
) to service_role;

create or replace function public.rollback_biometric_import_batch(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  perform 1 from public.biometric_import_batches
  where id = p_batch_id and status = 'APPLIED' for update;
  if not found then raise exception 'APPLIED_BIOMETRIC_BATCH_NOT_FOUND'; end if;
  perform set_config('app.suppress_attendance_outbox', 'true', true);

  for v_item in
    select * from public.biometric_import_batch_items
    where batch_id = p_batch_id
  loop
    delete from public.attendance_audit_logs audit
    using public.biometric_import_batches batch
    where batch.id = p_batch_id
      and audit.attendance_id = v_item.attendance_id
      and audit.source = 'BIOMETRIC'
      and audit.created_at >= batch.created_at;

    if not v_item.attendance_existed then
      delete from public.attendance_logs
      where id = v_item.attendance_id
        and upper(coalesce(attendance_type, '')) = 'BIOMETRIC';
    else
      update public.attendance_logs
      set checkin_time = (v_item.previous_state->>'checkin_time')::timestamptz,
          checkin_source = v_item.previous_state->>'checkin_source',
          checkout_time = (v_item.previous_state->>'checkout_time')::timestamptz,
          checkout_source = v_item.previous_state->>'checkout_source',
          status = v_item.previous_state->>'status',
          attendance_status = v_item.previous_state->>'attendance_status',
          day_status = v_item.previous_state->>'day_status',
          attendance_type = v_item.previous_state->>'attendance_type',
          smartoffice_imported =
            coalesce((v_item.previous_state->>'smartoffice_imported')::boolean, false),
          biometric_first_punch =
            (v_item.previous_state->>'biometric_first_punch')::timestamptz,
          biometric_last_punch =
            (v_item.previous_state->>'biometric_last_punch')::timestamptz,
          biometric_punch_count =
            (v_item.previous_state->>'biometric_punch_count')::integer,
          work_hours = (v_item.previous_state->>'work_hours')::numeric,
          updated_at = now()
      where id = v_item.attendance_id;
    end if;
  end loop;

  delete from public.smartoffice_device_logs where import_batch_id = p_batch_id;
  update public.biometric_import_batches
  set status = 'ROLLED_BACK', rolled_back_at = now()
  where id = p_batch_id;
  return jsonb_build_object('success', true, 'batch_id', p_batch_id);
end;
$$;

revoke all on function public.rollback_biometric_import_batch(uuid)
  from public, anon, authenticated;
grant execute on function public.rollback_biometric_import_batch(uuid)
  to service_role;
