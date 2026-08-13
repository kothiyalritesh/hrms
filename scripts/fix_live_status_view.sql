-- ============================================================
-- FULL FIX SCRIPT — Run in Supabase SQL Editor
-- 1. Remove duplicate attendance_logs (keep latest per user per day)
-- 2. Rebuild employee_live_status v8 (one row per user, latest ping)
-- 3. Set all office geo-fence radii to 50m
-- ============================================================

-- ── Step 1: Remove duplicate attendance_logs ─────────────────────────────────
-- Keep only the row with the latest checkin_time per (user_id, date)
DELETE FROM attendance_logs
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, date) id
  FROM attendance_logs
  ORDER BY user_id, date, checkin_time DESC
);

SELECT 'attendance_logs deduplicated' AS step1;

-- ── Step 2: Rebuild employee_live_status view ────────────────────────────────
DROP VIEW IF EXISTS employee_live_status;

CREATE VIEW employee_live_status AS
SELECT
  p.id                                                      AS user_id,
  p.name,
  p.employee_number,
  p.role,
  lt.latitude,
  lt.longitude,
  lt.distance_from_base,
  CASE
    WHEN al.checkout_time IS NOT NULL THEN 'CHECKED_OUT'
    WHEN lt.status IS NOT NULL        THEN lt.status
    ELSE 'CHECKIN_ONLY'
  END                                                       AS status,
  COALESCE(lt.gps_available, TRUE)                          AS gps_available,
  COALESCE(lt.recorded_at, al.checkin_time)                 AS recorded_at,
  p.base_latitude,
  p.base_longitude,
  COALESCE(p.geo_fence_radius, 50)                          AS geo_fence_radius,
  al.checkin_time                                           AS attendance_checkin,
  al.checkout_time                                          AS attendance_checkout,
  fv_out.fv_checkin                                         AS last_visit_checkin,
  fv_out.fv_checkout                                        AS last_visit_checkout,
  fv_out.fv_location                                        AS last_visit_location,
  al.checkin_time                                           AS checkin_time,
  al.checkout_time                                          AS checkout_time,
  CASE
    WHEN lt.user_id IS NOT NULL THEN 'GPS'
    ELSE 'CHECKIN_ONLY'
  END                                                       AS data_source

FROM profiles p

-- ONE attendance record per user: latest checkin today (IST-correct)
INNER JOIN LATERAL (
  SELECT *
  FROM attendance_logs
  WHERE user_id = p.id
    AND checkin_time IS NOT NULL
    AND checkin_time >= (CURRENT_DATE::timestamptz - interval '5 hours 30 minutes')
    AND checkin_time <  (CURRENT_DATE::timestamptz - interval '5 hours 30 minutes' + interval '1 day')
  ORDER BY checkin_time DESC
  LIMIT 1
) al ON TRUE

-- Latest GPS ping today
LEFT JOIN LATERAL (
  SELECT *
  FROM location_tracking
  WHERE user_id = p.id
    AND recorded_at >= (CURRENT_DATE::timestamptz - interval '5 hours 30 minutes')
    AND recorded_at <  (CURRENT_DATE::timestamptz - interval '5 hours 30 minutes' + interval '1 day')
  ORDER BY recorded_at DESC
  LIMIT 1
) lt ON TRUE

-- Latest field visit today
LEFT JOIN LATERAL (
  SELECT
    checkin_time  AS fv_checkin,
    checkout_time AS fv_checkout,
    location_name AS fv_location
  FROM field_visits
  WHERE user_id = p.id
    AND created_at >= (CURRENT_DATE::timestamptz - interval '5 hours 30 minutes')
    AND created_at <  (CURRENT_DATE::timestamptz - interval '5 hours 30 minutes' + interval '1 day')
  ORDER BY COALESCE(checkout_time, checkin_time, created_at) DESC NULLS LAST
  LIMIT 1
) fv_out ON TRUE

WHERE p.is_active = TRUE;

SELECT 'employee_live_status v8 rebuilt' AS step2;

-- ── Step 3: Set all office geo-fence radii to 50m ───────────────────────────
UPDATE offices
SET attendance_radius = 50
WHERE attendance_radius IS NULL OR attendance_radius > 50;

SELECT 'office geo-fence radii set to 50m' AS step3;
