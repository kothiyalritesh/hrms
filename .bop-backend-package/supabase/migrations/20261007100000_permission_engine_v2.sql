-- =============================================================================
-- 20261007100000_permission_engine_v2.sql
--
-- Permission engine v2. Builds on 20261006120000 (scope engine). Adds:
--   1. One permission catalog (canonical keys + legacy aliases), the same list
--      the app uses (constants/permissionCatalog.ts).
--   2. Temporary access: user_permissions.expires_at. Expired grants stop
--      working by themselves (no job needed).
--   3. Role templates (role_permission_grants): give a ROLE a permission +
--      scope; everyone with that role gets it. Scope REPORTS_TO without a
--      target means "their own reporting line", so a Team Lead template covers
--      each lead's own team automatically and follows transfers.
--   4. hrms_active_grants(user)  - direct (non-revoked, non-expired) + template
--      hrms_has_permission(key) - "may the caller use this capability at all"
--      hrms_require_permission(keys[]) - raises 42501 PERMISSION_REQUIRED
--   5. authorized_user_ids / can_access_user_data / explain_access /
--      get_my_permissions / get_user_permission_grants / hrms_is_permission_admin
--      rewritten on top of hrms_active_grants + aliases.
--   6. admin_grant_permission gains p_expires_at; role-template RPCs.
--
-- Data admins (SYSTEM_ADMIN, ADMIN, HR, HRD) keep every data permission at
-- GLOBAL scope; permission management stays SYSTEM_ADMIN / ADMIN (or an
-- explicit permissions.* grant). Default for everyone else: deny.
-- Idempotent. Run in the Supabase SQL Editor.
-- =============================================================================

-- ─── 1. Catalog ──────────────────────────────────────────────────────────────

ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS scoped boolean NOT NULL DEFAULT true;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;

