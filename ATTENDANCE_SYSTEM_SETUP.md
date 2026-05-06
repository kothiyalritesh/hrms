# Complete Attendance Management System - Setup Guide

## Overview

This system provides end-to-end attendance management with:
- Daily, weekly, monthly reporting
- Late detection (after 10:30 AM + 5 min grace)
- Overtime tracking (after 6:45 PM)
- Comp-off management (Sunday work, overtime, holidays)
- On-duty event tracking
- Leave integration with comp-off adjustment
- Performance leaderboard (Top 3 performers)
- CSV export for all reports

## Office Timing
- **Start Time**: 10:30 AM
- **End Time**: 6:30 PM
- **Grace Period**: 5 minutes
- **Overtime Threshold**: 6:45 PM

## Database Setup

### Step 1: Run Migration SQL

Execute the following SQL in your Supabase SQL Editor:

```bash
# File: scripts/attendance_enhancements.sql
```

This creates:
- `overtime_logs` - Track overtime entries
- `compoff_credits` - Track comp-off credits (Sunday, holiday, overtime)
- `compoff_usage` - Track comp-off usage against leaves
- `on_duty_events` - Track approved on-duty/event days
- `attendance_summary` - Daily attendance aggregation
- `performance_metrics` - Monthly performance scores
- Views for reporting and leaderboard

### Step 2: Verify Tables

```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%attendance%' OR table_name LIKE '%compoff%' OR table_name LIKE '%performance%';
```

## Service Implementation

### 1. Attendance Calculation Service

**File**: `services/attendance-calculation.service.ts`

Handles:
- Late detection (10:30 AM + 5 min grace)
- Overtime calculation (after 6:45 PM)
- Leave status checking
- On-duty event validation
- Sunday comp-off crediting
- Comp-off balance calculation

**Usage**:
```typescript
import { AttendanceCalculationService } from "@/services/attendance-calculation.service";

// Calculate attendance for a date
const attendance = await AttendanceCalculationService.calculateAttendance({
  user_id: "user-123",
  date: "2024-01-15",
  punch_in_time: "2024-01-15T10:45:00Z",
  punch_out_time: "2024-01-15T18:50:00Z",
  office_id: "office-1",
  office_name: "Sector 63"
});

// Process range and save to summary
await AttendanceCalculationService.processAttendanceRange("2024-01-01", "2024-01-31");

// Credit Sunday comp-off
await AttendanceCalculationService.creditSundayCompOff("user-123", "2024-01-14");

// Get comp-off balance
const balance = await AttendanceCalculationService.getCompOffBalance("user-123");

// Use comp-off for leave
await AttendanceCalculationService.useCompOffForLeave("user-123", "leave-id", 1);
```

### 2. Performance Service

**File**: `services/performance.service.ts`

Calculates:
- Punctuality Score: 100% if zero late marks
- Consistency Score: Based on attendance % and absences
- Overall Score: Weighted (Punctuality 50%, Consistency 30%, Hours 20%)

**Usage**:
```typescript
import { PerformanceService } from "@/services/performance.service";

// Calculate metrics for a user for a month
const metrics = await PerformanceService.calculateMonthlyMetrics("user-123", 1, 2024);

// Calculate for all employees
await PerformanceService.calculateAllMonthlyMetrics(1, 2024);

// Get top 3 performers
const topPerformers = await PerformanceService.getTopPerformers(1, 2024);

// Get full leaderboard
const leaderboard = await PerformanceService.getLeaderboard(1, 2024);

// Get employee history (last 6 months)
const history = await PerformanceService.getEmployeePerformanceHistory("user-123");

// Get department-wise performance
const deptPerf = await PerformanceService.getDepartmentPerformance(1, 2024);
```

### 3. Attendance Report Service

**File**: `services/attendance-report.service.ts`

Generates reports:
- Daily report
- Weekly report
- Monthly report
- Last month report
- This month report

**Usage**:
```typescript
import { AttendanceReportService } from "@/services/attendance-report.service";

// Get daily report
const daily = await AttendanceReportService.getDailyReport("2024-01-15", "office-id");

// Get weekly report
const weekly = await AttendanceReportService.getWeeklyReport("2024-01-08", "2024-01-14");

// Get monthly report
const monthly = await AttendanceReportService.getMonthlyReport(1, 2024);

// Generate CSV
const csv = await AttendanceReportService.generateDailyCSV("2024-01-15");
AttendanceReportService.downloadCSV(csv, "attendance_2024-01-15.csv");

// Get summary stats
const stats = await AttendanceReportService.getSummaryStats("2024-01-01", "2024-01-31");
```

## Admin Screen

**File**: `screens/admin/AttendanceReportingScreen.tsx`

Features:
- 6 report types (Daily, Weekly, Monthly, Last Month, This Month, Top Performers)
- Date/range selection
- Office filtering
- CSV export
- Summary statistics
- Performance leaderboard display

### Integration

Add to your admin navigation:

```typescript
// In AdminStackNavigator.tsx
import AttendanceReportingScreen from "@/screens/admin/AttendanceReportingScreen";

// Add to stack
<Stack.Screen 
  name="AttendanceReporting" 
  component={AttendanceReportingScreen}
  options={{ title: "Attendance Reports" }}
/>
```

## Attendance Status Codes

| Status | Meaning | Conditions |
|--------|---------|-----------|
| `present` | Present on time | Punch in before 10:35 AM, punch out recorded |
| `late` | Present but late | Punch in after 10:35 AM, punch out recorded |
| `absent` | Absent | No punch in or no punch out |
| `on_duty` | On approved duty | Approved on-duty event |
| `leave` | On approved leave | Approved leave application |
| `sunday` | Sunday (no work) | Sunday with no punch |
| `holiday` | Holiday (no work) | Holiday with no punch |

