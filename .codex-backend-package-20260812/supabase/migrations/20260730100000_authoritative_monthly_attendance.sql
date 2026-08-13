-- Authoritative employee calendar history. The browser no longer invents
-- monthly attendance from temporary local storage.

create or replace function public.rpc_get_my_monthly_attendance(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', p_month)::date;
  v_month_end date := (v_month_start + interval '1 month - 1 day')::date;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_profile record;
  v_policy record;
  v_date date;
  v_week_number integer;
  v_attendance record;
  v_leave record;
  v_status text;
  v_rows jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  if p_month is null or p_month <> v_month_start then
    raise exception 'MONTH_START_REQUIRED';
  end if;

  select id, office_id, role
  into v_profile
  from public.profiles
  where id = v_uid and is_active = true;
  if not found or v_profile.office_id is null then
    raise exception 'ACTIVE_PROFILE_WITH_OFFICE_REQUIRED';
  end if;

  select late_checkin_time
  into v_policy
  from public.attendance_policies
  where office_id = v_profile.office_id
    and coalesce(is_active, true)
    and lower(coalesce(role, 'all')) in (
      lower(coalesce(v_profile.role, '')),
      'all'
    )
  order by
    case when lower(coalesce(role, 'all')) =
      lower(coalesce(v_profile.role, '')) then 0 else 1 end
  limit 1;
  if not found or v_policy.late_checkin_time is null then
    raise exception 'ATTENDANCE_POLICY_NOT_CONFIGURED';
  end if;

  for v_date in
    select day::date
    from generate_series(
      v_month_start,
      least(v_month_end, v_today),
      interval '1 day'
    ) day
  loop
    v_week_number := ((extract(day from v_date)::integer - 1) / 7) + 1;
    v_status := null;

    if exists (
      select 1 from public.holiday_calendar holiday
      where holiday.holiday_date = v_date
        and (holiday.office_id is null or holiday.office_id = v_profile.office_id)
        and not coalesce(holiday.is_optional, false)
    ) then
      continue;
    end if;

    if exists (
      select 1 from public.weekly_off_rules weekly
      where weekly.is_active
        and (
          weekly.user_id = v_uid
          or (weekly.user_id is null and weekly.office_id = v_profile.office_id)
        )
        and weekly.weekday = extract(dow from v_date)::integer
        and (
          weekly.week_of_month is null
          or weekly.week_of_month = v_week_number
        )
    ) then
      continue;
    end if;

    select leave_type, is_half_day
    into v_leave
    from public.leave_requests request
    where request.user_id = v_uid
      and lower(request.status) = 'approved'
      and v_date between request.start_date and request.end_date
    order by request.created_at
    limit 1;
    if found then
      v_status := case
        when lower(coalesce(v_leave.leave_type, '')) = 'wfh' then 'wfh'
        else 'leave'
      end;
    end if;

    select id, checkin_time, checkout_time
    into v_attendance
    from public.attendance_logs attendance
    where attendance.user_id = v_uid
      and attendance.date = v_date
      and attendance.checkin_time is not null
    order by attendance.checkin_time
    limit 1;

    if found then
      v_status := case
        when (v_attendance.checkin_time at time zone 'Asia/Kolkata')::time
          >= v_policy.late_checkin_time then 'late'
        else 'present'
      end;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'id', v_attendance.id,
        'date', v_date,
        'checkIn', v_attendance.checkin_time,
        'checkOut', v_attendance.checkout_time,
        'status', v_status
      ));
      continue;
    end if;

    if exists (
      select 1 from public.field_visits visit
      where visit.user_id = v_uid
        and visit.date = v_date
        and visit.checkin_time is not null
    ) then
      v_status := 'present';
    end if;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', 'calendar-' || v_date::text,
      'date', v_date,
      'checkIn', null,
      'checkOut', null,
      'status', coalesce(v_status, 'absent')
    ));
  end loop;

  return jsonb_build_object(
    'success', true,
    'month', v_month_start,
    'through_date', least(v_month_end, v_today),
    'records', v_rows
  );
end;
$$;

revoke all on function public.rpc_get_my_monthly_attendance(date)
  from public, anon;
grant execute on function public.rpc_get_my_monthly_attendance(date)
  to authenticated;

notify pgrst, 'reload schema';
