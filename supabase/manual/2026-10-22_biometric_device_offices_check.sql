-- =============================================================================
-- 2026-10-22 READ-ONLY: which biometric devices are linked to an office?
-- Office return (migration 20261022100000) only trusts punches from a device
-- linked to an office (biometric_devices). Unlinked devices = no office return.
-- "suggested_office" = the office most of the device's users belong to; it is
-- only a hint - confirm where each device physically is.
-- Part 2 lists profiles whose name contains "viral" (possible duplicates).
-- =============================================================================
SELECT * FROM (
  SELECT 1 AS part,
         l.serial_number AS device,
         coalesce(o_linked.name, 'NOT LINKED') AS linked_office,
         (SELECT o.name FROM public.smartoffice_device_logs x
            JOIN public.profiles p ON p.id = x.user_id
            JOIN public.offices o ON o.id = p.office_id
          WHERE x.serial_number = l.serial_number
            AND x.log_date_only >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 30
          GROUP BY o.name ORDER BY count(*) DESC LIMIT 1) AS suggested_office,
         count(*)::text AS punches_30_days,
         count(*) FILTER (WHERE l.office_id IS NULL)::text AS punches_without_office,
         max(l.log_date_only)::text AS last_punch_day
  FROM public.smartoffice_device_logs l
  LEFT JOIN public.biometric_devices bd ON bd.device_identifier = l.serial_number AND bd.status = 'ACTIVE'
  LEFT JOIN public.offices o_linked ON o_linked.id = bd.office_id
  WHERE l.log_date_only >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 30
  GROUP BY l.serial_number, o_linked.name
  UNION ALL
  SELECT 2, p.name, coalesce(o.name, '-'),
         'active=' || coalesce(p.is_active, true)::text || ' code=' || coalesce(p.smartoffice_employee_code, '-'),
         (SELECT count(*) FROM public.field_visits v WHERE v.user_id = p.id
            AND v.date = (now() AT TIME ZONE 'Asia/Kolkata')::date)::text || ' visits today',
         (SELECT count(*) FROM public.smartoffice_device_logs l WHERE l.user_id = p.id
            AND l.log_date_only = (now() AT TIME ZONE 'Asia/Kolkata')::date)::text || ' punches today',
         p.id::text
  FROM public.profiles p LEFT JOIN public.offices o ON o.id = p.office_id
  WHERE p.name ILIKE '%viral%'
) r
ORDER BY part, device;
