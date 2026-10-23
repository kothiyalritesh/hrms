-- =============================================================================
-- 20261023100000_employee_erase_sync_health_joining_date.sql
--
-- A. Delete employee = erase the person and ALL their records (HR decision
--    2026-10-23: "Always erase everything").
--    The old trash button only deactivated, and rpc_admin_delete_profile
--    (2026-09-02) names a fixed list of tables, so every table added since
--    (permissions, geofence events, corrections, raw punches, ...) blocks it.
--    The erase now finds every table that points at the employee from the
--    database catalog, removes the employee's rows (and rows that depend on
--    them), clears references in other people's rows, then removes the
--    profile and the login. One transaction: it either completes or changes
--    nothing. rpc_admin_erase_employee_preview runs the same erase and rolls
--    it back, so HR sees exactly what will go (or what blocks it) first.
--
-- B. rpc_biometric_sync_health(): when did the biometric sync last succeed,
--    and since when is the SmartOffice server failing. The app shows this
--    instead of the raw error of the last one-minute run.
--
-- C. Joining date: profiles has two columns (date_of_joining from the HR form,
--    joining_date used by reports). They are kept equal from now on. Existing
--    rows are NOT changed here.
--    WITHDRAWN by 20261023110000: the columns mean different things.
-- =============================================================================
BEGIN;

-- ─── A. Employee erase ──────────────────────────────────────────────────────

-- Every column that points at an employee: foreign keys to profiles/auth.users,
-- plus un-keyed uuid columns with an owner name (user_id, profile_id, ...).
-- is_owner: the row belongs to the employee (deleted); otherwise the employee
-- is only mentioned (approver, creator, ...) and the reference is cleared.
CREATE OR REPLACE FUNCTION public.hrms_employee_link_columns()
RETURNS TABLE (tbl regclass, col text, via_fk boolean, nullable boolean, is_owner boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH owner_names(n) AS (
    SELECT unnest(ARRAY['user_id', 'profile_id', 'employee_id', 'employee_user_id', 'target_user_id',
                        'member_id', 'recipient_id', 'recipient_user_id', 'assigned_to', 'owner_id'])
  ), targets AS (
    SELECT oid FROM pg_class WHERE oid IN (to_regclass('public.profiles'), to_regclass('auth.users'))
  )
  SELECT c.conrelid::regclass, a.attname::text, true, NOT a.attnotnull,
         a.attname IN (SELECT n FROM owner_names) OR (c.conrelid = to_regclass('public.profiles') AND a.attname = 'id')
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE c.contype = 'f' AND cardinality(c.conkey) = 1
    AND c.confrelid IN (SELECT oid FROM targets)
    AND NOT t.relispartition
  UNION
  SELECT a.attrelid::regclass, a.attname::text, false, NOT a.attnotnull, true
  FROM pg_attribute a
  JOIN pg_class t ON t.oid = a.attrelid
  JOIN pg_namespace ns ON ns.oid = t.relnamespace
  WHERE ns.nspname = 'public' AND t.relkind IN ('r', 'p') AND NOT t.relispartition
    AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
    AND a.attname IN (SELECT n FROM owner_names)
    AND t.oid <> 'public.profiles'::regclass
    AND NOT EXISTS (SELECT 1 FROM pg_constraint fk
                    WHERE fk.contype = 'f' AND fk.conrelid = t.oid AND a.attnum = ANY (fk.conkey));
$$;
REVOKE ALL ON FUNCTION public.hrms_employee_link_columns() FROM public, anon, authenticated;

-- {a: 1} + {a: 2, b: 1} = {a: 3, b: 1}; zero counts are left out.
CREATE OR REPLACE FUNCTION public.hrms_add_counts(p_a jsonb, p_b jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_object_agg(k, total), '{}'::jsonb)
  FROM (SELECT k, sum(v::bigint) AS total
        FROM (SELECT * FROM jsonb_each_text(coalesce(p_a, '{}'::jsonb))
              UNION ALL SELECT * FROM jsonb_each_text(coalesce(p_b, '{}'::jsonb))) e(k, v)
        GROUP BY k) s
  WHERE total > 0;
$$;

-- Delete the rows of p_table matching p_where, first deleting the rows of
-- other tables that would block it (RESTRICT / NO ACTION foreign keys).
-- Returns {table: rows deleted} for p_table and everything below it.
CREATE OR REPLACE FUNCTION public.hrms_erase_rows(p_table regclass, p_where text, p_depth integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_any boolean;
  v_child text;
  v_parent text;
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
BEGIN
  IF p_depth > 8 THEN
    RAISE EXCEPTION 'ERASE_BLOCKED: records linked too deeply below %', p_table;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %s)', p_table, p_where) INTO v_any;
  IF NOT v_any THEN
    RETURN v_counts;
  END IF;

  FOR r IN
    SELECT c.conrelid::regclass AS child, c.conkey, c.confkey
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.confrelid = p_table AND c.confdeltype IN ('a', 'r')
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord) INTO v_child
    FROM unnest(r.conkey) WITH ORDINALITY k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = r.child AND a.attnum = k.attnum;
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord) INTO v_parent
    FROM unnest(r.confkey) WITH ORDINALITY k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = p_table AND a.attnum = k.attnum;
    v_counts := public.hrms_add_counts(v_counts, public.hrms_erase_rows(
      r.child,
      format('(%s) IN (SELECT %s FROM %s WHERE %s)', v_child, v_parent, p_table, p_where)
        -- a row pointing at itself is deleted with its own set
        || CASE WHEN r.child = p_table THEN format(' AND NOT coalesce((%s), false)', p_where) ELSE '' END,
      p_depth + 1));
  END LOOP;

  EXECUTE format('DELETE FROM %s WHERE %s', p_table, p_where);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN public.hrms_add_counts(v_counts, jsonb_build_object(p_table::text, v_n));
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_erase_rows(regclass, text, integer) FROM public, anon, authenticated;

