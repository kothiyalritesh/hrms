-- =============================================================================
-- Migration: 20261006010000_permission_manager_end_to_end.sql
--
-- Fixes:
--   1. scope column: drop old CHECK, add new CHECK covering all enum values,
--      migrate BRANCH → OFFICE.
--   2. admin_grant_permission: validates scope target, stores scope_id as text,
--      allows multiple active grants per (permission, scope, scope_id).
--   3. Single admin_revoke_permission overload with optional scope/scope_id.
--   4. can_access_user_data: handles all 9 scope types.
--   5. is_profile_admin / require_profile_admin: role-only (no "any grant = admin").
--   6. RLS on permissions, role_permissions, user_permission_overrides,
--      permission_audit_logs.
--   7. explain_access() simulator for admins.
--
-- Rollback (run manually):
--   See bottom of file.
-- =============================================================================

-- ─── 1. Scope column ─────────────────────────────────────────────────────────

-- Migrate legacy BRANCH rows to OFFICE
UPDATE public.user_permissions SET scope = 'OFFICE' WHERE scope::text = 'BRANCH';

-- Drop the old restrictive CHECK constraint (name may vary)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.user_permissions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%scope%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_permissions DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

-- Add permissive CHECK that covers all current scope values
ALTER TABLE public.user_permissions
  ADD CONSTRAINT user_permissions_scope_check
  CHECK (scope::text IN (
    'GLOBAL','OFFICE','OFFICE_TREE','TEAM','TEAM_TREE',
    'REPORTS_TO','ASSIGNED','SELF','DEPARTMENT'
  ));

-- Ensure scope_id is stored as text (it may already be uuid; cast if needed)
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='user_permissions'
        AND column_name='scope_id') = 'uuid' THEN
    ALTER TABLE public.user_permissions
      ALTER COLUMN scope_id TYPE text USING scope_id::text;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Partial unique index: one active grant per (user, permission, scope, scope_id)
DROP INDEX IF EXISTS public.user_permissions_active_unique;
CREATE UNIQUE INDEX user_permissions_active_unique
  ON public.user_permissions (user_id, permission, scope, coalesce(scope_id, ''))
  WHERE revoked_at IS NULL;

