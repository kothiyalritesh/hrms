DROP FUNCTION IF EXISTS public.admin_grant_permission(uuid, text, public.permission_scope, text);

CREATE OR REPLACE FUNCTION public.admin_grant_permission(
  p_user_id uuid,
  p_permission text,
  p_scope text,
  p_scope_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_perm_exists boolean;
  v_enum_scope public.permission_scope;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND is_active = true;
  IF public.normalize_profile_role(v_actor_role) NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD', 'HR') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_GRANT';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.permissions WHERE permission_key = p_permission) INTO v_perm_exists;
  IF NOT v_perm_exists THEN RAISE EXCEPTION 'INVALID_PERMISSION_KEY'; END IF;

  v_enum_scope := p_scope::public.permission_scope;

  INSERT INTO public.user_permissions (user_id, permission, scope, scope_id, granted_by) 
  VALUES (p_user_id, p_permission, v_enum_scope, p_scope_id, v_actor_id)
  ON CONFLICT (user_id, permission, scope, coalesce(scope_id, ''))
  DO UPDATE SET revoked_at = NULL, granted_by = v_actor_id, created_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;
NOTIFY pgrst, 'reload schema';
