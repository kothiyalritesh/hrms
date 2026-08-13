-- First-punch-only biometric attendance and an auditable unmapped-employee
-- administration contract. Raw punches remain immutable evidence; only the
-- earliest mapped punch can affect the daily attendance check-in.

create table if not exists public.biometric_attendance_correction_audit (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance_logs(id) on delete restrict,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  attendance_date date not null,
  old_checkin_time timestamptz not null,
  new_checkin_time timestamptz not null,
  first_biometric_punch timestamptz not null,
  correction_reason text not null,
  corrected_at timestamptz not null default now(),
  corrected_by uuid references public.profiles(id) on delete restrict,
  correction_source text not null check (correction_source in ('SYSTEM','ADMIN')),
  check (new_checkin_time <= old_checkin_time),
  unique(attendance_id, new_checkin_time, correction_reason)
);

create index if not exists biometric_correction_employee_date_idx
  on public.biometric_attendance_correction_audit(employee_id, attendance_date desc);

alter table public.biometric_attendance_correction_audit enable row level security;
drop policy if exists biometric_correction_admin_select
  on public.biometric_attendance_correction_audit;
create policy biometric_correction_admin_select
on public.biometric_attendance_correction_audit
for select to authenticated
using (public.is_profile_admin());
revoke insert, update, delete on public.biometric_attendance_correction_audit
  from anon, authenticated;
grant select on public.biometric_attendance_correction_audit to authenticated;

