CREATE OR REPLACE FUNCTION public.rpc_admin_reset_all_leave_balances(
  p_leave_type text,
  p_female_days numeric,
  p_male_days numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_emp RECORD;
  v_current_balance numeric;
  v_target numeric;
  v_delta numeric;
  v_tx uuid;
  v_count int := 0;
BEGIN
  -- Verify admin permissions
  SELECT EXISTS(
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
      AND role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED';
  END IF;

  FOR v_emp IN 
    SELECT id, gender FROM public.profiles WHERE active = true
  LOOP
    -- Determine target balance based on gender
    IF upper(v_emp.gender) = 'FEMALE' THEN
      v_target := p_female_days;
    ELSIF upper(v_emp.gender) = 'MALE' THEN
      v_target := p_male_days;
    ELSE
      CONTINUE;
    END IF;

    -- Get current balance for this leave type
    SELECT 
      CASE upper(p_leave_type)
        WHEN 'SICK' THEN sick
        WHEN 'CASUAL' THEN casual
        WHEN 'EARNED' THEN earned
        WHEN 'COMP_OFF' THEN comp_off
        ELSE 0
      END INTO v_current_balance
    FROM public.leave_balances
    WHERE user_id = v_emp.id;

    v_current_balance := COALESCE(v_current_balance, 0);
    v_delta := v_target - v_current_balance;

    IF v_delta <> 0 THEN
      -- Create transaction to adjust balance
      v_tx := public.apply_leave_transaction(
        v_emp.id, 
        upper(p_leave_type), 
        CASE WHEN v_delta > 0 THEN 'MANUAL_CREDIT' ELSE 'MANUAL_DEBIT' END,
        v_delta, 
        (now() at time zone 'Asia/Kolkata')::date, 
        null, 
        'HR_MANUAL', 
        null, 
        btrim(p_reason), 
        auth.uid(), 
        gen_random_uuid()::text
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'employees_updated', v_count);
END;
$$;
