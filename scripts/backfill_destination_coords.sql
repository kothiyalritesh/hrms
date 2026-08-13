-- Backfill destination_coords on existing visits that have a predefined_site_id
UPDATE field_visits fv
SET destination_coords = jsonb_build_object(
    'latitude',  ps.latitude,
    'longitude', ps.longitude
  ),
  checkin_radius_m = ps.checkin_radius_m
FROM predefined_sites ps
WHERE fv.predefined_site_id = ps.id
  AND fv.destination_coords IS NULL;

SELECT 'Backfilled: ' || COUNT(*) AS result
FROM field_visits
WHERE predefined_site_id IS NOT NULL
  AND destination_coords IS NOT NULL;
