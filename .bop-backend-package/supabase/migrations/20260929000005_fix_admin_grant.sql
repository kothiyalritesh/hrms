CREATE OR REPLACE FUNCTION public.admin_grant_permission(
  p_user_id uuid,
  p_permission text,
  p_scope public.permission_scope,
  p_scope_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_perm_exists boolean;
  v_office_exists boolean;
  v_profile_exists boolean;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND is_active = true;
  IF public.normalize_profile_role(v_actor_role) NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD', 'HR') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_GRANT';
  END IF;

  -- 1. Validate permission key exists
  SELECT EXISTS(SELECT 1 FROM public.permissions WHERE permission_key = p_permission) INTO v_perm_exists;
  IF NOT v_perm_exists THEN RAISE EXCEPTION 'INVALID_PERMISSION_KEY'; END IF;

  -- 2. Validate scope_id if provided
  IF p_scope_id IS NOT NULL THEN
    IF p_scope = 'OFFICE' THEN
      SELECT EXISTS(SELECT 1 FROM public.offices WHERE id = p_scope_id::uuid) INTO v_office_exists;
      IF NOT v_office_exists THEN RAISE EXCEPTION 'INVALID_OFFICE_ID'; END IF;
    ELSIF p_scope = 'TEAM' THEN
      -- If they provided a UUID, check profile, otherwise assume team name string
      IF p_scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = p_scope_id::uuid) INTO v_profile_exists;
        IF NOT v_profile_exists THEN RAISE EXCEPTION 'INVALID_TEAM_LEAD_ID'; END IF;
      END IF;
    END IF;
  END IF;

  -- 3. Upsert into user_permissions
  INSERT INTO public.user_permissions (
    user_id, permission, scope, scope_id, granted_by
  ) VALUES (
    p_user_id, p_permission, p_scope, p_scope_id, v_actor_id
  )
  ON CONFLICT (user_id, permission, scope, coalesce(scope_id, ''))
  DO UPDATE SET
    revoked_at = NULL,
    granted_by = v_actor_id,
    created_at = now();

  -- 4. Audit Log
  INSERT INTO public.permission_audit_logs (
    target_user_id, actor_id, action, permission, scope, scope_id
  ) VALUES (
    p_user_id, v_actor_id, 'GRANT', p_permission, p_scope, p_scope_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_permission(
  p_user_id uuid,
  p_permission text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND is_active = true;
  IF public.normalize_profile_role(v_actor_role) NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD', 'HR') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_REVOKE';
  END IF;

  UPDATE public.user_permissions
  SET revoked_at = now()
  WHERE user_id = p_user_id
    AND permission = p_permission
    AND revoked_at IS NULL;

  INSERT INTO public.permission_audit_logs (
    target_user_id, actor_id, action, permission
  ) VALUES (
    p_user_id, v_actor_id, 'REVOKE', p_permission
  );

  RETURN jsonb_build_object('success', true);
END;
$$;
NOTIFY pgrst, 'reload schema';
