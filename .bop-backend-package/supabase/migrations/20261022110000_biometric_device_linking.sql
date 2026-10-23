-- =============================================================================
-- 2026-10-22 HR Panel -> Biometric Devices: link each machine to its office.
-- A punch only proves "at the office" when its device is linked
-- (biometric_devices); none were, so office return could never apply.
--   rpc_biometric_device_overview(): every device seen in the last 60 days or
--     registered, its linked office, a suggested office (where most of its
--     users belong; a hint only), punch counts, last punch.
--   rpc_link_biometric_device(serial, office, name, active): registers or
--     re-links (same table and backfill as rpc_upsert_biometric_device), then
--     ends today's site visits that a later punch from it now proves ended.
-- Access: admins or biometric.manage. Audited. Needs 20261022100000.
-- Safe to run twice.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hrms_can_manage_biometric()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT public.is_profile_admin() OR public.hrms_has_permission('biometric.manage') $$;
REVOKE ALL ON FUNCTION public.hrms_can_manage_biometric() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_can_manage_biometric() TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_biometric_device_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since date := (now() AT TIME ZONE 'Asia/Kolkata')::date - 60;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT public.hrms_can_manage_biometric() THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(d) ORDER BY d.linked_office_id IS NOT NULL, d.punches_30_days DESC, d.serial)
    FROM (
      WITH seen AS (
        SELECT l.serial_number AS serial,
               count(*) FILTER (WHERE l.log_date_only >= v_since + 30) AS punches_30_days,
               count(*) FILTER (WHERE l.office_id IS NULL) AS punches_without_office,
               max(l.log_date_only) AS last_punch_day
        FROM public.smartoffice_device_logs l
        WHERE l.log_date_only >= v_since AND nullif(btrim(l.serial_number), '') IS NOT NULL
        GROUP BY l.serial_number
      ),
      devices AS (
        SELECT serial FROM seen
        UNION
        SELECT device_identifier FROM public.biometric_devices
      )
      SELECT dv.serial,
             bd.device_name,
             bd.status,
             CASE WHEN bd.status = 'ACTIVE' THEN bd.office_id END AS linked_office_id,
             CASE WHEN bd.status = 'ACTIVE' THEN lo.name END AS linked_office_name,
             sg.office_id AS suggested_office_id,
             sg.office_name AS suggested_office_name,
             coalesce(s.punches_30_days, 0) AS punches_30_days,
             coalesce(s.punches_without_office, 0) AS punches_without_office,
             s.last_punch_day,
             bd.updated_at
      FROM devices dv
      LEFT JOIN seen s ON s.serial = dv.serial
      LEFT JOIN public.biometric_devices bd ON bd.device_identifier = dv.serial
      LEFT JOIN public.offices lo ON lo.id = bd.office_id
      LEFT JOIN LATERAL (
        SELECT o.id AS office_id, o.name AS office_name
        FROM public.smartoffice_device_logs x
        JOIN public.profiles p ON p.id = x.user_id
        JOIN public.offices o ON o.id = p.office_id
        WHERE x.serial_number = dv.serial AND x.log_date_only >= v_since + 30
        GROUP BY o.id, o.name
        ORDER BY count(*) DESC, o.name
        LIMIT 1
      ) sg ON true
    ) d
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_biometric_device_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_biometric_device_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_link_biometric_device(
  p_serial text, p_office_id uuid, p_device_name text DEFAULT NULL, p_active boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_serial text := nullif(btrim(coalesce(p_serial, '')), '');
  v_office public.offices%rowtype;
  v_old public.biometric_devices%rowtype;
  v_filled integer := 0;
  v_closed integer := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT public.hrms_can_manage_biometric() THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF v_serial IS NULL THEN RAISE EXCEPTION 'DEVICE_SERIAL_REQUIRED'; END IF;
  SELECT * INTO v_office FROM public.offices WHERE id = p_office_id AND coalesce(is_active, true);
  IF NOT FOUND THEN RAISE EXCEPTION 'OFFICE_NOT_FOUND'; END IF;

  SELECT * INTO v_old FROM public.biometric_devices WHERE device_identifier = v_serial FOR UPDATE;
  INSERT INTO public.biometric_devices (device_name, device_identifier, office_id, status)
  VALUES (coalesce(nullif(btrim(p_device_name), ''), v_office.name || ' biometric'), v_serial, v_office.id,
          CASE WHEN p_active THEN 'ACTIVE' ELSE 'INACTIVE' END)
  ON CONFLICT (device_identifier) DO UPDATE
    SET office_id = EXCLUDED.office_id,
        device_name = coalesce(nullif(btrim(p_device_name), ''), public.biometric_devices.device_name),
        status = EXCLUDED.status,
        updated_at = now();

  IF p_active THEN
    -- Earlier punches of this machine get its office (only where empty, as before).
    UPDATE public.smartoffice_device_logs SET office_id = v_office.id
    WHERE serial_number = v_serial AND office_id IS NULL;
    GET DIAGNOSTICS v_filled = ROW_COUNT;

    -- Today's site visits that a later punch from this machine proves ended.
    FOR r IN
      SELECT DISTINCT l.user_id FROM public.smartoffice_device_logs l
      WHERE l.serial_number = v_serial AND l.log_date_only = v_today AND l.user_id IS NOT NULL
    LOOP
      v_closed := v_closed + public.hrms_close_visits_on_office_return(r.user_id, v_today);
    END LOOP;
  END IF;

  INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id,
                                        old_values, new_values, source)
  VALUES (auth.uid(), NULL, 'BIOMETRIC_DEVICE_LINKED', 'biometric_device', NULL,
          CASE WHEN v_old.device_identifier IS NULL THEN NULL
               ELSE jsonb_build_object('office_id', v_old.office_id, 'status', v_old.status) END,
          jsonb_build_object('serial', v_serial, 'office_id', v_office.id, 'office', v_office.name,
                             'active', p_active, 'punches_given_office', v_filled, 'visits_closed', v_closed),
          'HR_PANEL');

  RETURN jsonb_build_object('success', true, 'serial', v_serial, 'office', v_office.name,
                            'active', p_active, 'punches_given_office', v_filled, 'visits_closed', v_closed);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_link_biometric_device(text, uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_link_biometric_device(text, uuid, text, boolean) TO authenticated;

INSERT INTO public.permission_screen_access (route, keys) VALUES
  ('BiometricDevices', ARRAY['biometric.manage'])
ON CONFLICT (route) DO UPDATE SET keys = EXCLUDED.keys;

NOTIFY pgrst, 'reload schema';