INSERT INTO public.permissions (permission_key, module, action, label, description, scoped, risk_level, aliases, sort_order, is_active)
VALUES
  ('employees.view','Employees','view','View employees','Open employee profiles in scope',true,'MEDIUM',ARRAY['screen.user_management','employee.view'],10,true),
  ('employees.manage','Employees','manage','Add / edit employees','Create, edit and deactivate employees in scope',true,'HIGH',ARRAY['employee.create','employee.edit'],11,true),
  ('teams.manage','Employees','manage','Team hierarchy','Edit teams and reporting lines',false,'HIGH',ARRAY['screen.team_hierarchy'],12,true),
  ('birthdays.manage','Employees','manage','Birthdays','Manage birthday announcements',false,'LOW',ARRAY['screen.birthday_management'],13,true),
  ('attendance.view','Attendance','view','View attendance','Attendance logs and reports in scope',true,'MEDIUM',ARRAY['screen.attendance_control'],20,true),
  ('attendance.export','Attendance','export','Export attendance','Download attendance reports in scope',true,'MEDIUM','{}',21,true),
  ('attendance.regularize','Attendance','regularize','Correct attendance','Fix check-in / checkout times in scope',true,'HIGH',ARRAY['attendance.edit'],22,true),
  ('regularization.view','Attendance','view','View regularization requests','See requests in scope',true,'LOW',ARRAY['screen.attendance_regularization'],23,true),
  ('regularization.approve','Attendance','approve','Approve regularization','Approve or reject requests in scope',true,'HIGH',ARRAY['attendance.approve'],24,true),
  ('attendance.calendar.manage','Attendance','manage','Holidays & weekly offs','Edit the holiday calendar and weekly-off rules',false,'MEDIUM','{}',25,true),
  ('checkin_logs.view','Attendance','view','Check-in logs','GPS check-in attempts and blocked check-ins in scope',true,'MEDIUM',ARRAY['screen.check_in_logs'],26,true),
  ('suspicious.view','Attendance','view','Suspicious attendance','Fraud scores and GPS evidence in scope',true,'MEDIUM',ARRAY['screen.suspicious_attendance'],27,true),
  ('devices.manage','Attendance','manage','Duplicate devices','Device sessions and buddy-punching checks',false,'HIGH',ARRAY['screen.duplicate_devices'],28,true),
  ('biometric.manage','Attendance','manage','Biometric sync','SmartOffice sync, matching and imported data',false,'HIGH',ARRAY['screen.smartoffice_integration','biometric.sync'],29,true),
  ('leave.view','Leave','view','View leave','Leave requests and balances in scope',true,'LOW',ARRAY['screen.leave_balance'],30,true),
  ('leave.approve','Leave','approve','Approve leave','Approve or reject leave in scope',true,'HIGH',ARRAY['manage_leave'],31,true),
  ('leave.balance.manage','Leave','manage','Adjust leave balances','Add or remove leave balance in scope',true,'HIGH','{}',32,true),
  ('live_tracking.view','Field & tracking','view','Live tracking','Live location of employees in scope',true,'HIGH',ARRAY['screen.live_tracking','location.view_live','screen.in_transit'],40,true),
  ('field_visits.view','Field & tracking','view','Field visits','Field / site visits in scope',true,'MEDIUM',ARRAY['screen.field_visit_admin','field_visit.view','screen.site_visit_observer','view_site_visit_observer'],41,true),
  ('sites.manage','Field & tracking','manage','Sites & geofences','Projects, saved sites and geofences',false,'MEDIUM',ARRAY['screen.site_settings'],42,true),
  ('offices.manage','Field & tracking','manage','Offices & policies','Offices, radius and attendance policies',false,'HIGH',ARRAY['screen.office_settings'],43,true),
  ('tasks.view','Work','view','View tasks','Tasks of employees in scope',true,'LOW',ARRAY['screen.task_project_control'],50,true),
  ('tasks.manage','Work','manage','Assign tasks','Create and assign tasks in scope',true,'MEDIUM','{}',51,true),
  ('events.manage','Work','manage','Events','Create and manage events',false,'MEDIUM',ARRAY['screen.event_management'],52,true),
  ('notifications.send','Communication','send','Send notifications','Push notifications to employees',false,'MEDIUM',ARRAY['screen.notification_management'],60,true),
  ('tickets.manage','Communication','manage','Support tickets','View and resolve support tickets',false,'LOW',ARRAY['screen.ticket_management'],61,true),
  ('feedback.view','Communication','view','Anonymous feedback','Read anonymous feedback',false,'MEDIUM',ARRAY['screen.anonymous_feedback'],62,true),
  ('reports.view','Reports & audit','view','Reports','Reports hub for employees in scope',true,'MEDIUM','{}',70,true),
  ('audit.view','Reports & audit','view','Audit logs','System activity trail',false,'HIGH',ARRAY['screen.audit_logs'],71,true),
  ('permissions.view','Permissions','view','View permissions','Open the Permission Manager and simulator',false,'MEDIUM',ARRAY['screen.permissions_manager'],80,true),
  ('permissions.assign','Permissions','assign','Grant permissions','Grant permissions to other users',false,'HIGH','{}',81,true),
  ('permissions.revoke','Permissions','revoke','Revoke permissions','Revoke permissions from other users',false,'HIGH','{}',82,true)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, label = EXCLUDED.label,
  description = EXCLUDED.description, scoped = EXCLUDED.scoped,
  risk_level = EXCLUDED.risk_level, aliases = EXCLUDED.aliases,
  sort_order = EXCLUDED.sort_order, is_active = true;

-- Biometric sync stays admin-only (its Edge Function checks the role), so it
-- is not offered in the Permission Manager.
UPDATE public.permissions SET is_active = false WHERE permission_key = 'biometric.manage';

-- Legacy keys stay valid (old grants keep working) but are hidden from pickers.
UPDATE public.permissions p SET is_active = false
WHERE EXISTS (SELECT 1 FROM public.permissions c WHERE p.permission_key = ANY (c.aliases));

