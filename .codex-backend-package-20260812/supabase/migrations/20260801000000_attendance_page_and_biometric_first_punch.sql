-- The first verified biometric punch of an IST business day is an HRMS
-- check-in. It may move an existing later app check-in earlier, but it never
-- moves an already-earlier verified check-in later. Replays remain idempotent.

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
  v_previous_checkin timestamptz;
  v_previous_checkout timestamptz;
  v_work_hours numeric;
  v_created boolean := false;
  v_checkin_updated boolean := false;
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

  if (p_first_punch at time zone 'Asia/Kolkata')::date <> p_attendance_date
     or (p_last_punch at time zone 'Asia/Kolkata')::date <> p_attendance_date
  then
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
    select 1
    from public.profiles
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
      user_id, date, checkin_time, checkin_source, checkout_time, status,
      attendance_status, day_status, attendance_type, smartoffice_imported,
      biometric_first_punch, biometric_last_punch, biometric_punch_count
    ) values (
      p_user_id, p_attendance_date, p_first_punch, 'BIOMETRIC', null,
      'CHECKED_IN', 'PRESENT', 'P', 'BIOMETRIC', true,
      p_first_punch, p_last_punch, p_punch_count
    )
    returning * into v_attendance;
    v_created := true;
    v_checkin_updated := true;
  else
    v_previous_checkin := v_attendance.checkin_time;
    update public.attendance_logs
    set checkin_time = case
          when checkin_time is null or p_first_punch < checkin_time
            then p_first_punch
          else checkin_time
        end,
        checkin_source = case
          when checkin_time is null or p_first_punch < checkin_time
            then 'BIOMETRIC'
          else checkin_source
        end,
        status = case
          when checkin_time is null then 'CHECKED_IN'
          else status
        end,
        attendance_status = case
          when checkin_time is null then 'PRESENT'
          else coalesce(attendance_status, 'PRESENT')
        end,
        day_status = case
          when checkin_time is null then 'P'
          else coalesce(day_status, 'P')
        end,
        attendance_type = case
          when checkin_time is null then 'BIOMETRIC'
          else attendance_type
        end,
        smartoffice_imported = true,
        biometric_first_punch = least(
          coalesce(biometric_first_punch, p_first_punch),
          p_first_punch
        ),
        biometric_last_punch = greatest(
          coalesce(biometric_last_punch, p_last_punch),
          p_last_punch
        ),
        biometric_punch_count = greatest(
          coalesce(biometric_punch_count, 0),
          p_punch_count
        ),
        updated_at = now()
    where id = v_attendance.id
    returning * into v_attendance;
    v_checkin_updated := v_previous_checkin is distinct from
      v_attendance.checkin_time;
  end if;

  -- EVENT checkout remains location-verified and manual. For other attendance,
  -- the first biometric punch at or after 18:30 IST is the checkout.
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
      attendance_id, user_id, action, old_status, new_status,
      old_checkout_at, new_checkout_at, reason, source
    ) values (
      v_attendance.id, p_user_id, 'CHECKOUT_AUTO', v_attendance.status,
      'CHECKED_OUT', v_previous_checkout, p_checkout_punch,
      'First biometric punch at or after 18:30 IST', 'BIOMETRIC'
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
    'checkin_updated', v_checkin_updated,
    'checkin_time', v_attendance.checkin_time,
    'checkin_source', v_attendance.checkin_source,
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

-- Complete selected-day details, including field-visit and biometric evidence.
create or replace function public.rpc_get_my_monthly_attendance_v2(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_base jsonb;
  v_record jsonb;
  v_records jsonb := '[]'::jsonb;
  v_date date;
  v_attendance record;
  v_leave record;
  v_holiday record;
  v_visit record;
  v_has_attendance boolean;
  v_has_leave boolean;
  v_has_holiday boolean;
  v_has_visit boolean;
  v_worked_minutes integer;
  v_source text;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  v_base := public.rpc_get_my_monthly_attendance(p_month);
  if not coalesce((v_base->>'success')::boolean, false)
     or jsonb_typeof(v_base->'records') <> 'array' then
    raise exception 'MONTHLY_ATTENDANCE_NOT_CONFIRMED';
  end if;

  for v_record in
    select item.value
    from jsonb_array_elements(v_base->'records') item(value)
  loop
    v_date := (v_record->>'date')::date;
    v_worked_minutes := null;
    v_source := null;

    select
      attendance.checkin_time,
      attendance.checkout_time,
      attendance.attendance_type,
      attendance.checkin_source,
      attendance.checkout_source,
      attendance.smartoffice_imported,
      attendance.biometric_first_punch,
      attendance.biometric_last_punch,
      attendance.biometric_punch_count
    into v_attendance
    from public.attendance_logs attendance
    where attendance.user_id = v_uid
      and attendance.date = v_date
      and attendance.checkin_time is not null
    order by attendance.checkin_time
    limit 1;
    v_has_attendance := found;

    select request.leave_type, request.reason, request.is_half_day
    into v_leave
    from public.leave_requests request
    where request.user_id = v_uid
      and lower(request.status) = 'approved'
      and v_date between request.start_date and request.end_date
    order by request.created_at
    limit 1;
    v_has_leave := found;

    select holiday.name
    into v_holiday
    from public.holiday_calendar holiday
    join public.profiles profile on profile.id = v_uid
    where holiday.holiday_date = v_date
      and (holiday.office_id is null or holiday.office_id = profile.office_id)
      and not coalesce(holiday.is_optional, false)
    order by holiday.office_id nulls last, holiday.id
    limit 1;
    v_has_holiday := found;

    select visit.location_name, visit.checkin_time, visit.checkout_time
    into v_visit
    from public.field_visits visit
    where visit.user_id = v_uid
      and visit.date = v_date
      and visit.checkin_time is not null
    order by visit.checkin_time
    limit 1;
    v_has_visit := found;

    if v_has_attendance then
      if v_attendance.checkout_time is not null then
        v_worked_minutes := greatest(
          0,
          floor(extract(epoch from (
            v_attendance.checkout_time - v_attendance.checkin_time
          )) / 60)::integer
        );
      elsif v_date = v_today then
        v_worked_minutes := greatest(
          0,
          floor(extract(epoch from (
            now() - v_attendance.checkin_time
          )) / 60)::integer
        );
      end if;
      v_source := case
        when upper(coalesce(v_attendance.attendance_type, '')) = 'EVENT'
             and coalesce(v_attendance.biometric_punch_count, 0) > 0
          then 'Event + Biometric'
        when upper(coalesce(v_attendance.attendance_type, '')) = 'EVENT'
          then 'Event'
        when upper(coalesce(v_attendance.checkin_source, '')) = 'BIOMETRIC'
          then 'Biometric'
        when coalesce(v_attendance.smartoffice_imported, false)
          then 'App + Biometric'
        else initcap(lower(coalesce(
          v_attendance.attendance_type,
          v_attendance.checkin_source,
          'App'
        )))
      end;
    elsif v_has_visit then
      v_source := 'Field Visit';
      if v_visit.checkout_time is not null then
        v_worked_minutes := greatest(
          0,
          floor(extract(epoch from (
            v_visit.checkout_time - v_visit.checkin_time
          )) / 60)::integer
        );
      elsif v_date = v_today then
        v_worked_minutes := greatest(
          0,
          floor(extract(epoch from (
            now() - v_visit.checkin_time
          )) / 60)::integer
        );
      end if;
      v_record := v_record || jsonb_build_object(
        'checkIn', v_visit.checkin_time,
        'checkOut', v_visit.checkout_time
      );
    end if;

    v_record := v_record || jsonb_build_object(
      'workedMinutes', v_worked_minutes,
      'attendanceSource', v_source,
      'missingCheckout',
        v_has_attendance
        and v_attendance.checkout_time is null
        and v_date < v_today,
      'leaveType', case when v_has_leave then v_leave.leave_type else null end,
      'leaveReason', case when v_has_leave then v_leave.reason else null end,
      'isHalfDay', case when v_has_leave then v_leave.is_half_day else false end,
      'holidayName', case when v_has_holiday then v_holiday.name else null end,
      'fieldVisitName',
        case when v_has_visit then v_visit.location_name else null end,
      'fieldVisitCheckIn',
        case when v_has_visit then v_visit.checkin_time else null end,
      'fieldVisitCheckOut',
        case when v_has_visit then v_visit.checkout_time else null end,
      'fieldVisitMissingCheckout',
        v_has_visit and v_visit.checkout_time is null and v_date < v_today,
      'biometricFirstPunch',
        case when v_has_attendance then v_attendance.biometric_first_punch
          else null end,
      'biometricLastPunch',
        case when v_has_attendance then v_attendance.biometric_last_punch
          else null end,
      'biometricPunchCount',
        case when v_has_attendance then v_attendance.biometric_punch_count
          else 0 end
    );
    v_records := v_records || jsonb_build_array(v_record);
  end loop;

  return jsonb_set(v_base, '{records}', v_records, true) ||
    jsonb_build_object(
      'detail_contract', 'attendance-day-v3',
      'server_now', now()
    );
end;
$$;

revoke all on function public.rpc_get_my_monthly_attendance_v2(date)
  from public, anon;
grant execute on function public.rpc_get_my_monthly_attendance_v2(date)
  to authenticated;

notify pgrst, 'reload schema';
