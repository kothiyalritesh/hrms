-- Restore biometric visibility for every trusted HRMS administration role.
-- The legacy SELECT policy recognized only ADMIN/SUPER_ADMIN, so a valid
-- SYSTEM_ADMIN or HRD session received an empty device-log result.

drop policy if exists "Admins can view all device logs"
  on public.smartoffice_device_logs;
drop policy if exists biometric_device_logs_admin_read
  on public.smartoffice_device_logs;

create policy biometric_device_logs_admin_read
on public.smartoffice_device_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles actor
    where actor.id = auth.uid()
      and actor.is_active = true
      and upper(coalesce(actor.role, '')) in (
        'SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD'
      )
  )
);

grant select on public.smartoffice_device_logs to authenticated;

create index if not exists smartoffice_device_logs_code_datetime_idx
  on public.smartoffice_device_logs(lower(btrim(employee_code)), log_datetime desc);

create or replace function public.rpc_list_biometric_employee_codes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_codes jsonb;
  v_total bigint;
begin
  perform public.require_profile_admin();

  select count(*) into v_total
  from public.smartoffice_device_logs;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_code', grouped.employee_code,
        'punch_count', grouped.punch_count,
        'last_seen', grouped.last_seen,
        'matched_user_id', grouped.matched_user_id
      )
      order by grouped.last_seen desc nulls last, grouped.employee_code
    ),
    '[]'::jsonb
  )
  into v_codes
  from (
    select
      min(btrim(log.employee_code)) as employee_code,
      count(*) as punch_count,
      max(coalesce(log.log_datetime, log.log_date::text)) as last_seen,
      max(log.user_id::text)::uuid as matched_user_id
    from public.smartoffice_device_logs log
    where nullif(btrim(log.employee_code), '') is not null
    group by lower(btrim(log.employee_code))
  ) grouped;

  return jsonb_build_object(
    'success', true,
    'total_log_count', v_total,
    'code_count', jsonb_array_length(v_codes),
    'codes', v_codes
  );
end;
$$;

revoke all on function public.rpc_list_biometric_employee_codes()
  from public, anon;
grant execute on function public.rpc_list_biometric_employee_codes()
  to authenticated;

-- Recreate the warning RPC because the remote PostgREST schema no longer
-- exposed it even though an older migration was marked as applied.
create or replace function public.rpc_recalculate_attendance_warnings()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_policy public.tracking_warning_policy%rowtype;
  v_row record;
  v_warning boolean;
  v_radius double precision;
  v_distance double precision;
  v_evaluated integer := 0;
  v_updated integer := 0;
begin
  perform public.require_profile_admin();

  select * into v_policy
  from public.tracking_warning_policy
  where singleton = true;
  if not found then
    raise exception 'TRACKING_WARNING_POLICY_NOT_CONFIGURED';
  end if;

  for v_row in
    select
      attendance.id,
      attendance.warning,
      office.latitude as office_latitude,
      office.longitude as office_longitude,
      coalesce(
        office.allowed_radius_meters,
        office.attendance_radius
      )::double precision as configured_radius,
      ping.latitude as ping_latitude,
      ping.longitude as ping_longitude,
      ping.accuracy as ping_accuracy,
      ping.gps_available,
      ping.recorded_at
    from public.attendance_logs attendance
    left join public.offices office on office.id = attendance.office_id
    left join lateral (
      select tracking.latitude, tracking.longitude, tracking.accuracy,
             tracking.gps_available, tracking.recorded_at
      from public.location_tracking tracking
      where tracking.user_id = attendance.user_id
        and tracking.date = v_today
      order by tracking.recorded_at desc
      limit 1
    ) ping on true
    where attendance.date = v_today
      and attendance.status = 'CHECKED_IN'
      and attendance.checkin_time is not null
  loop
    v_evaluated := v_evaluated + 1;
    v_warning := false;
    v_radius := v_row.configured_radius;

    if v_row.recorded_at is null then
      v_warning := v_policy.warn_when_ping_missing;
    elsif coalesce(v_row.gps_available, false) = false then
      v_warning := true;
    elsif v_row.recorded_at <
      now() - make_interval(mins => v_policy.stale_after_minutes) then
      v_warning := true;
    elsif v_radius is null or v_radius < 10 or v_radius > 1000
       or v_row.office_latitude is null or v_row.office_longitude is null
       or v_row.ping_latitude is null or v_row.ping_longitude is null then
      v_warning := true;
    else
      v_distance := public.tracking_distance_metres(
        v_row.office_latitude,
        v_row.office_longitude,
        v_row.ping_latitude,
        v_row.ping_longitude
      );
      v_warning :=
        v_distance + greatest(coalesce(v_row.ping_accuracy, 0), 0) > v_radius;
    end if;

    if v_warning is distinct from coalesce(v_row.warning, false) then
      update public.attendance_logs
      set warning = v_warning, updated_at = now()
      where id = v_row.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'business_date', v_today,
    'evaluated_count', v_evaluated,
    'updated_count', v_updated,
    'stale_after_minutes', v_policy.stale_after_minutes
  );
end;
$$;

revoke all on function public.rpc_recalculate_attendance_warnings()
  from public, anon;
grant execute on function public.rpc_recalculate_attendance_warnings()
  to authenticated;

notify pgrst, 'reload schema';
