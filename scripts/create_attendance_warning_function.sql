-- ============================================================
-- Function to update attendance warnings based on location data
-- Run in Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION update_attendance_warnings()
RETURNS TABLE(updated_count INTEGER) AS $$
DECLARE
  rec RECORD;
  latest_ping RECORD;
  new_warning BOOLEAN;
  updated_count INTEGER := 0;
BEGIN
  -- Find all employees who are checked in today
  FOR rec IN 
    SELECT id, user_id, office_id, checkin_time, status, warning
    FROM attendance_logs
    WHERE date = CURRENT_DATE
      AND status = 'CHECKED_IN'
      AND checkin_time IS NOT NULL
  LOOP
    -- Get the latest location ping for this employee today
    SELECT distance_from_base, gps_available, recorded_at, status
    INTO latest_ping
    FROM location_tracking
    WHERE user_id = rec.user_id
      AND date = CURRENT_DATE
    ORDER BY recorded_at DESC
    LIMIT 1;
    
    new_warning := false;
    
    -- Check warning conditions
    IF latest_ping IS NULL THEN
      -- No location data at all today
      new_warning := true;
    ELSIF latest_ping.gps_available = false THEN
      -- GPS is off
      new_warning := true;
    ELSIF latest_ping.distance_from_base IS NOT NULL 
      AND latest_ping.distance_from_base > 50 THEN
      -- Distance from office > 50m
      new_warning := true;
    ELSIF latest_ping.recorded_at IS NOT NULL 
      AND latest_ping.recorded_at < NOW() - INTERVAL '15 minutes' THEN
      -- Location data is stale (>15 minutes old)
      new_warning := true;
    END IF;
    
    -- If warning status changed, update the record
    IF new_warning <> rec.warning THEN
      UPDATE attendance_logs
      SET warning = new_warning,
          updated_at = NOW()
      WHERE id = rec.id;
      
      updated_count := updated_count + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT updated_count;
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to run every 5 minutes (requires pg_cron extension)
-- SELECT cron.schedule('update-attendance-warnings', '*/5 * * * *', 'SELECT update_attendance_warnings()');

SELECT 'Function created successfully' AS status;
