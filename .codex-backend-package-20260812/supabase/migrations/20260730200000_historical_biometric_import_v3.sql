-- Bounded, identity-confirmed biometric import.
-- Former employees remain importable only inside their employment dates.

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
  if v_row_count < 1 or v_row_count > 5000 then
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
       or lower(btrim(coalesce(p.smartoffice_employee_code, '')))
            <> lower(btrim(r.employee_code))
       or (r.punch_timestamp at time zone 'Asia/Kolkata')::date <> r.log_date
       -- Today is valid for the protected live sync; only future punches fail.
       or r.log_date > (now() at time zone 'Asia/Kolkata')::date
       or r.log_date < coalesce(
            p.joining_date,
            (p.created_at at time zone 'Asia/Kolkata')::date
          )
       or (
         p.last_working_date is not null
         and r.log_date > p.last_working_date
       )
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
          and (candidate at time zone 'Asia/Kolkata')::time >= time '18:30:00'
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

create or replace function public.apply_biometric_import_batch_v3(
  p_batch_id uuid,
  p_source text,
  p_source_file_hash text,
  p_requested_by uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.biometric_import_batches%rowtype;
  v_result jsonb;
  v_submitted integer;
  v_inserted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_batch_id is null
     or p_requested_by is null
     or p_source_file_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_BIOMETRIC_IMPORT_IDEMPOTENCY';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_requested_by
      and is_active
      and upper(coalesce(role, '')) in (
        'SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD'
      )
  ) then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;

  v_submitted := jsonb_array_length(p_rows);
  if v_submitted < 1 or v_submitted > 5000 then
    raise exception 'BIOMETRIC_IMPORT_ROW_LIMIT';
  end if;

  select * into v_existing
  from public.biometric_import_batches
  where id = p_batch_id;
  if found then
    if v_existing.payload_hash <> p_source_file_hash
       or v_existing.source <> left(p_source, 80)
       or v_existing.requested_by is distinct from p_requested_by then
      raise exception 'BIOMETRIC_BATCH_ID_CONFLICT';
    end if;
    if v_existing.status = 'APPLIED' then
      return v_existing.result || jsonb_build_object(
        'success', true,
        'transaction_status', 'COMMITTED',
        'idempotent_replay', true,
        'batch_id', v_existing.id,
        'source_file_hash', v_existing.payload_hash
      );
    end if;
    raise exception 'BIOMETRIC_BATCH_NOT_RETRYABLE';
  end if;

  select * into v_existing
  from public.biometric_import_batches
  where source = left(p_source, 80)
    and payload_hash = p_source_file_hash
    and requested_by = p_requested_by
    and status = 'APPLIED'
  order by created_at desc
  limit 1;
  if found then
    raise exception 'BIOMETRIC_SOURCE_FILE_ALREADY_APPLIED:%', v_existing.id;
  end if;

  v_result := public.apply_biometric_import_batch(
    p_batch_id, p_source, p_source_file_hash, p_rows
  );
  update public.biometric_import_batches
  set requested_by = p_requested_by
  where id = p_batch_id;

  select count(*) into v_inserted
  from public.smartoffice_device_logs
  where import_batch_id = p_batch_id;

  v_result := v_result || jsonb_build_object(
    'success', true,
    'transaction_status', 'COMMITTED',
    'batch_id', p_batch_id,
    'source_file_hash', p_source_file_hash,
    'submitted_punches', v_submitted,
    'inserted_punches', v_inserted,
    'duplicate_punches', v_submitted - v_inserted,
    'rejected_punches', 0,
    'idempotent_replay', false
  );
  update public.biometric_import_batches
  set result = v_result
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

revoke all on function public.apply_biometric_import_batch_v3(
  uuid, text, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_biometric_import_batch_v3(
  uuid, text, text, uuid, jsonb
) to service_role;

notify pgrst, 'reload schema';
