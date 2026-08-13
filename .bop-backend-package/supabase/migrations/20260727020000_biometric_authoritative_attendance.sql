-- Biometric attendance is server driven:
--   * one normalized SmartOffice code can belong to only one HRMS profile
--   * first unique punch is check-in
--   * second and later unique punches set checkout to the latest punch
-- The mobile application is not involved in this flow.

update public.profiles
set smartoffice_employee_code = nullif(btrim(smartoffice_employee_code), '')
where smartoffice_employee_code is distinct from
  nullif(btrim(smartoffice_employee_code), '');

create unique index if not exists
  profiles_smartoffice_employee_code_normalized_uidx
on public.profiles (lower(btrim(smartoffice_employee_code)))
where smartoffice_employee_code is not null
  and btrim(smartoffice_employee_code) <> '';

create or replace function public.normalize_smartoffice_employee_code()
returns trigger
language plpgsql
as $$
begin
  new.smartoffice_employee_code :=
    nullif(btrim(new.smartoffice_employee_code), '');
  return new;
end;
$$;

drop trigger if exists normalize_smartoffice_employee_code_trg
  on public.profiles;
create trigger normalize_smartoffice_employee_code_trg
before insert or update of smartoffice_employee_code
on public.profiles
for each row execute function public.normalize_smartoffice_employee_code();

create table if not exists public.biometric_mapping_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('ASSIGNED', 'REPLACED', 'UNASSIGNED')),
  previous_employee_code text,
  new_employee_code text,
  created_at timestamptz not null default now()
);

create index if not exists biometric_mapping_audit_profile_created_idx
  on public.biometric_mapping_audit(profile_id, created_at desc);

alter table public.biometric_mapping_audit enable row level security;
revoke all on public.biometric_mapping_audit from anon, authenticated;

