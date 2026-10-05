DROP FUNCTION IF EXISTS public.admin_grant_permission(uuid, text, public.permission_scope, text);
DROP FUNCTION IF EXISTS public.admin_grant_permission(uuid, text, text, text);

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
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND is_active = true;
  IF public.normalize_profile_role(v_actor_role) NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD', 'HR') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_GRANT';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.permissions WHERE permission_key = p_permission) INTO v_perm_exists;
  IF NOT v_perm_exists THEN RAISE EXCEPTION 'INVALID_PERMISSION_KEY'; END IF;

  v_enum_scope := p_scope::public.permission_scope;
  
  IF TRIM(p_scope_id) = '' OR p_scope_id IS NULL THEN
    v_clean_scope_id := NULL;
  ELSE
    v_clean_scope_id := p_scope_id::uuid;
  END IF;

  UPDATE public.user_permissions
  SET revoked_at = now()
  WHERE user_id = p_user_id
    AND permission = p_permission
    AND revoked_at IS NULL;

  INSERT INTO public.user_permissions (user_id, permission, scope, scope_id, created_by) 
  VALUES (p_user_id, p_permission, v_enum_scope, v_clean_scope_id, v_actor_id);

  -- FIXED: Correct Audit Log Columns
  INSERT INTO public.permission_audit_logs (target_user_id, actor_id, action, permission, scope, scope_id) 
  VALUES (p_user_id, v_actor_id, 'GRANT', p_permission, v_enum_scope, v_clean_scope_id::text);

  RETURN jsonb_build_object('success', true);
END;
$$;