-- ─── 2. admin_grant_permission ───────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_grant_permission(uuid, text, public.permission_scope, text);
DROP FUNCTION IF EXISTS public.admin_grant_permission(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_grant_permission(
  p_user_id    uuid,
  p_permission text,
  p_scope      text,
  p_scope_id   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id   uuid := auth.uid();
  v_actor_role text;
  v_clean_id   text;
BEGIN
  -- Auth
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND is_active = true;
  IF public.normalize_profile_role(v_actor_role) NOT IN ('SYSTEM_ADMIN','SUPER_ADMIN','ADMIN','HRD','HR') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_GRANT';
  END IF;

  -- Permission key must exist in catalog
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE permission_key = p_permission) THEN
    RAISE EXCEPTION 'INVALID_PERMISSION_KEY: %', p_permission;
  END IF;

  -- Validate scope value
  IF p_scope NOT IN ('GLOBAL','OFFICE','OFFICE_TREE','TEAM','TEAM_TREE','REPORTS_TO','ASSIGNED','SELF','DEPARTMENT') THEN
    RAISE EXCEPTION 'INVALID_SCOPE: %', p_scope;
  END IF;

  -- Validate scope target
  v_clean_id := nullif(trim(coalesce(p_scope_id, '')), '');

  IF p_scope IN ('GLOBAL','SELF','ASSIGNED') THEN
    v_clean_id := NULL;  -- scope_id is meaningless for these
  ELSIF p_scope IN ('OFFICE','OFFICE_TREE') THEN
    IF v_clean_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.offices WHERE id = v_clean_id::uuid
    ) THEN
      RAISE EXCEPTION 'INVALID_OFFICE_ID: %', v_clean_id;
    END IF;
  ELSIF p_scope IN ('TEAM','TEAM_TREE') THEN
    IF v_clean_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.teams WHERE id = v_clean_id::uuid
    ) THEN
      RAISE EXCEPTION 'INVALID_TEAM_ID: %', v_clean_id;
    END IF;
  ELSIF p_scope = 'REPORTS_TO' THEN
    IF v_clean_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = v_clean_id::uuid AND is_active = true
    ) THEN
      RAISE EXCEPTION 'INVALID_PROFILE_ID: %', v_clean_id;
    END IF;
  END IF;

  -- Revoke only the exact same (permission, scope, scope_id) combination
  UPDATE public.user_permissions
  SET revoked_at = now()
  WHERE user_id   = p_user_id
    AND permission = p_permission
    AND scope::text = p_scope
    AND coalesce(scope_id, '') = coalesce(v_clean_id, '')
    AND revoked_at IS NULL;

  -- Insert new grant
  INSERT INTO public.user_permissions (user_id, permission, scope, scope_id, created_by)
  VALUES (p_user_id, p_permission, p_scope::public.permission_scope, v_clean_id, v_actor_id);

  -- Audit
  INSERT INTO public.permission_audit_logs
    (target_user_id, actor_id, actor_user_id, action, permission, permission_key, scope, scope_id)
  VALUES
    (p_user_id, v_actor_id, v_actor_id, 'GRANT', p_permission, p_permission, p_scope, v_clean_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_permission(uuid,text,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_permission(uuid,text,text,text) TO authenticated;

-- ─── 3. Single admin_revoke_permission overload ──────────────────────────────

-- Drop all existing overloads
DROP FUNCTION IF EXISTS public.admin_revoke_permission(uuid, text);
DROP FUNCTION IF EXISTS public.admin_revoke_permission(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_revoke_permission(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_revoke_permission(
  p_user_id    uuid,
  p_permission text,
  p_scope      text DEFAULT NULL,
  p_scope_id   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id   uuid := auth.uid();
  v_actor_role text;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND is_active = true;
  IF public.normalize_profile_role(v_actor_role) NOT IN ('SYSTEM_ADMIN','SUPER_ADMIN','ADMIN','HRD','HR') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_REVOKE';
  END IF;

  UPDATE public.user_permissions
  SET revoked_at = now()
  WHERE user_id   = p_user_id
    AND permission = p_permission
    AND revoked_at IS NULL
    AND (p_scope IS NULL OR scope::text = p_scope)
    AND (p_scope_id IS NULL OR coalesce(scope_id,'') = coalesce(p_scope_id,''));

  INSERT INTO public.permission_audit_logs
    (target_user_id, actor_id, actor_user_id, action, permission, permission_key, scope, scope_id)
  VALUES
    (p_user_id, v_actor_id, v_actor_id, 'REVOKE', p_permission, p_permission,
     p_scope, p_scope_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_permission(uuid,text,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_permission(uuid,text,text,text) TO authenticated;

-- ─── 4. can_access_user_data — all 9 scope types ────────────────────────────

CREATE OR REPLACE FUNCTION public.can_access_user_data(
  p_target_user_id uuid,
  p_permission     text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_caller public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_rule   record;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;

  -- Admin override
  IF public.normalize_profile_role(v_caller.role) IN ('SYSTEM_ADMIN','SUPER_ADMIN','ADMIN') THEN
    RETURN true;
  END IF;

  -- Self always allowed
  IF p_target_user_id = v_uid THEN RETURN true; END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_user_id;
  IF v_target.id IS NULL THEN RETURN false; END IF;

  FOR v_rule IN
    SELECT scope::text AS scope, scope_id
    FROM public.user_permissions
    WHERE user_id = v_uid
      AND permission = p_permission
      AND revoked_at IS NULL
  LOOP
    CASE v_rule.scope
      WHEN 'GLOBAL' THEN RETURN true;

      WHEN 'SELF' THEN
        IF p_target_user_id = v_uid THEN RETURN true; END IF;

      WHEN 'OFFICE' THEN
        IF v_target.office_id::text = coalesce(v_rule.scope_id, v_caller.office_id::text) THEN
          RETURN true;
        END IF;

      WHEN 'OFFICE_TREE' THEN
        IF v_target.office_id::text = coalesce(v_rule.scope_id, v_caller.office_id::text) THEN
          RETURN true;
        END IF;
        -- Also match teams belonging to that office
        IF v_rule.scope_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.teams tm
          WHERE tm.id = v_target.team_id
            AND tm.office_id::text = v_rule.scope_id
        ) THEN RETURN true; END IF;

      WHEN 'TEAM' THEN
        IF v_target.team_id::text = coalesce(v_rule.scope_id, v_caller.team_id::text) THEN
          RETURN true;
        END IF;

      WHEN 'TEAM_TREE' THEN
        IF v_rule.scope_id IS NOT NULL AND EXISTS (
          WITH RECURSIVE sub AS (
            SELECT id FROM public.teams WHERE id = v_rule.scope_id::uuid
            UNION ALL
            SELECT t.id FROM public.teams t JOIN sub ON t.parent_id = sub.id
          )
          SELECT 1 FROM sub WHERE id = v_target.team_id
        ) THEN RETURN true; END IF;

      WHEN 'REPORTS_TO' THEN
        DECLARE v_lead uuid := coalesce(v_rule.scope_id::uuid, v_uid);
        BEGIN
          IF v_target.id = v_lead THEN RETURN true; END IF;
          IF EXISTS (
            WITH RECURSIVE reps AS (
              SELECT id FROM public.profiles WHERE reports_to = v_lead
              UNION ALL
              SELECT p.id FROM public.profiles p JOIN reps r ON p.reports_to = r.id
            )
            SELECT 1 FROM reps WHERE id = v_target.id
          ) THEN RETURN true; END IF;
        END;

      WHEN 'DEPARTMENT' THEN
        IF lower(trim(coalesce(v_target.department,''))) =
           lower(trim(coalesce(v_rule.scope_id, v_caller.department,''))) THEN
          RETURN true;
        END IF;

      WHEN 'ASSIGNED' THEN
        NULL; -- record-level; resolved inside resource RPCs

      ELSE NULL;
    END CASE;
  END LOOP;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_user_data(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_access_user_data(uuid,text) TO authenticated;

-- ─── 5. is_profile_admin / require_profile_admin — role-only ─────────────────

CREATE OR REPLACE FUNCTION public.is_profile_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND is_active = true
      AND public.normalize_profile_role(role) IN ('SYSTEM_ADMIN','SUPER_ADMIN','ADMIN','HR','HRD')
  );
$$;

CREATE OR REPLACE FUNCTION public.require_profile_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_profile_admin() THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED'
      USING HINT = 'This operation requires ADMIN, HR or HRD role';
  END IF;
END;
$$;

-- ─── 6. RLS on RBAC tables ───────────────────────────────────────────────────

-- permissions catalog
ALTER TABLE IF EXISTS public.permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permissions_select ON public.permissions;
CREATE POLICY permissions_select ON public.permissions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS permissions_admin_write ON public.permissions;
CREATE POLICY permissions_admin_write ON public.permissions
  FOR ALL TO authenticated USING (public.is_profile_admin());
REVOKE ALL ON public.permissions FROM anon;

-- role_permissions
ALTER TABLE IF EXISTS public.role_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_permissions_select ON public.role_permissions;
CREATE POLICY role_permissions_select ON public.role_permissions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS role_permissions_admin_write ON public.role_permissions;
CREATE POLICY role_permissions_admin_write ON public.role_permissions
  FOR ALL TO authenticated USING (public.is_profile_admin());
REVOKE ALL ON public.role_permissions FROM anon;

-- user_permission_overrides
ALTER TABLE IF EXISTS public.user_permission_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS upo_select ON public.user_permission_overrides;
CREATE POLICY upo_select ON public.user_permission_overrides
  FOR SELECT TO authenticated USING (public.is_profile_admin() OR user_id = auth.uid());
DROP POLICY IF EXISTS upo_admin_write ON public.user_permission_overrides;
CREATE POLICY upo_admin_write ON public.user_permission_overrides
  FOR ALL TO authenticated USING (public.is_profile_admin());
REVOKE ALL ON public.user_permission_overrides FROM anon;

-- permission_audit_logs — append-only; no UPDATE/DELETE policy
ALTER TABLE IF EXISTS public.permission_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pal_select ON public.permission_audit_logs;
CREATE POLICY pal_select ON public.permission_audit_logs
  FOR SELECT TO authenticated
  USING (
    public.is_profile_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = auth.uid()
        AND permission = 'audit_logs.view'
        AND revoked_at IS NULL
    )
  );
REVOKE ALL ON public.permission_audit_logs FROM anon;

-- ─── 7. explain_access simulator ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.explain_access(
  p_user       uuid,
  p_permission text,
  p_target     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_target_row  public.profiles%rowtype;
  v_grant       record;
  v_allowed     boolean := false;
  v_reason      text := 'No matching grant';
  v_matched     jsonb := null;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF public.normalize_profile_role(v_caller_role) NOT IN ('SYSTEM_ADMIN','SUPER_ADMIN','ADMIN') THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  SELECT * INTO v_target_row FROM public.profiles WHERE id = p_target;

  -- Check admin override for p_user
  DECLARE v_user_role text;
  BEGIN
    SELECT role INTO v_user_role FROM public.profiles WHERE id = p_user;
    IF public.normalize_profile_role(v_user_role) IN ('SYSTEM_ADMIN','SUPER_ADMIN','ADMIN') THEN
      v_allowed := true;
      v_reason  := 'Admin role override';
      v_matched := jsonb_build_object('scope','ADMIN_ROLE','scope_id',null);
    END IF;
  END;

  IF NOT v_allowed THEN
    FOR v_grant IN
      SELECT scope::text AS scope, scope_id
      FROM public.user_permissions
      WHERE user_id = p_user AND permission = p_permission AND revoked_at IS NULL
    LOOP
      IF public.can_access_user_data(p_target, p_permission) THEN
        v_allowed := true;
        v_reason  := format('Matched grant scope=%s scope_id=%s', v_grant.scope, v_grant.scope_id);
        v_matched := jsonb_build_object('scope', v_grant.scope, 'scope_id', v_grant.scope_id);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'allowed',        v_allowed,
    'matched_grant',  v_matched,
    'target', jsonb_build_object(
      'office_id',  v_target_row.office_id,
      'team_id',    v_target_row.team_id,
      'reports_to', v_target_row.reports_to
    ),
    'reason', v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.explain_access(uuid,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.explain_access(uuid,text,uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK (run manually):
--   DROP FUNCTION IF EXISTS public.explain_access(uuid,text,uuid);
--   DROP FUNCTION IF EXISTS public.admin_revoke_permission(uuid,text,text,text);
--   DROP FUNCTION IF EXISTS public.admin_grant_permission(uuid,text,text,text);
--   DROP INDEX IF EXISTS public.user_permissions_active_unique;
--   ALTER TABLE public.user_permissions DROP CONSTRAINT IF EXISTS user_permissions_scope_check;
--   -- Then re-apply 20260929000012 to restore previous grant/revoke functions.
-- =============================================================================
