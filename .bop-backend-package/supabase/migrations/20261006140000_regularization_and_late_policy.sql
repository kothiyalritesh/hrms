-- =============================================================================
-- 20261006140000_regularization_and_late_policy.sql   (audit ATT-02, ATT-07)
--
-- 1. rpc_review_attendance_regularization (same signature and response shape):
--    • reviewer must be an admin role OR hold regularization.approve /
--      attendance.regularize covering the employee (scope-checked);
--    • nobody can approve or reject their OWN request;
--    • restores set_config('app.authorized_attendance_correction','REGULARIZATION')
--      so same-day approvals pass the protected-checkout trigger at commit;
--    • audit row source 'REGULARIZATION' (as in 20260806010000).
-- 2. Late threshold: one default everywhere = 10:32 (column default and the
--    get_attendance_policy fallback were still 10:30). Existing policy rows are
--    NOT modified; the guide has a query to check them.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rpc_review_attendance_regularization(
  p_request_id uuid,
  p_admin_id   uuid,
  p_approve    boolean,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_request    record;
  v_att        record;
  v_new_status text := CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', 'Sign in again.');
  END IF;

  IF NOT p_approve AND (p_notes IS NULL OR length(trim(p_notes)) < 3) THEN
    RETURN jsonb_build_object('success', false, 'error', 'REJECTION_REASON_REQUIRED',
                              'message', 'Enter a rejection reason.');
  END IF;

  SELECT * INTO v_request
  FROM public.attendance_regularization_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Request not found.');
  END IF;

  IF v_request.user_id = v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_REVIEW_FORBIDDEN',
                              'message', 'You cannot review your own regularization request.');
  END IF;

  IF NOT (
       public.hrms_is_admin_user(v_actor)
       OR public.can_access_user_data(v_request.user_id, 'regularization.approve')
       OR public.can_access_user_data(v_request.user_id, 'attendance.regularize')
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN',
                              'message', 'You are not allowed to review this employee''s requests.');
  END IF;

  IF v_request.status <> 'PENDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_REVIEWED',
                              'message', 'This request has already been reviewed.');
  END IF;

  SELECT * INTO v_att
  FROM public.attendance_logs
  WHERE id = v_request.attendance_id AND user_id = v_request.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ATTENDANCE_NOT_FOUND',
                              'message', 'Linked attendance record no longer exists.');
  END IF;

  IF p_approve THEN
    -- Lets the deferred protected-checkout trigger accept this correction.
    PERFORM set_config('app.authorized_attendance_correction', 'REGULARIZATION', true);

    UPDATE public.attendance_logs
    SET checkout_time     = v_request.requested_checkout,
        status            = 'ADMIN_CORRECTED',
        checkout_source   = 'ADMIN',   -- value the canonical view and triggers expect
        corrected_by      = v_actor,
        correction_reason = v_request.reason,
        undo_token        = NULL,
        undo_expires_at   = NULL,
        updated_at        = now()
    WHERE id = v_request.attendance_id;

    INSERT INTO public.attendance_audit_logs (
      attendance_id, user_id, action, old_status, new_status,
      old_checkout_at, new_checkout_at, reason, source
    ) VALUES (
      v_request.attendance_id, v_request.user_id, 'REGULARIZATION_APPROVED',
      v_att.status, 'ADMIN_CORRECTED', v_att.checkout_time, v_request.requested_checkout,
      v_request.reason || CASE WHEN nullif(trim(coalesce(p_notes, '')), '') IS NOT NULL
                               THEN ' | Reviewer: ' || trim(p_notes) ELSE '' END,
      'REGULARIZATION'
    );
  END IF;

  UPDATE public.attendance_regularization_requests
  SET status       = v_new_status,
      reviewed_by  = v_actor,
      reviewed_at  = now(),
      review_notes = nullif(trim(coalesce(p_notes, '')), '')
  WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'attendance_id', v_request.attendance_id,
    'message', 'Regularization ' || lower(v_new_status) || '.'
  );
END;
$$;
-- Note: the old version wrapped everything in "exception when others", which
-- could not catch the deferred trigger error anyway and hid real failures.

REVOKE ALL ON FUNCTION public.rpc_review_attendance_regularization(uuid, uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_review_attendance_regularization(uuid, uuid, boolean, text) TO authenticated;

-- ─── Late threshold default: 10:32 everywhere ────────────────────────────────

ALTER TABLE public.attendance_policies ALTER COLUMN late_checkin_time SET DEFAULT '10:32';

CREATE OR REPLACE FUNCTION public.get_attendance_policy(p_user_id uuid)
RETURNS TABLE(
  min_work_duration_minutes     integer,
  earliest_checkout_time        text,
  auto_close_time               text,
  allow_night_shift             boolean,
  require_early_checkout_reason boolean,
  undo_checkout_minutes         integer,
  office_id                     uuid,
  office_name                   text,
  late_checkin_time             text,
  checkin_reminder_time         text,
  checkout_reminder_time        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;

  IF p_user_id <> v_actor
     AND NOT public.hrms_is_admin_user(v_actor)
     AND NOT EXISTS (SELECT 1 FROM public.profiles target
                     WHERE target.id = p_user_id AND target.reports_to = v_actor)
     AND NOT public.can_access_user_data(p_user_id, 'attendance.view') THEN
    RAISE EXCEPTION 'POLICY_ACCESS_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    ap.min_work_duration_minutes,
    ap.earliest_checkout_time,
    ap.auto_close_time,
    ap.allow_night_shift,
    ap.require_early_checkout_reason,
    ap.undo_checkout_minutes,
    o.id,
    o.name,
    to_char(ap.late_checkin_time,      'HH24:MI'),
    to_char(ap.checkin_reminder_time,  'HH24:MI'),
    to_char(ap.checkout_reminder_time, 'HH24:MI')
  FROM public.profiles p
  JOIN public.offices o ON o.id = p.office_id AND o.is_active = true
  JOIN public.attendance_policies ap
    ON ap.office_id = p.office_id
   AND coalesce(ap.is_active, true)
   AND lower(coalesce(ap.role, 'all')) IN (lower(coalesce(p.role, '')), 'all')
  WHERE p.id = p_user_id AND p.is_active = true
  ORDER BY CASE WHEN lower(coalesce(ap.role, 'all')) = lower(coalesce(p.role, '')) THEN 0 ELSE 1 END
  LIMIT 1;

  -- Fallback when the office has no policy row: company defaults (late from 10:32).
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT 480, '09:00'::text, '23:59'::text, false, false, 5,
           o.id, o.name, '10:32'::text, '09:00'::text, '18:00'::text
    FROM public.profiles p
    JOIN public.offices o ON o.id = p.office_id AND o.is_active = true
    WHERE p.id = p_user_id AND p.is_active = true
    LIMIT 1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_policy(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_policy(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
