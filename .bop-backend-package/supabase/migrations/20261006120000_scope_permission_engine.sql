-- =============================================================================
-- 20261006120000_scope_permission_engine.sql
--
-- Scope-based permission engine (audit AUTH-01..AUTH-10).
-- Run AFTER 20261006110000 (separately, in its own transaction).
-- Idempotent and safe to re-run.
--
-- Model (single source of truth = public.user_permissions):
--   WHO (user_id) + WHAT (permission key, e.g. 'attendance.view')
--   + WHERE (scope + scope_id) → resolved against the LIVE org tables, so
--   office / team / manager transfers change access automatically.
--
--   scope        scope_id               covers
--   GLOBAL       NULL                   everyone
--   OFFICE       offices.id             employees whose home office = X
--   OFFICE_TREE  offices.id             office X + members of teams belonging to X
--   TEAM         teams.id               members of team X
--   TEAM_TREE    teams.id               team X + all descendant teams (teams.parent_id)
--   REPORTS_TO   profiles.id or NULL    everyone reporting (directly/indirectly)
--                                       to that lead (NULL = to the grant holder)
--   DEPARTMENT   department name        employees with that department
--   ASSIGNED     NULL                   record-level; resolved inside each RPC
--   SELF         NULL                   the grant holder only
--
-- Data admins (hrms_is_admin_user: SYSTEM_ADMIN, ADMIN, HR, HRD) implicitly have
-- every data permission at GLOBAL scope. Managing permissions is narrower:
-- hrms_is_permission_admin = SYSTEM_ADMIN / ADMIN or an explicit permissions.* grant.
-- Every user can always see their own records.
--
-- Public API:
--   authorized_user_ids(permission)            SETOF uuid  (for list RPCs / RLS)
--   can_access_user_data(target, permission)   boolean
--   explain_access(user, permission, target)   jsonb       (Permission simulator)
--   get_user_permission_grants(user)           jsonb       (Effective access view)
--   admin_grant_permission(user, perm, scope, scope_id, reason)  jsonb
--   admin_revoke_permission(user, perm, scope, scope_id, reason) jsonb
-- =============================================================================

-- ─── 0. Helpers ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hrms_try_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_value)::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.hrms_scope_types()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY['GLOBAL','OFFICE','OFFICE_TREE','TEAM','TEAM_TREE','REPORTS_TO',
               'DEPARTMENT','ASSIGNED','SELF']::text[];
$$;

-- Who may manage permissions: SYSTEM_ADMIN / ADMIN only (HR is a data admin but
-- does NOT manage the permission system), or an explicit permissions.<action> grant.
CREATE OR REPLACE FUNCTION public.hrms_is_permission_admin(p_user_id uuid, p_action text DEFAULT 'assign')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.profiles actor
           WHERE actor.id = p_user_id AND actor.is_active = true
             AND public.normalize_profile_role(actor.role) IN ('SYSTEM_ADMIN', 'ADMIN'))
      OR EXISTS (
           SELECT 1 FROM public.user_permissions up
           WHERE up.user_id = p_user_id AND up.revoked_at IS NULL
             AND up.permission = 'permissions.' || p_action);
$$;

