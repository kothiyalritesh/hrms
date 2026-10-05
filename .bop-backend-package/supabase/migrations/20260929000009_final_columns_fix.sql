DO $$
BEGIN
  -- Safely add created_by if it doesn't exist
  BEGIN
    ALTER TABLE public.user_permissions ADD COLUMN created_by uuid REFERENCES public.profiles(id);
  EXCEPTION WHEN duplicate_column THEN
    -- Do nothing
  END;

  -- Safely add revoked_at if it doesn't exist
  BEGIN
    ALTER TABLE public.user_permissions ADD COLUMN revoked_at timestamptz;
  EXCEPTION WHEN duplicate_column THEN
    -- Do nothing
  END;
END $$;

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
  -- 1. Check Role Authorization
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND is_active = true;
  IF public.normalize_profile_role(v_actor_role) NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD', 'HR') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_GRANT';
  END IF;

  -- 2. Validate Permission Key
  SELECT EXISTS(SELECT 1 FROM public.permissions WHERE permission_key = p_permission) INTO v_perm_exists;
  IF NOT v_perm_exists THEN RAISE EXCEPTION 'INVALID_PERMISSION_KEY'; END IF;

  -- 3. Safely cast the strings
  v_enum_scope := p_scope::public.permission_scope;
  IF TRIM(p_scope_id) = '' OR p_scope_id IS NULL THEN
    v_clean_scope_id := NULL;
  ELSE
    v_clean_scope_id := p_scope_id::uuid;
  END IF;

  -- 4. Invalidate old active permissions
  UPDATE public.user_permissions
  SET revoked_at = now()
  WHERE user_id = p_user_id
    AND permission = p_permission
    AND revoked_at IS NULL;

  -- 5. Insert new permission
  INSERT INTO public.user_permissions (user_id, permission, scope, scope_id, created_by) 
  VALUES (p_user_id, p_permission, v_enum_scope, v_clean_scope_id, v_actor_id);

  -- 6. Audit Log
  INSERT INTO public.permission_audit_logs (actor_user_id, target_user_id, action, permission_key, scope, scope_id) 
  VALUES (v_actor_id, p_user_id, 'GRANT', p_permission, v_enum_scope, v_clean_scope_id);

  RETURN jsonb_build_object('success', true);
END;
$$;
NOTIFY pgrst, 'reload schema';
