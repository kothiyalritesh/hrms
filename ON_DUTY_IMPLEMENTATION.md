# On-Duty Event Tracking & CSV Export Implementation Guide

## Overview
This guide covers the implementation of the On-Duty Event Tracking feature and fixes to the CSV export system.

## What's Implemented

### 1. CSV Export Fixes ✅
**File**: `services/attendance-report.service.ts`

**Changes Made**:
- Updated daily CSV headers to match expected format:
  - Date, Employee Name, Employee ID, Phone, Office
  - Check In, Check Out, Duration, Status
  - Late, Late Minutes, Overtime, Overtime Minutes
  - On Duty, Sunday, Leave, Leave Type
  - Distance from Office (m), Warning

- Updated weekly CSV with same column structure
- Updated monthly CSV to include Sunday Days and Holiday Days

**Result**: CSV exports now include all required columns with proper formatting

---

### 2. On-Duty Service ✅
**File**: `services/on-duty.service.ts`

**Features**:
- `requestOnDuty()` - Employee submits outdoor duty request
- `getPendingRequests()` - Admin retrieves pending approvals
- `getUserOnDutyEvents()` - Employee views their requests
- `approveRequest()` - Manager approves request + auto-marks attendance
- `rejectRequest()` - Manager rejects request
- `markAttendanceAsOnDuty()` - Automatically marks day as "on_duty" status
- `getOnDutyEventsByDateRange()` - Admin reporting
- `cancelRequest()` - Employee cancels pending request

**Key Logic**:
- When approved, automatically creates/updates attendance_summary record
- Sets status to "on_duty", working_hours to 8, is_on_duty to true
- Clears punch_in/punch_out times for on-duty days

---

### 3. Employee On-Duty Request Screen ✅
**File**: `screens/OnDutyRequestScreen.tsx`

**Features**:
- View all on-duty requests with status (Pending/Approved/Rejected/Completed)
- Submit new on-duty request with:
  - Event Date (required)
  - Event Name (required)
  - Event Type (Training, Conference, Client Visit, Company Event, Other)
  - Location (optional)
  - Description (optional)
- Cancel pending requests
- Real-time status updates

**UI Elements**:
- Header with request count
- Add button to submit new request
- Request cards showing event details
- Modal form for new requests
- Status badges with color coding

---

### 4. Admin On-Duty Approval Screen ✅
**File**: `screens/admin/OnDutyApprovalScreen.tsx`

**Features**:
- View all pending on-duty requests
- Filter by status (Pending, Approved, Rejected)
- View detailed request information
- Approve/Reject requests with one-click actions
- Automatic attendance marking on approval
- Request count by status

**UI Elements**:
- Status filter chips
- Request cards with employee info
- Detail modal with full request information
- Approve/Reject action buttons

---

## Integration Steps

### Step 1: Add Routes to Navigation
Add these screens to your navigation stack:

```typescript
// Employee Navigation
<Stack.Screen 
  name="OnDutyRequest" 
  component={OnDutyRequestScreen}
  options={{ title: "On-Duty Requests" }}
/>

// Admin Navigation
<Stack.Screen 
  name="OnDutyApproval" 
  component={OnDutyApprovalScreen}
  options={{ title: "On-Duty Approvals" }}
/>
```

### Step 2: Add Menu Items
Add to employee menu:
```typescript
{
  id: "on_duty",
  label: "On-Duty Requests",
  icon: "briefcase",
  screen: "OnDutyRequest"
}
```

Add to admin menu:
```typescript
{
  id: "on_duty_approval",
  label: "On-Duty Approvals",
  icon: "check-circle",
  screen: "OnDutyApproval"
}
```

### Step 3: Update Attendance Calculation
In `services/attendance-calculation.service.ts`, ensure on-duty events are recognized:

```typescript
// When calculating attendance for a date
const onDutyEvent = await supabase
  .from("on_duty_events")
  .select("*")
  .eq("user_id", userId)
  .eq("event_date", date)
  .eq("status", "approved")
  .single();

if (onDutyEvent) {
  // Mark as on-duty, don't require punch records
  return {
    status: "on_duty",
    is_on_duty: true,
    working_hours: 8,
    // ... other fields
  };
}
```

### Step 4: Test CSV Export
1. Go to Attendance Reporting Screen
2. Select Daily/Weekly/Monthly report
3. Click "Export as CSV"
4. Verify columns match expected format:
   - Date, Employee Name, Employee ID, Phone, Office
   - Check In, Check Out, Duration, Status
   - Late, Late Minutes, Overtime, Overtime Minutes
   - On Duty, Sunday, Leave, Leave Type
   - Distance from Office (m), Warning

