-- 2026-10-21 READ-ONLY: deactivated employees who still have a biometric code
-- (their punches blocked the sync until biometric-attendance-sync was fixed).
-- Remove their code in Biometric User Match, or reactivate them if they still work here.
SELECT p.name, p.employee_number, p.smartoffice_employee_code, p.last_working_date,
       (SELECT max(b.punch_timestamp) FROM public.biometric_device_punches b
        WHERE lower(btrim(b.biometric_employee_code)) = lower(btrim(p.smartoffice_employee_code))) AS last_punch
FROM public.profiles p
WHERE p.is_active IS DISTINCT FROM true
  AND nullif(btrim(p.smartoffice_employee_code), '') IS NOT NULL
ORDER BY last_punch DESC NULLS LAST, p.name;
