-- =============================================================================
-- 20261006160000_fix_canonical_wrapper_performance.sql
--
-- HOTFIX for 500 errors on /rpc/rpc_attendance_canonical_range after
-- 20261006150000. The wrapper used "(jsonb_populate_record(...)).*", which
-- PostgreSQL evaluates ONCE PER OUTPUT COLUMN (~50x per row), pushing requests
-- past the statement timeout. Same logic, now evaluated once per row via
-- LATERAL. Same signature and output. Idempotent.
-- =============================================================================

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

  v_unscoped := p_user_id = v_uid
    OR public.hrms_is_admin_user(v_uid)
    OR EXISTS (SELECT 1 FROM public.user_permissions up
               WHERE up.user_id = v_uid AND up.permission = 'attendance.view'
                 AND up.revoked_at IS NULL AND up.scope::text = 'GLOBAL');

  IF NOT v_unscoped AND NOT EXISTS (
       SELECT 1 FROM public.user_permissions up
       WHERE up.user_id = v_uid AND up.permission = 'attendance.view' AND up.revoked_at IS NULL) THEN
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

NOTIFY pgrst, 'reload schema';
