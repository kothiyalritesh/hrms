-- =============================================================================
-- 2026-10-22 APPLY (changes data): close today's site visits listed by
-- 2026-10-22_office_return_dryrun.sql. Run ONLY after reviewing that dry run.
-- Needs migration 20261022100000. Closes visits (COMPLETED, auto_closed,
-- reason OFFICE_RETURN_BIOMETRIC); deletes nothing; the workday stays open.
-- Running it twice changes nothing more.
-- =============================================================================
SELECT p.name AS employee,
       public.hrms_close_visits_on_office_return(x.user_id, (now() AT TIME ZONE 'Asia/Kolkata')::date) AS visits_closed
FROM (
  SELECT DISTINCT v.user_id FROM public.field_visits v
  WHERE v.date = (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND v.status = 'CHECKED_IN' AND v.checkout_time IS NULL
) x
JOIN public.profiles p ON p.id = x.user_id
ORDER BY p.name;
