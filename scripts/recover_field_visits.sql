-- ============================================================
-- RECOVERY: Restore field_visits deleted by TRUNCATE CASCADE
--
-- If TRUNCATE predefined_sites CASCADE deleted your field_visits
-- rows, this script cannot recover deleted data (PostgreSQL has
-- no undo for TRUNCATE unless you have a backup).
--
-- What this script DOES:
--   1. Re-links existing field_visits to predefined_sites by name
--   2. Resets any visits stuck in PENDING that should still be open
--   3. Shows you what's left
--
-- If visits are truly gone, employees need to re-log them.
-- ============================================================

-- Re-link by location_name match
UPDATE field_visits fv
SET predefined_site_id = ps.id
FROM predefined_sites ps
WHERE fv.predefined_site_id IS NULL
  AND fv.location_name = ps.site_label
  AND ps.is_active = true;

-- Show today's visits
SELECT
  p.name AS employee,
  fv.location_name,
  fv.status,
  fv.visit_type,
  fv.date,
  fv.created_at,
  fv.checkin_time,
  fv.predefined_site_id
FROM field_visits fv
JOIN profiles p ON p.id = fv.user_id
WHERE fv.date = CURRENT_DATE
ORDER BY fv.created_at DESC;

SELECT 'Total visits today: ' || COUNT(*) FROM field_visits WHERE date = CURRENT_DATE;
