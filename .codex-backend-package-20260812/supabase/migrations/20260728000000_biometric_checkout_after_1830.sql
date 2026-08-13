-- Attendance rule requested on 2026-07-28:
--   1. The first unique biometric punch is the check-in.
--   2. Punches before 18:30 IST do not check the employee out.
--   3. The first later punch at/after 18:30 IST is the checkout.
--   4. Punches after that do not move the checkout time.

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
set search_path = public
as $$
declare
  v_attendance public.attendance_logs%rowtype;
  v_previous_checkout timestamptz;
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

  if p_checkout_punch is not null and (
       p_punch_count < 2
       or p_checkout_punch <= p_first_punch
       or p_checkout_punch > p_last_punch
       or (p_checkout_punch at time zone 'Asia/Kolkata')::date
            <> p_attendance_date
       or (p_checkout_punch at time zone 'Asia/Kolkata')::time
            < time '18:30:00'
     ) then
    raise exception 'INVALID_BIOMETRIC_CHECKOUT_PUNCH';
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
    set checkin_time = case
          when upper(coalesce(checkin_source, '')) = 'BIOMETRIC'
               and p_first_punch < checkin_time
            then p_first_punch
          else checkin_time
        end,
        biometric_first_punch = p_first_punch,
        biometric_last_punch = p_last_punch,
        biometric_punch_count = p_punch_count,
        updated_at = now()
    where id = v_attendance.id
    returning * into v_attendance;
  end if;

  -- EVENT attendance uses its own location-verified manual checkout.
  -- A biometric checkout is only created after 18:30 and can only move
  -- earlier when a delayed feed reveals an earlier qualifying punch.
  if p_checkout_punch is not null
     and upper(coalesce(v_attendance.attendance_type, '')) <> 'EVENT'
     and (
       v_attendance.checkout_time is null
       or (
         upper(coalesce(v_attendance.checkout_source, '')) = 'BIOMETRIC'
         and p_checkout_punch < v_attendance.checkout_time
       )
     )
     and v_attendance.checkout_time is distinct from p_checkout_punch then
    v_previous_checkout := v_attendance.checkout_time;
    v_work_hours := greatest(
      0,
      round(
        (extract(epoch from (
          p_checkout_punch - v_attendance.checkin_time
        )) / 3600)::numeric,
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
      p_checkout_punch,
      'First biometric punch at or after 18:30 IST',
      'BIOMETRIC'
    );

    perform set_config(
      'app.authorized_attendance_checkout',
      'BIOMETRIC_SYNC',
      true
    );

    update public.attendance_logs
    set checkout_time = p_checkout_punch,
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
    'checkout_eligible', p_checkout_punch is not null,
    'punch_count', p_punch_count
  );
end;
$$;

revoke all on function public.apply_biometric_daily_punches_v2(
  uuid, date, timestamptz, timestamptz, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_biometric_daily_punches_v2(
  uuid, date, timestamptz, timestamptz, integer, timestamptz
) to service_role;

-- Compatibility for a sync worker that was already running while this
-- migration was installed. It cannot check out before 18:30.
create or replace function public.apply_biometric_daily_punches(
  p_user_id uuid,
  p_attendance_date date,
  p_first_punch timestamptz,
  p_last_punch timestamptz,
  p_punch_count integer
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.apply_biometric_daily_punches_v2(
    p_user_id,
    p_attendance_date,
    p_first_punch,
    p_last_punch,
    p_punch_count,
    case
      when p_punch_count >= 2
       and (p_last_punch at time zone 'Asia/Kolkata')::time
            >= time '18:30:00'
      then p_last_punch
      else null
    end
  );
$$;

revoke all on function public.apply_biometric_daily_punches(
  uuid, date, timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.apply_biometric_daily_punches(
  uuid, date, timestamptz, timestamptz, integer
) to service_role;

-- Repair only today's early machine checkouts created by the previous rule.
-- Audit rows remain as history; the attendance row is reopened until a valid
-- punch at/after 18:30 is received.
update public.attendance_logs
set checkout_time = null,
    checkout_source = null,
    status = 'CHECKED_IN',
    work_hours = null,
    auto_checkout = false,
    auto_checkout_reason = null,
    updated_at = now()
where date = (now() at time zone 'Asia/Kolkata')::date
  and upper(coalesce(checkout_source, '')) = 'BIOMETRIC'
  and (checkout_time at time zone 'Asia/Kolkata')::time < time '18:30:00';

notify pgrst, 'reload schema';
