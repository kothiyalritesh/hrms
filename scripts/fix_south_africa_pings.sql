-- ============================================================
-- Fix: Remove out-of-India GPS pings from location_tracking
--
-- Root cause: Google Geolocation API was called with considerIp:true.
-- Office PCs / old laptops often resolve to datacenter IPs in South Africa
-- (~-30° lat), Singapore, etc., which poisoned distance-mismatch alerts
-- and the live board.
--
-- This script:
--   1. Deletes all location_tracking rows outside the India bounding box
--      (lat 6.5–37.6°N, lon 68–97.5°E) that have non-null coordinates.
--   2. Reports how many rows were removed.
--   3. Leaves rows with null lat/lon untouched (those are valid "GPS OFF" records).
--
-- Safe to run multiple times. Run in Supabase SQL Editor → New Query → Run.
-- ============================================================

-- Preview how many rogue rows exist before deleting
SELECT COUNT(*) AS rogue_pings_to_delete
FROM location_tracking
WHERE latitude  IS NOT NULL
  AND longitude IS NOT NULL
  AND (
    latitude  < 6.5   OR latitude  > 37.6  OR
    longitude < 68.0  OR longitude > 97.5
  );

-- Delete them
DELETE FROM location_tracking
WHERE latitude  IS NOT NULL
  AND longitude IS NOT NULL
  AND (
    latitude  < 6.5   OR latitude  > 37.6  OR
    longitude < 68.0  OR longitude > 97.5
  );

-- Confirm
SELECT 'Deleted out-of-India pings. Remaining rows:' AS status, COUNT(*) AS total_rows
FROM location_tracking;
