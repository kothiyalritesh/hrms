begin;

-- Hard-delete an employee profile and all their related records.
-- Uses auth.uid() for the permission check — never trusts a caller-supplied ID.
-- Nullifies reports_to on other profiles so the org hierarchy is not broken.

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
  -- Permission check using auth.uid()
  select upper(coalesce(role, '')) into v_actor_role
  from public.profiles
  where id = v_actor and is_active = true;

  if v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD') then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;

  -- Cannot delete yourself
  if p_profile_id = v_actor then
    raise exception 'CANNOT_DELETE_CURRENT_USER';
  end if;

  -- Fetch target
  select role, name into v_target_role, v_name
  from public.profiles
  where id = p_profile_id;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  -- Only SYSTEM_ADMIN can delete another SYSTEM_ADMIN
  if upper(coalesce(v_target_role, '')) in ('SYSTEM_ADMIN', 'SUPER_ADMIN')
     and v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
    raise exception 'SYSTEM_ADMIN_PERMISSION_REQUIRED';
  end if;

  -- Nullify manager references so other employees are not orphaned
  update public.profiles
  set reports_to = null
  where reports_to = p_profile_id;

  -- Delete related records in dependency order
  delete from public.hrms_audit_events                   where actor_user_id = p_profile_id or target_user_id = p_profile_id;
  delete from public.user_device_sessions                where user_id = p_profile_id;
  delete from public.employee_assignment_history         where profile_id = p_profile_id;
  delete from public.attendance_regularization_requests where user_id = p_profile_id;
  delete from public.field_visits                        where user_id = p_profile_id;
  delete from public.attendance_logs                     where user_id = p_profile_id;
  delete from public.location_tracking                   where user_id = p_profile_id;
  delete from public.notifications                       where user_id = p_profile_id;

  -- Delete optional tables only if they exist
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

  -- Delete the profile row
  delete from public.profiles where id = p_profile_id;

  -- Delete from Supabase auth (requires service role via security definer)
  delete from auth.users where id = p_profile_id;

  return jsonb_build_object(
    'success',    true,
    'profile_id', p_profile_id,
    'name',       v_name
  );
end;
$$;

revoke all on function public.rpc_admin_delete_profile(uuid) from public, anon;
grant execute on function public.rpc_admin_delete_profile(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
