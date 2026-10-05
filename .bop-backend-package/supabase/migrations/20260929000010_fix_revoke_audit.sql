CREATE OR REPLACE FUNCTION public.admin_revoke_permission(
  p_user_id uuid,
  p_permission text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND is_active = true;
  IF public.normalize_profile_role(v_actor_role) NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD', 'HR') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_REVOKE';
  END IF;

  UPDATE public.user_permissions
  SET revoked_at = now()
  WHERE user_id = p_user_id
    AND permission = p_permission
    AND revoked_at IS NULL;

  INSERT INTO public.permission_audit_logs (
    target_user_id, actor_id, action, permission
  ) VALUES (
    p_user_id, v_actor_id, 'REVOKE', p_permission
  );

  RETURN jsonb_build_object('success', true);
END;
$$;
NOTIFY pgrst, 'reload schema';
