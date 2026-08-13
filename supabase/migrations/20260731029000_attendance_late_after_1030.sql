-- 10:30:00 Asia/Kolkata is on time. Only a timestamp strictly later than
-- 10:30:00 is late. Apply the same rule to check-in, calendars, and reports.

update public.attendance_policies
set late_checkin_time = time '10:30:00'
where late_checkin_time is distinct from time '10:30:00';

update public.attendance_policy_history
set late_checkin_time = time '10:30:00'
where late_checkin_time is distinct from time '10:30:00';

create or replace function public.set_authoritative_attendance_late_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_late_time time;
begin
  if new.checkin_time is null then
    new.is_late := false;
    return new;
  end if;

  select policy.late_checkin_time
  into v_late_time
  from public.profiles profile
  join public.attendance_policies policy
    on policy.office_id = coalesce(new.office_id, profile.office_id)
   and coalesce(policy.is_active, true)
   and lower(coalesce(policy.role, 'all')) in (
     lower(coalesce(profile.role, '')),
     'all'
   )
  where profile.id = new.user_id
  order by
    case when lower(coalesce(policy.role, 'all')) =
      lower(coalesce(profile.role, '')) then 0 else 1 end
  limit 1;

  new.is_late := case
    when v_late_time is null then null
    else (new.checkin_time at time zone 'Asia/Kolkata')::time > v_late_time
  end;
  return new;
end;
$$;

-- Correct existing classifications with the same office/role policy.
with classified as (
  select distinct on (attendance.id)
    attendance.id,
    (attendance.checkin_time at time zone 'Asia/Kolkata')::time >
      policy.late_checkin_time as is_late
  from public.attendance_logs attendance
  join public.profiles profile on profile.id = attendance.user_id
  join public.attendance_policies policy
    on policy.office_id = coalesce(attendance.office_id, profile.office_id)
   and coalesce(policy.is_active, true)
   and lower(coalesce(policy.role, 'all')) in (
     lower(coalesce(profile.role, '')),
     'all'
   )
  where attendance.checkin_time is not null
  order by
    attendance.id,
    case when lower(coalesce(policy.role, 'all')) =
      lower(coalesce(profile.role, '')) then 0 else 1 end
)
update public.attendance_logs attendance
set is_late = classified.is_late
from classified
where attendance.id = classified.id
  and attendance.is_late is distinct from classified.is_late;

-- Patch the already-deployed calendar function without copying its unrelated
-- leave, weekly-off, and field-visit logic into this focused migration.
do $$
declare
  v_before text;
  v_after text;
begin
  select pg_get_functiondef(
    'public.rpc_get_my_monthly_attendance(date)'::regprocedure
  ) into v_before;
  v_after := regexp_replace(
    v_before,
    '>=[[:space:]]*v_policy\.late_checkin_time',
    '> v_policy.late_checkin_time',
    'g'
  );
  if v_after = v_before then
    raise exception 'MONTHLY_ATTENDANCE_LATE_BOUNDARY_NOT_FOUND';
  end if;
  execute v_after;
end;
$$;

-- The payroll reconciliation view uses effective-dated policy history; keep
-- its boundary identical to the stored attendance classification.
do $$
declare
  v_before text;
  v_after text;
begin
  select pg_get_viewdef('public.attendance_reconciliation'::regclass, true)
  into v_before;
  v_after := regexp_replace(
    v_before,
    '>=[[:space:]]*policy\.late_checkin_time',
    '> policy.late_checkin_time',
    'g'
  );
  if v_after = v_before then
    raise exception 'RECONCILIATION_LATE_BOUNDARY_NOT_FOUND';
  end if;
  execute 'create or replace view public.attendance_reconciliation as ' ||
    v_after;
end;
$$;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260731029000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
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
