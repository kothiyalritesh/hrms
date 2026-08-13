-- ============================================================
-- FIX employee_live_status view to show location data exists
-- even when GPS is off but pings are being sent
-- Run in Supabase SQL Editor
-- ============================================================

-- Drop existing view
DROP VIEW IF EXISTS employee_live_status;

-- Create improved view
CREATE VIEW employee_live_status AS
SELECT
  p.id                                                      AS user_id,
  p.name,
  p.employee_number,
  p.role,

  -- GPS coordinates: use real ping if available, otherwise office coords as fallback
  lt.latitude,
  lt.longitude,
  COALESCE(lt.distance_from_base, 0)                        AS distance_from_base,

  -- Status logic - check if employee is checked in first, then look at GPS status
  CASE
    WHEN al.checkout_time IS NOT NULL THEN 'CHECKED_OUT'
    WHEN lt.status IN ('RED_GPS_OFF', 'RED_RANGE', 'ORANGE', 'YELLOW') THEN lt.status
    WHEN lt.status = 'GREEN' THEN 'GREEN'
    WHEN lt.status IS NOT NULL THEN lt.status
    ELSE 'CHECKIN_ONLY'
  END                                                       AS status,

  COALESCE(lt.gps_available, TRUE)                          AS gps_available,
  COALESCE(lt.recorded_at, al.checkin_time)                 AS recorded_at,

  -- Whether we have ANY location data (even if GPS is off)
  CASE
    WHEN lt.user_id IS NOT NULL THEN TRUE
    ELSE FALSE
  END                                                       AS has_location_data,
  
  -- Whether we have real GPS coordinates
  CASE
    WHEN lt.latitude IS NOT NULL AND lt.longitude IS NOT NULL THEN TRUE
    ELSE FALSE
  END                                                       AS has_gps_ping,

  -- Office fallback coordinates (always available if checked in at an office)
  o.latitude                                                AS office_latitude,
  o.longitude                                               AS office_longitude,
  o.name                                                    AS office_name,

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

  -- Data source indicator
  CASE
    WHEN lt.user_id IS NOT NULL THEN 'GPS'
    ELSE 'CHECKIN_ONLY'
  END                                                       AS data_source,

  -- Count of pings today (for debugging)
  (SELECT COUNT(*) FROM location_tracking lt2 WHERE lt2.user_id = p.id AND lt2.date = CURRENT_DATE) AS ping_count,

  -- Latest ping status (RED_GPS_OFF if GPS is off)
  lt.status                                                 AS ping_status

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

-- Latest GPS ping today (even if GPS is off)
LEFT JOIN LATERAL (
  SELECT *
  FROM location_tracking
  WHERE user_id = p.id
    AND recorded_at >= (CURRENT_DATE::timestamptz - interval '5 hours 30 minutes')
    AND recorded_at <  (CURRENT_DATE::timestamptz - interval '5 hours 30 minutes' + interval '1 day')
  ORDER BY recorded_at DESC
  LIMIT 1
) lt ON TRUE

-- Office where they checked in (for fallback coords)
LEFT JOIN offices o ON o.id = al.office_id 

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

-- Test the new view
SELECT COUNT(*) as total_employees FROM employee_live_status;
SELECT COUNT(*) as with_location_data FROM employee_live_status WHERE has_location_data = true;
SELECT COUNT(*) as with_gps_ping FROM employee_live_status WHERE has_gps_ping = true;
SELECT COUNT(*) as gps_off FROM employee_live_status WHERE gps_available = false;

SELECT 'employee_live_status view updated successfully' AS status;
