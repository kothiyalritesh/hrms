-- =============================================================================
-- 2026-10-22 CHANGES DATA: link ONE biometric device to the office where it is
-- physically installed. Run once per device, after confirming its office with
-- 2026-10-22_biometric_device_offices_check.sql.
-- Same as the existing rpc_upsert_biometric_device: registers the device,
-- fills the office on its earlier punches (only where it is empty), then
-- closes today's site visits that a later office punch now proves ended.
-- Deletes nothing. Running it again changes nothing more.
--
-- EDIT the two values below before running.
-- =============================================================================
WITH params AS (
  SELECT 'CEXJ203660057'::text AS device_serial,   -- device serial (as in the check)
         'Noida 136'::text     AS office_name      -- exact office name
),
office AS (
  SELECT o.id FROM public.offices o, params p WHERE o.name = p.office_name
),
linked AS (
  INSERT INTO public.biometric_devices (device_name, device_identifier, office_id, status)
  SELECT p.office_name || ' biometric', p.device_serial, (SELECT id FROM office), 'ACTIVE'
  FROM params p
  WHERE (SELECT count(*) FROM office) = 1
  ON CONFLICT (device_identifier) DO UPDATE
    SET office_id = EXCLUDED.office_id, status = 'ACTIVE', updated_at = now()
  RETURNING device_identifier, office_id
),
filled AS (
  UPDATE public.smartoffice_device_logs l
  SET office_id = k.office_id
  FROM linked k
  WHERE l.serial_number = k.device_identifier AND l.office_id IS NULL
  RETURNING l.id
)
SELECT (SELECT count(*) FROM linked)  AS device_linked,
       (SELECT count(*) FROM filled)  AS punches_given_office;

-- Today's open site visits ended by a later punch from now-linked devices.
SELECT p.name AS employee,
       public.hrms_close_visits_on_office_return(x.user_id, (now() AT TIME ZONE 'Asia/Kolkata')::date) AS visits_closed
FROM (
  SELECT DISTINCT v.user_id FROM public.field_visits v
  WHERE v.date = (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND v.status = 'CHECKED_IN' AND v.checkout_time IS NULL
) x
JOIN public.profiles p ON p.id = x.user_id
ORDER BY p.name;
