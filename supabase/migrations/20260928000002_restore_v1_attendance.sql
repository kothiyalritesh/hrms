CREATE OR REPLACE FUNCTION public.rpc_get_my_monthly_attendance(p_month date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_today date := (v_now at time zone 'Asia/Kolkata')::date;
  v_now_time time := (v_now at time zone 'Asia/Kolkata')::time;
  v_month_start date := date_trunc('month', p_month)::date;
  v_month_end date := (v_month_start + interval '1 month - 1 day')::date;
  v_employment_start date;
  v_employment_end date;
  v_range_start date;
  v_range_end date;
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

  select
    profile.id,
    profile.office_id,
    profile.role,
    profile.joining_date,
    profile.weekly_off_day,
    profile.last_working_date,
    profile.created_at
  into v_profile
  from public.profiles profile
  where profile.id = v_uid and profile.is_active = true;
  if not found or v_profile.office_id is null then
    raise exception 'ACTIVE_PROFILE_WITH_OFFICE_REQUIRED';
  end if;

  -- A known joining date is authoritative. For legacy rows without one, the
  -- profile creation date is the earliest date the system can safely prove.
  v_employment_start := coalesce(
    v_profile.joining_date,
    (v_profile.created_at at time zone 'Asia/Kolkata')::date
  );
  v_employment_end := coalesce(v_profile.last_working_date, v_today);
  v_range_start := greatest(v_month_start, v_employment_start);
  v_range_end := least(v_month_end, v_today, v_employment_end);

  select policy.late_checkin_time
  into v_policy
  from public.attendance_policies policy
  where policy.office_id = v_profile.office_id
    and coalesce(policy.is_active, true)
    and lower(coalesce(policy.role, 'all')) in (
      lower(coalesce(v_profile.role, '')),
      'all'
    )
  order by
    case when lower(coalesce(policy.role, 'all')) =
      lower(coalesce(v_profile.role, '')) then 0 else 1 end
  limit 1;
  if not found or v_policy.late_checkin_time is null then
    raise exception 'ATTENDANCE_POLICY_NOT_CONFIGURED';
  end if;

  if v_range_start <= v_range_end then
    for v_date in
      select day::date
      from generate_series(v_range_start, v_range_end, interval '1 day') day
    loop
      v_week_number := ((extract(day from v_date)::integer - 1) / 7) + 1;
      v_status := null;

      -- An actual punch is authoritative even on a leave, holiday, or weekly
      -- off day. is_late is maintained by the database trigger.
      select
        attendance.id,
        attendance.checkin_time,
        attendance.checkout_time,
        attendance.is_late
      into v_attendance
      from public.attendance_logs attendance
      where attendance.user_id = v_uid
        and attendance.date = v_date
        and attendance.checkin_time is not null
      order by attendance.checkin_time
      limit 1;

      if found then
        v_status := case
          when coalesce(
            v_attendance.is_late,
            (v_attendance.checkin_time at time zone 'Asia/Kolkata')::time >= v_policy.late_checkin_time
          ) then 'late'
          else 'present'
        end;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'id', v_attendance.id,
          'date', v_date,
          'checkIn', v_attendance.checkin_time,
          'checkOut', v_attendance.checkout_time,
          'is_late', v_status = 'late',
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

      if v_status is null then
        select request.leave_type, request.is_half_day
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
      end if;

      if v_status is null and exists (
        select 1 from public.holiday_calendar holiday
        where holiday.holiday_date = v_date
          and (
            holiday.office_id is null
            or holiday.office_id = v_profile.office_id
          )
          and not coalesce(holiday.is_optional, false)
      ) then
        v_status := 'holiday';
      end if;

      if v_status is null and v_profile.weekly_off_day is not null and v_profile.weekly_off_day = extract(dow from v_date)::integer then
        v_status := 'WEEKLY_OFF';
      end if;

      if v_status is null and exists (
        select 1 from public.weekly_off_rules weekly
        where weekly.is_active
          and (
            weekly.user_id = v_uid
            or (
              weekly.user_id is null
              and weekly.office_id = v_profile.office_id
            )
          )
          and weekly.weekday = extract(dow from v_date)::integer
          and (
            weekly.week_of_month is null
            or weekly.week_of_month = v_week_number
          )
      ) then
        v_status := 'WEEKLY_OFF';
      end if;

      if v_status is null then
        v_status := case
          when v_date = v_today
            and v_now_time < v_policy.late_checkin_time then 'notyet'
          else 'absent'
        end;
      end if;

      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'id', 'calendar-' || v_date::text,
        'date', v_date,
        'checkIn', null,
        'checkOut', null,
        'is_late', false,
        'status', v_status
      ));
    end loop;
  end if;

  return jsonb_build_object(
    'success', true,
    'month', v_month_start,
    'through_date', least(v_month_end, v_today),
    'employment_start', v_employment_start,
    'employment_end', v_employment_end,
    'late_cutoff', to_char(v_policy.late_checkin_time, 'HH24:MI:SS'),
    'late_boundary', 'EXCLUSIVE',
    'records', v_rows
  );
end;
$$;
