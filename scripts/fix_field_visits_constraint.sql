-- ============================================================
-- EMERGENCY FIX: Remove all check constraints on field_visits
-- and recreate only the correct ones.
-- Run in Supabase SQL Editor → New Query → Run
-- ============================================================

-- Step 1: Remove EVERY check constraint on field_visits
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'field_visits'::regclass
      AND contype = 'c'
  LOOP
    EXECUTE 'ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
    RAISE NOTICE 'Dropped constraint: %', r.conname;
  END LOOP;
END $$;

-- Step 2: Add back ONLY the two constraints the app needs
ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_status_check
  CHECK (status IN ('PENDING', 'CHECKED_IN', 'COMPLETED', 'MISSED'));

ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_visit_type_check
  CHECK (visit_type IN ('site', 'meeting', 'office', 'others'));

-- Step 3: Verify — should show exactly 2 rows
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'field_visits'::regclass
  AND contype = 'c'
ORDER BY conname;
