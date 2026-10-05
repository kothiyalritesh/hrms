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
  v_clean_scope_id uuid;
BEGIN
  -- 1. Check Role Authorization
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND is_active = true;
  IF public.normalize_profile_role(v_actor_role) NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD', 'HR') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_GRANT';
  END IF;

  -- 2. Validate Permission Key
  SELECT EXISTS(SELECT 1 FROM public.permissions WHERE permission_key = p_permission) INTO v_perm_exists;
  IF NOT v_perm_exists THEN RAISE EXCEPTION 'INVALID_PERMISSION_KEY'; END IF;

  -- 3. Safely cast the strings to their strict strict types
  v_enum_scope := p_scope::public.permission_scope;
  v_clean_scope_id := NULLIF(TRIM(p_scope_id), '')::uuid;

  -- 4. Upsert into user_permissions
  INSERT INTO public.user_permissions (user_id, permission, scope, scope_id, granted_by) 
  VALUES (p_user_id, p_permission, v_enum_scope, v_clean_scope_id, v_actor_id)
  ON CONFLICT (user_id, permission, scope, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET revoked_at = NULL, granted_by = v_actor_id, created_at = now();

  -- 5. Audit Log
  INSERT INTO public.permission_audit_logs (target_user_id, actor_id, action, permission, scope, scope_id) 
  VALUES (p_user_id, v_actor_id, 'GRANT', p_permission, v_enum_scope, v_clean_scope_id);

  RETURN jsonb_build_object('success', true);
END;
$$;
NOTIFY pgrst, 'reload schema';