## Comp-Off Management

### Credit Scenarios

1. **Sunday Work**: 1 comp-off credited automatically
2. **Overtime**: 1 comp-off per 8 hours overtime
3. **Holiday Work**: 1 comp-off per holiday worked

### Usage Scenarios

1. **Leave Adjustment**: Use comp-off to fill leave
2. **Audit Trail**: System tracks which comp-off was used for which leave

### Implementation

```typescript
// Credit Sunday comp-off
await AttendanceCalculationService.creditSundayCompOff(userId, "2024-01-14");

// Credit overtime comp-off
await AttendanceCalculationService.creditOvertimeCompOff(userId, "2024-01-15", 480); // 480 minutes = 8 hours

// Get balance
const balance = await AttendanceCalculationService.getCompOffBalance(userId);

// Use for leave
await AttendanceCalculationService.useCompOffForLeave(userId, leaveId, 1);
```

## Performance Leaderboard

### Scoring Algorithm

```
Punctuality Score = 100 - (Late Days / Total Days * 100)
Consistency Score = Attendance % - (Absence % * 2)
Overall Score = (Punctuality * 0.5) + (Consistency * 0.3) + (Hours Score * 0.2)
```

### Top Performers Display

Shows:
- Rank (1st, 2nd, 3rd)
- Employee name & ID
- Office location
- Present days, late days, absent days
- Total working hours
- Total overtime hours
- Punctuality score
- Consistency score
- Overall score

## Daily Processing

To process attendance daily, create a scheduled job:

```typescript
// Run at end of day (e.g., 11:59 PM)
async function dailyAttendanceProcessing() {
  const today = new Date().toISOString().split("T")[0];
  
  // Process attendance summary
  await AttendanceCalculationService.processAttendanceRange(today, today);
  
  // Credit Sunday comp-offs
  const { data: sundayWork } = await supabase
    .from("attendance_summary")
    .select("user_id, date")
    .eq("is_sunday", true)
    .eq("status", "present");
  
  for (const record of sundayWork || []) {
    await AttendanceCalculationService.creditSundayCompOff(record.user_id, record.date);
  }
  
  // Credit overtime comp-offs
  const { data: overtimeWork } = await supabase
    .from("attendance_summary")
    .select("user_id, date, overtime_minutes")
    .eq("is_overtime", true);
  
  for (const record of overtimeWork || []) {
    await AttendanceCalculationService.creditOvertimeCompOff(
      record.user_id,
      record.date,
      record.overtime_minutes
    );
  }
}
```

## Monthly Processing

To calculate performance metrics monthly:

```typescript
// Run on 1st of each month
async function monthlyPerformanceProcessing() {
  const now = new Date();
  const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  
  await PerformanceService.calculateAllMonthlyMetrics(lastMonth, lastYear);
}
```

## CSV Export Format

### Daily/Weekly Report
```
Date | Employee Name | Employee ID | Phone | Office | Punch In | Punch Out | Working Hours | Late | Late Minutes | Overtime | Overtime Minutes | Status | On Duty | Sunday | Leave | Leave Type
```

### Monthly Report
```
Employee Name | Employee ID | Phone | Office | Present Days | Late Days | Absent Days | On Duty Days | Leave Days | Total Working Hours | Total Overtime Hours | Attendance %
```

## API Endpoints (if using REST)

```
GET /api/attendance/daily?date=2024-01-15&office_id=office-1
GET /api/attendance/weekly?start=2024-01-08&end=2024-01-14
GET /api/attendance/monthly?month=1&year=2024
GET /api/attendance/export/daily?date=2024-01-15
GET /api/performance/top-performers?month=1&year=2024
GET /api/performance/leaderboard?month=1&year=2024
POST /api/compoff/credit
POST /api/compoff/use
GET /api/compoff/balance?user_id=user-123
```

## Troubleshooting

### Issue: Late detection not working
- Check office start time is set to 10:30 AM
- Verify grace period is 5 minutes
- Check punch in time format (should be ISO 8601)

### Issue: Comp-off not crediting
- Verify `compoff_credits` table exists
- Check `is_sunday` flag is set correctly in `attendance_summary`
- Verify overtime minutes calculation

### Issue: Performance scores not calculating
- Ensure `attendance_summary` has all records for the month
- Check `performance_metrics` table has data
- Verify `performance_leaderboard` view is working

### Issue: CSV export not downloading
- Check browser allows downloads
- Verify CSV generation completes without errors
- Check file size is reasonable

## Testing

### Test Daily Attendance
```typescript
// Create test punch records
const testData = {
  user_id: "test-user",
  date: "2024-01-15",
  punch_in_time: "2024-01-15T10:45:00Z", // Late by 15 minutes
  punch_out_time: "2024-01-15T18:50:00Z", // Overtime by 5 minutes
};

const result = await AttendanceCalculationService.calculateAttendance(testData);
console.log(result);
// Expected: is_late=true, late_minutes=15, is_overtime=true, overtime_minutes=5
```

### Test Performance Calculation
```typescript
const metrics = await PerformanceService.calculateMonthlyMetrics("test-user", 1, 2024);
console.log(metrics);
// Expected: punctuality_score, consistency_score, overall_score
```

## Next Steps

1. Run the SQL migration
2. Implement the three services
3. Add the admin screen to navigation
4. Set up daily processing job
5. Set up monthly performance calculation
6. Test with sample data
7. Deploy to production

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review the service documentation
3. Check database views are working
4. Verify all tables have data
