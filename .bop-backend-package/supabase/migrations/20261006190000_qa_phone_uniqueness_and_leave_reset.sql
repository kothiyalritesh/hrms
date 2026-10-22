-- =============================================================================
-- 20261006190000_qa_phone_uniqueness_and_leave_reset.sql
--
-- QA defects HRMS-007 and HRMS-010.
--
-- HRMS-007  Same phone number created a second employee/role.
--   Login (otp-auth) treats 9876543210, 919876543210 and +919876543210 as the
--   same person, but rpc_admin_save_profile compared the exact digit string,
--   so "+91 98765 43210" passed the duplicate check and created a second
--   profile. Login then matched two profiles (two roles).
--   * hrms_phone_key(): the last 10 digits, the identity login uses.
--   * A trigger on profiles rejects any insert/update whose phone key already
--     belongs to another profile (every code path: admin form, bulk import,
--     SQL). Existing duplicates are NOT changed; only new conflicts are blocked.
--   * rpc_admin_save_profile stores Indian numbers as 10 digits and checks by key.
--
-- HRMS-010  Leave Balance "Reset All" always failed: the function read
--   profiles.active (column is is_active) and public.leave_balances (table is
--   leave_balance).
--
-- Idempotent. Run in the Supabase SQL Editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Phone identity
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hrms_phone_key(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '')
$$;

CREATE INDEX IF NOT EXISTS profiles_phone_key_idx
  ON public.profiles (public.hrms_phone_key(phone));

CREATE OR REPLACE FUNCTION public.hrms_profiles_unique_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key   text := public.hrms_phone_key(NEW.phone);
  v_other record;
BEGIN
  IF v_key IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND v_key IS NOT DISTINCT FROM public.hrms_phone_key(OLD.phone) THEN
    RETURN NEW;  -- phone identity unchanged (also keeps legacy duplicates editable)
  END IF;

  -- serialize concurrent saves of the same number
  PERFORM pg_advisory_xact_lock(hashtext('hrms.profiles.phone:' || v_key));

  SELECT p.id, p.name, p.employee_number, p.is_active
    INTO v_other
  FROM public.profiles p
  WHERE public.hrms_phone_key(p.phone) = v_key
    AND p.id <> NEW.id
  ORDER BY p.is_active DESC, p.created_at
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'PHONE_NUMBER_ALREADY_EXISTS'
      USING ERRCODE = '23505',
            DETAIL = coalesce(v_other.name, 'another employee')
                     || coalesce(', ' || v_other.employee_number, '')
                     || CASE WHEN coalesce(v_other.is_active, true) THEN '' ELSE ', inactive' END,
            HINT = 'One phone number can belong to one employee only. Edit the existing profile to change its role.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_unique_phone_trg ON public.profiles;
CREATE TRIGGER profiles_unique_phone_trg
  BEFORE INSERT OR UPDATE OF phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.hrms_profiles_unique_phone();

