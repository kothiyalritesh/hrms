# Distance Mismatch Fix - Summary

## Problems Fixed

1. **Offices: 0** - "No active offices configured" appearing
2. **Distance Mismatch: 0** - Employees in meetings with GPS off NOT appearing  
3. **Map My India instead of Google Maps** - Wrong map service being used

## Root Causes

1. Offices table missing latitude, longitude, attendance_radius columns
2. update_attendance_warnings() PostgreSQL function doesn't exist
3. VisitDetailModal using hardcoded Google Maps API key

## SQL Fixes to Run in Supabase SQL Editor

```sql
-- 1. Add missing office columns
ALTER TABLE offices ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE offices ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE offices ADD COLUMN IF NOT EXISTS attendance_radius INTEGER DEFAULT 50;

-- 2. Create warning update function
CREATE OR REPLACE FUNCTION update_attendance_warnings()
RETURNS TABLE(updated_count INTEGER) AS $$
DECLARE
  rec RECORD;
  latest_ping RECORD;
  new_warning BOOLEAN;
  updated_count INTEGER := 0;
BEGIN
  FOR rec IN 
    SELECT id, user_id, office_id, checkin_time, status, warning
    FROM attendance_logs
    WHERE date = CURRENT_DATE
      AND status = 'CHECKED_IN'
      AND checkin_time IS NOT NULL
  LOOP
    SELECT distance_from_base, gps_available, recorded_at, status
    INTO latest_ping
    FROM location_tracking
    WHERE user_id = rec.user_id
      AND date = CURRENT_DATE
    ORDER BY recorded_at DESC
    LIMIT 1;
    
    new_warning := false;
    
    IF latest_ping IS NULL THEN
      new_warning := true;
    ELSIF latest_ping.gps_available = false THEN
      new_warning := true;
    ELSIF latest_ping.distance_from_base IS NOT NULL 
      AND latest_ping.distance_from_base > 50 THEN
      new_warning := true;
    ELSIF latest_ping.recorded_at IS NOT NULL 
      AND latest_ping.recorded_at < NOW() - INTERVAL '15 minutes' THEN
      new_warning := true;
    END IF;
    
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

-- 3. Schedule to run every 5 minutes
SELECT cron.schedule('update-attendance-warnings', '*/5 * * * *', 'SELECT update_attendance_warnings()');
```

## Files Modified

1. `services/attendance.service.ts` - Added updateAllAttendanceWarnings()
2. `screens/admin/LiveTrackingScreen.tsx` - Shows "Ping exists (no GPS)" when GPS off
3. `screens/admin/TVDisplayScreen.tsx` - Enhanced fraud detection
4. `components/VisitDetailModal.tsx` - Fixed Google Maps API key

## Expected Behavior

**Distance Mismatch Alerts Trigger When:**
- GPS/location turned OFF
- Distance from office > 50m
- Last ping > 15 minutes old

**Employees in meetings with GPS off will appear in:**
- TVDisplayScreen "NEEDS ATTENTION" section
- LiveTrackingScreen with "📍 Ping exists (no GPS)"
- AttendanceControlScreen with warning icon
