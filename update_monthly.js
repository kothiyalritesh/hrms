const fs = require('fs');

const sql = `
-- 1. Fix rpc_get_my_monthly_attendance to use profiles.weekly_off_day
CREATE OR REPLACE FUNCTION public.rpc_get_my_monthly_attendance(p_month date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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
BEGIN
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  if p_month is null or p_month <> v_month_start then
    raise exception 'MONTH_START_REQUIRED';
  end if;

  select id, office_id, role, weekly_off_day
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

    if v_profile.weekly_off_day is not null and v_profile.weekly_off_day = extract(dow from v_date)::integer then
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

    select
      attendance.checkin_time,
      attendance.checkout_time
    into v_attendance
    from public.attendance_logs attendance
    where attendance.user_id = v_uid
      and attendance.date = v_date
      and attendance.checkin_time is not null
    order by attendance.created_at desc
    limit 1;

    if found then
      if v_attendance.checkin_time::time > v_policy.late_checkin_time then
        v_status := 'late';
      else
        v_status := 'present';
      end if;
    else
      select request.leave_type
      into v_leave
      from public.leave_requests request
      where request.user_id = v_uid
        and lower(request.status) = 'approved'
        and v_date between request.start_date and request.end_date
      limit 1;

      if found then
        v_status := 'leave';
      else
        v_status := 'absent';
      end if;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'date', v_date,
      'status', v_status
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'month', p_month,
    'records', v_rows
  );
END;
$$;
`;

fs.writeFileSync('fix_monthly_attendance.sql', sql, 'utf-8');
console.log("Created fix for monthly attendance RPC");
