-- =============================================================================
-- 20261006130000_canonical_range_authorization.sql   (audit SEC-05, REP-01)
--
-- rpc_attendance_canonical_range was SECURITY DEFINER with no auth check: any
-- signed-in employee could read everyone's attendance by passing NULL filters.
--
-- Approach (no copy of the 500-line body, so it can't drift from production):
--   1. The existing 5-argument function is renamed to
--      rpc_attendance_canonical_range_core and closed to API callers.
--   2. A thin wrapper with the SAME name and SAME signature checks the caller,
--      restricts rows to authorized_user_ids('attendance.view'), and returns
--      rows in a stable order (work_date DESC, employee_name, user_id) so the
--      client can page with .range() without skipping or repeating rows.
--
-- Callers inside the database (rpc_my_attendance_daily_v3 etc.) resolve the
-- name at run time and go through the wrapper: an employee asking for their
-- own rows takes the fast self path.
--
-- Also removes the 6-argument overload (p_search) created by the abandoned
-- 20261006000000 draft, which made every existing call ambiguous (PGRST203).
-- Idempotent.
-- =============================================================================

DROP FUNCTION IF EXISTS public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid, text);

DO $$
BEGIN
  IF to_regprocedure('public.rpc_attendance_canonical_range_core(date, date, uuid, uuid, uuid)') IS NULL THEN
    IF to_regprocedure('public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid)') IS NULL THEN
      RAISE EXCEPTION 'rpc_attendance_canonical_range(date,date,uuid,uuid,uuid) not found: apply 20261005000000 first';
    END IF;
    ALTER FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid)
      RENAME TO rpc_attendance_canonical_range_core;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.rpc_attendance_canonical_range_core(date, date, uuid, uuid, uuid)
  FROM public, anon, authenticated;

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
  v_uid uuid := auth.uid();
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

  -- Own records: always allowed, cheapest path.
  IF p_user_id = v_uid THEN
    RETURN QUERY
      SELECT c.* FROM public.rpc_attendance_canonical_range_core(p_start_date, p_end_date, p_office_id, p_team_id, p_user_id) c
      ORDER BY c.work_date DESC, c.employee_name ASC, c.user_id ASC;
    RETURN;
  END IF;

  -- Admin role or GLOBAL attendance.view: filters apply as requested.
  IF public.hrms_is_admin_user(v_uid) OR EXISTS (
       SELECT 1 FROM public.user_permissions up
       WHERE up.user_id = v_uid AND up.permission = 'attendance.view'
         AND up.revoked_at IS NULL AND up.scope::text = 'GLOBAL') THEN
    RETURN QUERY
      SELECT c.* FROM public.rpc_attendance_canonical_range_core(p_start_date, p_end_date, p_office_id, p_team_id, p_user_id) c
      ORDER BY c.work_date DESC, c.employee_name ASC, c.user_id ASC;
    RETURN;
  END IF;

  -- No attendance.view grant at all: only their own rows, whatever they asked for.
  IF NOT EXISTS (
       SELECT 1 FROM public.user_permissions up
       WHERE up.user_id = v_uid AND up.permission = 'attendance.view' AND up.revoked_at IS NULL) THEN
    IF p_user_id IS NOT NULL THEN
      RETURN;   -- asked for someone else: nothing
    END IF;
    RETURN QUERY
      SELECT c.* FROM public.rpc_attendance_canonical_range_core(p_start_date, p_end_date, p_office_id, p_team_id, v_uid) c
      ORDER BY c.work_date DESC, c.employee_name ASC, c.user_id ASC;
    RETURN;
  END IF;

  -- Scoped grants: requested filters can only narrow the authorized set.
  RETURN QUERY
    SELECT c.*
    FROM public.rpc_attendance_canonical_range_core(p_start_date, p_end_date, p_office_id, p_team_id, p_user_id) c
    WHERE c.user_id IN (SELECT public.authorized_user_ids('attendance.view'))
    ORDER BY c.work_date DESC, c.employee_name ASC, c.user_id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK (manual):
--   DROP FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid);
--   ALTER FUNCTION public.rpc_attendance_canonical_range_core(date, date, uuid, uuid, uuid)
--     RENAME TO rpc_attendance_canonical_range;
--   GRANT EXECUTE ON FUNCTION public.rpc_attendance_canonical_range(date, date, uuid, uuid, uuid) TO authenticated;
-- =============================================================================