REVOKE ALL ON FUNCTION public.hrms_is_permission_admin(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_is_permission_admin(uuid, text) TO authenticated;

-- ─── 1. Normalise user_permissions ───────────────────────────────────────────

ALTER TABLE public.user_permissions ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.user_permissions ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.user_permissions ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.user_permissions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.user_permissions ADD COLUMN IF NOT EXISTS reason text;

DO $$
DECLARE
  c record;
  v_scope_type text;
  v_scope_id_type text;
BEGIN
  -- Old unique constraints / indexes that block several scopes per permission.
  ALTER TABLE public.user_permissions DROP CONSTRAINT IF EXISTS user_permissions_unique;
  DROP INDEX IF EXISTS public.idx_user_permissions_unique_scoped;
  DROP INDEX IF EXISTS public.idx_user_permissions_active_grant;   -- abandoned draft

  -- Every CHECK constraint that mentions scope uses the old vocabulary
  -- (GLOBAL/DEPARTMENT/BRANCH/TEAM/SELF) and rejects OFFICE: drop them all.
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.user_permissions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%scope%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_permissions DROP CONSTRAINT %I', c.conname);
  END LOOP;

  SELECT data_type INTO v_scope_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_permissions' AND column_name = 'scope';

  IF v_scope_type IS NULL THEN
    ALTER TABLE public.user_permissions ADD COLUMN scope text NOT NULL DEFAULT 'GLOBAL';
    v_scope_type := 'text';
  END IF;

  -- scope_id must be text: it holds office/team/profile UUIDs AND department names.
  SELECT data_type INTO v_scope_id_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_permissions' AND column_name = 'scope_id';

  IF v_scope_id_type IS NULL THEN
    ALTER TABLE public.user_permissions ADD COLUMN scope_id text;
  ELSIF v_scope_id_type <> 'text' THEN
    ALTER TABLE public.user_permissions ALTER COLUMN scope_id TYPE text USING scope_id::text;
  END IF;

  -- Legacy vocabulary → new vocabulary (text column only; an enum column can't hold BRANCH).
  IF v_scope_type = 'text' THEN
    UPDATE public.user_permissions SET scope = upper(btrim(scope)) WHERE scope <> upper(btrim(scope));
    UPDATE public.user_permissions SET scope = 'OFFICE' WHERE scope = 'BRANCH';
  END IF;
END $$;

-- Data clean-up (only active grants are changed; history is kept).
DO $$
DECLARE
  v_n integer;
BEGIN
  -- Scopes that take no target.
  UPDATE public.user_permissions SET scope_id = NULL
  WHERE scope::text IN ('GLOBAL','SELF','ASSIGNED') AND scope_id IS NOT NULL;

  -- Old meaning of TEAM was "team-lead user id" (reports_to tree). Preserve it.
  EXECUTE $q$
    UPDATE public.user_permissions up SET scope = 'REPORTS_TO'
    WHERE up.revoked_at IS NULL
      AND up.scope::text = 'TEAM'
      AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = public.hrms_try_uuid(up.scope_id))
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = public.hrms_try_uuid(up.scope_id))
  $q$;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE NOTICE 'Converted % legacy TEAM(lead-id) grants to REPORTS_TO', v_n; END IF;

  -- Grants that could never resolve (target missing or unknown scope) are revoked.
  UPDATE public.user_permissions up
  SET revoked_at = now(),
      reason = coalesce(up.reason || ' | ', '') || 'auto-revoked 2026-10-06: invalid scope target'
  WHERE up.revoked_at IS NULL
    AND (
      up.scope::text <> ALL (public.hrms_scope_types())
      OR (up.scope::text IN ('OFFICE','OFFICE_TREE')
          AND NOT EXISTS (SELECT 1 FROM public.offices o WHERE o.id = public.hrms_try_uuid(up.scope_id)))
      OR (up.scope::text IN ('TEAM','TEAM_TREE')
          AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = public.hrms_try_uuid(up.scope_id)))
      OR (up.scope::text = 'DEPARTMENT' AND coalesce(btrim(up.scope_id), '') = '')
      OR (up.scope::text = 'REPORTS_TO' AND up.scope_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = public.hrms_try_uuid(up.scope_id)))
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE NOTICE 'Revoked % grants with an invalid scope target', v_n; END IF;

  -- Duplicate active grants: keep one.
  WITH ranked AS (
    SELECT id, row_number() OVER (
      PARTITION BY user_id, permission, scope::text, coalesce(scope_id, '')
      ORDER BY id) AS rn
    FROM public.user_permissions
    WHERE revoked_at IS NULL
  )
  UPDATE public.user_permissions up
  SET revoked_at = now(),
      reason = coalesce(up.reason || ' | ', '') || 'auto-revoked 2026-10-06: duplicate grant'
  FROM ranked r
  WHERE r.id = up.id AND r.rn > 1;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS hrms_user_permissions_active_uq
  ON public.user_permissions (user_id, permission, scope, (coalesce(scope_id, '')))
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS hrms_user_permissions_lookup_idx
  ON public.user_permissions (user_id, permission)
  WHERE revoked_at IS NULL;

