# 🔧 Admin Attendance Editor - Hidden Feature

## Overview
A hidden admin-only feature that allows admins to edit employee check-in times and mark late arrivals as on-time (10:30 AM).

## Access

### For Admins:
1. Go to **Admin Dashboard**
2. Scroll down to **Quick Actions**
3. Tap **"Edit Attendance"** button (pink icon)

### Permission:
- Only users with role `ADMIN` or `SYSTEM_ADMIN` can access this feature
- Non-admins will see a lock screen

## Features

### 1. View Attendance by Date
- Select any date (YYYY-MM-DD format)
- Click "Load Attendance" to see all check-ins for that date
- Shows employee name, phone, check-in time, and status

### 2. Mark as On-Time (Quick Action)
- Tap the **"On-Time"** button on any late arrival
- Automatically sets check-in time to **10:30 AM** (your organization's punch time)
- Marks `is_late` as `false`
- Records the edit with timestamp

### 3. Edit Check-In Time (Custom)
- Tap the **"Edit"** button on any record
- Enter new check-in time in **HH:MM** format (e.g., 10:30)
- Enter reason for the edit
- Click "Update" to save

### 4. Edit History
- All edits are tracked with:
  - `admin_edited`: true/false
  - `admin_edit_reason`: reason for edit
  - `admin_edit_timestamp`: when the edit was made

## Database Fields

The following fields are added to `attendance_logs` table:

```sql
admin_edited BOOLEAN DEFAULT false
admin_edit_reason TEXT
admin_edit_timestamp TIMESTAMP
is_late BOOLEAN (updated when check-in time changes)
```

## Use Cases

### Scenario 1: Employee was late but had valid reason
1. Go to Admin Dashboard → Edit Attendance
2. Select the date
3. Find the employee
4. Tap "On-Time" button
5. Check-in is now marked as 10:30 AM (on-time)

### Scenario 2: Employee's check-in time was recorded incorrectly
1. Go to Admin Dashboard → Edit Attendance
2. Select the date
3. Find the employee
4. Tap "Edit" button
5. Enter correct time (e.g., 10:25)
6. Enter reason (e.g., "System error - corrected")
7. Click "Update"

### Scenario 3: Bulk mark multiple late arrivals as on-time
- Use the service method `bulkMarkAsOnTime()` for batch operations

## Service Methods

### Available in `AdminAttendanceEditService`:

```typescript
// Get all attendance for a date
getAttendanceByDate(date: string): Promise<any[]>

// Get single attendance record
getAttendanceById(attendanceId: string): Promise<any>

// Edit check-in time with custom time
editCheckInTime(attendanceId: string, newCheckInTime: string, reason: string): Promise<any>

// Quick mark as on-time (10:30 AM)
markAsOnTime(attendanceId: string, reason: string): Promise<any>

// Get all late arrivals in date range
getLateArrivals(startDate: string, endDate: string): Promise<any[]>

// Bulk mark multiple as on-time
bulkMarkAsOnTime(attendanceIds: string[], reason: string): Promise<any>

// Get edit history
getEditHistory(attendanceId: string): Promise<any>
```

## Example Usage

```typescript
import { AdminAttendanceEditService } from "@/services/admin-attendance-edit.service";

// Mark an employee as on-time
await AdminAttendanceEditService.markAsOnTime(
  "attendance-id-123",
  "Valid reason for late arrival"
);

// Edit check-in time to specific time
await AdminAttendanceEditService.editCheckInTime(
  "attendance-id-123",
  "2026-05-01T10:25:00",
  "Corrected system error"
);

// Get all late arrivals for a week
const lateArrivals = await AdminAttendanceEditService.getLateArrivals(
  "2026-05-01",
  "2026-05-07"
);
```

## Important Notes

1. **Grace Period**: Your organization has **NO grace period** - punch time is exactly **10:30 AM**
2. **Audit Trail**: All edits are recorded with reason and timestamp
3. **Late Calculation**: Automatically recalculated when check-in time changes
4. **Admin Only**: This feature is restricted to admin users only
5. **Reversible**: Edits can be made multiple times if needed

## Security

- Feature is role-based (ADMIN/SYSTEM_ADMIN only)
- All edits are logged with admin reason and timestamp
- Can be audited later for compliance

## Files Created

- `services/admin-attendance-edit.service.ts` - Service layer
- `screens/admin/AdminAttendanceEditScreen.tsx` - UI screen
- Updated `navigation/AdminStackNavigator.tsx` - Added route
- Updated `screens/admin/AdminDashboardScreen.tsx` - Added quick action button

## Next Steps

1. Test the feature with a sample late arrival
2. Verify the edit is recorded in the database
3. Check that monthly reports reflect the corrected time
4. Set up audit logging if needed
