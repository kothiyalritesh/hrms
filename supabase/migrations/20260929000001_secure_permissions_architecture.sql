-- ==============================================================================
-- Secure Permissions Architecture & Audit Logging
-- Aligns with best practices for multi-dimensional scope RBAC
-- ==============================================================================

-- 1. Define explicit scope enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permission_scope') THEN
    CREATE TYPE public.permission_scope AS ENUM (
      'GLOBAL',
      'OFFICE',
      'DEPARTMENT',
      'TEAM',
      'SELF'
    );
  END IF;
END
$$;

-- 2. Clean up redundant scope information and standardize user_permissions
-- We will create the table if it doesn't exist, or alter it to be strict.
CREATE TABLE IF NOT EXISTS public.user_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    permission text NOT NULL,
    scope public.permission_scope NOT NULL DEFAULT 'GLOBAL',
    scope_id text, -- Polymorphic reference to office UUID, team name, etc.
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    revoked_at timestamptz
);

-- Note: If office_id/department/etc already existed, we would migrate them to scope_id here.
-- For a fresh enforcement, we just rely on scope and scope_id.

-- 3. Add an audit trail
CREATE TABLE IF NOT EXISTS public.permission_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    target_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    permission_key text NOT NULL,
    action text NOT NULL, -- 'GRANT' or 'REVOKE'
    scope public.permission_scope,
    scope_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb
);

-- 4. get_my_permissions() returning scope information
CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permission', up.permission,
        'scope', up.scope,
        'scope_id', up.scope_id
      )
    ),
    '[]'::jsonb
  )
  FROM public.user_permissions up
  WHERE up.user_id = auth.uid()
    AND up.revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_my_permissions() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;

-- 5. admin_grant_permission() with validation and audit logging
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
  -- Validate granting admin authorization
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND is_active = true;
  IF v_actor_role NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_GRANT';
  END IF;

  -- Validate target user
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  -- Validate permission
  SELECT EXISTS (SELECT 1 FROM public.permissions WHERE permission_key = p_permission) INTO v_perm_exists;
  IF NOT v_perm_exists THEN
    RAISE EXCEPTION 'INVALID_PERMISSION_KEY: %', p_permission;
  END IF;

  -- Validate scope ID based on scope type
  IF p_scope = 'OFFICE' THEN
    SELECT EXISTS (SELECT 1 FROM public.offices WHERE id = p_scope_id::uuid) INTO v_office_exists;
    IF NOT v_office_exists THEN RAISE EXCEPTION 'INVALID_OFFICE_ID'; END IF;
  ELSIF p_scope = 'TEAM' THEN
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_scope_id::uuid) INTO v_profile_exists;
    IF NOT v_profile_exists THEN RAISE EXCEPTION 'INVALID_TEAM_LEAD_ID'; END IF;
  END IF;

  -- Invalidate previous identical active permission
  UPDATE public.user_permissions
  SET revoked_at = now()
  WHERE user_id = p_user_id
    AND permission = p_permission
    AND revoked_at IS NULL;

  -- Insert new permission
  INSERT INTO public.user_permissions (
    user_id, permission, scope, scope_id, created_by
  ) VALUES (
    p_user_id, p_permission, p_scope, p_scope_id, v_actor_id
  );

  -- Log audit trail
  INSERT INTO public.permission_audit_logs (
    actor_user_id, target_user_id, permission_key, action, scope, scope_id
  ) VALUES (
    v_actor_id, p_user_id, p_permission, 'GRANT', p_scope, p_scope_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_permission(uuid, text, public.permission_scope, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_permission(uuid, text, public.permission_scope, text) TO authenticated;

-- 6. admin_revoke_permission() with audit logging
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
  IF v_actor_role NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_REVOKE';
  END IF;

  UPDATE public.user_permissions
  SET revoked_at = now()
  WHERE user_id = p_user_id
    AND permission = p_permission
    AND revoked_at IS NULL;

  IF FOUND THEN
    INSERT INTO public.permission_audit_logs (
      actor_user_id, target_user_id, permission_key, action
    ) VALUES (
      v_actor_id, p_user_id, p_permission, 'REVOKE'
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_permission(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_permission(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