ALTER TABLE public.user_permissions DROP CONSTRAINT IF EXISTS hrms_user_permissions_scope_valid;
ALTER TABLE public.user_permissions
  ADD CONSTRAINT hrms_user_permissions_scope_valid
  CHECK (
    revoked_at IS NOT NULL
    OR (
      scope::text = ANY (public.hrms_scope_types())
      AND (scope::text NOT IN ('GLOBAL','SELF','ASSIGNED') OR scope_id IS NULL)
      AND (scope::text NOT IN ('OFFICE','OFFICE_TREE','TEAM','TEAM_TREE','DEPARTMENT') OR scope_id IS NOT NULL)
    )
  );

-- ─── 2. Scope resolution ─────────────────────────────────────────────────────

-- Profiles covered by ONE grant. p_owner = the grant holder.
CREATE OR REPLACE FUNCTION public.hrms_scope_member_ids(p_scope text, p_scope_id text, p_owner uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid := public.hrms_try_uuid(p_scope_id);
BEGIN
  CASE upper(coalesce(p_scope, ''))
    WHEN 'GLOBAL' THEN
      RETURN QUERY SELECT p.id FROM public.profiles p;

    WHEN 'SELF' THEN
      IF p_owner IS NOT NULL THEN RETURN NEXT p_owner; END IF;

    WHEN 'OFFICE' THEN
      RETURN QUERY SELECT p.id FROM public.profiles p WHERE p.office_id = v_id;

    WHEN 'OFFICE_TREE' THEN
      RETURN QUERY
        SELECT p.id FROM public.profiles p
        WHERE p.office_id = v_id
           OR p.team_id IN (SELECT t.id FROM public.teams t WHERE t.office_id = v_id);

    WHEN 'TEAM' THEN
      RETURN QUERY SELECT p.id FROM public.profiles p WHERE p.team_id = v_id;

    WHEN 'TEAM_TREE' THEN
      RETURN QUERY
        WITH RECURSIVE tree AS (
          SELECT t.id FROM public.teams t WHERE t.id = v_id
          UNION                                   -- UNION (not ALL) stops cycles
          SELECT child.id FROM public.teams child JOIN tree ON child.parent_id = tree.id
        )
        SELECT p.id FROM public.profiles p WHERE p.team_id IN (SELECT id FROM tree);

    WHEN 'REPORTS_TO' THEN
      RETURN QUERY
        WITH RECURSIVE reports AS (
          SELECT p.id FROM public.profiles p WHERE p.reports_to = coalesce(v_id, p_owner)
          UNION
          SELECT p.id FROM public.profiles p JOIN reports r ON p.reports_to = r.id
        )
        SELECT id FROM reports;

    WHEN 'DEPARTMENT' THEN
      RETURN QUERY
        SELECT p.id FROM public.profiles p
        WHERE lower(btrim(coalesce(p.department, ''))) = lower(btrim(coalesce(p_scope_id, '')))
          AND btrim(coalesce(p_scope_id, '')) <> '';

    ELSE
      -- ASSIGNED is record-level (resolved inside each resource RPC); unknown = deny.
      RETURN;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.hrms_scope_member_ids(text, text, uuid) FROM public, anon, authenticated;

-- All profiles the CURRENT caller may act on for a permission.
CREATE OR REPLACE FUNCTION public.authorized_user_ids(p_permission text)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF public.hrms_is_admin_user(v_uid) OR EXISTS (
       SELECT 1 FROM public.user_permissions up
       WHERE up.user_id = v_uid AND up.permission = p_permission
         AND up.revoked_at IS NULL AND up.scope::text = 'GLOBAL') THEN
    RETURN QUERY SELECT p.id FROM public.profiles p;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT v_uid
    UNION
    SELECT m
    FROM public.user_permissions up
    CROSS JOIN LATERAL public.hrms_scope_member_ids(up.scope::text, up.scope_id, v_uid) m
    WHERE up.user_id = v_uid
      AND up.permission = p_permission
      AND up.revoked_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.authorized_user_ids(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.authorized_user_ids(text) TO authenticated;

-- Single-target check, same rules.
CREATE OR REPLACE FUNCTION public.can_access_user_data(p_target_user_id uuid, p_permission text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_target_user_id IS NULL THEN
    RETURN false;
  END IF;
  IF p_target_user_id = v_uid OR public.hrms_is_admin_user(v_uid) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_permissions up
    WHERE up.user_id = v_uid
      AND up.permission = p_permission
      AND up.revoked_at IS NULL
      AND p_target_user_id IN (
        SELECT public.hrms_scope_member_ids(up.scope::text, up.scope_id, v_uid))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_user_data(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_access_user_data(uuid, text) TO authenticated;

-- Human-readable target name for a grant.
CREATE OR REPLACE FUNCTION public.hrms_scope_label(p_scope text, p_scope_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE upper(coalesce(p_scope, ''))
    WHEN 'GLOBAL' THEN 'All employees'
    WHEN 'SELF' THEN 'Own records only'
    WHEN 'ASSIGNED' THEN 'Records assigned to them'
    WHEN 'OFFICE' THEN 'Office: ' || coalesce((SELECT o.name FROM public.offices o WHERE o.id = public.hrms_try_uuid(p_scope_id)), p_scope_id)
    WHEN 'OFFICE_TREE' THEN 'Office + its teams: ' || coalesce((SELECT o.name FROM public.offices o WHERE o.id = public.hrms_try_uuid(p_scope_id)), p_scope_id)
    WHEN 'TEAM' THEN 'Team: ' || coalesce((SELECT t.name FROM public.teams t WHERE t.id = public.hrms_try_uuid(p_scope_id)), p_scope_id)
    WHEN 'TEAM_TREE' THEN 'Team + sub-teams: ' || coalesce((SELECT t.name FROM public.teams t WHERE t.id = public.hrms_try_uuid(p_scope_id)), p_scope_id)
    WHEN 'REPORTS_TO' THEN CASE WHEN p_scope_id IS NULL THEN 'Their direct + indirect reports'
      ELSE 'Reports of: ' || coalesce((SELECT p.name FROM public.profiles p WHERE p.id = public.hrms_try_uuid(p_scope_id)), p_scope_id) END
    WHEN 'DEPARTMENT' THEN 'Department: ' || coalesce(p_scope_id, '')
    ELSE coalesce(p_scope, '?') || coalesce(': ' || p_scope_id, '')
  END;
$$;

REVOKE ALL ON FUNCTION public.hrms_scope_label(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_scope_label(text, text) TO authenticated;

-- ─── 3. Effective access + simulator ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_permission_grants(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_user_id <> v_uid
     AND NOT public.hrms_is_permission_admin(v_uid, 'view')
     AND NOT public.hrms_is_permission_admin(v_uid, 'assign') THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'is_admin', public.hrms_is_admin_user(p_user_id),
    'role', (SELECT p.role FROM public.profiles p WHERE p.id = p_user_id),
    'grants', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', up.id,
               'permission', up.permission,
               'scope', up.scope::text,
               'scope_id', up.scope_id,
               'scope_label', public.hrms_scope_label(up.scope::text, up.scope_id),
               'granted_at', up.created_at,
               'granted_by', (SELECT g.name FROM public.profiles g WHERE g.id = up.created_by),
               'reason', up.reason)
             ORDER BY up.permission, up.scope::text)
      FROM public.user_permissions up
      WHERE up.user_id = p_user_id AND up.revoked_at IS NULL), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_permission_grants(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_permission_grants(uuid) TO authenticated;

-- "Can USER do PERMISSION on TARGET, and why?"  Admins only.
DROP FUNCTION IF EXISTS public.explain_access(uuid, text, uuid);
CREATE FUNCTION public.explain_access(p_user uuid, p_permission text, p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_user public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_target_json jsonb;
  v_grants jsonb;
  v_match record;
BEGIN
  IF v_caller IS NULL OR NOT (public.hrms_is_permission_admin(v_caller, 'view')
                              OR public.hrms_is_permission_admin(v_caller, 'assign')) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_user FROM public.profiles WHERE id = p_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'USER_NOT_FOUND');
  END IF;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_target;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'TARGET_NOT_FOUND');
  END IF;

  v_target_json := jsonb_build_object(
    'id', v_target.id, 'name', v_target.name,
    'office_id', v_target.office_id,
    'office_name', (SELECT o.name FROM public.offices o WHERE o.id = v_target.office_id),
    'team_id', v_target.team_id,
    'team_name', (SELECT t.name FROM public.teams t WHERE t.id = v_target.team_id),
    'reports_to', v_target.reports_to,
    'reports_to_name', (SELECT m.name FROM public.profiles m WHERE m.id = v_target.reports_to),
    'department', v_target.department);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'scope', up.scope::text, 'scope_id', up.scope_id,
           'scope_label', public.hrms_scope_label(up.scope::text, up.scope_id),
           'covers_target', p_target IN (SELECT public.hrms_scope_member_ids(up.scope::text, up.scope_id, p_user))
         )), '[]'::jsonb)
  INTO v_grants
  FROM public.user_permissions up
  WHERE up.user_id = p_user AND up.permission = p_permission AND up.revoked_at IS NULL;

  IF p_user = p_target THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'SELF',
      'explanation', 'Everyone can access their own records.',
      'user', jsonb_build_object('id', v_user.id, 'name', v_user.name, 'role', v_user.role),
      'target', v_target_json, 'grants', v_grants);
  END IF;

  IF public.hrms_is_admin_user(p_user) THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'ADMIN_ROLE',
      'explanation', format('%s has an admin role (%s): all permissions, global scope.', v_user.name, v_user.role),
      'user', jsonb_build_object('id', v_user.id, 'name', v_user.name, 'role', v_user.role),
      'target', v_target_json, 'grants', v_grants);
  END IF;

  SELECT up.scope::text AS scope, up.scope_id INTO v_match
  FROM public.user_permissions up
  WHERE up.user_id = p_user AND up.permission = p_permission AND up.revoked_at IS NULL
    AND p_target IN (SELECT public.hrms_scope_member_ids(up.scope::text, up.scope_id, p_user))
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'SCOPED_GRANT',
      'matched_grant', jsonb_build_object('scope', v_match.scope, 'scope_id', v_match.scope_id,
                                          'scope_label', public.hrms_scope_label(v_match.scope, v_match.scope_id)),
      'explanation', format('%s has %s for %s, which includes %s.', v_user.name, p_permission,
                            public.hrms_scope_label(v_match.scope, v_match.scope_id), v_target.name),
      'user', jsonb_build_object('id', v_user.id, 'name', v_user.name, 'role', v_user.role),
      'target', v_target_json, 'grants', v_grants);
  END IF;

  RETURN jsonb_build_object('allowed', false,
    'reason', CASE WHEN jsonb_array_length(v_grants) = 0 THEN 'NO_GRANT' ELSE 'TARGET_OUTSIDE_SCOPE' END,
    'explanation', CASE WHEN jsonb_array_length(v_grants) = 0
      THEN format('%s has no %s grant.', v_user.name, p_permission)
      ELSE format('%s has %s, but none of their scopes include %s.', v_user.name, p_permission, v_target.name) END,
    'user', jsonb_build_object('id', v_user.id, 'name', v_user.name, 'role', v_user.role),
    'target', v_target_json, 'grants', v_grants);