create or replace function public.record_biometric_checkin_correction(
  p_attendance_id uuid,
  p_employee_id uuid,
  p_attendance_date date,
  p_old_checkin timestamptz,
  p_new_checkin timestamptz,
  p_first_biometric_punch timestamptz,
  p_device_id text default null,
  p_actor uuid default null,
  p_source text default 'SYSTEM'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text := case when upper(coalesce(p_source, 'SYSTEM')) = 'ADMIN'
    then 'ADMIN' else 'SYSTEM' end;
begin
  if p_old_checkin is null or p_new_checkin is null
     or p_new_checkin >= p_old_checkin then
    return;
  end if;

  insert into public.biometric_attendance_correction_audit(
    attendance_id, employee_id, attendance_date,
    old_checkin_time, new_checkin_time, first_biometric_punch,
    correction_reason, corrected_by, correction_source
  ) values (
    p_attendance_id, p_employee_id, p_attendance_date,
    p_old_checkin, p_new_checkin, p_first_biometric_punch,
    'EARLIER_FIRST_BIOMETRIC_PUNCH', p_actor, v_source
  ) on conflict(attendance_id, new_checkin_time, correction_reason) do nothing;

  insert into public.hrms_audit_events(
    actor_user_id, target_user_id, action, entity_type, entity_id,
    old_values, new_values, source, device_id
  ) values (
    p_actor, p_employee_id, 'BIOMETRIC_CHECKIN_TIME_CORRECTED',
    'attendance', p_attendance_id,
    jsonb_build_object(
      'attendance_date', p_attendance_date,
      'checkin_time', p_old_checkin
    ),
    jsonb_build_object(
      'attendance_date', p_attendance_date,
      'checkin_time', p_new_checkin,
      'first_biometric_punch', p_first_biometric_punch,
      'reason', 'EARLIER_FIRST_BIOMETRIC_PUNCH'
    ),
    v_source, p_device_id
  );
end;
$$;

revoke all on function public.record_biometric_checkin_correction(
  uuid,uuid,date,timestamptz,timestamptz,timestamptz,text,uuid,text
) from public, anon, authenticated;

create or replace function public.process_biometric_punch(
  p_punch_id uuid,
  p_punch_timestamp timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_punch public.biometric_device_punches%rowtype;
  v_mapping public.employee_biometric_mappings%rowtype;
  v_attendance public.attendance_logs%rowtype;
  v_created boolean := false;
  v_corrected boolean := false;
  v_previous_checkin timestamptz;
  v_day_first timestamptz;
begin
  select * into v_punch
  from public.biometric_device_punches
  where id = p_punch_id and punch_timestamp = p_punch_timestamp
  for update;
  if not found then raise exception 'PUNCH_NOT_FOUND'; end if;

  if v_punch.processing_status in ('PROCESSED','RECONCILIATION_REQUIRED') then
    return jsonb_build_object(
      'success', true, 'idempotent', true,
      'status', v_punch.processing_status
    );
  end if;

  select * into v_mapping
  from public.employee_biometric_mappings
  where is_active
    and lower(btrim(biometric_employee_code)) =
        lower(btrim(v_punch.biometric_employee_code))
    and device_id in (v_punch.device_id, '*')
  order by (device_id = v_punch.device_id) desc, mapped_at desc
  limit 1;

  if not found or not exists (
    select 1 from public.profiles
    where id = v_mapping.user_id and is_active
  ) then
    update public.biometric_device_punches
    set processing_status = 'UNMAPPED',
        last_error = 'ACTIVE_MAPPING_REQUIRED'
    where id = p_punch_id and punch_timestamp = p_punch_timestamp;

    insert into public.biometric_reconciliation_queue(
      punch_id, punch_timestamp, device_id, biometric_employee_code, reason
    ) values (
      p_punch_id, p_punch_timestamp, v_punch.device_id,
      v_punch.biometric_employee_code, 'UNMAPPED_CODE'
    ) on conflict(punch_id, punch_timestamp) do nothing;

    return jsonb_build_object('success', true, 'status', 'UNMAPPED');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_mapping.user_id::text || ':' || v_punch.attendance_date::text, 0
    )
  );

  select min(p.punch_timestamp) into v_day_first
  from public.biometric_device_punches p
  join lateral (
    select m.user_id
    from public.employee_biometric_mappings m
    where m.is_active
      and m.user_id = v_mapping.user_id
      and lower(btrim(m.biometric_employee_code)) =
          lower(btrim(p.biometric_employee_code))
      and m.device_id in (p.device_id, '*')
    order by (m.device_id = p.device_id) desc, m.mapped_at desc
    limit 1
  ) resolved on true
  where p.attendance_date = v_punch.attendance_date;

  select * into v_attendance
  from public.attendance_logs
  where user_id = v_mapping.user_id and date = v_punch.attendance_date
  for update;

  if not found then
    insert into public.attendance_logs(
      user_id, date, checkin_time, checkin_source, checkout_time,
      status, attendance_state, attendance_status, day_status,
      attendance_type, biometric_first_punch,
      biometric_last_punch, biometric_punch_count, smartoffice_imported
    ) values (
      v_mapping.user_id, v_punch.attendance_date, v_day_first, 'BIOMETRIC', null,
      'CHECKED_IN', 'WORKING', 'PRESENT', 'P',
      'BIOMETRIC', v_day_first, null, 1, true
    ) returning * into v_attendance;
    v_created := true;
  else
    v_previous_checkin := v_attendance.checkin_time;
    update public.attendance_logs
    set checkin_time = least(coalesce(checkin_time, v_day_first), v_day_first),
        checkin_source = case
          when checkin_time is null or v_day_first < checkin_time
            then 'BIOMETRIC'
          else checkin_source
        end,
        status = case
          when checkin_time is null and checkout_time is null
            then 'CHECKED_IN'
          else status
        end,
        attendance_state = case
          when checkout_time is not null then 'CHECKED_OUT'
          when checkin_time is null then 'WORKING'
          else attendance_state
        end,
        attendance_status = coalesce(attendance_status, 'PRESENT'),
        day_status = coalesce(day_status, 'P'),
        attendance_type = coalesce(attendance_type, 'BIOMETRIC'),
        biometric_first_punch = least(
          coalesce(biometric_first_punch, v_day_first), v_day_first
        ),
        -- Later machine punches remain only in biometric_device_punches.
        biometric_last_punch = null,
        biometric_punch_count = 1,
        smartoffice_imported = true,
        work_hours = case
          when checkout_time is null then work_hours
          else greatest(
            0,
            round(
              extract(epoch from (
                checkout_time - least(coalesce(checkin_time, v_day_first), v_day_first)
              ))::numeric / 3600,
              2
            )
          )
        end,
        updated_at = now()
    where id = v_attendance.id
    returning * into v_attendance;

    v_corrected := v_previous_checkin is not null
      and v_attendance.checkin_time < v_previous_checkin;
    if v_corrected then
      perform public.record_biometric_checkin_correction(
        v_attendance.id, v_mapping.user_id, v_punch.attendance_date,
        v_previous_checkin, v_attendance.checkin_time, v_day_first,
        v_punch.device_id, null, 'SYSTEM'
      );
    end if;
  end if;

  update public.biometric_device_punches
  set processing_status = case
        when v_attendance.checkout_time is null then 'PROCESSED'
        else 'RECONCILIATION_REQUIRED'
      end,
      processed_at = now(),
      last_error = null
  where id = p_punch_id and punch_timestamp = p_punch_timestamp;

  if v_attendance.checkout_time is not null then
    insert into public.biometric_reconciliation_queue(
      punch_id, punch_timestamp, device_id, biometric_employee_code,
      reason, assigned_user_id
    ) values (
      p_punch_id, p_punch_timestamp, v_punch.device_id,
      v_punch.biometric_employee_code, 'PUNCH_AFTER_GOING_HOME',
      v_mapping.user_id
    ) on conflict(punch_id, punch_timestamp) do nothing;
  end if;

  insert into public.hrms_audit_events(
    target_user_id, action, entity_type, entity_id,
    new_values, source, device_id
  ) values (
    v_mapping.user_id,
    case
      when v_created then 'AUTOMATIC_BIOMETRIC_CHECKIN'
      else 'BIOMETRIC_PUNCH_PROCESSED'
    end,
    'attendance', v_attendance.id,
    jsonb_build_object(
      'attendance_date', v_punch.attendance_date,
      'punch_timestamp', v_punch.punch_timestamp,
      'first_biometric_punch', v_day_first,
      'checkin_corrected', v_corrected,
      'attendance_state_changed', v_created
    ),
    'BIOMETRIC', v_punch.device_id
  );

  if v_created then
    begin
      insert into public.notifications(
        user_id, title, message, type, event_key
      ) values (
        v_mapping.user_id,
        'Biometric check-in recorded',
        'Your first valid biometric punch was recorded as today''s attendance check-in.',
        'biometric_checkin',
        'biometric-checkin:' || v_mapping.user_id || ':' || v_punch.attendance_date
      ) on conflict(event_key) where event_key is not null do nothing;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', case when v_attendance.checkout_time is null
      then 'PROCESSED' else 'RECONCILIATION_REQUIRED' end,
    'created_attendance', v_created,
    'checkin_corrected', v_corrected,
    'attendance_id', v_attendance.id,
    'checkin_time', v_attendance.checkin_time,
    'biometric_first_punch', v_attendance.biometric_first_punch,
    'checkout_preserved', v_attendance.checkout_time is not null
  );