create or replace function public.rpc_assign_biometric_employee_code(
  p_profile_id uuid,
  p_employee_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_code text := nullif(btrim(p_employee_code), '');
  v_previous_code text;
  v_conflicting_profile uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    select upper(coalesce(role, '')) into v_role
    from public.profiles
    where id = v_actor and is_active = true;

    if coalesce(v_role, '') not in
      ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD') then
      raise exception 'ADMIN_PERMISSION_REQUIRED';
    end if;
  end if;

  if v_code is null then
    raise exception 'BIOMETRIC_EMPLOYEE_CODE_REQUIRED';
  end if;

  select smartoffice_employee_code into v_previous_code
  from public.profiles
  where id = p_profile_id and is_active = true
  for update;
  if not found then
    raise exception 'ACTIVE_HRMS_PROFILE_NOT_FOUND';
  end if;

  select id into v_conflicting_profile
  from public.profiles
  where lower(btrim(smartoffice_employee_code)) = lower(v_code)
    and id <> p_profile_id
  limit 1;
  if v_conflicting_profile is not null then
    raise exception 'BIOMETRIC_CODE_ALREADY_MAPPED_TO_ANOTHER_EMPLOYEE';
  end if;

  if v_previous_code is not null
     and lower(btrim(v_previous_code)) <> lower(v_code) then
    update public.smartoffice_device_logs
    set user_id = null
    where user_id = p_profile_id
      and lower(btrim(employee_code)) = lower(btrim(v_previous_code));
  end if;

  update public.profiles
  set smartoffice_employee_code = v_code,
      smartoffice_synced_at = now()
  where id = p_profile_id;

  update public.smartoffice_device_logs
  set user_id = p_profile_id
  where lower(btrim(employee_code)) = lower(v_code)
    and user_id is distinct from p_profile_id;

  insert into public.biometric_mapping_audit(
    profile_id, actor_id, action, previous_employee_code, new_employee_code
  ) values (
    p_profile_id,
    v_actor,
    case
      when v_previous_code is null then 'ASSIGNED'
      when lower(btrim(v_previous_code)) = lower(v_code) then 'ASSIGNED'
      else 'REPLACED'
    end,
    v_previous_code,
    v_code
  );

  return jsonb_build_object(
    'success', true,
    'profile_id', p_profile_id,
    'employee_code', v_code
  );
end;
$$;

revoke all on function public.rpc_assign_biometric_employee_code(uuid, text)
  from public, anon;
grant execute on function public.rpc_assign_biometric_employee_code(uuid, text)
  to authenticated, service_role;

create or replace function public.rpc_unassign_biometric_employee_code(
  p_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_previous_code text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    select upper(coalesce(role, '')) into v_role
    from public.profiles
    where id = v_actor and is_active = true;

    if coalesce(v_role, '') not in
      ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD') then
      raise exception 'ADMIN_PERMISSION_REQUIRED';
    end if;
  end if;

  select smartoffice_employee_code into v_previous_code
  from public.profiles
  where id = p_profile_id
  for update;
  if not found then
    raise exception 'HRMS_PROFILE_NOT_FOUND';
  end if;

  update public.profiles
  set smartoffice_employee_code = null,
      smartoffice_synced_at = now()
  where id = p_profile_id;

  if v_previous_code is not null then
    update public.smartoffice_device_logs
    set user_id = null
    where user_id = p_profile_id
      and lower(btrim(employee_code)) = lower(btrim(v_previous_code));
  end if;

  insert into public.biometric_mapping_audit(
    profile_id, actor_id, action, previous_employee_code, new_employee_code
  ) values (
    p_profile_id, v_actor, 'UNASSIGNED', v_previous_code, null
  );

  return jsonb_build_object(
    'success', true,
    'profile_id', p_profile_id
  );
end;
$$;

revoke all on function public.rpc_unassign_biometric_employee_code(uuid)
  from public, anon;
grant execute on function public.rpc_unassign_biometric_employee_code(uuid)
  to authenticated, service_role;

-- Direct client/import checkouts remain blocked. Only the protected biometric
-- RPC and the existing protected day-end function can authorize them.
create or replace function public.prevent_machine_attendance_checkout()
returns trigger
language plpgsql
as $$
declare
  v_is_new_checkout boolean;
  v_machine_source boolean;
  v_authorized_day_end boolean;
  v_authorized_biometric boolean;
begin
  if tg_op = 'INSERT' then
    v_is_new_checkout := new.checkout_time is not null;
  else
    v_is_new_checkout := new.checkout_time is not null and
      (old.checkout_time is null or
       new.checkout_time is distinct from old.checkout_time);
  end if;

  v_authorized_day_end :=
    current_setting('app.authorized_attendance_checkout', true) = 'DAY_END';
  v_authorized_biometric :=
    current_setting('app.authorized_attendance_checkout', true) =
      'BIOMETRIC_SYNC';

  if tg_op = 'INSERT'
     and new.date = (now() at time zone 'Asia/Kolkata')::date
     and new.checkout_time is not null
     and not v_authorized_biometric then
    new.checkout_time := null;
    new.checkout_source := null;
    if new.status in ('CHECKED_OUT', 'AUTO_CHECKED_OUT') then
      new.status := 'CHECKED_IN';
    end if;
    return new;
  end if;

  v_machine_source :=
    (
      upper(coalesce(new.checkout_source, '')) in
        ('BIOMETRIC', 'SMARTOFFICE', 'PUNCH_MACHINE')
      and not v_authorized_biometric
    )
    or (
      upper(coalesce(new.checkout_source, '')) = 'SYSTEM'
      and not v_authorized_day_end
    )
    or (
      coalesce(new.smartoffice_imported, false) = true
      and new.checkout_source is null
      and not v_authorized_biometric
    );

  if v_is_new_checkout and v_machine_source then
    if tg_op = 'UPDATE' then
      new.checkout_time := old.checkout_time;
      new.checkout_source := old.checkout_source;
      new.status := old.status;
    else
      new.checkout_time := null;
      new.checkout_source := null;
      if new.status in ('CHECKED_OUT', 'AUTO_CHECKED_OUT') then
        new.status := 'CHECKED_IN';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.require_protected_checkout_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.date = (now() at time zone 'Asia/Kolkata')::date
     and new.checkout_time is not null
     and new.checkout_time is distinct from old.checkout_time
     and not exists (
       select 1 from public.attendance_audit_logs audit
       where audit.attendance_id = new.id
         and audit.new_checkout_at = new.checkout_time
         and (
           (
             audit.action in ('CHECKOUT_MANUAL', 'CHECKOUT_EARLY')
             and audit.source = 'APP'
           )
           or (
             audit.action = 'CHECKOUT_AUTO'
             and audit.source = 'SYSTEM'
           )
           or (
             audit.action = 'CHECKOUT_AUTO'
             and audit.source = 'BIOMETRIC'
           )
         )
     ) then
    raise exception 'CHECKOUT_REQUIRES_AUTHORIZED_ACTION';
  end if;
  return null;
end;
$$;

create or replace function public.apply_biometric_daily_punches(
  p_user_id uuid,
  p_attendance_date date,
  p_first_punch timestamptz,
  p_last_punch timestamptz,
  p_punch_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attendance public.attendance_logs%rowtype;
  v_previous_checkout timestamptz;
  v_checkout timestamptz;
  v_work_hours numeric;
  v_created boolean := false;
  v_checked_out boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_user_id is null
     or p_attendance_date is null
     or p_first_punch is null
     or p_last_punch is null
     or coalesce(p_punch_count, 0) < 1
     or p_last_punch < p_first_punch then
    raise exception 'INVALID_BIOMETRIC_PUNCH_SUMMARY';
  end if;

  if (p_first_punch at time zone 'Asia/Kolkata')::date
       <> p_attendance_date
     or (p_last_punch at time zone 'Asia/Kolkata')::date
       <> p_attendance_date then
    raise exception 'BIOMETRIC_PUNCH_DATE_MISMATCH';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user_id
      and is_active = true
      and nullif(btrim(smartoffice_employee_code), '') is not null
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
      user_id,
      date,
      checkin_time,
      checkin_source,
      checkout_time,
      status,
      attendance_type,
      smartoffice_imported,
      biometric_first_punch,
      biometric_last_punch,
      biometric_punch_count
    ) values (
      p_user_id,
      p_attendance_date,
      p_first_punch,
      'BIOMETRIC',
      null,
      'CHECKED_IN',
      'BIOMETRIC',
      true,
      p_first_punch,
      p_last_punch,
      p_punch_count
    )
    returning * into v_attendance;
    v_created := true;
  else
    update public.attendance_logs
    set biometric_first_punch = p_first_punch,
        biometric_last_punch = p_last_punch,
        biometric_punch_count = p_punch_count,
        updated_at = now()
    where id = v_attendance.id
    returning * into v_attendance;
  end if;

  -- Event attendance has its own location-verified manual checkout.
  if p_punch_count >= 2
     and p_last_punch > p_first_punch
     and upper(coalesce(v_attendance.attendance_type, '')) <> 'EVENT'
     and (
       v_attendance.checkout_time is null
       or upper(coalesce(v_attendance.checkout_source, '')) = 'BIOMETRIC'
     )
     and v_attendance.checkout_time is distinct from p_last_punch then
    v_previous_checkout := v_attendance.checkout_time;
    v_checkout := p_last_punch;
    v_work_hours := greatest(
      0,
      round(
        (extract(epoch from (v_checkout - v_attendance.checkin_time)) /
          3600)::numeric,
        2
      )
    );

    insert into public.attendance_audit_logs(
      attendance_id,
      user_id,
      action,
      old_status,
      new_status,
      old_checkout_at,
      new_checkout_at,
      reason,
      source
    ) values (
      v_attendance.id,
      p_user_id,
      'CHECKOUT_AUTO',
      v_attendance.status,
      'CHECKED_OUT',
      v_previous_checkout,
      v_checkout,
      'Latest unique punch received from the biometric attendance machine',
      'BIOMETRIC'
    );

    perform set_config(
      'app.authorized_attendance_checkout',
      'BIOMETRIC_SYNC',
      true
    );

    update public.attendance_logs
    set checkout_time = v_checkout,
        checkout_source = 'BIOMETRIC',
        status = 'CHECKED_OUT',
        attendance_status = 'PRESENT',
        day_status = 'P',
        auto_checkout = false,
        auto_checkout_reason = null,
        work_hours = v_work_hours,
        updated_at = now()
    where id = v_attendance.id;
    v_checked_out := true;
  end if;

  return jsonb_build_object(
    'success', true,
    'attendance_id', v_attendance.id,
    'created', v_created,
    'checked_out', v_checked_out,
    'punch_count', p_punch_count
  );
end;
$$;

revoke all on function public.apply_biometric_daily_punches(
  uuid, date, timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.apply_biometric_daily_punches(
  uuid, date, timestamptz, timestamptz, integer
) to service_role;

-- Poll every minute. The claim lock prevents overlapping runs.
do $$
begin
  if exists(select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in (
      'biometric-attendance-sync-every-2-minutes',
      'biometric-attendance-sync-every-minute'
    );

    perform cron.schedule(
      'biometric-attendance-sync-every-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := 'https://jidbrwpzfpbursihtvpg.supabase.co/functions/v1/biometric-attendance-sync',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-biometric-sync-source', 'pg_cron'
          ),
          body := '{"source":"pg_cron"}'::jsonb,
          timeout_milliseconds := 55000
        );
      $job$
    );
  end if;
end;
$$;

notify pgrst, 'reload schema';
