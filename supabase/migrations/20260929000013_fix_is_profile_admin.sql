CREATE OR REPLACE FUNCTION public.is_profile_admin()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_has_perms boolean;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true;

  IF coalesce(v_role, '') IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD') THEN
    RETURN true;
  END IF;

  -- If they have ANY granular permissions, we treat them as an admin for read policies
  SELECT EXISTS (
    SELECT 1 FROM public.user_permissions
    WHERE user_id = auth.uid() AND revoked_at IS NULL
  ) INTO v_has_perms;

  RETURN v_has_perms;
END;
$$;
NOTIFY pgrst, 'reload schema';