end;
$$;

create or replace function public.apply_biometric_daily_punches_v2(
  p_user_id uuid,
  p_attendance_date date,
  p_first_punch timestamptz,
  p_last_punch timestamptz,
  p_punch_count integer,
  p_checkout_punch timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attendance public.attendance_logs%rowtype;
  v_created boolean := false;
  v_corrected boolean := false;
  v_previous_checkin timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_user_id is null or p_attendance_date is null or p_first_punch is null
     or p_last_punch is null or coalesce(p_punch_count, 0) < 1
     or p_last_punch < p_first_punch
     or (p_first_punch at time zone 'Asia/Kolkata')::date <> p_attendance_date
  then
    raise exception 'INVALID_BIOMETRIC_DAILY_PUNCHES';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_user_id and is_active
  ) then
    raise exception 'ACTIVE_MAPPED_EMPLOYEE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_attendance_date::text, 0)
  );
  select * into v_attendance
  from public.attendance_logs
  where user_id = p_user_id and date = p_attendance_date
  for update;

  if not found then
    insert into public.attendance_logs(
      user_id, date, checkin_time, checkin_source, checkout_time,
      status, attendance_state, attendance_status, day_status,
      attendance_type, smartoffice_imported, biometric_first_punch,
      biometric_last_punch, biometric_punch_count
    ) values (
      p_user_id, p_attendance_date, p_first_punch, 'BIOMETRIC', null,
      'CHECKED_IN', 'WORKING', 'PRESENT', 'P',
      'BIOMETRIC', true, p_first_punch, null, 1
    ) returning * into v_attendance;
    v_created := true;
  else
    v_previous_checkin := v_attendance.checkin_time;
    update public.attendance_logs
    set checkin_time = least(coalesce(checkin_time, p_first_punch), p_first_punch),
        checkin_source = case
          when checkin_time is null or p_first_punch < checkin_time
            then 'BIOMETRIC'
          else checkin_source
        end,
        status = case
          when checkin_time is null and checkout_time is null
            then 'CHECKED_IN'
          else status
        end,
        attendance_state = case
          when checkout_time is not null then 'CHECKED_OUT'
          when checkin_time is null then 'WORKING'
          else attendance_state
        end,
        attendance_status = coalesce(attendance_status, 'PRESENT'),
        day_status = coalesce(day_status, 'P'),
        attendance_type = coalesce(attendance_type, 'BIOMETRIC'),
        smartoffice_imported = true,
        biometric_first_punch = least(
          coalesce(biometric_first_punch, p_first_punch), p_first_punch
        ),
        biometric_last_punch = null,
        biometric_punch_count = 1,
        work_hours = case
          when checkout_time is null then work_hours
          else greatest(
            0,
            round(
              extract(epoch from (
                checkout_time - least(coalesce(checkin_time, p_first_punch), p_first_punch)
              ))::numeric / 3600,
              2
            )
          )
        end,
        updated_at = now()
    where id = v_attendance.id
    returning * into v_attendance;

    v_corrected := v_previous_checkin is not null
      and v_attendance.checkin_time < v_previous_checkin;
    if v_corrected then
      perform public.record_biometric_checkin_correction(
        v_attendance.id, p_user_id, p_attendance_date,
        v_previous_checkin, v_attendance.checkin_time, p_first_punch,
        null, null, 'SYSTEM'
      );
    end if;
  end if;

  if v_created then
    insert into public.hrms_audit_events(
      target_user_id, action, entity_type, entity_id, new_values, source
    ) values (
      p_user_id, 'AUTOMATIC_BIOMETRIC_CHECKIN', 'attendance', v_attendance.id,
      jsonb_build_object(
        'attendance_date', p_attendance_date,
        'checkin_time', v_attendance.checkin_time,
        'first_biometric_punch', p_first_punch
      ),
      'BIOMETRIC'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'attendance_id', v_attendance.id,
    'created', v_created,
    'checkin_updated', v_created or v_corrected,
    'checkin_corrected', v_corrected,
    'checkin_time', v_attendance.checkin_time,
    'checkout_time', v_attendance.checkout_time,
    'checked_out', false,
    'checkout_preserved', v_attendance.checkout_time is not null,
    'biometric_first_punch', v_attendance.biometric_first_punch,
    'biometric_last_punch', null,
    'biometric_punch_count', 1
  );
