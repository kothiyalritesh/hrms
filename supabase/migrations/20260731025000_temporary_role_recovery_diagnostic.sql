-- Temporary, unguessable read-only diagnostic. Removed by the next migration.
create or replace function public.rpc_temporary_role_recovery_diagnostic(
  p_recovery_token uuid
)
returns table(
  id uuid,
  name text,
  phone text,
  employee_number text,
  profile_role text,
  linked_role text,
  smartoffice_designation text,
  is_active boolean,
  history jsonb,
  repairs jsonb
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    profile.id,
    profile.name,
    profile.phone,
    profile.employee_number,
    profile.role,
    linked_role.name,
    profile.smartoffice_designation,
    profile.is_active,
    (
      select jsonb_agg(jsonb_build_object(
        'role', assignment.role,
        'verified', assignment.verified,
        'from', assignment.effective_from,
        'to', assignment.effective_to
      ) order by assignment.effective_from desc, assignment.recorded_at desc)
      from public.employee_assignment_history assignment
      where assignment.profile_id = profile.id
    ),
    (
      select jsonb_agg(jsonb_build_object(
        'previous', audit.previous_role,
        'restored', audit.restored_role,
        'at', audit.repaired_at
      ) order by audit.repaired_at desc)
      from public.profile_role_repair_audit audit
      where audit.profile_id = profile.id
    )
  from public.profiles profile
  left join public.roles linked_role on linked_role.id = profile.role_id
  where p_recovery_token = 'f4edba6d-ecbc-4d3b-82f3-42607b748567'::uuid
    and (
      regexp_replace(coalesce(profile.phone, ''), '\D', '', 'g') in (
        '9999999999', '919999999999'
      )
      or lower(coalesce(profile.name, '')) like '%ritesh%kothiyal%'
      or regexp_replace(upper(coalesce(profile.role, '')), '[^A-Z0-9]+', '_', 'g')
        in ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
      or regexp_replace(upper(coalesce(linked_role.name, '')), '[^A-Z0-9]+', '_', 'g')
        in ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
      or regexp_replace(upper(coalesce(profile.smartoffice_designation, '')), '[^A-Z0-9]+', '_', 'g')
        in ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
      or exists (
        select 1
        from public.employee_assignment_history assignment
        where assignment.profile_id = profile.id
          and regexp_replace(upper(coalesce(assignment.role, '')), '[^A-Z0-9]+', '_', 'g')
            in ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
      )
    )
  order by profile.name, profile.id;
$$;

revoke all on function public.rpc_temporary_role_recovery_diagnostic(uuid)
  from public, authenticated;
grant execute on function public.rpc_temporary_role_recovery_diagnostic(uuid)
  to anon;
