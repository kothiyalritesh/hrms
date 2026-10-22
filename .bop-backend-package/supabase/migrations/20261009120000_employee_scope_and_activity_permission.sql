-- =============================================================================
-- 20261009120000_employee_scope_and_activity_permission.sql
--
-- Run AFTER 20261007130000_legacy_permission_aliases.sql (and after re-running
-- 20261007100000_permission_engine_v2.sql, if that is ever re-run: it resets
-- the alias lists).
--
-- Bug report 2026-10-09. No grant, profile or attendance row is changed.
--
-- BUG-06  An office-scoped account saw every employee.
--   * rpc_admin_list_employees: the Employees screen now loads only the
--     employees the caller may see (employees.view / employees.manage scope),
--     with a fixed column list and a per-row can_edit flag.
--   * hrms_visible_profile_ids (profiles read rule from 20261007120000):
--     any GLOBAL grant used to unlock every profile, and company-wide settings
--     (events, sites, offices, tickets, ...) are always granted GLOBAL. Now a
--     GLOBAL grant counts only for scoped data permissions and for the
--     settings that genuinely need the staff list (team hierarchy, birthdays,
--     notifications, permission management).
--   NOT done here (needs the live policy listing and approval): removing any
--   older broad SELECT policy on profiles. Policies are OR-ed, so if one
--   exists, direct table reads stay broad until it is removed.
--
-- BUG-07  "Outside of scope" when editing: grants saved under
--   employees.update / employees.edit / employee.update were not recognised.
--   They are now aliases of employees.manage (same scope as granted).
--
-- BUG-09  Activity Analysis had no permission of its own (it was an alias of
--   live_tracking.view) and its data followed attendance.view instead.
--   * New scoped key activity_analysis.view (alias reports.activity_analysis,
--     which is removed from live_tracking.view).
--   * rpc_activity_analysis_day / rpc_activity_logs_day: data limited to the
--     employees in the caller's activity_analysis.view or live_tracking.view
--     scope (live_tracking.view keeps existing access working).
--   * rpc_attendance_canonical_range read user_permissions directly and
--     ignored expiry, role templates and aliases (an expired GLOBAL
--     attendance.view still returned the whole company). Now uses the
--     permission engine.
--
-- Idempotent.
-- =============================================================================

-- ─── 1. Catalog ──────────────────────────────────────────────────────────────

UPDATE public.permissions
SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || ARRAY['employees.update','employees.edit','employee.update']) a ORDER BY a)
WHERE permission_key = 'employees.manage';

UPDATE public.permissions
SET aliases = array_remove(aliases, 'reports.activity_analysis')
WHERE permission_key = 'live_tracking.view';

INSERT INTO public.permissions (permission_key, module, action, label, description, scoped, risk_level, aliases, sort_order, is_active)
VALUES ('activity_analysis.view', 'Field & tracking', 'view', 'Activity analysis',
        'Daily activity log and attendance of employees in scope', true, 'MEDIUM',
        ARRAY['reports.activity_analysis','screen.activity_analysis'], 44, true)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, label = EXCLUDED.label,
  description = EXCLUDED.description, scoped = EXCLUDED.scoped,
  risk_level = EXCLUDED.risk_level,
  aliases = ARRAY(SELECT DISTINCT a FROM unnest(public.permissions.aliases || EXCLUDED.aliases) a ORDER BY a),
  sort_order = EXCLUDED.sort_order, is_active = true;

-- Alias keys stay valid for old grants but are hidden from the picker.
UPDATE public.permissions p SET is_active = false
WHERE EXISTS (SELECT 1 FROM public.permissions c WHERE p.permission_key = ANY (c.aliases));

-- ─── 2. BUG-06: who a GLOBAL grant reveals ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.hrms_visible_profile_ids()
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF public.hrms_is_admin_user(v_uid)
     OR EXISTS (
       SELECT 1
       FROM public.hrms_active_grants(v_uid) g
       JOIN public.permissions c
         ON g.permission = c.permission_key OR g.permission = ANY (c.aliases)
       WHERE g.scope = 'GLOBAL'
         AND (c.scoped
              OR c.permission_key IN ('teams.manage', 'birthdays.manage', 'notifications.send',
                                      'permissions.view', 'permissions.assign', 'permissions.revoke'))) THEN
    RETURN QUERY SELECT p.id FROM public.profiles p;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT v_uid
    UNION
    SELECT m FROM public.hrms_active_grants(v_uid) g
    CROSS JOIN LATERAL public.hrms_scope_member_ids(g.scope, g.scope_id, v_uid) m
    WHERE g.scope <> 'GLOBAL';
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_visible_profile_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_visible_profile_ids() TO authenticated;

