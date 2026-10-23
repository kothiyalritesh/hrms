-- =============================================================================
-- 2026-10-22 READ-ONLY dry run: site visits of TODAY that are still open
-- although the employee punched an office biometric device after the visit
-- check-in. These are what 2026-10-22_office_return_apply.sql would close
-- (same rule as hrms_close_visits_on_office_return, migration 20261022100000).
-- Nothing is changed. Send the CSV back before running the apply script.
-- =============================================================================
WITH d AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS day),
open_visits AS (
  SELECT v.id, v.user_id, v.location_name, v.journey_status,
         public.hrms_timestamp(v.checkin_time) AS started,
         public.hrms_timestamp(v.departed_at) AS departed
  FROM public.field_visits v, d
  WHERE v.date = d.day AND v.status = 'CHECKED_IN' AND v.checkout_time IS NULL AND v.checkin_time IS NOT NULL
)
SELECT p.name AS employee,
       ov.location_name AS open_site_visit,
       to_char(ov.started AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS visit_checked_in,
       to_char(ov.departed AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS gps_left_site,
       to_char(pu.log_date AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS office_punch,
       o.name AS punch_office,
       to_char((CASE WHEN ov.departed > ov.started AND ov.departed <= pu.log_date THEN ov.departed ELSE pu.log_date END)
               AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS visit_would_end_at,
       'workday stays open' AS workday
FROM open_visits ov
JOIN public.profiles p ON p.id = ov.user_id
JOIN LATERAL (
  SELECT l.log_date, l.office_id FROM public.smartoffice_device_logs l, d
  WHERE l.user_id = ov.user_id AND l.log_date_only = d.day AND l.office_id IS NOT NULL
    AND l.log_date > ov.started + interval '2 minutes'
  ORDER BY l.log_date LIMIT 1
) pu ON true
LEFT JOIN public.offices o ON o.id = pu.office_id
ORDER BY p.name;