-- Every key that means the same capability as p_key (canonical + aliases).
CREATE OR REPLACE FUNCTION public.hrms_permission_keys(p_key text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH canonical AS (
    SELECT coalesce(
      (SELECT c.permission_key FROM public.permissions c WHERE c.permission_key = p_key AND cardinality(c.aliases) > 0),
      (SELECT c.permission_key FROM public.permissions c WHERE p_key = ANY (c.aliases) LIMIT 1),
      p_key) AS key
  )
  SELECT ARRAY(
    SELECT DISTINCT k FROM (
      SELECT (SELECT key FROM canonical) AS k
      UNION ALL SELECT p_key
      UNION ALL SELECT unnest(c.aliases) FROM public.permissions c WHERE c.permission_key = (SELECT key FROM canonical)
    ) keys WHERE k IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.hrms_permission_keys(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_permission_keys(text) TO authenticated, service_role;

-- ─── 2. Temporary access ─────────────────────────────────────────────────────

ALTER TABLE public.user_permissions ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS hrms_user_permissions_expiry_idx
  ON public.user_permissions (expires_at) WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

-- ─── 3. Role templates ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.role_permission_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role        text NOT NULL,
  permission  text NOT NULL,
  scope       text NOT NULL DEFAULT 'REPORTS_TO',
  scope_id    text,
  reason      text,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS role_permission_grants_active_uq
  ON public.role_permission_grants (role, permission, scope, (coalesce(scope_id, '')))
  WHERE revoked_at IS NULL;
ALTER TABLE public.role_permission_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.role_permission_grants FROM anon;
DROP POLICY IF EXISTS role_permission_grants_read ON public.role_permission_grants;
CREATE POLICY role_permission_grants_read ON public.role_permission_grants
  FOR SELECT TO authenticated USING (true);   -- role templates are not secret
-- writes only through rpc_admin_*_role_permission (SECURITY DEFINER)

-- ─── 4. Effective grants + the shared checks ────────────────────────────────

-- Every grant that is in force for a user right now.
CREATE OR REPLACE FUNCTION public.hrms_active_grants(p_user uuid)
RETURNS TABLE (permission text, scope text, scope_id text, source text, grant_id uuid, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT up.permission, up.scope::text, up.scope_id, 'USER'::text, up.id, up.expires_at
  FROM public.user_permissions up
  WHERE up.user_id = p_user
    AND up.revoked_at IS NULL
    AND (up.expires_at IS NULL OR up.expires_at > now())
  UNION ALL
  SELECT rg.permission, rg.scope, rg.scope_id, 'ROLE:' || rg.role, rg.id, NULL::timestamptz
  FROM public.role_permission_grants rg
  JOIN public.profiles p ON p.id = p_user AND coalesce(p.is_active, true)
  WHERE rg.revoked_at IS NULL
    AND upper(rg.role) = public.normalize_profile_role(p.role);
$$;
REVOKE ALL ON FUNCTION public.hrms_active_grants(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_active_grants(uuid) TO service_role;

-- May the caller use this capability at all (any scope)?
CREATE OR REPLACE FUNCTION public.hrms_has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    CASE
      WHEN p_permission LIKE 'permissions.%'
        THEN public.hrms_is_permission_admin(auth.uid(), split_part(p_permission, '.', 2))
      ELSE public.hrms_is_admin_user(auth.uid())
           OR EXISTS (SELECT 1 FROM public.hrms_active_grants(auth.uid()) g
                      WHERE g.permission = ANY (public.hrms_permission_keys(p_permission)))
    END);
$$;
REVOKE ALL ON FUNCTION public.hrms_has_permission(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_has_permission(text) TO authenticated;

-- Raise 42501 (HTTP 403) unless the caller holds at least one of the keys.
CREATE OR REPLACE FUNCTION public.hrms_require_permission(p_permissions text[])
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(p_permissions) k WHERE public.hrms_has_permission(k)) THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED: %', array_to_string(p_permissions, ' or ')
      USING ERRCODE = '42501',
            HINT = 'Ask an administrator to grant this permission in the Permission Manager.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_require_permission(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_require_permission(text[]) TO authenticated;

-- Permission administration: role, or an active (non-expired / template) grant.
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
             AND public.normalize_profile_role(actor.role) IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN'))
      OR EXISTS (
           SELECT 1 FROM public.hrms_active_grants(p_user_id) g
           WHERE g.permission = ANY (public.hrms_permission_keys('permissions.' || p_action)));
$$;
REVOKE ALL ON FUNCTION public.hrms_is_permission_admin(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_is_permission_admin(uuid, text) TO authenticated;

-- ─── 5. Scope resolution on top of active grants ────────────────────────────

CREATE OR REPLACE FUNCTION public.authorized_user_ids(p_permission text)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_keys text[] := public.hrms_permission_keys(p_permission);
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF public.hrms_is_admin_user(v_uid) OR EXISTS (
       SELECT 1 FROM public.hrms_active_grants(v_uid) g
       WHERE g.permission = ANY (v_keys) AND g.scope = 'GLOBAL') THEN
    RETURN QUERY SELECT p.id FROM public.profiles p;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT v_uid
    UNION
    SELECT m
    FROM public.hrms_active_grants(v_uid) g
    CROSS JOIN LATERAL public.hrms_scope_member_ids(g.scope, g.scope_id, v_uid) m
    WHERE g.permission = ANY (v_keys);
END;
$$;
REVOKE ALL ON FUNCTION public.authorized_user_ids(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.authorized_user_ids(text) TO authenticated;

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
    FROM public.hrms_active_grants(v_uid) g
    WHERE g.permission = ANY (public.hrms_permission_keys(p_permission))
      AND (g.scope = 'GLOBAL'
           OR p_target_user_id IN (SELECT public.hrms_scope_member_ids(g.scope, g.scope_id, v_uid))));
END;
$$;
REVOKE ALL ON FUNCTION public.can_access_user_data(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_access_user_data(uuid, text) TO authenticated;

-- ─── 6. What the app reads ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'permission', g.permission,
           'scope', g.scope,
           'scope_id', g.scope_id,
           'scope_label', public.hrms_scope_label(g.scope, g.scope_id),
           'source', g.source,
           'expires_at', g.expires_at)), '[]'::jsonb)
  FROM public.hrms_active_grants(auth.uid()) g;
$$;
REVOKE ALL ON FUNCTION public.get_my_permissions() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_permission_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'key', c.permission_key, 'module', c.module, 'label', coalesce(c.label, c.permission_key),
           'description', c.description, 'scoped', c.scoped, 'risk', c.risk_level, 'aliases', c.aliases)
         ORDER BY c.sort_order, c.permission_key), '[]'::jsonb)
  FROM public.permissions c
  WHERE c.is_active;
