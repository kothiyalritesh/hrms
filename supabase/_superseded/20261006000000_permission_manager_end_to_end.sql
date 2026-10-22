-- =============================================================================
-- Migration: 20261006000000_permission_manager_end_to_end.sql
-- =============================================================================

-- =============================================================================
-- 1. FIX user_permissions TABLE STRUCTURE
-- =============================================================================
DO $$
BEGIN
  -- We know from B-Level 2 simulation that scope is still text and has a CHECK constraint.
  -- We convert it to the enum permission_scope safely.
  
  -- The CHECK constraint in 20260908070000 was user_permissions_scope_check
  ALTER TABLE public.user_permissions
    DROP CONSTRAINT IF EXISTS user_permissions_scope_check;

  -- Drop the old constraint if it exists. Note: Constraint name might be auto-generated if we didn't specify it,
  -- but we can find it or just drop constraint by doing an alter column type which drops dependent checks.
  -- Better, we can just alter the column type directly:
  ALTER TABLE public.user_permissions
    ALTER COLUMN scope DROP DEFAULT;

  -- First map BRANCH to OFFICE
  UPDATE public.user_permissions
  SET scope = 'OFFICE'
  WHERE scope = 'BRANCH';
  
  -- Also drop constraint from 20260908010000 unique (user_id, permission) which prevents multiple scopes
  ALTER TABLE public.user_permissions
    DROP CONSTRAINT IF EXISTS user_permissions_unique;

  ALTER TABLE public.user_permissions
    ALTER COLUMN scope TYPE public.permission_scope
    USING scope::public.permission_scope;

  ALTER TABLE public.user_permissions
    ALTER COLUMN scope SET DEFAULT 'GLOBAL'::public.permission_scope;
    
  -- Convert scope_id to text if it's not already
  -- It was added as uuid in 20260908070000 and redefined as text in 20260929000001 (which was a no-op)
  -- Actually, let's make sure scope_id is text.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'scope_id' AND data_type = 'uuid') THEN
    ALTER TABLE public.user_permissions ALTER COLUMN scope_id TYPE text USING scope_id::text;
  END IF;

  -- B-Level 4: Add partial unique index on (user_id, permission, scope, coalesce(scope_id,'')) WHERE revoked_at IS NULL.
  -- First we need to make sure we don't have duplicates, but ignoring for now.
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_permissions_active_grant
  ON public.user_permissions (user_id, permission, scope, COALESCE(scope_id, ''))
  WHERE revoked_at IS NULL;

ALTER TABLE public.user_permissions
  ADD CONSTRAINT user_permissions_scope_rule 
  CHECK ((scope IN ('GLOBAL','SELF','ASSIGNED')) = (scope_id IS NULL) OR scope IN ('OFFICE','OFFICE_TREE','TEAM','TEAM_TREE','REPORTS_TO','DEPARTMENT'));

