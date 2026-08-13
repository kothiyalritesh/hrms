-- Fix the policy RPC's strict PostgreSQL result types and expose complete,
-- authenticated detail for each selectable calendar day.

create or replace function public.get_attendance_policy(p_user_id uuid)
returns table(
  min_work_duration_minutes integer,
  earliest_checkout_time text,
  auto_close_time text,
  allow_night_shift boolean,
  require_early_checkout_reason boolean,
  undo_checkout_minutes integer,
  office_id uuid,
  office_name text,
  late_checkin_time text,
  checkin_reminder_time text,
  checkout_reminder_time text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  if p_user_id <> v_actor and not exists (
    select 1 from public.profiles target
    where target.id = p_user_id
      and target.is_active = true
      and (
        target.reports_to = v_actor
        or exists (
          select 1 from public.profiles actor
          where actor.id = v_actor and actor.is_active = true
            and upper(coalesce(actor.role, '')) in
              ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
        )
      )
  ) then
    raise exception 'POLICY_ACCESS_DENIED';
  end if;

  return query
  select
    policy.min_work_duration_minutes::integer,
    policy.earliest_checkout_time::text,
    policy.auto_close_time::text,
    policy.allow_night_shift::boolean,
    policy.require_early_checkout_reason::boolean,
    policy.undo_checkout_minutes::integer,
    office.id::uuid,
    office.name::text,
    to_char(policy.late_checkin_time, 'HH24:MI')::text,
    to_char(policy.checkin_reminder_time, 'HH24:MI')::text,
    to_char(policy.checkout_reminder_time, 'HH24:MI')::text
  from public.profiles profile
  join public.offices office
    on office.id = profile.office_id and office.is_active = true
  join public.attendance_policies policy
    on policy.office_id = profile.office_id
   and policy.is_active = true
   and lower(coalesce(policy.role, 'all')) in (
     lower(coalesce(profile.role, '')),
     'all'
   )
  where profile.id = p_user_id and profile.is_active = true
  order by case
    when lower(coalesce(policy.role, 'all')) =
      lower(coalesce(profile.role, '')) then 0 else 1 end
  limit 1;
end;
$$;

revoke all on function public.get_attendance_policy(uuid) from public, anon;
grant execute on function public.get_attendance_policy(uuid) to authenticated;

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
      attendance.smartoffice_imported
    into v_attendance
    from public.attendance_logs attendance
    where attendance.user_id = v_uid
      and attendance.date = v_date
      and attendance.checkin_time is not null
    order by attendance.checkin_time
    limit 1;
    v_has_attendance := found;

    select
      request.leave_type,
      request.reason,
      request.is_half_day
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

    select
      visit.location_name,
      visit.checkin_time,
      visit.checkout_time
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
        when coalesce(v_attendance.smartoffice_imported, false)
          or upper(coalesce(v_attendance.attendance_type, '')) = 'BIOMETRIC'
          then 'Biometric'
        when upper(coalesce(v_attendance.attendance_type, '')) = 'EVENT'
          then 'Event'
        else initcap(lower(coalesce(
          v_attendance.attendance_type,
          v_attendance.checkin_source,
          'App'
        )))
      end;
    elsif v_has_visit then
      v_source := 'Field Visit';
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
        case when v_has_visit then v_visit.location_name else null end
    );
    v_records := v_records || jsonb_build_array(v_record);
  end loop;

  return jsonb_set(v_base, '{records}', v_records, true) ||
    jsonb_build_object(
      'detail_contract', 'attendance-day-v2',
      'server_now', now()
    );
end;
$$;

revoke all on function public.rpc_get_my_monthly_attendance_v2(date)
  from public, anon;
grant execute on function public.rpc_get_my_monthly_attendance_v2(date)
  to authenticated;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260731031000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'attendance_history_rpc', 'rpc_get_my_monthly_attendance_v2',
    'attendance_day_detail_contract', 'attendance-day-v2',
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