---

## Database Schema

### on_duty_events Table
```sql
- id (UUID, PK)
- user_id (UUID, FK to profiles)
- event_date (DATE)
- event_name (TEXT)
- event_type (TEXT: training, conference, client_visit, company_event, other)
- location (TEXT, optional)
- start_time (TIMESTAMPTZ, optional)
- end_time (TIMESTAMPTZ, optional)
- description (TEXT, optional)
- status (TEXT: pending, approved, rejected, completed)
- requested_by (UUID, FK to profiles)
- approved_by (UUID, FK to profiles, optional)
- approved_at (TIMESTAMPTZ, optional)
- created_at (TIMESTAMPTZ)
```

### attendance_summary Updates
When on-duty request is approved:
```sql
UPDATE attendance_summary SET
  is_on_duty = true,
  status = 'on_duty',
  working_hours = 8,
  punch_in_time = NULL,
  punch_out_time = NULL,
  is_late = false,
  late_minutes = 0
WHERE user_id = $1 AND date = $2;
```

---

## Workflow

### Employee Workflow
1. Employee opens "On-Duty Requests" screen
2. Clicks "+" button to submit new request
3. Fills in event details (date, name, type, location, description)
4. Submits request
5. Request appears with "Pending" status
6. Manager approves/rejects
7. If approved, attendance is automatically marked as "on_duty"
8. Employee can see approval status in their request list

### Manager Workflow
1. Manager opens "On-Duty Approvals" screen
2. Sees all pending requests
3. Clicks on request to view details
4. Reviews employee info, event details, location
5. Clicks "Approve" or "Reject"
6. If approved:
   - Request status changes to "approved"
   - Attendance record is created/updated
   - Employee is marked as "present" (on-duty)
7. Can filter by status to see approved/rejected requests

---

## CSV Export Format

### Daily/Weekly Report Columns
```
Date | Employee Name | Employee ID | Phone | Office | 
Check In | Check Out | Duration | Status | 
Late | Late Minutes | Overtime | Overtime Minutes | 
On Duty | Sunday | Leave | Leave Type | 
Distance from Office (m) | Warning
```

### Monthly Report Columns
```
Employee Name | Employee ID | Phone | Office | 
Present Days | Late Days | Absent Days | On Duty Days | Leave Days | 
Sunday Days | Holiday Days | 
Total Working Hours | Total Overtime Hours | Attendance %
```

---

## Testing Checklist

- [ ] Employee can submit on-duty request
- [ ] Request appears in employee's request list
- [ ] Manager can see pending requests
- [ ] Manager can approve request
- [ ] Manager can reject request
- [ ] Approved request marks attendance as on-duty
- [ ] Employee can cancel pending request
- [ ] CSV export includes all required columns
- [ ] CSV export shows on-duty status correctly
- [ ] Filter by status works in admin screen
- [ ] Request details modal displays all information
- [ ] Status badges show correct colors

---

## Troubleshooting

### Issue: On-duty requests not showing in attendance
**Solution**: Ensure `markAttendanceAsOnDuty()` is called when request is approved. Check that attendance_summary record is created with correct fields.

### Issue: CSV export missing columns
**Solution**: Verify `attendance-report.service.ts` has been updated with new column headers. Clear app cache and re-export.

### Issue: Manager can't see pending requests
**Solution**: Ensure manager has admin role. Check that on_duty_events table has RLS disabled or proper policies set.

### Issue: Attendance not updating after approval
**Solution**: Check that `approveRequest()` calls `markAttendanceAsOnDuty()`. Verify database permissions allow updates to attendance_summary.

---

## Performance Considerations

- On-duty requests are indexed by user_id and event_date for fast lookups
- Attendance summary is updated synchronously on approval
- Consider adding pagination if many requests exist
- Cache on-duty events for current month to reduce queries

---

## Future Enhancements

1. **Bulk Approvals**: Allow manager to approve multiple requests at once
2. **Recurring Events**: Support recurring on-duty events
3. **Notifications**: Notify employee when request is approved/rejected
4. **Analytics**: Track on-duty event types and frequency
5. **Integration**: Link on-duty events to projects/tasks
6. **Geofencing**: Verify employee location matches event location
7. **Photo Evidence**: Allow employees to upload photos during on-duty events
8. **Expense Tracking**: Track expenses related to on-duty events

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the database schema to ensure tables exist
3. Verify RLS policies are correctly configured
4. Check browser console for error messages
5. Review Supabase logs for database errors