end;
$$;

revoke all on function public.apply_biometric_daily_punches_v2(
  uuid,date,timestamptz,timestamptz,integer,timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_biometric_daily_punches_v2(
  uuid,date,timestamptz,timestamptz,integer,timestamptz
) to service_role;

create or replace function public.correct_attendance_checkins_to_first_biometric(
  p_from_date date default null,
  p_to_date date default null,
  p_actor uuid default null,
  p_source text default 'SYSTEM'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_updated integer := 0;
  v_source text := case when upper(coalesce(p_source, 'SYSTEM')) = 'ADMIN'
    then 'ADMIN' else 'SYSTEM' end;
begin
  if current_user not in ('postgres','supabase_admin')
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_profile_admin() then
    raise exception 'BIOMETRIC_CORRECTION_PERMISSION_REQUIRED';
  end if;
  if p_from_date is not null and p_to_date is not null
     and p_from_date > p_to_date then
    raise exception 'INVALID_CORRECTION_DATE_RANGE';
  end if;

  for v_row in
    with resolved_punches as (
      select
        mapping.user_id,
        punch.attendance_date,
        min(punch.punch_timestamp) as first_punch
      from public.biometric_device_punches punch
      join lateral (
        select candidate.user_id
        from public.employee_biometric_mappings candidate
        join public.profiles profile
          on profile.id = candidate.user_id and profile.is_active
        where candidate.is_active
          and lower(btrim(candidate.biometric_employee_code)) =
              lower(btrim(punch.biometric_employee_code))
          and candidate.device_id in (punch.device_id, '*')
        order by (candidate.device_id = punch.device_id) desc,
                 candidate.mapped_at desc
        limit 1
      ) mapping on true
      where (p_from_date is null or punch.attendance_date >= p_from_date)
        and (p_to_date is null or punch.attendance_date <= p_to_date)
      group by mapping.user_id, punch.attendance_date
    )
    select attendance.*, resolved.first_punch
    from public.attendance_logs attendance
    join resolved_punches resolved
      on resolved.user_id = attendance.user_id
     and resolved.attendance_date = attendance.date
    where attendance.checkin_time is not null
      and resolved.first_punch < attendance.checkin_time
    order by attendance.date, attendance.id
    for update of attendance
  loop
    update public.attendance_logs
    set checkin_time = v_row.first_punch,
        checkin_source = 'BIOMETRIC',
        biometric_first_punch = least(
          coalesce(biometric_first_punch, v_row.first_punch), v_row.first_punch
        ),
        biometric_last_punch = null,
        biometric_punch_count = 1,
        smartoffice_imported = true,
        work_hours = case
          when checkout_time is null then work_hours
          else greatest(
            0,
            round(
              extract(epoch from (checkout_time - v_row.first_punch))::numeric / 3600,
              2
            )
          )
        end,
        updated_at = now()
    where id = v_row.id;

    perform public.record_biometric_checkin_correction(
      v_row.id, v_row.user_id, v_row.date,
      v_row.checkin_time, v_row.first_punch, v_row.first_punch,
      null, p_actor, v_source
    );
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'corrected', v_updated,
    'from_date', p_from_date,
    'to_date', p_to_date,
    'transaction_status', 'COMMITTED'
  );
end;
$$;

revoke all on function public.correct_attendance_checkins_to_first_biometric(
  date,date,uuid,text
) from public, anon, authenticated;
grant execute on function public.correct_attendance_checkins_to_first_biometric(
  date,date,uuid,text
) to service_role;

create or replace function public.rpc_admin_correct_biometric_checkins(
  p_from_date date default null,
  p_to_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_profile_admin();
  return public.correct_attendance_checkins_to_first_biometric(
    p_from_date, p_to_date, auth.uid(), 'ADMIN'
  );
end;
$$;

revoke all on function public.rpc_admin_correct_biometric_checkins(date,date)
  from public, anon;
grant execute on function public.rpc_admin_correct_biometric_checkins(date,date)
  to authenticated;

create or replace function public.rpc_list_unmapped_biometric_employees()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  perform public.require_profile_admin();

  with machine_codes as (
    select
      punch.device_id,
      min(btrim(punch.biometric_employee_code)) as employee_code,
      count(*) as punch_count,
      min(punch.punch_timestamp) as first_seen,
      max(punch.punch_timestamp) as last_seen
    from public.biometric_device_punches punch
    where nullif(btrim(punch.biometric_employee_code), '') is not null
    group by punch.device_id, lower(btrim(punch.biometric_employee_code))
  ), classified as (
    select
      machine.*,
      mapped.user_id as mapped_user_id,
      mapped.employee_name_snapshot,
      mapped.profile_active as mapped_profile_active,
      mapped.profile_name as mapped_profile_name,
      mapped.employee_number as mapped_employee_number,
      mapped.office_name as mapped_office_name,
      mapped.team as mapped_team,
      coalesce(conflicts.mapping_user_count, 0) as mapping_user_count,
      coalesce(candidates.candidate_count, 0) as candidate_count,
      candidates.suggested_user_id,
      candidates.suggested_user_name,
      candidates.suggested_employee_number,
      candidates.suggested_office_name,
      candidates.suggested_team,
      candidates.suggested_existing_code
    from machine_codes machine
    left join lateral (
      select
        mapping.user_id,
        mapping.employee_name_snapshot,
        profile.is_active as profile_active,
        profile.name as profile_name,
        profile.employee_number,
        office.name as office_name,
        profile.team
      from public.employee_biometric_mappings mapping
      join public.profiles profile on profile.id = mapping.user_id
      left join public.offices office on office.id = profile.office_id
      where mapping.is_active
        and lower(btrim(mapping.biometric_employee_code)) =
            lower(btrim(machine.employee_code))
        and mapping.device_id in (machine.device_id, '*')
      order by (mapping.device_id = machine.device_id) desc,
               mapping.mapped_at desc
      limit 1
    ) mapped on true
    left join lateral (
      select count(distinct mapping.user_id) as mapping_user_count
      from public.employee_biometric_mappings mapping
      where mapping.is_active
        and lower(btrim(mapping.biometric_employee_code)) =
            lower(btrim(machine.employee_code))
        and mapping.device_id in (machine.device_id, '*')
    ) conflicts on true
    left join lateral (
      select
        count(*) as candidate_count,
        (array_agg(profile.id order by profile.is_active desc, profile.name, profile.id))[1]
          as suggested_user_id,
        (array_agg(profile.name order by profile.is_active desc, profile.name, profile.id))[1]
          as suggested_user_name,
        (array_agg(profile.employee_number order by profile.is_active desc, profile.name, profile.id))[1]
          as suggested_employee_number,
        (array_agg(office.name order by profile.is_active desc, profile.name, profile.id))[1]
          as suggested_office_name,
        (array_agg(profile.team order by profile.is_active desc, profile.name, profile.id))[1]
          as suggested_team,
        (array_agg(profile.smartoffice_employee_code order by profile.is_active desc, profile.name, profile.id))[1]
          as suggested_existing_code
      from public.profiles profile
      left join public.offices office on office.id = profile.office_id
      where nullif(btrim(profile.employee_number), '') is not null
        and lower(btrim(profile.employee_number)) = lower(btrim(machine.employee_code))
    ) candidates on true
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'device_id', row.device_id,
        'employee_code', row.employee_code,
        'employee_name', coalesce(
          row.mapped_profile_name, row.employee_name_snapshot
        ),
        'punch_count', row.punch_count,
        'first_seen', row.first_seen,
        'last_seen', row.last_seen,
        'mapped_user_id', row.mapped_user_id,
        'mapped_user_name', row.mapped_profile_name,
        'suggested_user_id', case
          when row.mapped_user_id is not null then row.mapped_user_id
          when row.candidate_count = 1 then row.suggested_user_id
          else null
        end,
        'suggested_user_name', case
          when row.mapped_user_id is not null then row.mapped_profile_name
          when row.candidate_count = 1 then row.suggested_user_name
          else null
        end,
        'hrms_employee_id', case
          when row.mapped_user_id is not null then row.mapped_user_id
          when row.candidate_count = 1 then row.suggested_user_id
          else null
        end,
        'employee_number', coalesce(
          row.mapped_employee_number,
          case when row.candidate_count = 1 then row.suggested_employee_number end
        ),
        'office_name', coalesce(
          row.mapped_office_name,
          case when row.candidate_count = 1 then row.suggested_office_name end
        ),
        'team', coalesce(
          row.mapped_team,
          case when row.candidate_count = 1 then row.suggested_team end
        ),
        'suggestion_method', case
          when row.mapped_user_id is not null then 'EXISTING_BIOMETRIC_ID'
          when row.candidate_count = 1 then 'HRMS_EMPLOYEE_NUMBER'
          else null
        end,
        'mapping_status', case
          when row.mapping_user_count > 1 then 'CONFLICT'
          when row.mapped_user_id is not null and row.mapped_profile_active then 'LINKED'
          when row.mapped_user_id is not null then 'UNMAPPED'
          when row.candidate_count = 1 then 'SUGGESTED'
          else 'UNMAPPED'
        end,
        'unmapped_reason', case
          when row.mapping_user_count > 1 then 'DUPLICATE_BIOMETRIC_ID'
          when row.mapped_user_id is not null and not row.mapped_profile_active
            then 'EMPLOYEE_INACTIVE'
          when row.mapped_user_id is not null and row.mapped_profile_active then null
          when row.candidate_count > 1 then 'MORE_THAN_ONE_POSSIBLE_EMPLOYEE'
          when row.candidate_count = 1 and row.suggested_existing_code is null
            then 'HRMS_EMPLOYEE_DOES_NOT_HAVE_BIOMETRIC_ID'
          when row.candidate_count = 1 then 'EMPLOYEE_DETAILS_DO_NOT_MATCH'
          else 'BIOMETRIC_ID_NOT_AVAILABLE_IN_HRMS'
        end
      ) order by
        case
          when row.mapped_user_id is not null and row.mapped_profile_active then 1
          else 0
        end,
        row.last_seen desc,
        row.employee_code
    ),
    '[]'::jsonb
  ) into v_rows
  from classified row;

  return jsonb_build_object(
    'success', true,
    'employees', v_rows,
    'matching_priority', jsonb_build_array(
      'EXISTING_BIOMETRIC_ID',
      'HRMS_EMPLOYEE_NUMBER',
      'VERIFIED_OFFICIAL_EMAIL',
      'VERIFIED_PHONE',
      'MANUAL_ADMIN_SELECTION'
    ),
    'name_only_matching_disabled', true,
    'device_directory_fields_available', jsonb_build_array(
      'device_id', 'employee_code', 'punch_timestamp'
    )
  );
end;
$$;

revoke all on function public.rpc_list_unmapped_biometric_employees()
  from public, anon;
grant execute on function public.rpc_list_unmapped_biometric_employees()
  to authenticated;

-- Correct historical rows once. Re-running this migration/function is safe:
-- only rows whose stored check-in is later than the first raw punch are touched.
select public.correct_attendance_checkins_to_first_biometric(
  null, null, null, 'SYSTEM'
);

-- Daily attendance stores only the attendance-contributing first machine
-- punch. Every later punch remains available in the partitioned raw table.
update public.attendance_logs
set biometric_last_punch = null,
    biometric_punch_count = 1,
    updated_at = now()
where biometric_first_punch is not null
  and (
    biometric_last_punch is not null
    or biometric_punch_count is distinct from 1
  );

notify pgrst, 'reload schema';