$$;
REVOKE ALL ON FUNCTION public.get_permission_catalog() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_permission_catalog() TO authenticated;

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
               'id', g.grant_id,
               'permission', g.permission,
               'scope', g.scope,
               'scope_id', g.scope_id,
               'scope_label', public.hrms_scope_label(g.scope, g.scope_id),
               'source', g.source,
               'expires_at', g.expires_at,
               'granted_at', coalesce(up.created_at, rg.created_at),
               'granted_by', (SELECT a.name FROM public.profiles a WHERE a.id = coalesce(up.created_by, rg.created_by)),
               'reason', coalesce(up.reason, rg.reason))
             ORDER BY g.permission, g.scope)
      FROM public.hrms_active_grants(p_user_id) g
      LEFT JOIN public.user_permissions up ON g.source = 'USER' AND up.id = g.grant_id
      LEFT JOIN public.role_permission_grants rg ON g.source <> 'USER' AND rg.id = g.grant_id), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_user_permission_grants(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_permission_grants(uuid) TO authenticated;

-- Simulator: "Can USER do PERMISSION on TARGET, and why?"
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
  v_user   public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_target_json jsonb;
  v_user_json jsonb;
  v_grants jsonb;
  v_keys   text[] := public.hrms_permission_keys(p_permission);
  v_match  record;
BEGIN
  IF v_caller IS NULL OR NOT (public.hrms_is_permission_admin(v_caller, 'view')
                              OR public.hrms_is_permission_admin(v_caller, 'assign')) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_user FROM public.profiles WHERE id = p_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'reason', 'USER_NOT_FOUND'); END IF;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_target;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'reason', 'TARGET_NOT_FOUND'); END IF;

  v_user_json := jsonb_build_object('id', v_user.id, 'name', v_user.name, 'role', v_user.role,
                                    'is_active', v_user.is_active);
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
           'permission', g.permission, 'scope', g.scope, 'scope_id', g.scope_id,
           'scope_label', public.hrms_scope_label(g.scope, g.scope_id),
           'source', g.source, 'expires_at', g.expires_at,
           'covers_target', g.scope = 'GLOBAL'
             OR p_target IN (SELECT public.hrms_scope_member_ids(g.scope, g.scope_id, p_user))
         )), '[]'::jsonb)
  INTO v_grants
  FROM public.hrms_active_grants(p_user) g
  WHERE g.permission = ANY (v_keys);

  IF NOT coalesce(v_user.is_active, true) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'USER_INACTIVE',
      'explanation', format('%s is deactivated: no access.', v_user.name),
      'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
  END IF;
  IF p_user = p_target THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'SELF',
      'explanation', 'Everyone can access their own records.',
      'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
  END IF;
  IF p_permission LIKE 'permissions.%' THEN
    IF public.hrms_is_permission_admin(p_user, split_part(p_permission, '.', 2)) THEN
      RETURN jsonb_build_object('allowed', true, 'reason', 'PERMISSION_ADMIN',
        'explanation', format('%s may manage permissions.', v_user.name),
        'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
    END IF;
  ELSIF public.hrms_is_admin_user(p_user) THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'ADMIN_ROLE',
      'explanation', format('%s has an admin role (%s): all data permissions, all employees.', v_user.name, v_user.role),
      'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
  END IF;

  SELECT g.scope, g.scope_id, g.source, g.expires_at INTO v_match
  FROM public.hrms_active_grants(p_user) g
  WHERE g.permission = ANY (v_keys)
    AND (g.scope = 'GLOBAL' OR p_target IN (SELECT public.hrms_scope_member_ids(g.scope, g.scope_id, p_user)))
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('allowed', true,
      'reason', CASE WHEN v_match.source = 'USER' THEN 'SCOPED_GRANT' ELSE 'ROLE_TEMPLATE' END,
      'matched_grant', jsonb_build_object('scope', v_match.scope, 'scope_id', v_match.scope_id,
                                          'scope_label', public.hrms_scope_label(v_match.scope, v_match.scope_id),
                                          'source', v_match.source, 'expires_at', v_match.expires_at),
      'explanation', format('%s has %s for %s%s, which includes %s.', v_user.name, p_permission,
                            public.hrms_scope_label(v_match.scope, v_match.scope_id),
                            CASE WHEN v_match.source = 'USER' THEN '' ELSE ' (from the ' || substr(v_match.source, 6) || ' role template)' END,
                            v_target.name),
      'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
  END IF;

  RETURN jsonb_build_object('allowed', false,
    'reason', CASE WHEN jsonb_array_length(v_grants) = 0 THEN 'NO_GRANT' ELSE 'TARGET_OUTSIDE_SCOPE' END,
    'explanation', CASE WHEN jsonb_array_length(v_grants) = 0
      THEN format('%s has no %s grant.', v_user.name, p_permission)
      ELSE format('%s has %s, but none of their scopes include %s.', v_user.name, p_permission, v_target.name) END,
    'user', v_user_json, 'target', v_target_json, 'grants', v_grants);
END;
$$;
REVOKE ALL ON FUNCTION public.explain_access(uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.explain_access(uuid, text, uuid) TO authenticated;

-- ─── 7. Grant with optional expiry ──────────────────────────────────────────

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_grant_permission'
  LOOP
    EXECUTE format('DROP FUNCTION %s', fn.sig);
  END LOOP;
END $$;

CREATE FUNCTION public.admin_grant_permission(
  p_user_id    uuid,
  p_permission text,
  p_scope      text DEFAULT 'GLOBAL',
  p_scope_id   text DEFAULT NULL,
  p_reason     text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
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
  v_def      record;
  v_existing uuid;
  v_new_id   uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', 'Sign in again.');
  END IF;
  v_is_admin := EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = v_actor AND a.is_active
                        AND public.normalize_profile_role(a.role) IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN'));
  IF NOT public.hrms_is_permission_admin(v_actor, 'assign') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN',
      'message', 'Only System Admin / Admin (or users with permissions.assign) can grant permissions.');
  END IF;
  IF NOT v_is_admin AND p_user_id = v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_GRANT_FORBIDDEN', 'message', 'You cannot grant permissions to yourself.');
  END IF;
  IF NOT v_is_admin AND p_permission LIKE 'permissions.%' THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Only admins can grant permission-management rights.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND', 'message', 'Employee not found.');
  END IF;
  SELECT c.permission_key, c.scoped INTO v_def FROM public.permissions c WHERE c.permission_key = p_permission;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PERMISSION_KEY', 'message', 'Unknown permission: ' || coalesce(p_permission, ''));
  END IF;
  IF v_scope <> ALL (public.hrms_scope_types()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE', 'message', 'Unknown scope: ' || v_scope);
  END IF;
  IF NOT v_def.scoped AND v_scope <> 'GLOBAL' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE',
      'message', 'This permission is a company-wide setting and can only be granted for all employees.');
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_EXPIRY', 'message', 'The expiry must be in the future.');
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
  ELSIF v_scope = 'DEPARTMENT' AND v_scope_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_TARGET', 'message', 'Choose a department.');
  END IF;

  SELECT up.id INTO v_existing
  FROM public.user_permissions up
  WHERE up.user_id = p_user_id AND up.permission = p_permission AND up.revoked_at IS NULL
    AND up.scope::text = v_scope AND coalesce(up.scope_id, '') = coalesce(v_scope_id, '');

  PERFORM set_config('hrms.permission_reason', coalesce(p_reason, ''), true);

  IF v_existing IS NOT NULL THEN
    -- Re-granting renews / changes the expiry of the same grant.
    UPDATE public.user_permissions SET expires_at = p_expires_at,
           reason = coalesce(nullif(p_reason, ''), reason)
    WHERE id = v_existing;
    RETURN jsonb_build_object('success', true, 'id', v_existing, 'existing', true);
  END IF;

  EXECUTE format(
    'INSERT INTO public.user_permissions (user_id, permission, scope, scope_id, created_by, created_at, reason, expires_at)
     VALUES ($1, $2, %L, $3, $4, now(), $5, $6) RETURNING id', v_scope)
  INTO v_new_id
  USING p_user_id, p_permission, v_scope_id, v_actor, p_reason, p_expires_at;

  RETURN jsonb_build_object('success', true, 'id', v_new_id, 'existing', false,
    'scope_label', public.hrms_scope_label(v_scope, v_scope_id), 'expires_at', p_expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_grant_permission(uuid, text, text, text, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_permission(uuid, text, text, text, text, timestamptz) TO authenticated;

-- ─── 8. Role templates: list / grant / revoke ───────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_admin_list_role_permissions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.hrms_is_permission_admin(auth.uid(), 'view') OR public.hrms_is_permission_admin(auth.uid(), 'assign')) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'roles', coalesce((
      SELECT jsonb_agg(r ORDER BY r) FROM (
        SELECT DISTINCT public.normalize_profile_role(p.role) AS r FROM public.profiles p
        WHERE p.role IS NOT NULL AND coalesce(p.is_active, true)
      ) roles WHERE r IS NOT NULL AND r <> ''), '[]'::jsonb),
    'members', coalesce((
      SELECT jsonb_object_agg(r, n) FROM (
        SELECT public.normalize_profile_role(p.role) AS r, count(*) AS n FROM public.profiles p
        WHERE p.role IS NOT NULL AND coalesce(p.is_active, true) GROUP BY 1
      ) counts WHERE r IS NOT NULL), '{}'::jsonb),
    'grants', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', rg.id, 'role', rg.role, 'permission', rg.permission,
               'scope', rg.scope, 'scope_id', rg.scope_id,
               'scope_label', CASE WHEN rg.scope = 'REPORTS_TO' AND rg.scope_id IS NULL
                                   THEN 'Their own reporting line'
                                   ELSE public.hrms_scope_label(rg.scope, rg.scope_id) END,
               'reason', rg.reason, 'created_at', rg.created_at,
               'created_by', (SELECT a.name FROM public.profiles a WHERE a.id = rg.created_by))
             ORDER BY rg.role, rg.permission)
      FROM public.role_permission_grants rg WHERE rg.revoked_at IS NULL), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_list_role_permissions() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_role_permissions() TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_admin_grant_role_permission(
  p_role text, p_permission text, p_scope text DEFAULT 'REPORTS_TO', p_scope_id text DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role  text := upper(btrim(coalesce(p_role, '')));
  v_scope text := upper(btrim(coalesce(p_scope, 'REPORTS_TO')));
  v_scope_id text := nullif(btrim(coalesce(p_scope_id, '')), '');
  v_def record;
  v_id uuid;
BEGIN
  -- Role templates change access for many people at once: role admins only.
  IF NOT EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = v_actor AND a.is_active
                 AND public.normalize_profile_role(a.role) IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Only System Admin / Admin can change role templates.');
  END IF;
  IF v_role = '' OR v_role = ANY (public.hrms_admin_roles()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ROLE',
      'message', 'Choose a non-admin role (admin roles already have every data permission).');
  END IF;
  SELECT c.permission_key, c.scoped INTO v_def FROM public.permissions c WHERE c.permission_key = p_permission AND c.is_active;
  IF NOT FOUND OR p_permission LIKE 'permissions.%' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PERMISSION_KEY', 'message', 'Choose a data permission.');
  END IF;
  IF v_scope <> ALL (public.hrms_scope_types()) OR v_scope = 'ASSIGNED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE', 'message', 'Unknown scope: ' || v_scope);
  END IF;
  IF NOT v_def.scoped AND v_scope <> 'GLOBAL' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE', 'message', 'This permission can only be granted for all employees.');
  END IF;
  IF v_scope IN ('GLOBAL', 'SELF') THEN v_scope_id := NULL; END IF;
  IF v_scope IN ('OFFICE', 'OFFICE_TREE') AND NOT EXISTS (SELECT 1 FROM public.offices WHERE id = public.hrms_try_uuid(v_scope_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_TARGET', 'message', 'Choose a valid office.');
  END IF;
  IF v_scope IN ('TEAM', 'TEAM_TREE') AND NOT EXISTS (SELECT 1 FROM public.teams WHERE id = public.hrms_try_uuid(v_scope_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_TARGET', 'message', 'Choose a valid team.');
  END IF;
  IF v_scope = 'DEPARTMENT' AND v_scope_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCOPE_TARGET', 'message', 'Choose a department.');
  END IF;

  SELECT id INTO v_id FROM public.role_permission_grants
  WHERE role = v_role AND permission = p_permission AND scope = v_scope
    AND coalesce(scope_id, '') = coalesce(v_scope_id, '') AND revoked_at IS NULL;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'id', v_id, 'existing', true);
  END IF;

  INSERT INTO public.role_permission_grants (role, permission, scope, scope_id, reason, created_by)
  VALUES (v_role, p_permission, v_scope, v_scope_id, nullif(btrim(coalesce(p_reason, '')), ''), v_actor)
  RETURNING id INTO v_id;

  PERFORM public.hrms_log_role_template_change('ROLE_GRANT', v_id, v_role, p_permission, v_scope, v_scope_id, p_reason);
  RETURN jsonb_build_object('success', true, 'id', v_id, 'existing', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_revoke_role_permission(p_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.role_permission_grants%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = v_actor AND a.is_active
                 AND public.normalize_profile_role(a.role) IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Only System Admin / Admin can change role templates.');
  END IF;
  UPDATE public.role_permission_grants SET revoked_at = now(), revoked_by = v_actor
  WHERE id = p_id AND revoked_at IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'revoked', 0);
  END IF;
  PERFORM public.hrms_log_role_template_change('ROLE_REVOKE', v_row.id, v_row.role, v_row.permission, v_row.scope, v_row.scope_id, p_reason);
  RETURN jsonb_build_object('success', true, 'revoked', 1);
END;
$$;

-- Role-template audit goes to the general audit trail (permission_audit_logs
-- requires a target user or a legacy role row).
CREATE OR REPLACE FUNCTION public.hrms_log_role_template_change(
  p_action text, p_id uuid, p_role text, p_permission text, p_scope text, p_scope_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, new_values, source)
    VALUES (auth.uid(), NULL, p_action, 'role_permission_grant', p_id,
            jsonb_build_object('role', p_role, 'permission', p_permission, 'scope', p_scope,
                               'scope_id', p_scope_id, 'reason', p_reason), 'PERMISSION_MANAGER');
  EXCEPTION WHEN others THEN
    RAISE WARNING 'role template audit skipped: %', SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_log_role_template_change(text, uuid, text, text, text, text, text) FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_grant_role_permission(text, text, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_admin_revoke_role_permission(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_grant_role_permission(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_revoke_role_permission(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
