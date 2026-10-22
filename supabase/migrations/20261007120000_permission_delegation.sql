-- =============================================================================
-- 20261007120000_permission_delegation.sql
--
-- Run AFTER 20261007100000_permission_engine_v2.sql.
--
-- Makes the HR panel work for people who are NOT admins but hold scoped
-- permissions, without copying the bodies of ~20 existing admin functions:
--
-- A. require_profile_admin() accepts a transaction-local "delegated" flag that
--    only the SECURITY DEFINER wrappers below can set (clients cannot set
--    server settings through PostgREST).
-- B. hrms_install_permission_wrapper(fn, keys, targets, row_filter, extra):
--    renames fn -> fn__core (once) and creates fn with the SAME signature:
--      admins            -> call the original unchanged
--      everyone else     -> hrms_require_permission(keys)
--                           + every target employee must be inside the
--                             caller's scope for one of the keys
--                           + optional extra condition (e.g. "cannot edit an
--                             admin", "cannot approve own leave")
--                           + set-returning functions are filtered to the
--                             employees in scope
-- C. Wrappers for leave, employee, configuration, audit, tracking, events,
--    hierarchy and fraud-review functions.
-- D. rpc_admin_mutate_configuration rebuilt: the 20260918040000 version had
--    dropped the SITE branches, so Sites & Geofences could not save anything.
--    Now checks per entity: holidays/weekly offs -> attendance.calendar.manage,
--    offices/policies -> offices.manage, sites -> sites.manage.
-- E. Unguarded functions that returned company-wide data to ANY signed-in user
--    are now permission-checked: rpc_geofence_report, rpc_admin_attendance_daily_v3,
--    v_duplicate_device_usage.
-- F. Scoped read rules (RLS) added next to the existing ones, so screens that
--    read tables directly see exactly the employees in the caller's scope.
-- G. get_site_visit_observer_data: canonical field_visits.view key + IST date.
--
-- Idempotent: re-running regenerates the wrappers from the __core functions.
-- =============================================================================

-- ─── A. Delegation flag in require_profile_admin ────────────────────────────

CREATE OR REPLACE FUNCTION public.require_profile_admin()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT public.normalize_profile_role(profile.role)
  INTO v_role
  FROM public.profiles profile
  WHERE profile.id = auth.uid()
    AND profile.is_active = true;

  IF coalesce(v_role, '') = ANY (public.hrms_admin_roles()) THEN
    RETURN v_role;
  END IF;

  -- Set (transaction-local) only by a permission wrapper after it verified the
  -- caller's permission and scope for this exact call.
  IF current_setting('hrms.delegated_permission', true) = 'granted:' || auth.uid()::text THEN
    RETURN 'DELEGATED';
  END IF;

  RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.require_profile_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.require_profile_admin() TO authenticated, service_role;

-- Caller has one of the keys at GLOBAL scope (or is a data admin).
CREATE OR REPLACE FUNCTION public.hrms_has_global_permission(p_keys text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.hrms_is_admin_user(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.hrms_active_grants(auth.uid()) g, unnest(p_keys) k
    WHERE g.scope = 'GLOBAL' AND g.permission = ANY (public.hrms_permission_keys(k)));
$$;
REVOKE ALL ON FUNCTION public.hrms_has_global_permission(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_has_global_permission(text[]) TO authenticated;

-- Profiles a delegated employee manager may create/edit: never admin roles,
-- never themselves; a new or moved employee must land in an office they cover.
CREATE OR REPLACE FUNCTION public.hrms_delegated_profile_save_ok(p_profile_id uuid, p_values jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new_role text := public.normalize_profile_role(p_values->>'role');
  v_office uuid := public.hrms_try_uuid(p_values->>'office_id');
  v_old record;
BEGIN
  IF v_new_role = ANY (public.hrms_admin_roles()) OR v_new_role IN ('SUPER_ADMIN') THEN
    RETURN false;
  END IF;
  IF p_profile_id IS NOT NULL THEN
    IF p_profile_id = v_uid THEN RETURN false; END IF;
    SELECT office_id, public.normalize_profile_role(role) AS role INTO v_old
    FROM public.profiles WHERE id = p_profile_id;
    IF v_old.role = ANY (public.hrms_admin_roles()) THEN RETURN false; END IF;
    IF v_office IS NOT DISTINCT FROM v_old.office_id THEN RETURN true; END IF;
  END IF;
  -- creating, or moving to another office: that office must be covered
  RETURN public.hrms_has_global_permission(ARRAY['employees.manage'])
      OR EXISTS (SELECT 1 FROM public.hrms_active_grants(v_uid) g
                 WHERE g.permission = ANY (public.hrms_permission_keys('employees.manage'))
                   AND g.scope IN ('OFFICE', 'OFFICE_TREE')
                   AND public.hrms_try_uuid(g.scope_id) = v_office);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_delegated_profile_save_ok(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_delegated_profile_save_ok(uuid, jsonb) TO authenticated;

-- ─── B. Wrapper generator ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hrms_install_permission_wrapper(
  p_fn          text,
  p_keys_sql    text,                 -- SQL expression -> text[]
  p_targets_sql text DEFAULT NULL,    -- SQL expression -> uuid[] (employees acted on)
  p_row_filter  text DEFAULT NULL,    -- result column holding the employee id (set-returning fns)
  p_extra_sql   text DEFAULT NULL     -- SQL expression -> boolean (extra rule for delegated users)
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $gen$
DECLARE
  v_core   text := p_fn || '__core';
  r        record;
  v_core_oid oid;
  v_args   text;
  v_result text;
  v_call   text;
  v_retset boolean;
  v_void   boolean;
  v_body   text;
  v_n      integer := 0;
  v_names  text[];
  v_modes  "char"[];
  v_parts  text[];
  i        integer;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS ident
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = p_fn
  LOOP
    -- Already installed? Then this oid is the wrapper; regenerate it from core.
    SELECT p.oid INTO v_core_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_core
      AND pg_get_function_identity_arguments(p.oid) = r.ident;

    IF v_core_oid IS NULL THEN
      EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', p_fn, r.ident, v_core);
      v_core_oid := r.oid;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public, anon, authenticated', v_core, r.ident);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', v_core, r.ident);

    SELECT pg_get_function_arguments(p.oid), pg_get_function_result(p.oid), p.proretset,
           p.prorettype = 'void'::regtype, p.proargnames, p.proargmodes
    INTO v_args, v_result, v_retset, v_void, v_names, v_modes
    FROM pg_proc p WHERE p.oid = v_core_oid;

    -- positional call with the IN arguments
    v_parts := ARRAY[]::text[];
    FOR i IN 1 .. coalesce(array_length(v_names, 1), 0) LOOP
      IF v_modes IS NULL OR v_modes[i] IN ('i', 'b', 'v') THEN
        v_parts := v_parts || CASE WHEN v_modes IS NOT NULL AND v_modes[i] = 'v'
                                   THEN 'VARIADIC ' || quote_ident(v_names[i]) ELSE quote_ident(v_names[i]) END;
      END IF;
    END LOOP;
    v_call := format('public.%I(%s)', v_core, array_to_string(v_parts, ', '));

    v_body := format($w$
CREATE OR REPLACE FUNCTION public.%1$I(%2$s)
RETURNS %3$s
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v__uid     uuid := auth.uid();
  v__keys    text[];
  v__targets uuid[];
  %4$s
BEGIN
  IF public.hrms_is_admin_user(v__uid) THEN
    %5$s
  END IF;

  v__keys := (%6$s);
  IF v__keys IS NULL OR cardinality(v__keys) = 0 THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  PERFORM public.hrms_require_permission(v__keys);

  v__targets := (%7$s);
  IF EXISTS (SELECT 1 FROM unnest(v__targets) t
             WHERE t IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM unnest(v__keys) k WHERE public.can_access_user_data(t, k))) THEN
    RAISE EXCEPTION 'TARGET_OUTSIDE_SCOPE'
      USING ERRCODE = '42501', HINT = 'This employee is outside your permission scope.';
  END IF;
  IF NOT coalesce((%8$s), true) THEN
    RAISE EXCEPTION 'NOT_ALLOWED_FOR_DELEGATED_USER'
      USING ERRCODE = '42501', HINT = 'Only an administrator can do this.';
  END IF;

  PERFORM set_config('hrms.delegated_permission', 'granted:' || v__uid::text, true);
  %9$s
END;
$fn$;
$w$,
      p_fn, v_args, v_result,
      CASE WHEN v_retset OR v_void THEN '' ELSE format('v__result %s;', v_result) END,
      CASE WHEN v_retset THEN format('RETURN QUERY SELECT * FROM %s; RETURN;', v_call)
           WHEN v_void THEN format('PERFORM %s; RETURN;', v_call)
           ELSE format('RETURN %s;', v_call) END,
      p_keys_sql,
      coalesce(p_targets_sql, 'NULL::uuid[]'),
      coalesce(p_extra_sql, 'true'),
      CASE
        WHEN v_retset AND p_row_filter IS NOT NULL THEN format(
          'RETURN QUERY SELECT c.* FROM %s c WHERE c.%I IN (SELECT public.authorized_user_ids(k) FROM unnest(v__keys) k);
  PERFORM set_config(''hrms.delegated_permission'', '''', true);
  RETURN;', v_call, p_row_filter)
        WHEN v_retset THEN format(
          'RETURN QUERY SELECT * FROM %s;
  PERFORM set_config(''hrms.delegated_permission'', '''', true);
  RETURN;', v_call)
        WHEN v_void THEN format(
          'PERFORM %s;
  PERFORM set_config(''hrms.delegated_permission'', '''', true);
  RETURN;', v_call)
        ELSE format(
          'v__result := %s;
  PERFORM set_config(''hrms.delegated_permission'', '''', true);
  RETURN v__result;', v_call)
      END);

    EXECUTE v_body;
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public, anon', p_fn, r.ident);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', p_fn, r.ident);
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE 'hrms_install_permission_wrapper: % not found, skipped', p_fn;
  END IF;
  RETURN v_n;
END;
$gen$;
REVOKE ALL ON FUNCTION public.hrms_install_permission_wrapper(text, text, text, text, text) FROM public, anon, authenticated;

-- ─── D. Configuration (holidays / weekly offs / offices / sites) ────────────

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('rpc_admin_mutate_configuration', 'rpc_admin_mutate_configuration__core')
  LOOP
    EXECUTE format('DROP FUNCTION %s', fn.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.hrms_mutate_configuration_impl(
  p_entity text, p_action text, p_id uuid, p_values jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entity text := upper(btrim(coalesce(p_entity, '')));
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_id uuid := p_id;
  v_radius integer;
  v_office_id uuid := nullif(p_values->>'office_id', '')::uuid;
  v_team_id uuid := nullif(p_values->>'team_id', '')::uuid;
  v_user_id uuid := nullif(p_values->>'user_id', '')::uuid;
  v_week_of_month integer := nullif(p_values->>'week_of_month', '')::integer;
BEGIN
  IF v_entity = 'ATTENDANCE_POLICY' AND v_action = 'UPDATE' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'POLICY_ID_REQUIRED'; END IF;
    -- Only the fields that are sent change (a partial update used to blank the rest).
    IF coalesce((p_values->>'min_work_duration_minutes')::integer, 0) NOT BETWEEN 0 AND 1440
      OR coalesce((p_values->>'undo_checkout_minutes')::integer, 0) NOT BETWEEN 0 AND 60
      OR coalesce(p_values->>'earliest_checkout_time', '00:00') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$'
      OR coalesce(p_values->>'auto_close_time', '00:00') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$'
    THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_POLICY'; END IF;
    UPDATE public.attendance_policies SET
      min_work_duration_minutes = coalesce((p_values->>'min_work_duration_minutes')::integer, min_work_duration_minutes),
      earliest_checkout_time = coalesce(p_values->>'earliest_checkout_time', earliest_checkout_time::text),
      auto_close_time = coalesce(p_values->>'auto_close_time', auto_close_time::text),
      allow_night_shift = coalesce((p_values->>'allow_night_shift')::boolean, allow_night_shift),
      require_early_checkout_reason = coalesce((p_values->>'require_early_checkout_reason')::boolean, require_early_checkout_reason),
      undo_checkout_minutes = coalesce((p_values->>'undo_checkout_minutes')::integer, undo_checkout_minutes),
      allow_field_visit_checkout = coalesce((p_values->>'allow_field_visit_checkout')::boolean, allow_field_visit_checkout),
      updated_at = now()
    WHERE id = p_id;

  ELSIF v_entity = 'OFFICE' AND v_action = 'CREATE' THEN
    v_radius := coalesce((p_values->>'attendance_radius')::integer, 100);
    IF nullif(btrim(p_values->>'name'), '') IS NULL
      OR coalesce(nullif(p_values->>'latitude', '')::double precision, 0) NOT BETWEEN -90 AND 90
      OR coalesce(nullif(p_values->>'longitude', '')::double precision, 0) NOT BETWEEN -180 AND 180
      OR v_radius NOT BETWEEN 10 AND 1000
    THEN RAISE EXCEPTION 'INVALID_OFFICE'; END IF;
    INSERT INTO public.offices (name, address, latitude, longitude, attendance_radius, is_active)
    VALUES (btrim(p_values->>'name'), nullif(btrim(p_values->>'address'), ''),
            nullif(p_values->>'latitude', '')::double precision,
            nullif(p_values->>'longitude', '')::double precision, v_radius, true)
    RETURNING id INTO v_id;

  ELSIF v_entity = 'OFFICE' AND v_action = 'SET_ACTIVE' THEN
    IF (p_values->>'is_active')::boolean AND NOT EXISTS (
      SELECT 1 FROM public.attendance_policies policy WHERE policy.office_id = p_id AND policy.is_active
    ) THEN RAISE EXCEPTION 'ACTIVE_OFFICE_REQUIRES_ATTENDANCE_POLICY'; END IF;
    UPDATE public.offices SET is_active = (p_values->>'is_active')::boolean WHERE id = p_id;

  ELSIF v_entity = 'OFFICE' AND v_action = 'SET_RADIUS' THEN
    v_radius := (p_values->>'attendance_radius')::integer;
    IF v_radius NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'INVALID_RADIUS'; END IF;
    UPDATE public.offices SET attendance_radius = v_radius WHERE id = p_id;

  ELSIF v_entity = 'SITE' AND v_action = 'CREATE' THEN
    v_radius := coalesce((p_values->>'checkin_radius_m')::integer, 100);
    IF nullif(btrim(p_values->>'project_name'), '') IS NULL
      OR nullif(btrim(p_values->>'site_label'), '') IS NULL
      OR nullif(p_values->>'latitude', '')::double precision NOT BETWEEN -90 AND 90
      OR nullif(p_values->>'longitude', '')::double precision NOT BETWEEN -180 AND 180
      OR v_radius NOT BETWEEN 10 AND 5000
      OR lower(coalesce(p_values->>'site_type', 'site')) NOT IN ('site', 'office', 'meeting')
    THEN RAISE EXCEPTION 'INVALID_SITE'; END IF;
    INSERT INTO public.predefined_sites (project_name, site_label, address, latitude, longitude,
                                         checkin_radius_m, site_type, is_active)
    VALUES (btrim(p_values->>'project_name'), btrim(p_values->>'site_label'),
            nullif(btrim(p_values->>'address'), ''),
            (p_values->>'latitude')::double precision, (p_values->>'longitude')::double precision,
            v_radius, lower(coalesce(p_values->>'site_type', 'site')), true)
    RETURNING id INTO v_id;

  ELSIF v_entity = 'SITE' AND v_action = 'SET_ACTIVE' THEN
    UPDATE public.predefined_sites SET is_active = (p_values->>'is_active')::boolean WHERE id = p_id;

  ELSIF v_entity = 'SITE' AND v_action = 'SET_RADIUS' THEN
    v_radius := (p_values->>'checkin_radius_m')::integer;
    IF v_radius NOT BETWEEN 10 AND 5000 THEN RAISE EXCEPTION 'INVALID_SITE_RADIUS'; END IF;
    UPDATE public.predefined_sites SET checkin_radius_m = v_radius WHERE id = p_id;

  ELSIF v_entity = 'HOLIDAY' AND v_action = 'CREATE' THEN
    IF num_nonnulls(v_office_id, v_team_id, v_user_id) > 1 THEN RAISE EXCEPTION 'CONFLICTING_CALENDAR_SCOPE'; END IF;
    IF nullif(btrim(p_values->>'name'), '') IS NULL THEN RAISE EXCEPTION 'HOLIDAY_NAME_REQUIRED'; END IF;
    INSERT INTO public.holiday_calendar (holiday_date, name, office_id, team_id, user_id, is_optional, is_active, created_by)
    VALUES ((p_values->>'holiday_date')::date, btrim(p_values->>'name'), v_office_id, v_team_id, v_user_id,
            coalesce((p_values->>'is_optional')::boolean, false), true, auth.uid())
    RETURNING id INTO v_id;

  ELSIF v_entity = 'HOLIDAY' AND v_action = 'DELETE' THEN
    DELETE FROM public.holiday_calendar WHERE id = p_id;

  ELSIF v_entity = 'WEEKLY_OFF' AND v_action = 'CREATE' THEN
    IF num_nonnulls(v_office_id, v_team_id, v_user_id) > 1 THEN RAISE EXCEPTION 'CONFLICTING_CALENDAR_SCOPE'; END IF;
    IF (p_values->>'weekday')::integer NOT BETWEEN 0 AND 6
      OR (v_week_of_month IS NOT NULL AND v_week_of_month NOT BETWEEN 1 AND 5)
      OR (nullif(p_values->>'valid_to', '')::date IS NOT NULL
          AND nullif(p_values->>'valid_to', '')::date
              < coalesce(nullif(p_values->>'valid_from', '')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date))
    THEN RAISE EXCEPTION 'INVALID_WEEKLY_OFF_RULE'; END IF;
    -- re-activate an identical rule that was removed earlier
    UPDATE public.weekly_off_rules SET
      is_active = true,
      valid_from = coalesce(nullif(p_values->>'valid_from', '')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date),
      valid_to = nullif(p_values->>'valid_to', '')::date,
      created_by = auth.uid()
    WHERE office_id IS NOT DISTINCT FROM v_office_id
      AND team_id IS NOT DISTINCT FROM v_team_id
      AND user_id IS NOT DISTINCT FROM v_user_id
      AND weekday = (p_values->>'weekday')::integer
      AND week_of_month IS NOT DISTINCT FROM v_week_of_month
    RETURNING id INTO v_id;
    IF NOT FOUND THEN
      INSERT INTO public.weekly_off_rules (office_id, team_id, user_id, weekday, week_of_month,
                                           valid_from, valid_to, is_active, created_by)
      VALUES (v_office_id, v_team_id, v_user_id, (p_values->>'weekday')::integer, v_week_of_month,
              coalesce(nullif(p_values->>'valid_from', '')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date),
              nullif(p_values->>'valid_to', '')::date, true, auth.uid())
      RETURNING id INTO v_id;
    END IF;

  ELSIF v_entity = 'WEEKLY_OFF' AND v_action = 'DEACTIVATE' THEN
    UPDATE public.weekly_off_rules SET is_active = false WHERE id = p_id;

  ELSIF v_entity = 'WEEKLY_OFF' AND v_action = 'DELETE' THEN
    DELETE FROM public.weekly_off_rules WHERE id = p_id;

  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_CONFIGURATION_ACTION';
  END IF;

  IF v_id IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'CONFIGURATION_ROW_NOT_FOUND';
  END IF;

  INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, new_values, source)
  VALUES (auth.uid(), NULL, 'CONFIGURATION_' || v_action, lower(v_entity), v_id,
          jsonb_build_object('values', p_values), 'HRMS_ADMIN');

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_mutate_configuration_impl(text, text, uuid, jsonb) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_admin_mutate_configuration(
  p_entity text, p_action text, p_id uuid DEFAULT NULL, p_values jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entity text := upper(btrim(coalesce(p_entity, '')));
BEGIN
  PERFORM public.hrms_require_permission(
    CASE
      WHEN v_entity IN ('HOLIDAY', 'WEEKLY_OFF') THEN ARRAY['attendance.calendar.manage']
      WHEN v_entity IN ('OFFICE', 'ATTENDANCE_POLICY') THEN ARRAY['offices.manage']
      WHEN v_entity = 'SITE' THEN ARRAY['sites.manage']
      ELSE ARRAY['__admin_only__']
    END);
  RETURN public.hrms_mutate_configuration_impl(p_entity, p_action, p_id, coalesce(p_values, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_mutate_configuration(text, text, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_mutate_configuration(text, text, uuid, jsonb) TO authenticated;

-- ─── C. Wrappers ────────────────────────────────────────────────────────────

SELECT public.hrms_install_permission_wrapper('rpc_admin_leave_balance_summary',
  $k$ARRAY['leave.view','leave.balance.manage']$k$, NULL, 'user_id');
SELECT public.hrms_install_permission_wrapper('rpc_admin_adjust_leave_balance',
  $k$ARRAY['leave.balance.manage']$k$, $t$ARRAY[p_user_id]$t$);
SELECT public.hrms_install_permission_wrapper('rpc_grant_comp_off_credit',
  $k$ARRAY['leave.balance.manage']$k$, $t$ARRAY[p_user_id]$t$, NULL, $x$p_user_id <> auth.uid()$x$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_create_comp_off_earning',
  $k$ARRAY['leave.balance.manage']$k$, $t$ARRAY[p_user_id]$t$, NULL, $x$p_user_id <> auth.uid()$x$);
SELECT public.hrms_install_permission_wrapper('rpc_review_leave_request',
  $k$ARRAY['leave.approve']$k$,
  $t$ARRAY[(SELECT lr.user_id FROM public.leave_requests lr WHERE lr.id = p_request_id)]$t$,
  NULL,
  $x$(SELECT lr.user_id FROM public.leave_requests lr WHERE lr.id = p_request_id) IS DISTINCT FROM auth.uid()$x$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_set_profile_active',
  $k$ARRAY['employees.manage']$k$, $t$ARRAY[p_profile_id]$t$, NULL,
  $x$p_profile_id <> auth.uid() AND NOT EXISTS (SELECT 1 FROM public.profiles pp WHERE pp.id = p_profile_id
     AND public.normalize_profile_role(pp.role) = ANY (public.hrms_admin_roles()))$x$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_save_profile',
  $k$ARRAY['employees.manage']$k$,
  $t$CASE WHEN p_profile_id IS NULL THEN NULL ELSE ARRAY[p_profile_id] END$t$, NULL,
  $x$public.hrms_delegated_profile_save_ok(p_profile_id, p_values)$x$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_attendance_configuration_issues',
  $k$ARRAY['offices.manage','attendance.calendar.manage']$k$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_audit_logs_summary', $k$ARRAY['audit.view']$k$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_update_hierarchy', $k$ARRAY['teams.manage']$k$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_apply_hierarchy_import', $k$ARRAY['teams.manage']$k$);
SELECT public.hrms_install_permission_wrapper('rpc_recalculate_attendance_warnings', $k$ARRAY['attendance.regularize']$k$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_create_event', $k$ARRAY['events.manage']$k$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_delete_event', $k$ARRAY['events.manage']$k$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_request_location_pings',
  $k$ARRAY['live_tracking.view']$k$, $t$p_target_user_ids$t$);
SELECT public.hrms_install_permission_wrapper('rpc_admin_save_transit_warning',
  $k$ARRAY['live_tracking.view']$k$, $t$ARRAY[public.hrms_try_uuid(p_values->>'user_id')]$t$);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'location_alerts' AND column_name = 'user_id') THEN
    PERFORM public.hrms_install_permission_wrapper('rpc_admin_resolve_location_alert',
      $k$ARRAY['live_tracking.view']$k$,
      $t$ARRAY[(SELECT la.user_id FROM public.location_alerts la WHERE la.id = p_alert_id)]$t$);
  ELSE
    PERFORM public.hrms_install_permission_wrapper('rpc_admin_resolve_location_alert', $k$ARRAY['live_tracking.view']$k$);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'attendance_fraud_events' AND column_name = 'user_id') THEN
    PERFORM public.hrms_install_permission_wrapper('rpc_admin_review_fraud_event',
      $k$ARRAY['suspicious.view']$k$,
      $t$ARRAY[(SELECT fe.user_id FROM public.attendance_fraud_events fe WHERE fe.id = p_event_id)]$t$);
  ELSE
    PERFORM public.hrms_install_permission_wrapper('rpc_admin_review_fraud_event', $k$ARRAY['suspicious.view']$k$);
  END IF;
END $$;

-- ─── E. Unguarded company-wide functions ────────────────────────────────────

-- Geofence report: any signed-in user could read every employee's events.
SELECT public.hrms_install_permission_wrapper('rpc_geofence_report',
  $k$ARRAY['live_tracking.view','attendance.view']$k$, $t$ARRAY[p_user_id]$t$, NULL,
  $x$p_user_id IS NOT NULL OR public.hrms_has_global_permission(ARRAY['live_tracking.view','attendance.view'])$x$);
-- Company-wide daily attendance counts.
SELECT public.hrms_install_permission_wrapper('rpc_admin_attendance_daily_v3',
  $k$ARRAY['attendance.view']$k$, NULL, NULL,
  $x$public.hrms_has_global_permission(ARRAY['attendance.view'])$x$);

DO $$
BEGIN
  IF to_regclass('public.employee_device_bindings') IS NOT NULL THEN
    CREATE OR REPLACE VIEW public.v_duplicate_device_usage AS
    WITH device_counts AS (
      SELECT device_fingerprint, count(DISTINCT user_id) AS users_count
      FROM public.employee_device_bindings
      GROUP BY device_fingerprint
      HAVING count(DISTINCT user_id) > 1
    )
    SELECT d.device_fingerprint, d.device_name, d.platform, d.app_version, d.user_id,
           p.name AS employee_name, p.employee_number, d.last_verified_at AS last_used, c.users_count
    FROM public.employee_device_bindings d
    JOIN device_counts c ON c.device_fingerprint = d.device_fingerprint
    JOIN public.profiles p ON p.id = d.user_id
    WHERE public.hrms_has_permission('devices.manage')
    ORDER BY c.users_count DESC, d.device_fingerprint, d.last_verified_at DESC;
    REVOKE ALL ON public.v_duplicate_device_usage FROM anon;
    GRANT SELECT ON public.v_duplicate_device_usage TO authenticated;
  END IF;
END $$;

-- ─── F. Scoped read rules next to the existing ones ─────────────────────────

-- Everyone the caller may see for ANY scoped permission (names in lists, joins).
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
     OR EXISTS (SELECT 1 FROM public.hrms_active_grants(v_uid) g WHERE g.scope = 'GLOBAL') THEN
    RETURN QUERY SELECT p.id FROM public.profiles p;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT v_uid
    UNION
    SELECT m FROM public.hrms_active_grants(v_uid) g
    CROSS JOIN LATERAL public.hrms_scope_member_ids(g.scope, g.scope_id, v_uid) m;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_visible_profile_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_visible_profile_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.hrms_add_scoped_read_policy(
  p_table text, p_column text, p_keys text[], p_command text DEFAULT 'SELECT')
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy text := 'hrms_scoped_' || lower(p_command) || '_' || p_table;
  v_expr text;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN
    RAISE NOTICE 'scoped policy: table % not found, skipped', p_table;
    RETURN;
  END IF;
  IF p_column IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column) THEN
    RAISE NOTICE 'scoped policy: %.% not found, skipped', p_table, p_column;
    RETURN;
  END IF;
  v_expr := CASE
    WHEN p_column IS NULL THEN
      format('(SELECT bool_or(public.hrms_has_permission(k)) FROM unnest(%L::text[]) k)', p_keys)
    ELSE
      format('%I IN (SELECT public.authorized_user_ids(k) FROM unnest(%L::text[]) k)', p_column, p_keys)
  END;
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy, p_table);
  IF p_command = 'SELECT' THEN
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', v_policy, p_table, v_expr);
  ELSIF p_command = 'INSERT' THEN
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', v_policy, p_table, v_expr);
  ELSE
    EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING (%s) WITH CHECK (%s)',
                   v_policy, p_table, p_command, v_expr, v_expr);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_add_scoped_read_policy(text, text, text[], text) FROM public, anon, authenticated;

SELECT public.hrms_add_scoped_read_policy('attendance_logs', 'user_id', ARRAY['attendance.view','attendance.regularize']);
SELECT public.hrms_add_scoped_read_policy('attendance_regularization_requests', 'user_id', ARRAY['regularization.view','regularization.approve']);
SELECT public.hrms_add_scoped_read_policy('field_visits', 'user_id', ARRAY['field_visits.view']);
SELECT public.hrms_add_scoped_read_policy('leave_requests', 'user_id', ARRAY['leave.view','leave.approve']);
SELECT public.hrms_add_scoped_read_policy('comp_off_earnings', 'user_id', ARRAY['leave.view','leave.balance.manage']);
SELECT public.hrms_add_scoped_read_policy('tasks', 'assigned_to', ARRAY['tasks.view','tasks.manage']);
SELECT public.hrms_add_scoped_read_policy('tasks', 'assigned_to', ARRAY['tasks.manage'], 'INSERT');
SELECT public.hrms_add_scoped_read_policy('tasks', 'assigned_to', ARRAY['tasks.manage'], 'UPDATE');
SELECT public.hrms_add_scoped_read_policy('location_tracking', 'user_id', ARRAY['live_tracking.view']);
SELECT public.hrms_add_scoped_read_policy('location_alerts', 'user_id', ARRAY['live_tracking.view']);
SELECT public.hrms_add_scoped_read_policy('transit_warnings', 'user_id', ARRAY['live_tracking.view']);
SELECT public.hrms_add_scoped_read_policy('checkin_attempts', 'user_id', ARRAY['checkin_logs.view']);
SELECT public.hrms_add_scoped_read_policy('attendance_fraud_events', 'user_id', ARRAY['suspicious.view']);
SELECT public.hrms_add_scoped_read_policy('smartoffice_device_logs', 'user_id', ARRAY['attendance.view']);
SELECT public.hrms_add_scoped_read_policy('support_tickets', NULL, ARRAY['tickets.manage']);
SELECT public.hrms_add_scoped_read_policy('support_tickets', NULL, ARRAY['tickets.manage'], 'UPDATE');
SELECT public.hrms_add_scoped_read_policy('anonymous_feedback', NULL, ARRAY['feedback.view']);
SELECT public.hrms_add_scoped_read_policy('audit_logs', NULL, ARRAY['audit.view']);
SELECT public.hrms_add_scoped_read_policy('notifications', NULL, ARRAY['notifications.send'], 'INSERT');

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP POLICY IF EXISTS hrms_scoped_select_profiles ON public.profiles;
    CREATE POLICY hrms_scoped_select_profiles ON public.profiles
      FOR SELECT TO authenticated
      USING (id IN (SELECT public.hrms_visible_profile_ids()));
  END IF;
END $$;

-- ─── G. Site Visit Observer: canonical key + IST "today" ────────────────────

DO $$
DECLARE
  v_oid oid := to_regprocedure('public.get_site_visit_observer_data(date, uuid, uuid)');
  v_def text;
BEGIN
  IF v_oid IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef(v_oid);
  v_def := replace(v_def,
    $o$IF NOT EXISTS(SELECT 1 FROM public.user_permissions WHERE user_id = auth.uid() AND permission = 'view_site_visit_observer' AND revoked_at IS NULL) THEN$o$,
    $n$IF NOT public.hrms_has_permission('field_visits.view') THEN$n$);
  v_def := replace(v_def, $o$v_is_live  := (p_date = CURRENT_DATE);$o$,
                          $n$v_is_live  := (p_date = (now() AT TIME ZONE 'Asia/Kolkata')::date);$n$);
  v_def := replace(v_def, $o$public.can_access_user_data(fv.user_id,'view_site_visit_observer')$o$,
                          $n$public.can_access_user_data(fv.user_id,'field_visits.view')$n$);
  EXECUTE v_def;
END $$;

NOTIFY pgrst, 'reload schema';
