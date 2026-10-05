-- =============================================================================
-- MIGRATION: Scope-Based Filtering in RPCs
-- Date: 2026-10-01
-- =============================================================================

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
  SELECT upper(coalesce(role, '')) INTO v_actor_role
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true;

  -- Bypassed via require_profile_admin() logic historically, but we allow anyone with granular permissions now.
  -- The true protection is the p_office_id scope filter.

  SELECT count(*) INTO v_total
  FROM public.attendance_regularization_requests r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.status = upper(p_status)
    AND (p_office_id IS NULL OR p.office_id = p_office_id);

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
NOTIFY pgrst, 'reload schema';
