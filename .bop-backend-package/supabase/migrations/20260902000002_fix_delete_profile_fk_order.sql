begin;

create or replace function public.rpc_admin_delete_profile(
  p_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_target_role text;
  v_name        text;
begin
  select upper(coalesce(role, '')) into v_actor_role
  from public.profiles
  where id = v_actor and is_active = true;

  if v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD') then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;

  if p_profile_id = v_actor then
    raise exception 'CANNOT_DELETE_CURRENT_USER';
  end if;

  select role, name into v_target_role, v_name
  from public.profiles
  where id = p_profile_id;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  if upper(coalesce(v_target_role, '')) in ('SYSTEM_ADMIN', 'SUPER_ADMIN')
     and v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
    raise exception 'SYSTEM_ADMIN_PERMISSION_REQUIRED';
  end if;

  -- Nullify manager references so other employees are not orphaned
  update public.profiles set reports_to = null where reports_to = p_profile_id;

  -- Tables that FK-reference attendance_logs(id) ON DELETE RESTRICT
  -- must be cleared before attendance_logs rows are deleted
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'attendance_action_requests') then
    execute 'delete from public.attendance_action_requests where attendance_id in (select id from public.attendance_logs where user_id = $1)' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'biometric_attendance_correction_audit') then
    execute 'delete from public.biometric_attendance_correction_audit where attendance_id in (select id from public.attendance_logs where user_id = $1)' using p_profile_id;
  end if;

  -- Tables that FK-reference profiles(id) ON DELETE RESTRICT
  -- must be cleared before the profile row is deleted
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'biometric_import_batch_items') then
    execute 'delete from public.biometric_import_batch_items where user_id = $1' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'protected_system_admin_profiles') then
    execute 'delete from public.protected_system_admin_profiles where profile_id = $1' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'biometric_device_mappings') then
    execute 'delete from public.biometric_device_mappings where user_id = $1' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'biometric_unmapped_alerts') then
    execute 'update public.biometric_unmapped_alerts set assigned_user_id = null, resolved_by = null where assigned_user_id = $1 or resolved_by = $1' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'employee_biometric_mappings') then
    execute 'delete from public.employee_biometric_mappings where user_id = $1' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'daily_route_summaries') then
    execute 'delete from public.daily_route_summaries where user_id = $1' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'transit_warnings') then
    execute 'delete from public.transit_warnings where user_id = $1' using p_profile_id;
  end if;

  -- Standard related records
  delete from public.hrms_audit_events                   where actor_user_id = p_profile_id or target_user_id = p_profile_id;
  delete from public.user_device_sessions                where user_id = p_profile_id;
  delete from public.employee_assignment_history         where profile_id = p_profile_id;
  delete from public.field_visits                        where user_id = p_profile_id;
  delete from public.attendance_logs                     where user_id = p_profile_id;
  delete from public.location_tracking                   where user_id = p_profile_id;
  delete from public.notifications                       where user_id = p_profile_id;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'attendance_regularization_requests') then
    execute 'delete from public.attendance_regularization_requests where user_id = $1' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'attendance_summaries') then
    execute 'delete from public.attendance_summaries where user_id = $1' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'location_pings') then
    execute 'delete from public.location_pings where user_id = $1' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'leave_requests') then
    execute 'delete from public.leave_requests where user_id = $1' using p_profile_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'biometric_attendance_records') then
    execute 'delete from public.biometric_attendance_records where user_id = $1' using p_profile_id;
  end if;

  delete from public.profiles where id = p_profile_id;
  delete from auth.users     where id = p_profile_id;

  return jsonb_build_object(
    'success',    true,
    'profile_id', p_profile_id,
    'name',       v_name
  );
end;
$$;

commit;