-- Tables whose rows are normally permanent (history guards). Only this erase,
-- inside its own transaction, switches the guards off; other sessions wait for
-- the transaction and never see them off.
CREATE OR REPLACE FUNCTION public.hrms_erase_guard_triggers(p_enable boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tg.tgrelid::regclass AS tbl, tg.tgname
    FROM pg_trigger tg
    JOIN (VALUES
      ('public.attendance_corrections', 'hrms_attendance_corrections_guard_trg'),
      ('public.attendance_correction_events', 'hrms_attendance_correction_events_guard_trg'),
      ('public.attendance_event_ledger', 'trg_prevent_attendance_ledger_mutation'),
      ('public.field_visit_location_audit', 'prevent_location_audit_mutation_trigger')
    ) g(tbl, name) ON tg.tgrelid = to_regclass(g.tbl) AND tg.tgname = g.name
    WHERE NOT tg.tgisinternal
  LOOP
    EXECUTE format('ALTER TABLE %s %s TRIGGER %I', r.tbl, CASE WHEN p_enable THEN 'ENABLE' ELSE 'DISABLE' END, r.tgname);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_erase_guard_triggers(boolean) FROM public, anon, authenticated;

-- Who may erase whom. Raises with a readable code.
CREATE OR REPLACE FUNCTION public.hrms_erase_employee_check(p_profile_id uuid)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_target public.profiles;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;
  IF p_profile_id IS NULL OR p_profile_id = v_actor THEN
    RAISE EXCEPTION 'CANNOT_DELETE_CURRENT_USER';
  END IF;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
  END IF;
  IF NOT (public.is_profile_admin() OR public.can_access_user_data(p_profile_id, 'employees.manage')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: deleting employees needs Add / edit employees for this person';
  END IF;
  IF to_regclass('public.protected_system_admin_profiles') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.protected_system_admin_profiles WHERE profile_id = p_profile_id) THEN
      RAISE EXCEPTION 'PROTECTED_SYSTEM_ADMIN_CANNOT_BE_DELETED';
    END IF;
  END IF;
  SELECT public.normalize_profile_role(role) INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF public.normalize_profile_role(v_target.role) = ANY (public.hrms_admin_roles())
     AND v_actor_role IS DISTINCT FROM 'SYSTEM_ADMIN' THEN
    RAISE EXCEPTION 'SYSTEM_ADMIN_PERMISSION_REQUIRED: only a system admin can delete an admin';
  END IF;
  RETURN v_target;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_erase_employee_check(uuid) FROM public, anon, authenticated;

-- The erase itself. Returns {"deleted": {table: rows}, "cleared": {table.column: rows}}.
CREATE OR REPLACE FUNCTION public.hrms_erase_employee_impl(p_profile_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_n bigint;
  v_pass integer;
  v_deleted jsonb := '{}'::jsonb;
  v_cleared jsonb := '{}'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erase:' || p_profile_id::text, 0));
  -- Server-side writers that guard field visits / corrections check these.
  PERFORM set_config('app.current_location_server', 'on', true);
  PERFORM set_config('hrms.attendance_correction_workflow', 'on', true);
  -- No attendance events or leave ledger entries for rows being erased.
  PERFORM set_config('app.suppress_attendance_outbox', 'true', true);
  PERFORM set_config('app.leave_ledger_write', 'true', true);
  PERFORM public.hrms_erase_guard_triggers(false);

  -- 1. The employee's own rows (and rows depending on them). Done again
  --    after step 2: a delete trigger may write a row for the employee.
  FOR v_pass IN 1..2 LOOP
    IF v_pass = 2 THEN
      -- Their team no longer reports to them (also when reports_to has no key).
      UPDATE public.profiles SET reports_to = NULL WHERE reports_to = p_profile_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_cleared := public.hrms_add_counts(v_cleared, jsonb_build_object('public.profiles.reports_to', v_n));
      -- 2. Other people's rows only mention the employee: clear the mention
      --    (or hand it to the person erasing when the column cannot be empty).
      FOR r IN SELECT * FROM public.hrms_employee_link_columns() WHERE NOT is_owner ORDER BY tbl::text, col LOOP
        BEGIN
          IF r.nullable THEN
            EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = $1', r.tbl, r.col, r.col) USING p_profile_id;
          ELSE
            EXECUTE format('UPDATE %s SET %I = $2 WHERE %I = $1', r.tbl, r.col, r.col) USING p_profile_id, p_actor;
          END IF;
          GET DIAGNOSTICS v_n = ROW_COUNT;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'ERASE_BLOCKED: %.% could not be cleared: %', r.tbl, r.col, SQLERRM;
        END;
        v_cleared := public.hrms_add_counts(v_cleared, jsonb_build_object(r.tbl::text || '.' || r.col, v_n));
      END LOOP;
    END IF;
    FOR r IN SELECT * FROM public.hrms_employee_link_columns()
             WHERE is_owner AND tbl NOT IN (to_regclass('public.profiles'), to_regclass('auth.users'))
             ORDER BY tbl::text, col LOOP
      BEGIN
        v_deleted := public.hrms_add_counts(v_deleted,
          public.hrms_erase_rows(r.tbl, format('%I = %L::uuid', r.col, p_profile_id)));
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'ERASE_BLOCKED: % (%): %', r.tbl, r.col, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  -- 3. The profile, then the login (sessions and identities go with it).
  BEGIN
    v_deleted := public.hrms_add_counts(v_deleted,
      public.hrms_erase_rows('public.profiles'::regclass, format('id = %L::uuid', p_profile_id)));
    IF to_regclass('auth.users') IS NOT NULL THEN
      v_deleted := public.hrms_add_counts(v_deleted,
        public.hrms_erase_rows(to_regclass('auth.users'), format('id = %L::uuid', p_profile_id)));
    END IF;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'ERASE_BLOCKED: profile/login: %', SQLERRM;
  END;

  PERFORM public.hrms_erase_guard_triggers(true);
  RETURN jsonb_build_object('deleted', v_deleted, 'cleared', v_cleared);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_erase_employee_impl(uuid, uuid) FROM public, anon, authenticated;

-- Runs the real erase and rolls it back: exact counts, or what blocks it.
CREATE OR REPLACE FUNCTION public.rpc_admin_erase_employee_preview(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target public.profiles;
  v_result jsonb;
BEGIN
  v_target := public.hrms_erase_employee_check(p_profile_id);
  BEGIN
    v_result := public.hrms_erase_employee_impl(p_profile_id, auth.uid());
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'HRMS_ERASE_PREVIEW_ROLLBACK';
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN
      NULL; -- rolled back on purpose; v_result keeps the counts
    WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'profile_id', p_profile_id, 'name', v_target.name,
                                'blocked', SQLERRM);
  END;
  RETURN jsonb_build_object('ok', true, 'profile_id', p_profile_id, 'name', v_target.name,
                            'deleted', v_result->'deleted', 'cleared', v_result->'cleared');
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_erase_employee_preview(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_erase_employee_preview(uuid) TO authenticated;

-- The erase. p_confirm_name must be the employee's name (typed by HR).
CREATE OR REPLACE FUNCTION public.rpc_admin_erase_employee(p_profile_id uuid, p_confirm_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target public.profiles;
  v_result jsonb;
BEGIN
  v_target := public.hrms_erase_employee_check(p_profile_id);
  IF lower(regexp_replace(btrim(coalesce(p_confirm_name, '')), '\s+', ' ', 'g'))
     IS DISTINCT FROM lower(regexp_replace(btrim(coalesce(v_target.name, '')), '\s+', ' ', 'g')) THEN
    RAISE EXCEPTION 'CONFIRM_NAME_MISMATCH: type the employee''s name exactly to delete';
  END IF;

  v_result := public.hrms_erase_employee_impl(p_profile_id, auth.uid());

  -- The one record that stays: who erased whom, and how much.
  INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id,
                                        old_values, new_values, source)
  VALUES (auth.uid(), NULL, 'EMPLOYEE_ERASED', 'profile', p_profile_id,
          jsonb_build_object('name', v_target.name, 'employee_number', v_target.employee_number,
                             'role', v_target.role, 'office_id', v_target.office_id),
          v_result, 'rpc_admin_erase_employee');

  RETURN jsonb_build_object('success', true, 'profile_id', p_profile_id, 'name', v_target.name)
         || v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_erase_employee(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_erase_employee(uuid, text) TO authenticated;

-- The 2026-09-02 version is replaced by the erase above.
DO $$
BEGIN
  IF to_regprocedure('public.rpc_admin_delete_profile(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.rpc_admin_delete_profile(uuid) FROM public, anon, authenticated;
  END IF;
END $$;

-- ─── B. Biometric sync health ───────────────────────────────────────────────

ALTER TABLE public.biometric_sync_state
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS failing_since timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure text;

-- The Edge Function writes last_status / last_error; keep the history here.
CREATE OR REPLACE FUNCTION public.hrms_biometric_sync_state_track()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.last_completed_at IS DISTINCT FROM OLD.last_completed_at THEN
    IF NEW.last_status = 'SUCCESS' THEN
      NEW.last_success_at := NEW.last_completed_at;
      NEW.failing_since := NULL;
      NEW.consecutive_failures := 0;
    ELSIF NEW.last_status = 'FAILED' THEN
      NEW.failing_since := coalesce(OLD.failing_since, NEW.last_completed_at);
      NEW.consecutive_failures := OLD.consecutive_failures + 1;
      NEW.last_failure := NEW.last_error;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hrms_biometric_sync_state_track_trg ON public.biometric_sync_state;
CREATE TRIGGER hrms_biometric_sync_state_track_trg
  BEFORE UPDATE ON public.biometric_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.hrms_biometric_sync_state_track();

UPDATE public.biometric_sync_state s
SET last_success_at = coalesce(s.last_success_at,
      (SELECT max(r.updated_at) FROM public.biometric_sync_requests r WHERE r.status = 'COMMITTED'))
WHERE s.last_success_at IS NULL;

CREATE OR REPLACE FUNCTION public.rpc_biometric_sync_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.biometric_sync_state;
BEGIN
  IF NOT (public.is_profile_admin() OR public.hrms_has_permission('attendance.view')
          OR public.hrms_has_permission('biometric.manage')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  SELECT * INTO s FROM public.biometric_sync_state WHERE singleton;
  RETURN jsonb_build_object(
    'now', now(),
    'last_success_at', s.last_success_at,
    'last_attempt_at', s.last_started_at,
    'last_status', s.last_status,
    'failing_since', s.failing_since,
    'consecutive_failures', coalesce(s.consecutive_failures, 0),
    'last_failure', s.last_failure);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_biometric_sync_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_biometric_sync_health() TO authenticated;

-- ─── C. One joining date ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hrms_profiles_sync_joining_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.joining_date := coalesce(NEW.joining_date, NEW.date_of_joining);
    NEW.date_of_joining := coalesce(NEW.date_of_joining, NEW.joining_date);
  ELSIF NEW.date_of_joining IS DISTINCT FROM OLD.date_of_joining THEN
    NEW.joining_date := NEW.date_of_joining;          -- edited on the HR form
  ELSIF NEW.joining_date IS DISTINCT FROM OLD.joining_date THEN
    NEW.date_of_joining := NEW.joining_date;          -- set by an import/report tool
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'date_of_joining')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'joining_date') THEN
    DROP TRIGGER IF EXISTS hrms_profiles_sync_joining_date_trg ON public.profiles;
    CREATE TRIGGER hrms_profiles_sync_joining_date_trg
      BEFORE INSERT OR UPDATE OF date_of_joining, joining_date ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.hrms_profiles_sync_joining_date();
  ELSE
    RAISE NOTICE 'profiles has only one joining date column: nothing to keep in step';
  END IF;
END $$;

COMMIT;
