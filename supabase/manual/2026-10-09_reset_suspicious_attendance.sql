-- =============================================================================
-- Reset Suspicious Attendance (attendance_fraud_events)  — 2026-10-09
--
-- NOT a migration. Run by hand in the Supabase SQL Editor, one step at a time.
-- Requested by HR: clear all existing suspicious-attendance records; new
-- records keep being created automatically from the next check-in on.
--
-- Only table touched: public.attendance_fraud_events (the only source of the
-- Suspicious Attendance screen). Attendance itself is NOT changed.
-- Side effect: compliance scores and the "suspicious" markers in attendance
-- reports for past days will no longer show these events.
-- A full copy is kept in public.attendance_fraud_events_backup_20261009, so
-- the delete can be undone (Step 4).
-- =============================================================================

-- ── STEP 1: look first (changes nothing) ─────────────────────────────────────
SELECT count(*)                                   AS total_events,
       count(*) FILTER (WHERE reviewed_at IS NULL) AS not_reviewed,
       min(created_at)                            AS oldest,
       max(created_at)                            AS newest
FROM public.attendance_fraud_events;

-- ── STEP 2: backup (run once) ────────────────────────────────────────────────
CREATE TABLE public.attendance_fraud_events_backup_20261009 AS
SELECT * FROM public.attendance_fraud_events;
-- Only admins may read the backup:
ALTER TABLE public.attendance_fraud_events_backup_20261009 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_fraud_events_backup_20261009 FROM anon, authenticated;

-- Check: both numbers must be equal before Step 3.
SELECT (SELECT count(*) FROM public.attendance_fraud_events)                 AS live_rows,
       (SELECT count(*) FROM public.attendance_fraud_events_backup_20261009) AS backup_rows;

-- ── STEP 3: delete (only after Step 2 shows equal counts) ────────────────────
BEGIN;
DELETE FROM public.attendance_fraud_events
WHERE id IN (SELECT id FROM public.attendance_fraud_events_backup_20261009);
-- Expect 0. Anything created during this run (new check-ins) is kept.
SELECT count(*) AS remaining_old_rows
FROM public.attendance_fraud_events e
WHERE EXISTS (SELECT 1 FROM public.attendance_fraud_events_backup_20261009 b WHERE b.id = e.id);
COMMIT;

-- ── STEP 4: UNDO (only if you need the old records back) ─────────────────────
-- INSERT INTO public.attendance_fraud_events
-- SELECT * FROM public.attendance_fraud_events_backup_20261009
-- ON CONFLICT DO NOTHING;

-- ── Later (e.g. after a month), when the backup is no longer needed ──────────
-- DROP TABLE public.attendance_fraud_events_backup_20261009;
