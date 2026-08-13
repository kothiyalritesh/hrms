-- ============================================================
-- Fix: Remove out-of-India and low-accuracy GPS pings
--
-- Problem: Google Play Services on old Android phones returns
-- stale cached locations — Mumbai (~18.9°N), Bangalore (~12.9°N),
-- or the geographic center of India (~22.5°N, 80°E) — before
-- real GPS acquires. These pollute distance-mismatch alerts
-- and the live board.
--
-- This script:
--   1. Shows how many bad pings exist (run the SELECT first)
--   2. Deletes pings outside India's bounding box
--   3. Deletes pings with accuracy worse than 1000m (cache hits)
--   4. Deletes known Google Play cache hit coordinates exactly
--
-- Run in Supabase SQL Editor → New Query → Run.
-- Safe to run multiple times.
-- ============================================================

-- ── Step 0: Preview (check counts before deleting) ───────────────────────────
SELECT
  'Outside India bounding box' AS reason,
  COUNT(*) AS ping_count
FROM location_tracking
WHERE latitude IS NOT NULL AND longitude IS NOT NULL
  AND (latitude < 6.5 OR latitude > 37.6 OR longitude < 68.0 OR longitude > 97.5)

UNION ALL

SELECT
  'Low accuracy (>1000m, likely cache hit)' AS reason,
  COUNT(*) AS ping_count
FROM location_tracking
WHERE accuracy IS NOT NULL AND accuracy > 1000

UNION ALL

SELECT
  'Exact Mumbai Google cache (19.07, 72.87 ±0.5°)' AS reason,
  COUNT(*) AS ping_count
FROM location_tracking
WHERE latitude BETWEEN 18.5 AND 19.5 AND longitude BETWEEN 72.3 AND 73.4

UNION ALL

SELECT
  'Center of India fallback (20-23°N, 78-82°E)' AS reason,
  COUNT(*) AS ping_count
FROM location_tracking
WHERE latitude BETWEEN 20.0 AND 23.5 AND longitude BETWEEN 78.0 AND 82.0
  AND source = 'app';

-- ── Step 1: Delete outside India ─────────────────────────────────────────────
DELETE FROM location_tracking
WHERE latitude IS NOT NULL AND longitude IS NOT NULL
  AND (latitude < 6.5 OR latitude > 37.6 OR longitude < 68.0 OR longitude > 97.5);

-- ── Step 2: Delete known Google Play cache hit coordinates ───────────────────
-- Mumbai data center: ~19.07°N 72.87°E (accuracy often 1200-3000m)
DELETE FROM location_tracking
WHERE latitude BETWEEN 18.5 AND 19.5
  AND longitude BETWEEN 72.3 AND 73.4
  AND (accuracy IS NULL OR accuracy > 500);

-- ── Step 3: Delete low-accuracy pings (>1000m = cell/WiFi cache, not real GPS) ─
-- Keep low-accuracy pings only if they were explicitly marked as cell/wifi source
DELETE FROM location_tracking
WHERE accuracy IS NOT NULL
  AND accuracy > 1000
  AND (source IS NULL OR source = 'app' OR source = 'web');

-- ── Step 4: Confirm ──────────────────────────────────────────────────────────
SELECT
  'Remaining valid pings in India' AS status,
  COUNT(*) AS total
FROM location_tracking
WHERE latitude IS NOT NULL
  AND latitude BETWEEN 6.5 AND 37.6
  AND longitude BETWEEN 68.0 AND 97.5;
