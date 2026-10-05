-- ==============================================================================
-- Migration: 20261005010000_phase1_permissions.sql
-- Description: Consolidate permission architecture and enforce scopes
-- ==============================================================================

-- 1. Drop unused overlapping RBAC tables (if they exist)
DROP TABLE IF EXISTS public.role_permissions CASCADE;
DROP TABLE IF EXISTS public.roles CASCADE;
DROP TABLE IF EXISTS public.user_permission_overrides CASCADE;

-- 2. Define the core backend enforcement function for multidimensional scopes
-- This replaces the broken/orphaned 8-parameter version with the correct 4-parameter 
-- polymorphic scope model introduced in 20260929000001
CREATE OR REPLACE FUNCTION public.can_access_user_data(
  p_target_user_id uuid,
  p_permission text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_rule record;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  -- Admin override (Super users)
  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;
  IF public.normalize_profile_role(v_caller.role) IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN') THEN 
    RETURN true; 
  END IF;

  -- Self access always allowed
  IF p_target_user_id = v_uid THEN RETURN true; END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_user_id;
  IF v_target.id IS NULL THEN RETURN false; END IF;

  -- Evaluate caller's permissions against the target
  FOR v_rule IN
    SELECT scope, scope_id FROM public.user_permissions
    WHERE user_id = v_uid AND permission = p_permission AND revoked_at IS NULL
  LOOP
    IF v_rule.scope = 'GLOBAL' THEN
      RETURN true;
    ELSIF v_rule.scope = 'SELF' AND p_target_user_id = v_uid THEN
      RETURN true;
    ELSIF v_rule.scope = 'OFFICE' THEN
      IF v_target.office_id::text = v_rule.scope_id THEN RETURN true; END IF;
    ELSIF v_rule.scope = 'DEPARTMENT' THEN
      IF v_target.department = v_rule.scope_id THEN RETURN true; END IF;
    ELSIF v_rule.scope = 'TEAM' THEN
      -- If scope_id is UUID, it's a team lead profile ID
      IF v_rule.scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
         IF v_target.reports_to::text = v_rule.scope_id THEN RETURN true; END IF;
      ELSE
         -- Otherwise it's a team name string
         IF v_target.team = v_rule.scope_id THEN RETURN true; END IF;
      END IF;
    END IF;
  END LOOP;
  
  RETURN false;
END;
$$;

-- Secure the function
REVOKE ALL ON FUNCTION public.can_access_user_data(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_access_user_data(uuid, text) TO authenticated;


-- 3. Wire can_access_user_data into list-based RPCs for true backend enforcement

-- Enforce on Regularization RPC
CREATE OR REPLACE FUNCTION public.rpc_admin_list_attendance_regularization(
  p_status  text    default 'PENDING',
  p_offset  integer default 0,
  p_limit   integer default 200,
  p_office_id uuid default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_role text;
  v_records    jsonb;
  v_total      integer;
BEGIN
  SELECT count(*) INTO v_total
  FROM public.attendance_regularization_requests r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.status = upper(p_status)
    AND (p_office_id IS NULL OR p.office_id = p_office_id)
    AND public.can_access_user_data(p.id, 'Attendance.View');

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
      AND public.can_access_user_data(p.id, 'Attendance.View')
    ORDER BY r.created_at DESC
    OFFSET p_offset LIMIT p_limit
  ) page;

  RETURN jsonb_build_object(
    'success', true,
    'records', v_records,
    'total', v_total,
    'has_more', p_offset + jsonb_array_length(v_records) < v_total
  );
END;
$$;


-- Enforce on Daily Aggregation RPC
CREATE OR REPLACE FUNCTION public.rpc_admin_attendance_daily_v3(
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', att.date,
      'day_label', to_char(att.date, 'Dy, MMM DD'),
      'present_count', att.present_count,
      'present_missing_out_count', att.present_missing_out_count,
      'absent_count', att.absent_count,
      'leave_count', att.leave_count,
      'weekly_off_count', att.weekly_off_count,
      'holiday_count', att.holiday_count,
      'late_count', att.late_count,
      'attendance_rate', att.attendance_rate
    )
    ORDER BY att.date
  )
  INTO v_result
  FROM (
    SELECT
      al.date,
      COUNT(*) FILTER (WHERE al.status = 'PRESENT') as present_count,
      COUNT(*) FILTER (WHERE al.status = 'PRESENT_MISSING_OUT') as present_missing_out_count,
      COUNT(*) FILTER (WHERE al.status = 'ABSENT') as absent_count,
      COUNT(*) FILTER (WHERE al.status = 'APPROVED_LEAVE') as leave_count,
      COUNT(*) FILTER (WHERE al.status = 'WEEKLY_OFF') as weekly_off_count,
      COUNT(*) FILTER (WHERE al.status = 'HOLIDAY') as holiday_count,
      COUNT(*) FILTER (WHERE al.is_late = true) as late_count,
      CASE
        WHEN COUNT(*) FILTER (WHERE al.status NOT IN ('HOLIDAY', 'WEEKLY_OFF', 'NO_SOURCE_DATA')) > 0
        THEN ROUND(
          (COUNT(*) FILTER (WHERE al.status IN ('PRESENT', 'PRESENT_MISSING_OUT'))::numeric /
           COUNT(*) FILTER (WHERE al.status NOT IN ('HOLIDAY', 'WEEKLY_OFF', 'NO_SOURCE_DATA'))) * 100,
          2
        )
        ELSE 100
      END as attendance_rate
    FROM public.attendance_logs al
    WHERE al.date >= p_start_date
      AND al.date <= p_end_date
      AND public.can_access_user_data(al.user_id, 'Attendance.View')
    GROUP BY al.date
  ) att;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


NOTIFY pgrst, 'reload schema';

-- Enforce on Enterprise Report RPC
CREATE OR REPLACE FUNCTION public.rpc_admin_attendance_report_v4(
  p_start date, p_end date,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 500,
  p_office_names text[] DEFAULT NULL, p_team_names text[] DEFAULT NULL,
  p_head_names text[] DEFAULT NULL, p_roles text[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL, p_sources text[] DEFAULT NULL,
  p_search text DEFAULT NULL, p_exceptions_only boolean DEFAULT false
)
RETURNS SETOF public.v_attendance_daily_enterprise
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $BODY$
BEGIN
  PERFORM public.require_profile_admin();

  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start
     OR p_end > (now() AT TIME ZONE 'Asia/Kolkata')::date
     OR p_end - p_start > 366
     OR p_offset < 0 OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'INVALID_ATTENDANCE_REPORT_RANGE';
  END IF;

  RETURN QUERY
  SELECT report.* FROM public.v_attendance_daily_enterprise report
  WHERE report.work_date BETWEEN p_start AND p_end
    AND (COALESCE(CARDINALITY(p_office_names),0)=0 OR regexp_replace(lower(btrim(report.office_name)),'\s+office$','') = ANY(SELECT regexp_replace(lower(btrim(value)),'\s+office$','') FROM unnest(p_office_names) value))
    AND (COALESCE(CARDINALITY(p_team_names),0)=0 OR regexp_replace(lower(btrim(report.team_name)),'\s+team$','') = ANY(SELECT regexp_replace(lower(btrim(value)),'\s+team$','') FROM unnest(p_team_names) value))
    AND (COALESCE(CARDINALITY(p_head_names),0)=0 OR lower(btrim(report.team_head_name)) = ANY(SELECT lower(btrim(value)) FROM unnest(p_head_names) value))
    AND (COALESCE(CARDINALITY(p_roles),0)=0 OR lower(btrim(report.role)) = ANY(SELECT lower(btrim(value)) FROM unnest(p_roles) value))
    AND (COALESCE(CARDINALITY(p_statuses),0)=0 OR report.attendance_status = ANY(p_statuses))
    AND (COALESCE(CARDINALITY(p_sources),0)=0 OR COALESCE(report.first_in_source, 'UNKNOWN') = ANY(p_sources))
    AND (p_search IS NULL OR p_search = '' 
         OR report.employee_name ILIKE '%' || p_search || '%' 
         OR report.employee_number ILIKE '%' || p_search || '%')
    AND (NOT p_exceptions_only OR report.attendance_status IN ('ABSENT', 'LATE', 'HALF_DAY', 'CONFIG_REQUIRED'))
    AND public.can_access_user_data(report.user_id, 'Attendance.Export')
  ORDER BY report.work_date DESC, report.employee_name ASC
  OFFSET p_offset LIMIT p_limit;
END;
$BODY$;

NOTIFY pgrst, 'reload schema';
