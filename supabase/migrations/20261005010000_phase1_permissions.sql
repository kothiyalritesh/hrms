-- ==============================================================================
-- Migration: 20261005010000_phase1_permissions.sql
-- Description: Unifies the `can_access_user_data` RPC to match the 4-column
-- secure permissions architecture (user_id, permission, scope, scope_id)
-- introduced in 20260929000001_secure_permissions_architecture.sql.
-- Drops legacy columns and enforces polymorphic scoping across the application.
-- ==============================================================================

-- 1. Drop old multidimensional columns from user_permissions
-- We ensure the legacy columns are dropped so there is no ambiguity.
DO $$
BEGIN
  ALTER TABLE public.user_permissions
    DROP COLUMN IF EXISTS office_id CASCADE,
    DROP COLUMN IF EXISTS department CASCADE,
    DROP COLUMN IF EXISTS team_lead_id CASCADE,
    DROP COLUMN IF EXISTS team_name CASCADE;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore if already dropped or if it throws a minor warning
END $$;

-- 2. Replace can_access_user_data with the correct polymorphic scope model
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
  v_uid uuid := auth.uid();
  v_caller public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_rule record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Admin override: Full access across entire organization
  SELECT * INTO v_caller FROM public.profiles WHERE id = v_uid;
  IF v_caller.role IN ('SYSTEM_ADMIN', 'ADMIN', 'SUPER_ADMIN') THEN
    RETURN true;
  END IF;

  -- Self access: Users can always view their own records
  IF p_target_user_id = v_uid THEN
    RETURN true;
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_user_id;
  IF v_target.id IS NULL THEN
    RETURN false;
  END IF;

  -- Evaluate caller's active permission rules for this specific permission
  FOR v_rule IN
    SELECT scope, scope_id
    FROM public.user_permissions
    WHERE user_id = v_uid
      AND permission = p_permission
      AND revoked_at IS NULL
  LOOP
    -- Rule A: GLOBAL scope grants universal access
    IF v_rule.scope = 'GLOBAL' THEN
      RETURN true;
    END IF;

    -- Rule B: SELF scope only matches caller
    IF v_rule.scope = 'SELF' AND p_target_user_id = v_uid THEN
      RETURN true;
    END IF;

    -- Rule C: OFFICE (Branch) scope
    IF v_rule.scope = 'OFFICE' THEN
      IF v_rule.scope_id IS NOT NULL THEN
        IF v_target.office_id::text = v_rule.scope_id THEN
          RETURN true;
        END IF;
      ELSE
        -- Fallback: caller's own office
        IF v_target.office_id = v_caller.office_id THEN
          RETURN true;
        END IF;
      END IF;
    END IF;

    -- Rule D: DEPARTMENT scope
    IF v_rule.scope = 'DEPARTMENT' THEN
      IF v_rule.scope_id IS NOT NULL THEN
        IF lower(trim(coalesce(v_target.department, ''))) = lower(trim(v_rule.scope_id)) THEN
          RETURN true;
        END IF;
      ELSE
        -- Fallback: caller's own department
        IF lower(trim(coalesce(v_target.department, ''))) = lower(trim(coalesce(v_caller.department, ''))) THEN
          RETURN true;
        END IF;
      END IF;
    END IF;

    -- Rule E: TEAM scope
    IF v_rule.scope = 'TEAM' THEN
      IF v_rule.scope_id IS NOT NULL THEN
        -- Matches if target is the team lead themselves OR reports directly/indirectly to the team lead
        IF v_target.id::text = v_rule.scope_id THEN
          RETURN true;
        END IF;
        
        IF EXISTS (
          WITH RECURSIVE sub_team AS (
            SELECT id FROM public.profiles WHERE reports_to = v_rule.scope_id::uuid
            UNION
            SELECT p.id FROM public.profiles p JOIN sub_team st ON p.reports_to = st.id
          )
          SELECT 1 FROM sub_team WHERE id = v_target.id
        ) THEN
          RETURN true;
        END IF;
      ELSE
        -- Fallback: caller's own direct reportees or same team
        IF v_target.reports_to = v_uid OR lower(trim(coalesce(v_target.team, ''))) = lower(trim(coalesce(v_caller.team, ''))) THEN
          RETURN true;
        END IF;
      END IF;
    END IF;

  END LOOP;

  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.can_access_user_data(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_access_user_data(uuid, text) TO authenticated;

-- 3. Hard-wire can_access_user_data into rpc_admin_list_attendance_regularization
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
    AND public.can_access_user_data(r.user_id, 'manage_attendance');

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
      AND public.can_access_user_data(r.user_id, 'manage_attendance')
    ORDER BY r.created_at DESC
    OFFSET p_offset LIMIT p_limit
  ) page;

  RETURN jsonb_build_object(
    'success', true,
    'records', v_records,
    'total', v_total,
    'has_more', p_offset + coalesce(jsonb_array_length(v_records), 0) < v_total
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
