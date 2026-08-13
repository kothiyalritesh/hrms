-- 10:31:00 Asia/Kolkata is still on time. A check-in is late only when its
-- authoritative server timestamp is strictly later than 10:31:00.

update public.attendance_policies
set late_checkin_time = time '10:31:00'
where late_checkin_time is distinct from time '10:31:00';

-- The attendance-policy trigger above creates/replaces today's effective-dated
-- history record without rewriting the cutoff used by earlier business dates.

-- Reclassify today's existing records so every current screen and report agrees
-- immediately. Older attendance retains the policy that applied on that date.
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
  where attendance.date >= (now() at time zone 'Asia/Kolkata')::date
    and attendance.checkin_time is not null
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
    'attendance_late_cutoff', '10:31:00',
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