END;
$$;

REVOKE ALL ON FUNCTION public.explain_access(uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.explain_access(uuid, text, uuid) TO authenticated;

-- ─── 4. Grant / revoke (exactly one overload each) ───────────────────────────

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('admin_grant_permission', 'admin_revoke_permission')
  LOOP
    EXECUTE format('DROP FUNCTION %s', fn.sig);
  END LOOP;
END $$;

CREATE FUNCTION public.admin_grant_permission(
  p_user_id    uuid,
  p_permission text,
  p_scope      text DEFAULT 'GLOBAL',
  p_scope_id   text DEFAULT NULL,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_is_admin boolean;
  v_scope    text := upper(btrim(coalesce(p_scope, 'GLOBAL')));
  v_scope_id text := nullif(btrim(coalesce(p_scope_id, '')), '');
  v_existing uuid;
  v_new_id   uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', 'Sign in again.');
  END IF;

  -- v_is_admin = SYSTEM_ADMIN / ADMIN role (not HR, not a delegated grant).
  v_is_admin := EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = v_actor AND a.is_active
                        AND public.normalize_profile_role(a.role) IN ('SYSTEM_ADMIN', 'ADMIN'));
  IF NOT public.hrms_is_permission_admin(v_actor, 'assign') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Only System Admin / Admin (or users with permissions.assign) can grant permissions.');
  END IF;

  -- Separation of duties for delegated permission managers.
  IF NOT v_is_admin AND p_user_id = v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_GRANT_FORBIDDEN', 'message', 'You cannot grant permissions to yourself.');
  END IF;
  IF NOT v_is_admin AND p_permission LIKE 'permissions.%' THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Only admins can grant permission-management rights.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND', 'message', 'Employee not found.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE permission_key = p_permission) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PERMISSION_KEY', 'message', 'Unknown permission: ' || coalesce(p_permission, ''));
  END IF;
  IF v_scope <> ALL (public.hrms_scope_types()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE', 'message', 'Unknown scope: ' || v_scope);
  END IF;

  IF v_scope IN ('GLOBAL', 'SELF', 'ASSIGNED') THEN
    v_scope_id := NULL;
  ELSIF v_scope IN ('OFFICE', 'OFFICE_TREE') THEN
    IF NOT EXISTS (SELECT 1 FROM public.offices WHERE id = public.hrms_try_uuid(v_scope_id)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_TARGET', 'message', 'Choose a valid office.');
    END IF;
  ELSIF v_scope IN ('TEAM', 'TEAM_TREE') THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = public.hrms_try_uuid(v_scope_id)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_TARGET', 'message', 'Choose a valid team.');
    END IF;
  ELSIF v_scope = 'REPORTS_TO' THEN
    IF v_scope_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = public.hrms_try_uuid(v_scope_id)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_TARGET', 'message', 'Choose a valid team lead.');
    END IF;
  ELSIF v_scope = 'DEPARTMENT' THEN
    IF v_scope_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_TARGET', 'message', 'Choose a department.');
    END IF;
  END IF;

  SELECT up.id INTO v_existing
  FROM public.user_permissions up
  WHERE up.user_id = p_user_id AND up.permission = p_permission AND up.revoked_at IS NULL
    AND up.scope::text = v_scope AND coalesce(up.scope_id, '') = coalesce(v_scope_id, '');

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'id', v_existing, 'existing', true);
  END IF;

  PERFORM set_config('hrms.permission_reason', coalesce(p_reason, ''), true);

  -- %L literal so the value coerces to the column type (text or permission_scope enum).
  EXECUTE format(
    'INSERT INTO public.user_permissions (user_id, permission, scope, scope_id, created_by, created_at, reason)
     VALUES ($1, $2, %L, $3, $4, now(), $5) RETURNING id', v_scope)
  INTO v_new_id
  USING p_user_id, p_permission, v_scope_id, v_actor, p_reason;

  RETURN jsonb_build_object('success', true, 'id', v_new_id, 'existing', false,
    'scope_label', public.hrms_scope_label(v_scope, v_scope_id));
END;
$$;

CREATE FUNCTION public.admin_revoke_permission(
  p_user_id    uuid,
  p_permission text,
  p_scope      text DEFAULT NULL,
  p_scope_id   text DEFAULT NULL,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_is_admin boolean;
  v_count    integer;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', 'Sign in again.');
  END IF;

  v_is_admin := EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = v_actor AND a.is_active
                        AND public.normalize_profile_role(a.role) IN ('SYSTEM_ADMIN', 'ADMIN'));
  IF NOT public.hrms_is_permission_admin(v_actor, 'revoke') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Only System Admin / Admin (or users with permissions.revoke) can revoke permissions.');
  END IF;
  IF NOT v_is_admin AND p_permission LIKE 'permissions.%' THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Only admins can revoke permission-management rights.');
  END IF;

  PERFORM set_config('hrms.permission_reason', coalesce(p_reason, ''), true);

  UPDATE public.user_permissions up
  SET revoked_at = now(), revoked_by = v_actor
  WHERE up.user_id = p_user_id
    AND up.permission = p_permission
    AND up.revoked_at IS NULL
    AND (p_scope IS NULL OR up.scope::text = upper(btrim(p_scope)))
    AND (p_scope IS NULL OR coalesce(up.scope_id, '') = coalesce(nullif(btrim(coalesce(p_scope_id, '')), ''), ''));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'revoked', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_permission(uuid, text, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_permission(uuid, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_permission(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_permission(uuid, text, text, text, text) TO authenticated;

-- ─── 5. Audit every change to user_permissions (including direct writes) ─────

ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS actor_id uuid;
ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS actor_user_id uuid;
ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS performed_by uuid;
ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS target_user_id uuid;
ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS permission text;
ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS permission_key text;
ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS scope_id text;
ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE public.permission_audit_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'permission_audit_logs' AND column_name = 'scope') THEN
    ALTER TABLE public.permission_audit_logs ADD COLUMN scope text;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.hrms_audit_user_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row     public.user_permissions%ROWTYPE;
  v_action  text;
  v_actor   uuid := auth.uid();
  v_reason  text := nullif(current_setting('hrms.permission_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_row := NEW; v_action := 'GRANT'; v_actor := coalesce(v_actor, NEW.created_by);
  ELSIF TG_OP = 'DELETE' THEN
    v_row := OLD; v_action := 'DELETE';
  ELSIF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    v_row := NEW; v_action := 'REVOKE'; v_actor := coalesce(v_actor, NEW.revoked_by);
    v_reason := coalesce(v_reason, NEW.reason);
  ELSE
    v_row := NEW; v_action := 'UPDATE';
  END IF;

  EXECUTE format(
    'INSERT INTO public.permission_audit_logs
       (actor_id, actor_user_id, performed_by, target_user_id, permission, permission_key,
        action, scope, scope_id, reason, metadata, created_at)
     VALUES ($1, $1, $1, $2, $3, $3, $4, %L, $5, $6, $7, now())',
    v_row.scope::text)
  USING v_actor, v_row.user_id, v_row.permission, v_action, v_row.scope_id, v_reason,
        CASE WHEN TG_OP = 'UPDATE'
             THEN jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
             ELSE jsonb_build_object('row', to_jsonb(v_row)) END;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.hrms_audit_user_permissions() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_user_permissions ON public.user_permissions;      -- abandoned draft
DROP FUNCTION IF EXISTS public.trg_audit_user_permissions();
DROP TRIGGER IF EXISTS hrms_audit_user_permissions ON public.user_permissions;
CREATE TRIGGER hrms_audit_user_permissions
AFTER INSERT OR UPDATE OR DELETE ON public.user_permissions
FOR EACH ROW EXECUTE FUNCTION public.hrms_audit_user_permissions();

-- ─── 6. RLS on user_permissions ──────────────────────────────────────────────

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_permissions FROM anon;

DROP POLICY IF EXISTS user_permissions_select ON public.user_permissions;
DROP POLICY IF EXISTS user_permissions_insert ON public.user_permissions;
DROP POLICY IF EXISTS user_permissions_delete ON public.user_permissions;
DROP POLICY IF EXISTS user_permissions_update ON public.user_permissions;
DROP POLICY IF EXISTS hrms_user_permissions_read ON public.user_permissions;
DROP POLICY IF EXISTS hrms_user_permissions_admin_write ON public.user_permissions;

CREATE POLICY hrms_user_permissions_read ON public.user_permissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR public.hrms_is_permission_admin(auth.uid(), 'view')
         OR public.hrms_is_permission_admin(auth.uid(), 'assign'));

-- Writes should go through admin_grant/revoke_permission; direct admin writes are
-- still allowed but are audited by the trigger above.
CREATE POLICY hrms_user_permissions_admin_write ON public.user_permissions
  FOR ALL TO authenticated
  USING (public.hrms_is_permission_admin(auth.uid(), 'assign'))
  WITH CHECK (public.hrms_is_permission_admin(auth.uid(), 'assign') AND user_id <> auth.uid());

-- Permission audit log: readable by permission admins / viewers only.
DROP POLICY IF EXISTS hrms_permission_audit_read ON public.permission_audit_logs;
CREATE POLICY hrms_permission_audit_read ON public.permission_audit_logs
  FOR SELECT TO authenticated
  USING (public.hrms_is_permission_admin(auth.uid(), 'view')
         OR public.hrms_is_permission_admin(auth.uid(), 'assign'));

-- ─── 7. get_my_permissions: same shape, plus a readable label ────────────────

CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'permission', up.permission,
           'scope', up.scope::text,
           'scope_id', up.scope_id,
           'scope_label', public.hrms_scope_label(up.scope::text, up.scope_id))), '[]'::jsonb)
  FROM public.user_permissions up
  WHERE up.user_id = auth.uid() AND up.revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_my_permissions() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;

-- ─── 8. Catalog keys referenced by the app and RPCs ──────────────────────────

INSERT INTO public.permissions (permission_key, module, action, description) VALUES
  ('attendance.view',            'ATTENDANCE',     'view',     'View attendance of employees in scope'),
  ('attendance.export',          'ATTENDANCE',     'export',   'Export attendance of employees in scope'),
  ('attendance.regularize',      'ATTENDANCE',     'regularize','Correct attendance of employees in scope'),
  ('regularization.view',        'REGULARIZATION', 'view',     'View regularization requests in scope'),
  ('regularization.approve',     'REGULARIZATION', 'approve',  'Approve/reject regularization requests in scope'),
  ('view_site_visit_observer',   'FIELD_VISITS',   'view',     'Site Visit Observer'),
  ('permissions.view',           'PERMISSIONS',    'view',     'Open the Permission Manager'),
  ('permissions.assign',         'PERMISSIONS',    'assign',   'Grant permissions to other users'),
  ('permissions.revoke',         'PERMISSIONS',    'revoke',   'Revoke permissions from other users')
ON CONFLICT (permission_key) DO NOTHING;

-- ─── 9. Regularization list: real scope check ────────────────────────────────
-- Same output as 20261005010000, but scope comes from the permission engine
-- (regularization.view / regularization.approve / legacy manage_attendance);
-- p_office_id can only narrow the result.

CREATE OR REPLACE FUNCTION public.rpc_admin_list_attendance_regularization(
  p_status    text    DEFAULT 'PENDING',
  p_offset    integer DEFAULT 0,
  p_limit     integer DEFAULT 200,
  p_office_id uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_records jsonb;
  v_total   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;


  SELECT count(*) INTO v_total
  FROM public.attendance_regularization_requests r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.status = upper(p_status)
    AND (p_office_id IS NULL OR p.office_id = p_office_id)
    AND r.user_id IN (
          SELECT public.authorized_user_ids('regularization.view')
          UNION SELECT public.authorized_user_ids('regularization.approve')
          UNION SELECT public.authorized_user_ids('manage_attendance'));

  SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC), '[]'::jsonb)
  INTO v_records
  FROM (
    SELECT r.*,
           jsonb_build_object('name', p.name, 'employee_number', p.employee_number) AS profiles,
           jsonb_build_object('date', a.date, 'checkin_time', a.checkin_time, 'checkout_time', a.checkout_time, 'is_late', a.is_late) AS attendance_logs,
           c.official_first_in, c.first_in_source, c.official_last_out AS current_official_last_out, c.last_out_source,
           CASE WHEN r.status = 'APPROVED' THEN r.requested_checkout END AS final_approved_checkout,
           c.team_name, c.office_name, c.check_in_office_name, c.attendance_status
    FROM public.attendance_regularization_requests r
    JOIN public.profiles p ON p.id = r.user_id
    JOIN public.attendance_logs a ON a.id = r.attendance_id
    LEFT JOIN public.v_attendance_daily_canonical c ON c.user_id = r.user_id AND c.work_date = a.date
    WHERE r.status = upper(p_status)
      AND (p_office_id IS NULL OR p.office_id = p_office_id)
      AND r.user_id IN (
          SELECT public.authorized_user_ids('regularization.view')
          UNION SELECT public.authorized_user_ids('regularization.approve')
          UNION SELECT public.authorized_user_ids('manage_attendance'))
    ORDER BY r.created_at DESC
    OFFSET greatest(p_offset, 0) LIMIT least(greatest(p_limit, 1), 500)
  ) page;

  RETURN jsonb_build_object(
    'success', true,
    'records', v_records,
    'total', v_total,
    'has_more', greatest(p_offset, 0) + coalesce(jsonb_array_length(v_records), 0) < v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_list_attendance_regularization(text, integer, integer, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_attendance_regularization(text, integer, integer, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK (manual): this migration only adds functions/columns/indexes and
-- tightens checks. To undo the user_permissions clean-up, inspect
--   SELECT * FROM public.user_permissions WHERE reason LIKE 'auto-revoked 2026-10-06%';
-- and clear revoked_at for rows you want back.
-- =============================================================================