-- ---------------------------------------------------------------------------
-- rpc_admin_save_profile: same behaviour as 20260923020000, plus phone
-- normalisation and key-based duplicate check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_save_profile(
  p_profile_id uuid,
  p_values jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_role text := public.require_profile_admin();
  v_id uuid := p_profile_id;
  v_target_role text := upper(nullif(btrim(p_values->>'role'), ''));
  v_phone text := nullif(regexp_replace(coalesce(p_values->>'phone', ''), '\D', '', 'g'), '');
  v_existing_phone text;
  v_gender text := coalesce(upper(btrim(p_values->>'gender')), 'MALE');
  v_doj date := nullif(p_values->>'date_of_joining', '')::date;
BEGIN
  IF nullif(btrim(p_values->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'PROFILE_NAME_REQUIRED';
  END IF;

  IF v_target_role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN') AND v_actor_role NOT IN ('SYSTEM_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ROLE_ASSIGNMENT';
  END IF;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'PROFILE_PHONE_REQUIRED';
  END IF;

  -- Indian numbers are stored as the 10-digit mobile number (what login uses)
  IF length(v_phone) = 12 AND left(v_phone, 2) = '91' THEN
    v_phone := right(v_phone, 10);
  ELSIF length(v_phone) = 11 AND left(v_phone, 1) = '0' THEN
    v_phone := right(v_phone, 10);
  END IF;

  IF length(v_phone) < 10 OR length(v_phone) > 15 THEN
    RAISE EXCEPTION 'INVALID_PHONE_NUMBER_FORMAT';
  END IF;

  IF v_gender NOT IN ('MALE', 'FEMALE') THEN
    v_gender := 'MALE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE public.hrms_phone_key(phone) = public.hrms_phone_key(v_phone)
      AND (v_id IS NULL OR id <> v_id)
  ) THEN
    -- Existing duplicates may keep their number; only a NEW clash is rejected.
    IF v_id IS NULL OR public.hrms_phone_key((SELECT phone FROM public.profiles WHERE id = v_id))
                       IS DISTINCT FROM public.hrms_phone_key(v_phone) THEN
      RAISE EXCEPTION 'PHONE_NUMBER_ALREADY_EXISTS' USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.profiles (
      name, email, phone, employee_number, role, role_id,
      office_id, team, is_active, gender, date_of_joining
    ) VALUES (
      btrim(p_values->>'name'),
      nullif(btrim(p_values->>'email'), ''),
      v_phone,
      nullif(btrim(p_values->>'employee_number'), ''),
      nullif(btrim(p_values->>'role'), ''),
      nullif(p_values->>'role_id', '')::uuid,
      nullif(p_values->>'office_id', '')::uuid,
      nullif(btrim(p_values->>'team'), ''),
      coalesce((p_values->>'is_active')::boolean, true),
      v_gender,
      v_doj
    ) RETURNING id INTO v_id;

    PERFORM public.log_audit_event('EMPLOYEE_CREATED', 'profiles', v_id::text, null, p_values);
  ELSE
    SELECT phone INTO v_existing_phone FROM public.profiles WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;

    UPDATE public.profiles
    SET name = btrim(p_values->>'name'),
        email = nullif(btrim(p_values->>'email'), ''),
        phone = v_phone,
        employee_number = nullif(btrim(p_values->>'employee_number'), ''),
        role = nullif(btrim(p_values->>'role'), ''),
        role_id = nullif(p_values->>'role_id', '')::uuid,
        office_id = nullif(p_values->>'office_id', '')::uuid,
        team = nullif(btrim(p_values->>'team'), ''),
        gender = v_gender,
        date_of_joining = coalesce(v_doj, date_of_joining),
        updated_at = now()
    WHERE id = v_id;

    PERFORM public.log_audit_event(
      'EMPLOYEE_UPDATED', 'profiles', v_id::text,
      jsonb_build_object('phone', v_existing_phone), p_values);
  END IF;

  RETURN jsonb_build_object('success', true, 'profile_id', v_id, 'phone', v_phone);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_save_profile(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_save_profile(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Leave Balance "Reset All"
-- ---------------------------------------------------------------------------
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
  v_type    text := upper(btrim(coalesce(p_leave_type, '')));
  v_emp     record;
  v_current numeric;
  v_target  numeric;
  v_delta   numeric;
  v_count   int := 0;
  v_run     text := gen_random_uuid()::text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND coalesce(is_active, true)
      AND upper(role) IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED';
  END IF;
  IF v_type NOT IN ('SICK', 'CASUAL', 'EARNED', 'COMP_OFF') THEN
    RAISE EXCEPTION 'INVALID_LEAVE_TYPE';
  END IF;
  IF p_female_days IS NULL OR p_male_days IS NULL
     OR p_female_days < 0 OR p_male_days < 0
     OR p_female_days > 365 OR p_male_days > 365 THEN
    RAISE EXCEPTION 'INVALID_ADJUSTMENT_QUANTITY';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASON_REQUIRED';
  END IF;

  FOR v_emp IN
    SELECT p.id, upper(coalesce(p.gender, '')) AS gender
    FROM public.profiles p
    WHERE p.is_active
      AND NOT coalesce(p.is_service_account, false)
  LOOP
    IF v_emp.gender = 'FEMALE' THEN
      v_target := p_female_days;
    ELSIF v_emp.gender = 'MALE' THEN
      v_target := p_male_days;
    ELSE
      CONTINUE;
    END IF;

    EXECUTE format('SELECT coalesce(%I, 0) FROM public.leave_balance WHERE user_id = $1', lower(v_type))
      INTO v_current USING v_emp.id;
    v_delta := v_target - coalesce(v_current, 0);

    IF v_delta <> 0 THEN
      PERFORM public.apply_leave_transaction(
        v_emp.id, v_type,
        CASE WHEN v_delta > 0 THEN 'MANUAL_CREDIT' ELSE 'MANUAL_DEBIT' END,
        v_delta,
        (now() AT TIME ZONE 'Asia/Kolkata')::date,
        null, 'HR_MANUAL', null, btrim(p_reason), auth.uid(),
        'reset-all:' || v_run || ':' || v_emp.id);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  BEGIN  -- audit is best effort; every balance change is already in leave_transactions
    INSERT INTO public.hrms_audit_events(actor_user_id, target_user_id, action, entity_type, entity_id, new_values, source)
    VALUES (auth.uid(), null, 'LEAVE_BALANCE_RESET_ALL', 'leave_balance', auth.uid(),
            jsonb_build_object('leave_type', v_type, 'female_days', p_female_days,
                               'male_days', p_male_days, 'reason', btrim(p_reason),
                               'employees_updated', v_count),
            'HRMS_ADMIN');
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'employees_updated', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
