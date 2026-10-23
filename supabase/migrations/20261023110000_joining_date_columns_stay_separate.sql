-- =============================================================================
-- 20261023110000_joining_date_columns_stay_separate.sql
--
-- Correction to 20261023100000 section C. Production data (2026-10-23 check)
-- shows the two columns mean different things:
--   date_of_joining  the real joining date HR enters on the employee form
--   joining_date     the attendance-reporting start (2026-09-01 for 225
--                    people), used by the canonical attendance view
-- Copying one into the other would either put 2026-09-01 on everyone's
-- profile or start their reports years back. The sync trigger is removed;
-- no rows were changed by it (check: "both dates saved and equal" = 0).
-- =============================================================================
BEGIN;
DROP TRIGGER IF EXISTS hrms_profiles_sync_joining_date_trg ON public.profiles;
DROP FUNCTION IF EXISTS public.hrms_profiles_sync_joining_date();
COMMIT;
