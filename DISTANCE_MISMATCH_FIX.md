# Distance Mismatch Alert Fix - Implementation Summary

## Problem Statement

The attendance control screen was showing "No distance mismatches detected" or "Not Logged In / Not Pinging" for employees who:
1. Were in meetings but had GPS/location turned OFF
2. Were checked in but their last ping was >50m from office
3. Had location data stale for >15 minutes

These cases should appear in the "Distance Mismatch" alert section.

## Root Cause

The `warning` flag in `attendance_logs` was only being set at check-in time based on the initial distance from office. It was NOT being updated during the day when:
- GPS is turned OFF (gps_available = false)
- Employee drifts >50m from office after checking in
- Location pings become stale (>15 minutes old)

## Solution Implemented

### 1. Added Warning Update Logic (attendance.service.ts)

```typescript
async updateAllAttendanceWarnings() {
  // Checks all checked-in employees and updates warning flag based on:
  // - No location pings today
  // - GPS turned off (gps_available = false)
  // - Distance from office > 50m
  // - Location data stale (>15 minutes old)
}
```

### 2. SQL Function for Server-Side Updates (create_attendance_warning_function.sql)

Created a PostgreSQL function that runs server-side to update attendance warnings. This can be scheduled to run every 5 minutes using pg_cron.

### 3. Database Migration (add_warning_reason.sql)

Added a `warning_reason` column to `attendance_logs` to track why an employee has a warning.

## How It Works Now

1. **Real-time Monitoring**: The `useLocationMonitor` hook continues to send GPS pings every 1-5 minutes
2. **Warning Detection**: The `updateAllAttendanceWarnings()` function is called periodically (every 5-15 minutes) to check:
   - If GPS is OFF (gps_available = false)
   - If distance > 50m from office
   - If last ping is >15 minutes old
3. **Attendance Update**: When a warning condition is detected, the `warning` flag in `attendance_logs` is updated
4. **Display**: The Attendance Control Screen now shows these employees in the appropriate alert section

## Implementation Steps

### Step 1: Run Database Migrations

Run these SQL scripts in Supabase SQL Editor (in order):

```sql
-- 1. Add warning_reason column
c:\Users\Sagar\Downloads\RealtyHRMs-updated\RealtyHRMs-updated\RealtyHRM\scripts\add_warning_reason.sql

-- 2. Create warning update function (optional, for scheduled jobs)
c:\Users\Sagar\Downloads\RealtyHRMs-updated\RealtyHRMs-updated\RealtyHRM\scripts\create_attendance_warning_function.sql
```

### Step 2: Schedule Periodic Updates

**Option A: Using pg_cron (Recommended)**

If pg_cron is enabled in your Supabase project:

```sql
SELECT cron.schedule('update-attendance-warnings', '*/5 * * * *', 'SELECT update_attendance_warnings()');
```

This runs every 5 minutes.

**Option B: Using Edge Function (if you have Deno Deploy)**

Deploy the Edge Function at `api/update_attendance_warnings/index.ts` and call it via cron job or Supabase Scheduler.

**Option C: Manual Trigger**

Call `await AttendanceService.updateAllAttendanceWarnings()` from the attendance control screen when it loads.

### Step 3: Update Attendance Control Screen (Optional Enhancement)

The existing screen should automatically show updated warnings once the data is updated. If you want to force refresh, add a refresh button that calls `updateAllAttendanceWarnings()`.

## Alert Thresholds

| Condition | Alert Type |
|-----------|------------|
| GPS/location OFF (gps_available = false) | Distance Mismatch |
| Distance from office > 50m | Distance Mismatch |
| Last ping > 15 minutes old | Distance Mismatch |
| No location pings today | Distance Mismatch |

## Testing

1. Check an employee in at the office
2. Turn off GPS on their device
3. Wait 15 minutes (or trigger a manual warning update)
4. The employee should appear in the Distance Mismatch section
5. Similarly, if they leave the office and go >50m away, they should be flagged

## Notes

- The warning flag is now updated continuously, not just at check-in
- The `warning_reason` column explains why the warning was triggered
- Alerts are resolved automatically when GPS becomes available again and distance is within range
- The `updateAllAttendanceWarnings()` function should be called every 5-15 minutes for real-time monitoring