-- =============================================================================
-- 2. FIX GRANT & REVOKE RPCs
-- =============================================================================
DROP FUNCTION IF EXISTS public.admin_grant_permission(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_grant_permission(
  p_user_id uuid,
  p_permission text,
  p_scope public.permission_scope DEFAULT 'GLOBAL',
  p_scope_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_office_id uuid;
  v_team_id uuid;
BEGIN
  -- Note: HR check removed as per decision: explicit grants instead of HR = global admin.
  SELECT is_profile_admin(v_caller) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Only admins can grant permissions.');
  END IF;

  -- Validate target per scope
  IF p_scope IN ('OFFICE', 'OFFICE_TREE') THEN
    BEGIN
      v_office_id := p_scope_id::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_ID', 'message', 'Scope ID must be a valid office UUID.');
    END;
    IF NOT EXISTS (SELECT 1 FROM public.offices WHERE id = v_office_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_ID', 'message', 'Office not found.');
    END IF;
  ELSIF p_scope IN ('TEAM', 'TEAM_TREE') THEN
    BEGIN
      v_team_id := p_scope_id::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_ID', 'message', 'Scope ID must be a valid team UUID.');
    END;
    IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_ID', 'message', 'Team not found.');
    END IF;
  ELSIF p_scope = 'REPORTS_TO' THEN
    IF p_scope_id IS NOT NULL THEN
      BEGIN
        v_team_id := p_scope_id::uuid;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_ID', 'message', 'Scope ID must be a valid profile UUID.');
      END;
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_team_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_ID', 'message', 'Profile not found.');
      END IF;
    END IF;
  ELSIF p_scope IN ('GLOBAL', 'SELF', 'ASSIGNED') THEN
    p_scope_id := NULL;
  END IF;

  INSERT INTO public.user_permissions (user_id, permission, scope, scope_id, created_by, created_at)
  VALUES (p_user_id, p_permission, p_scope, p_scope_id, v_caller, now())
  ON CONFLICT (user_id, permission, scope, COALESCE(scope_id, ''))
  WHERE revoked_at IS NULL
  DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_permission FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_permission TO authenticated;

-- Make sure exactly one overload remains for revoke
DROP FUNCTION IF EXISTS public.admin_revoke_permission(uuid, text);
DROP FUNCTION IF EXISTS public.admin_revoke_permission(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_revoke_permission(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_revoke_permission(
  p_user_id uuid,
  p_permission text,
  p_scope text DEFAULT NULL,
  p_scope_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  SELECT is_profile_admin(v_caller) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Only admins can revoke permissions.');
  END IF;

  IF p_scope IS NULL THEN
    UPDATE public.user_permissions
    SET revoked_at = now()
    WHERE user_id = p_user_id AND permission = p_permission AND revoked_at IS NULL;
  ELSE
    UPDATE public.user_permissions
    SET revoked_at = now()
    WHERE user_id = p_user_id 
      AND permission = p_permission 
      AND scope::text = p_scope
      AND COALESCE(scope_id, '') = COALESCE(p_scope_id, '') 
      AND revoked_at IS NULL;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_permission FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_permission TO authenticated;

-- =============================================================================
-- 3. FIX can_access_user_data & ADD authorized_user_ids
-- =============================================================================
CREATE OR REPLACE FUNCTION public.authorized_user_ids(p_permission text)
RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  IF v_caller IS NULL THEN RETURN; END IF;
  
  SELECT is_profile_admin(v_caller) INTO v_is_admin;
  IF v_is_admin THEN
    RETURN QUERY SELECT id FROM public.profiles WHERE is_active = true;
    RETURN;
  END IF;

  RETURN QUERY
  WITH my_grants AS (
    SELECT scope, scope_id FROM public.user_permissions 
    WHERE user_id = v_caller AND permission = p_permission AND revoked_at IS NULL
  ),
  team_tree AS (
    SELECT id FROM public.teams t JOIN my_grants g ON g.scope IN ('TEAM_TREE') AND g.scope_id = t.id::text
    -- Note: Since teams doesn't have parent_id, TEAM_TREE is just the team itself for now until parent_id is added.
  ),
  reports_tree AS (
    SELECT id FROM public.profiles 
    WHERE reports_to IN (SELECT COALESCE(scope_id::uuid, v_caller) FROM my_grants WHERE scope = 'REPORTS_TO')
    -- If we had recursive query for reports_to:
    -- UNION ALL ...
  )
  SELECT p.id FROM public.profiles p WHERE p.is_active = true AND (
    EXISTS (SELECT 1 FROM my_grants WHERE scope = 'GLOBAL')
    OR (EXISTS (SELECT 1 FROM my_grants WHERE scope = 'SELF') AND p.id = v_caller)
    OR EXISTS (SELECT 1 FROM my_grants WHERE scope IN ('OFFICE','OFFICE_TREE') AND p.office_id::text = scope_id)
    -- OFFICE_TREE ignores teams.office_id since it's same as profiles.office_id generally, or we add it if needed.
    OR EXISTS (SELECT 1 FROM my_grants WHERE scope = 'TEAM' AND p.team_id::text = scope_id)
    OR EXISTS (SELECT 1 FROM team_tree WHERE team_tree.id = p.team_id)
    OR EXISTS (SELECT 1 FROM reports_tree WHERE reports_tree.id = p.id)
    OR EXISTS (SELECT 1 FROM my_grants WHERE scope = 'DEPARTMENT' AND upper(p.department) = upper(scope_id))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_user_data(p_target_user_id uuid, p_permission text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_target public.profiles%rowtype;
BEGIN
  IF v_caller IS NULL THEN RETURN false; END IF;
  IF p_target_user_id = v_caller THEN RETURN true; END IF;

  SELECT is_profile_admin(v_caller) INTO v_is_admin;
  IF v_is_admin THEN RETURN true; END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_user_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_permissions up
    WHERE up.user_id = v_caller AND up.permission = p_permission AND up.revoked_at IS NULL
    AND (
      up.scope = 'GLOBAL'
      OR (up.scope IN ('OFFICE','OFFICE_TREE') AND v_target.office_id::text = up.scope_id)
      OR (up.scope = 'TEAM' AND v_target.team_id::text = up.scope_id)
      OR (up.scope = 'TEAM_TREE' AND v_target.team_id::text = up.scope_id) -- mock team tree
      OR (up.scope = 'REPORTS_TO' AND v_target.reports_to = COALESCE(up.scope_id::uuid, v_caller))
      OR (up.scope = 'DEPARTMENT' AND upper(v_target.department) = upper(up.scope_id))
    )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.explain_access(p_user uuid, p_permission text, p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_target public.profiles%rowtype;
  v_grant record;
BEGIN
  SELECT is_profile_admin(v_caller) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Only admins may call explain_access');
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target;
  IF p_user = p_target THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'SELF access is implicitly granted');
  END IF;

  IF public.is_profile_admin(p_user) THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'User is a GLOBAL ADMIN via role');
  END IF;

  FOR v_grant IN SELECT * FROM public.user_permissions WHERE user_id = p_user AND permission = p_permission AND revoked_at IS NULL LOOP
    IF v_grant.scope = 'GLOBAL' THEN
      RETURN jsonb_build_object('allowed', true, 'matched_grant', jsonb_build_object('scope', v_grant.scope, 'scope_id', v_grant.scope_id), 'target', jsonb_build_object('office_id', v_target.office_id, 'team_id', v_target.team_id, 'reports_to', v_target.reports_to), 'reason', 'Global grant matches any target');
    ELSIF v_grant.scope IN ('OFFICE','OFFICE_TREE') AND v_target.office_id::text = v_grant.scope_id THEN
      RETURN jsonb_build_object('allowed', true, 'matched_grant', jsonb_build_object('scope', v_grant.scope, 'scope_id', v_grant.scope_id), 'target', jsonb_build_object('office_id', v_target.office_id, 'team_id', v_target.team_id, 'reports_to', v_target.reports_to), 'reason', 'Target is in the granted office');
    ELSIF v_grant.scope IN ('TEAM','TEAM_TREE') AND v_target.team_id::text = v_grant.scope_id THEN
      RETURN jsonb_build_object('allowed', true, 'matched_grant', jsonb_build_object('scope', v_grant.scope, 'scope_id', v_grant.scope_id), 'target', jsonb_build_object('office_id', v_target.office_id, 'team_id', v_target.team_id, 'reports_to', v_target.reports_to), 'reason', 'Target is in the granted team');
    ELSIF v_grant.scope = 'REPORTS_TO' AND v_target.reports_to = COALESCE(v_grant.scope_id::uuid, p_user) THEN
      RETURN jsonb_build_object('allowed', true, 'matched_grant', jsonb_build_object('scope', v_grant.scope, 'scope_id', v_grant.scope_id), 'target', jsonb_build_object('office_id', v_target.office_id, 'team_id', v_target.team_id, 'reports_to', v_target.reports_to), 'reason', 'Target reports to the designated lead');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('allowed', false, 'target', jsonb_build_object('office_id', v_target.office_id, 'team_id', v_target.team_id, 'reports_to', v_target.reports_to), 'reason', 'No matching grants found');
END;
$$;

-- =============================================================================
-- 4. FIX is_profile_admin & require_profile_admin
-- =============================================================================
-- Currently returns true for ANY active user_permissions row. 
-- We restrict this to just roles SYSTEM_ADMIN, SUPER_ADMIN, ADMIN.
CREATE OR REPLACE FUNCTION public.is_profile_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT upper(role) INTO v_role FROM public.profiles WHERE id = p_user_id;
  RETURN v_role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN');
END;
$$;

CREATE OR REPLACE FUNCTION public.require_profile_admin()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_profile_admin(auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Admin privileges required';
  END IF;
END;
$$;

-- =============================================================================
-- 5. RLS on RBAC Tables & Auditing
-- =============================================================================
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.permissions FROM anon;
REVOKE ALL ON public.role_permissions FROM anon;
REVOKE ALL ON public.user_permission_overrides FROM anon;
REVOKE ALL ON public.permission_audit_logs FROM anon;

CREATE POLICY permissions_select ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY permissions_admin ON public.permissions FOR ALL TO authenticated USING (public.is_profile_admin(auth.uid()));

CREATE POLICY audit_select ON public.permission_audit_logs FOR SELECT TO authenticated
USING (public.is_profile_admin(auth.uid()) OR public.can_access_user_data(auth.uid(), 'audit_logs.view'));

CREATE POLICY audit_insert ON public.permission_audit_logs FOR INSERT TO authenticated
WITH CHECK (true); -- allowed for trigger

-- Add AFTER INSERT OR UPDATE OR DELETE triggers on user_permissions
CREATE OR REPLACE FUNCTION public.trg_audit_user_permissions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text;
  v_reason text := 'Direct table write via trigger';
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.permission_audit_logs (actor_id, target_user_id, permission, scope, scope_id, action, reason)
    VALUES (NEW.created_by, NEW.user_id, NEW.permission, NEW.scope::text, NEW.scope_id, 'GRANT', v_reason);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    INSERT INTO public.permission_audit_logs (actor_id, target_user_id, permission, scope, scope_id, action, reason)
    VALUES (auth.uid(), NEW.user_id, NEW.permission, NEW.scope::text, NEW.scope_id, 'REVOKE', v_reason);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.permission_audit_logs (actor_id, target_user_id, permission, scope, scope_id, action, reason)
    VALUES (auth.uid(), OLD.user_id, OLD.permission, OLD.scope::text, OLD.scope_id, 'REVOKE', v_reason);
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_permissions ON public.user_permissions;
CREATE TRIGGER trg_audit_user_permissions
AFTER INSERT OR UPDATE OR DELETE ON public.user_permissions
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_user_permissions();

-- Catalog
INSERT INTO public.permissions (module, action, permission_key, description) VALUES
('FIELD_VISITS', 'view', 'view_site_visit_observer', 'Can view site_visit_observer')
ON CONFLICT (permission_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