-- ─── 3. BUG-06: scoped employee list ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.rpc_admin_list_employees(uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_admin_list_employees(
  p_office_id uuid DEFAULT NULL,
  p_search    text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  phone text,
  employee_number text,
  role text,
  role_id uuid,
  role_name text,
  office_id uuid,
  office_name text,
  team text,
  reports_to uuid,
  reporting_manager_name text,
  is_active boolean,
  username text,
  gender text,
  date_of_joining date,
  weekly_off_day integer,
  can_edit boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_admin boolean;
  v_q     text := nullif(lower(btrim(coalesce(p_search, ''))), '');
BEGIN
  PERFORM public.hrms_require_permission(ARRAY['employees.view', 'employees.manage']);
  v_admin := public.hrms_is_admin_user(v_uid);

  RETURN QUERY
  WITH scope AS (
    SELECT public.authorized_user_ids('employees.view') AS uid
    UNION
    SELECT public.authorized_user_ids('employees.manage')
  ), editable AS (
    SELECT public.authorized_user_ids('employees.manage') AS uid
  )
  SELECT p.id,
         p.name::text,
         p.email::text,
         p.phone::text,
         p.employee_number::text,
         p.role::text,
         p.role_id,
         coalesce(nullif(p.role::text, ''), r.name::text, 'No Role'),
         p.office_id,
         coalesce(o.name::text, 'No Office'),
         p.team::text,
         p.reports_to,
         m.name::text,
         p.is_active,
         p.username::text,
         p.gender::text,
         p.date_of_joining::date,
         p.weekly_off_day::integer,
         (v_admin
          OR (p.id <> v_uid
              AND p.id IN (SELECT uid FROM editable)
              AND public.normalize_profile_role(p.role) NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')))
  FROM public.profiles p
  LEFT JOIN public.roles r ON r.id = p.role_id
  LEFT JOIN public.offices o ON o.id = p.office_id
  LEFT JOIN public.profiles m ON m.id = p.reports_to
  WHERE (v_admin OR p.id IN (SELECT uid FROM scope))
    AND (p_office_id IS NULL OR p.office_id = p_office_id)
    AND (v_q IS NULL
         OR lower(coalesce(p.name, '')) LIKE '%' || v_q || '%'
         OR lower(coalesce(p.employee_number::text, '')) LIKE '%' || v_q || '%'
         OR lower(coalesce(p.phone::text, '')) LIKE '%' || v_q || '%'
         OR lower(coalesce(p.email::text, '')) LIKE '%' || v_q || '%')
  ORDER BY p.team NULLS LAST, p.name, p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_list_employees(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_employees(uuid, text) TO authenticated;

-- ─── 4. BUG-09: canonical attendance uses the permission engine ─────────────

CREATE OR REPLACE FUNCTION public.rpc_attendance_canonical_range(
  p_start_date date,
  p_end_date   date,
  p_office_id  uuid DEFAULT NULL,
  p_team_id    uuid DEFAULT NULL,
  p_user_id    uuid DEFAULT NULL
)
RETURNS SETOF public.v_attendance_daily_canonical
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_user      uuid := p_user_id;
  v_unscoped  boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE' USING ERRCODE = '22023';
  END IF;
  IF p_end_date - p_start_date > 400 THEN
    RAISE EXCEPTION 'DATE_RANGE_TOO_LARGE: maximum 400 days per request' USING ERRCODE = '22023';
  END IF;

  -- Active (not revoked, not expired) grants incl. role templates and aliases.
  v_unscoped := p_user_id = v_uid
    OR public.hrms_is_admin_user(v_uid)
    OR public.hrms_has_global_permission(ARRAY['attendance.view']);

  IF NOT v_unscoped AND NOT public.hrms_has_permission('attendance.view') THEN
    IF p_user_id IS NOT NULL THEN
      RETURN;
    END IF;
    v_user := v_uid;
    v_unscoped := true;
  END IF;

  IF v_unscoped THEN
    RETURN QUERY
      SELECT patched.*
      FROM public.rpc_attendance_canonical_range_core(p_start_date, p_end_date, p_office_id, p_team_id, v_user) c
      CROSS JOIN LATERAL jsonb_populate_record(c, public.hrms_canonical_row_patch(to_jsonb(c))) patched
      ORDER BY patched.work_date DESC, patched.employee_name ASC, patched.user_id ASC;
  ELSE
    RETURN QUERY
      SELECT patched.*
      FROM public.rpc_attendance_canonical_range_core(p_start_date, p_end_date, p_office_id, p_team_id, v_user) c
      CROSS JOIN LATERAL jsonb_populate_record(c, public.hrms_canonical_row_patch(to_jsonb(c))) patched
      WHERE c.user_id IN (SELECT public.authorized_user_ids('attendance.view'))
      ORDER BY patched.work_date DESC, patched.employee_name ASC, patched.user_id ASC;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid) TO authenticated;

-- ─── 5. BUG-09: Activity Analysis data ──────────────────────────────────────

-- Employees the caller may analyse.
CREATE OR REPLACE FUNCTION public.hrms_activity_analysis_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.authorized_user_ids('activity_analysis.view')
  UNION
  SELECT public.authorized_user_ids('live_tracking.view');
$$;
REVOKE ALL ON FUNCTION public.hrms_activity_analysis_user_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_activity_analysis_user_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_activity_analysis_day(p_date date)
RETURNS SETOF public.v_attendance_daily_canonical
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.hrms_require_permission(ARRAY['activity_analysis.view', 'live_tracking.view']);
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT patched.*
    FROM public.rpc_attendance_canonical_range_core(p_date, p_date, NULL, NULL, NULL) c
    CROSS JOIN LATERAL jsonb_populate_record(c, public.hrms_canonical_row_patch(to_jsonb(c))) patched
    WHERE public.hrms_is_admin_user(v_uid)
       OR c.user_id IN (SELECT public.hrms_activity_analysis_user_ids())
    ORDER BY patched.employee_name ASC, patched.user_id ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_activity_analysis_day(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_activity_analysis_day(date) TO authenticated;

-- activity_logs."timestamp" is timestamp or timestamptz depending on how the
-- table was first created; the IST day bounds are built for the actual type.
CREATE OR REPLACE FUNCTION public.rpc_activity_logs_day(p_date date)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_admin boolean;
  v_tz    boolean;
BEGIN
  PERFORM public.hrms_require_permission(ARRAY['activity_analysis.view', 'live_tracking.view']);
  IF p_date IS NULL OR to_regclass('public.activity_logs') IS NULL THEN
    RETURN;
  END IF;
  v_admin := public.hrms_is_admin_user(v_uid);
  SELECT c.data_type = 'timestamp with time zone' INTO v_tz
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'activity_logs' AND c.column_name = 'timestamp';

  IF v_tz THEN
    RETURN QUERY EXECUTE
      'SELECT to_jsonb(a) FROM public.activity_logs a
        WHERE a."timestamp" >= ($1::timestamp AT TIME ZONE ''Asia/Kolkata'')
          AND a."timestamp" <  (($1 + 1)::timestamp AT TIME ZONE ''Asia/Kolkata'')
          AND ($2 OR a.user_id IN (SELECT public.hrms_activity_analysis_user_ids()))
        ORDER BY a."timestamp"'
      USING p_date, v_admin;
  ELSE
    RETURN QUERY EXECUTE
      'SELECT to_jsonb(a) FROM public.activity_logs a
        WHERE a."timestamp" >= $1::timestamp
          AND a."timestamp" <  ($1 + 1)::timestamp
          AND ($2 OR a.user_id IN (SELECT public.hrms_activity_analysis_user_ids()))
        ORDER BY a."timestamp"'
      USING p_date, v_admin;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_activity_logs_day(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_activity_logs_day(date) TO authenticated;

NOTIFY pgrst, 'reload schema';
