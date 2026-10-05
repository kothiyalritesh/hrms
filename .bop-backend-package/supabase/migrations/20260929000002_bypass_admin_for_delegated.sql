CREATE OR REPLACE FUNCTION public.require_profile_admin()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare 
  v_role text;
  v_has_perms boolean;
begin
  select public.normalize_profile_role(profile.role)
  into v_role
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.is_active = true;

  -- If they have a native admin role, allow immediately
  if coalesce(v_role, '') in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD') then
    return v_role;
  end if;

  -- Otherwise, check if they have ANY dynamically granted screen permissions
  select exists (
    select 1 from public.user_permissions
    where user_id = auth.uid()
      and revoked_at is null
      and permission like 'screen.%'
  ) into v_has_perms;

  if v_has_perms then
    return v_role;
  end if;

  raise exception 'ADMIN_PERMISSION_REQUIRED';
end;
$$;
NOTIFY pgrst, 'reload schema';
