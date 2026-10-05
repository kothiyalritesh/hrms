CREATE OR REPLACE FUNCTION public.rpc_admin_import_employee_profiles_v2(
  p_batch_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_role text := public.require_profile_admin();
  v_payload_hash text := md5(p_rows::text);
  v_existing public.employee_import_batches%rowtype;
  v_row jsonb;
  v_values jsonb;
  v_profile_id uuid;
  v_role_id uuid;
  v_office_id uuid;
  v_role_name text;
  v_phone text;
  v_save_result jsonb;
  v_result jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_processed integer := 0;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'IMPORT_BATCH_ID_REQUIRED';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) = 0
     OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'INVALID_EMPLOYEE_IMPORT_BATCH';
  END IF;

  INSERT INTO public.employee_import_batches(
    batch_id, actor_id, payload_hash, status
  ) VALUES (
    p_batch_id, v_actor, v_payload_hash, 'PROCESSING'
  )
  ON CONFLICT (batch_id) DO NOTHING;

  SELECT *
  INTO v_existing
  FROM public.employee_import_batches
  WHERE batch_id = p_batch_id
  FOR UPDATE;

  IF v_existing.actor_id <> v_actor THEN
    RAISE EXCEPTION 'IMPORT_BATCH_OWNER_MISMATCH';
  END IF;
  IF v_existing.payload_hash <> v_payload_hash THEN
    RAISE EXCEPTION 'IMPORT_BATCH_PAYLOAD_MISMATCH';
  END IF;
  IF v_existing.status = 'COMPLETED' THEN
    RETURN v_existing.result;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_processed := v_processed + 1;

    IF nullif(btrim(v_row->>'name'), '') IS NULL THEN
      RAISE EXCEPTION 'ROW_%_NAME_REQUIRED', coalesce(v_row->>'row_number', '?');
    END IF;

    v_phone := nullif(regexp_replace(v_row->>'phone', '\D', '', 'g'), '');
    IF v_phone IS NULL OR length(v_phone) <> 10 THEN
      RAISE EXCEPTION 'ROW_%_VALID_PHONE_REQUIRED', coalesce(v_row->>'row_number', '?');
    END IF;

    BEGIN
      v_role_id := (v_row->>'role_id')::uuid;
      v_office_id := (v_row->>'office_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'ROW_%_ROLE_AND_OFFICE_REQUIRED', coalesce(v_row->>'row_number', '?');
    END;

    SELECT name INTO v_role_name FROM public.roles WHERE id = v_role_id;
    IF v_role_name IS NULL THEN
      RAISE EXCEPTION 'ROW_%_INVALID_ROLE', coalesce(v_row->>'row_number', '?');
    END IF;
    IF upper(v_role_name) IN ('SYSTEM_ADMIN', 'SUPER_ADMIN') THEN
      RAISE EXCEPTION 'SYSTEM_ADMIN_BULK_IMPORT_PROHIBITED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.offices WHERE id = v_office_id AND is_active) THEN
      RAISE EXCEPTION 'ROW_%_INVALID_OR_INACTIVE_OFFICE', coalesce(v_row->>'row_number', '?');
    END IF;

    SELECT id INTO v_profile_id
    FROM public.profiles
    WHERE regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone
    LIMIT 1;

    SELECT jsonb_build_object(
      'name', btrim(v_row->>'name'),
      'phone', v_phone,
      'email', nullif(btrim(v_row->>'email'), ''),
      'employee_number', nullif(btrim(v_row->>'employee_number'), ''),
      'role', v_role_name,
      'role_id', v_role_id,
      'office_id', v_office_id,
      'team', nullif(btrim(v_row->>'team'), ''),
      'gender', nullif(btrim(v_row->>'gender'), ''),
      'date_of_birth', CASE WHEN nullif(btrim(v_row->>'date_of_birth'), '') IS NOT NULL THEN (v_row->>'date_of_birth')::date ELSE NULL END,
      'joining_date', CASE WHEN nullif(btrim(v_row->>'joining_date'), '') IS NOT NULL THEN (v_row->>'joining_date')::date ELSE NULL END,
      'is_active', true
    ) INTO v_values;

    IF v_profile_id IS NOT NULL THEN
      SELECT v_values || jsonb_build_object(
        'updated_at', now()
      ) INTO v_values;
    ELSE
      SELECT v_values || jsonb_build_object(
        'created_at', now()
      ) INTO v_values;
    END IF;

    SELECT public.rpc_admin_save_employee(v_profile_id, v_values) INTO v_save_result;
    
    IF v_save_result->>'success' <> 'true' THEN
      RAISE EXCEPTION 'ROW_%_SAVE_FAILED: %', 
        coalesce(v_row->>'row_number', '?'), 
        v_save_result->>'message';
    END IF;

    IF v_profile_id IS NULL THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'inserted', v_inserted,
    'updated', v_updated
  );

  UPDATE public.employee_import_batches
  SET status = 'COMPLETED', result = v_result, updated_at = now()
  WHERE batch_id = p_batch_id;

  RETURN v_result;
END;
$$;
NOTIFY pgrst, 'reload schema';
