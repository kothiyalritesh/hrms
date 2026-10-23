-- =============================================================================
-- 2026-10-23 Employee import check: READ-ONLY (SELECT only).
-- Until migration 20261023120000, re-importing an existing employee reset
-- their gender to MALE (and cleared email / employee number not in the file
-- was kept, but gender was not). This shows how many imports updated existing
-- employees, and the gender counts, so HR can see if women are listed as MALE.
-- =============================================================================
SELECT 1 AS section, 'imports that updated existing employees' AS check_name,
       count(*)::text AS value,
       coalesce(sum((result->>'updated')::int), 0)::text || ' employee updates, last ' ||
       coalesce(to_char(max(updated_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), '-') AS detail
FROM public.employee_import_batches
WHERE status = 'COMPLETED' AND coalesce((result->>'updated')::int, 0) > 0
UNION ALL
SELECT 2, 'active employees by gender: ' || coalesce(gender, '(none)'), count(*)::text, NULL
FROM public.profiles WHERE coalesce(is_active, true)
GROUP BY gender
ORDER BY 1, 2;
