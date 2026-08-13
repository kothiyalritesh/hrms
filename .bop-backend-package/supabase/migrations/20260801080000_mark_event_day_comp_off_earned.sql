-- A Sunday that earned comp-off must not be labelled Late. It remains worked
-- attendance, with an explicit Comp-Off Earned status in employee calendars.

create or replace function public.rpc_get_my_monthly_attendance_v3(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_base jsonb;
  v_record jsonb;
  v_records jsonb := '[]'::jsonb;
  v_date date;
  v_comp_off_days numeric;
  v_event_names text;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  v_base := public.rpc_get_my_monthly_attendance_v2(p_month);
  if not coalesce((v_base->>'success')::boolean, false)
     or jsonb_typeof(v_base->'records') <> 'array' then
    raise exception 'MONTHLY_ATTENDANCE_NOT_CONFIRMED';
  end if;

  for v_record in
    select item.value
    from jsonb_array_elements(v_base->'records') item(value)
  loop
    v_date := (v_record->>'date')::date;
    select
      coalesce(sum(credit.days), 0),
      string_agg(distinct event.title, ', ' order by event.title)
    into v_comp_off_days, v_event_names
    from public.event_comp_off_credits credit
    join public.events event on event.id = credit.event_id
    where credit.user_id = v_uid
      and event.event_date = v_date;

    v_record := v_record || jsonb_build_object(
      'compOffEarned', v_comp_off_days,
      'compOffEventName', v_event_names
    );
    if v_comp_off_days > 0 then
      v_record := v_record || jsonb_build_object(
        'status', 'compoff',
        'is_late', false
      );
    end if;
    v_records := v_records || jsonb_build_array(v_record);
  end loop;

  return jsonb_set(v_base, '{records}', v_records, true) ||
    jsonb_build_object(
      'detail_contract', 'attendance-day-v6',
      'comp_off_source', 'event_comp_off_credits'
    );
end;
$$;

revoke all on function public.rpc_get_my_monthly_attendance_v3(date)
  from public, anon;
grant execute on function public.rpc_get_my_monthly_attendance_v3(date)
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
    'backend_schema_version', '20260801080000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'attendance_history_rpc', 'rpc_get_my_monthly_attendance_v3',
    'attendance_day_detail_contract', 'attendance-day-v6',
    'attendance_checkin_precedence', 'BIOMETRIC_FIRST_PUNCH',
    'attendance_checkout_precedence', 'HRMS_THEN_IST_ROLLOVER',
    'sunday_event_comp_off', 'VERIFIED_ATTENDEE_IDEMPOTENT',
    'attendance_regularization_list_rpc',
      'rpc_admin_list_attendance_regularization',
    'attendance_late_cutoff', '10:32:00',
    'attendance_late_boundary', 'INCLUSIVE',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'biometric_cron_auth', 'PROJECT_PUBLISHABLE_KEY',
    'smartoffice_config', 'DATABASE_VAULT_SERVICE_ROLE',
    'field_visit_evidence_rpc', 'submit_field_visit_current_location_v3',
    'admin_dashboard_rpc', 'rpc_admin_dashboard_summary',
    'authenticated_profile_rpc', 'rpc_get_my_profile_v2',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260801.1',
      'otp-auth', '20260731.1',
      'field-visit-evidence-upload', '20260731.2',
      'smartoffice-proxy', '20260801.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
