-- ─── Phase 3: Attendance Regularization Integrity ───
-- Fixes ATT-07: Restore the authorized_attendance_correction context flag and block self-approvals of regularizations.

CREATE OR REPLACE FUNCTION public.rpc_review_attendance_regularization(
  p_request_id uuid,
  p_admin_id   uuid,
  p_approve    boolean,
  p_notes      text default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_actor_role text;
  v_request    record;
  v_att        record;
  v_new_status text := CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END;
BEGIN
  SELECT upper(coalesce(role, '')) INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor AND coalesce(is_active, true);

  IF v_actor_role NOT IN ('ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN', 'HR', 'HRD', 'HR_MANAGER') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'FORBIDDEN',
      'message', 'Only HR/admin can review regularization.'
    );
  END IF;

  IF NOT p_approve AND (p_notes IS NULL OR length(trim(p_notes)) < 3) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'REJECTION_REASON_REQUIRED',
      'message', 'Enter a rejection reason.'
    );
  END IF;

  SELECT * INTO v_request
  FROM public.attendance_regularization_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Request not found.');
  END IF;

  -- Block self-approvals
  IF v_request.user_id = v_actor THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'SELF_APPROVAL_FORBIDDEN',
      'message', 'You cannot review your own regularization request.'
    );
  END IF;

  IF v_request.status <> 'PENDING' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'ALREADY_REVIEWED',
      'message', 'This request has already been reviewed.'
    );
  END IF;

  SELECT * INTO v_att
  FROM public.attendance_logs
  WHERE id = v_request.attendance_id AND user_id = v_request.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'ATTENDANCE_NOT_FOUND',
      'message', 'Linked attendance record no longer exists.'
    );
  END IF;

  IF p_approve THEN
    -- Restore authorized_attendance_correction flag to bypass the checkout audit trigger
    PERFORM set_config('app.authorized_attendance_correction', 'REGULARIZATION', true);

    UPDATE public.attendance_logs
    SET
      checkout_time     = v_request.requested_checkout,
      status            = 'ADMIN_CORRECTED',
      checkout_source   = 'ADMIN',
      corrected_by      = v_actor,
      correction_reason = v_request.reason,
      undo_token        = null,
      undo_expires_at   = null,
      updated_at        = now()
    WHERE id = v_request.attendance_id;

    INSERT INTO public.attendance_audit_logs (
      attendance_id, user_id, action,
      old_status, new_status,
      old_checkout_at, new_checkout_at,
      reason, source
    ) VALUES (
      v_att.id, v_request.user_id, 'REGULARIZATION_APPROVED',
      v_att.status, 'ADMIN_CORRECTED',
      v_att.checkout_time, v_request.requested_checkout,
      v_request.reason, 'ADMIN'
    );
  END IF;

  UPDATE public.attendance_regularization_requests
  SET
    status = v_new_status,
    reviewed_by = v_actor,
    reviewed_at = now(),
    review_notes = p_notes
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
