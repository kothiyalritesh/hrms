DO $$
BEGIN
  -- 1. Ensure table exists first!
  CREATE TABLE IF NOT EXISTS public.permission_audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now()
  );

  -- 2. Forcefully add all possible columns to the audit log so we stop guessing
  BEGIN ALTER TABLE public.permission_audit_logs ADD COLUMN actor_id uuid REFERENCES public.profiles(id); EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE public.permission_audit_logs ADD COLUMN actor_user_id uuid REFERENCES public.profiles(id); EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE public.permission_audit_logs ADD COLUMN permission text; EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE public.permission_audit_logs ADD COLUMN permission_key text; EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE public.permission_audit_logs ADD COLUMN target_user_id uuid REFERENCES public.profiles(id); EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE public.permission_audit_logs ADD COLUMN action text; EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE public.permission_audit_logs ADD COLUMN scope text; EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE public.permission_audit_logs ADD COLUMN scope_id text; EXCEPTION WHEN duplicate_column THEN END;
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

  -- Use BOTH columns if they exist, to be absolutely bulletproof
  INSERT INTO public.permission_audit_logs (target_user_id, actor_id, actor_user_id, action, permission, permission_key, scope, scope_id) 
  VALUES (p_user_id, v_actor_id, v_actor_id, 'GRANT', p_permission, p_permission, v_enum_scope::text, v_clean_scope_id::text);

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_permission(
  p_user_id uuid,
  p_permission text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

  INSERT INTO public.permission_audit_logs (target_user_id, actor_id, actor_user_id, action, permission, permission_key) 
  VALUES (p_user_id, v_actor_id, v_actor_id, 'REVOKE', p_permission, p_permission);

  RETURN jsonb_build_object('success', true);
END;
$$;
NOTIFY pgrst, 'reload schema';
