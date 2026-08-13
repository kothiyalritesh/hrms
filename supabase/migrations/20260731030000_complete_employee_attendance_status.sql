-- Complete employee attendance classification. The server owns every status;
-- the browser only renders the returned values.

create or replace function public.rpc_get_my_monthly_attendance(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
            (v_attendance.checkin_time at time zone 'Asia/Kolkata')::time >
              v_policy.late_checkin_time
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
        v_status := 'weeklyoff';
      end if;

      if v_status is null then
        v_status := case
          when v_date = v_today
            and v_now_time <= v_policy.late_checkin_time then 'notyet'
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

revoke all on function public.rpc_get_my_monthly_attendance(date)
  from public, anon;
grant execute on function public.rpc_get_my_monthly_attendance(date)
  to authenticated;

create or replace function public.rpc_admin_list_attendance_regularization(
  p_status text,
  p_offset integer default 0,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_records jsonb;
  v_total integer;
begin
  perform public.require_profile_admin();
  if v_status not in ('PENDING', 'APPROVED', 'REJECTED')
     or p_offset < 0 or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_REGULARIZATION_LIST_REQUEST';
  end if;

  select count(*)
  into v_total
  from public.attendance_regularization_requests request
  where upper(request.status) = v_status;

  select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc), '[]'::jsonb)
  into v_records
  from (
    select
      request.id,
      request.user_id,
      request.attendance_id,
      request.request_type,
      request.requested_checkout,
      request.reason,
      request.status,
      request.reviewed_by,
      request.reviewed_at,
      request.review_notes,
      request.created_at,
      jsonb_build_object(
        'name', profile.name,
        'employee_number', profile.employee_number
      ) as profiles,
      jsonb_build_object(
        'date', attendance.date,
        'checkin_time', attendance.checkin_time,
        'checkout_time', attendance.checkout_time,
        'status', attendance.status,
        'is_late', attendance.is_late
      ) as attendance_logs
    from public.attendance_regularization_requests request
    join public.profiles profile on profile.id = request.user_id
    join public.attendance_logs attendance on attendance.id = request.attendance_id
    where upper(request.status) = v_status
    order by request.created_at desc, request.id
    offset p_offset limit p_limit
  ) page;

  return jsonb_build_object(
    'success', true,
    'status', v_status,
    'offset', p_offset,
    'limit', p_limit,
    'total', v_total,
    'has_more', p_offset + jsonb_array_length(v_records) < v_total,
    'records', v_records
  );
end;
$$;

revoke all on function public.rpc_admin_list_attendance_regularization(
  text, integer, integer
) from public, anon;
grant execute on function public.rpc_admin_list_attendance_regularization(
  text, integer, integer
) to authenticated;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260731030000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'attendance_history_rpc', 'rpc_get_my_monthly_attendance',
    'attendance_regularization_list_rpc',
      'rpc_admin_list_attendance_regularization',
    'attendance_late_cutoff', '10:30:00',
    'attendance_late_boundary', 'EXCLUSIVE',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'field_visit_evidence_rpc', 'submit_field_visit_current_location_v3',
    'admin_dashboard_rpc', 'rpc_admin_dashboard_summary',
    'authenticated_profile_rpc', 'rpc_get_my_profile_v2',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260731.2',
      'otp-auth', '20260731.1',
      'field-visit-evidence-upload', '20260731.2',
      'smartoffice-proxy', '20260731.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
