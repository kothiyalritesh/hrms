-- Restore read visibility for trusted HRMS administrators after the RLS
-- guardrail migration. Existing employee/manager policies remain in place;
-- this policy only adds SELECT access for an active privileged profile.

create or replace function public.normalize_profile_role(p_role text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case regexp_replace(
    upper(btrim(coalesce(p_role, ''))),
    '[^A-Z0-9]+',
    '_',
    'g'
  )
    when 'SUPER_ADMIN' then 'SYSTEM_ADMIN'
    when 'SUPERADMIN' then 'SYSTEM_ADMIN'
    when 'SYSTEMADMIN' then 'SYSTEM_ADMIN'
    when 'SYS_ADMIN' then 'SYSTEM_ADMIN'
    when 'ADMINISTRATOR' then 'ADMIN'
    when 'HR_MANAGER' then 'HR'
    else regexp_replace(
      upper(btrim(coalesce(p_role, ''))),
      '[^A-Z0-9]+',
      '_',
      'g'
    )
  end
$$;

revoke all on function public.normalize_profile_role(text)
  from public, anon;
grant execute on function public.normalize_profile_role(text)
  to authenticated, service_role;

create or replace function public.is_profile_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles actor
    where actor.id = auth.uid()
      and actor.is_active = true
      and public.normalize_profile_role(actor.role) in (
        'SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD'
      )
  )
$$;

revoke all on function public.is_profile_admin()
  from public, anon;
grant execute on function public.is_profile_admin()
  to authenticated, service_role;

create or replace function public.require_profile_admin()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_role text;
begin
  select public.normalize_profile_role(profile.role)
  into v_role
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.is_active = true;

  if coalesce(v_role, '') not in (
    'SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD'
  ) then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;
  return v_role;
end;
$$;

revoke all on function public.require_profile_admin()
  from public, anon;
grant execute on function public.require_profile_admin()
  to authenticated, service_role;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles',
    'roles',
    'offices',
    'attendance_logs',
    'location_tracking',
    'attendance_fraud_events',
    'attendance_audit_logs',
    'smartoffice_device_logs',
    'leave_balance',
    'field_visits',
    'field_visit_location_audit',
    'notifications'
  ]
  loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'ADMIN_READ_TABLE_MISSING: %', v_table;
    end if;

    execute format(
      'drop policy if exists profile_admin_read_all on public.%I',
      v_table
    );
    execute format(
      'create policy profile_admin_read_all on public.%I '
      || 'for select to authenticated using (public.is_profile_admin())',
      v_table
    );
    execute format(
      'grant select on table public.%I to authenticated',
      v_table
    );
  end loop;
end
$$;

notify pgrst, 'reload schema';
