-- ============================================================
-- STEP 1: PREVIEW — how many duplicates exist across all dates
-- ============================================================
SELECT user_id, date, COUNT(*) AS cnt
FROM attendance_logs
GROUP BY user_id, date
HAVING COUNT(*) > 1
ORDER BY date DESC, cnt DESC;


-- ============================================================
-- STEP 2: DELETE all duplicates across ALL dates
-- Keeps the row with the earliest created_at per (user_id, date)
-- ============================================================
DELETE FROM attendance_logs
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, date) id
  FROM attendance_logs
  ORDER BY user_id, date, created_at ASC
);


-- ============================================================
-- STEP 3: Verify — must return 0 rows before adding constraint
-- ============================================================
SELECT user_id, date, COUNT(*) AS cnt
FROM attendance_logs
GROUP BY user_id, date
HAVING COUNT(*) > 1;


-- ============================================================
-- STEP 4: Add UNIQUE constraint (only after Step 3 returns 0 rows)
-- ============================================================
ALTER TABLE attendance_logs
  ADD CONSTRAINT attendance_logs_user_date_unique UNIQUE (user_id, date);
