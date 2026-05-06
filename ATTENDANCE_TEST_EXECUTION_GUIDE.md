# 🧪 Attendance System - Test Execution Guide

## Test Overview

This guide walks you through testing the complete attendance system with 10 scenarios covering all features.

---

## 📋 Pre-Test Checklist

Before running tests, verify:
- [ ] Database migration completed (`attendance_enhancements.sql`)
- [ ] All tables created
- [ ] All views created
- [ ] Services copied to project
- [ ] UI screen added to navigation
- [ ] At least 6 employees in `profiles` table
- [ ] At least 1 office in `offices` table

---

## 🧪 Test Execution Steps

### STEP 1: Load Test Data (5 minutes)

**Action**: Run all INSERT statements from `scripts/attendance_test_data.sql`

```sql
-- Copy and run the INSERT statements section
-- This creates 10 test scenarios
```

**Expected Result**: 
- ✅ 3 attendance logs inserted (scenarios 1-3)
- ✅ 1 on-duty event created (scenario 6)
- ✅ 1 leave created (scenario 7)
- ✅ 2 comp-off credits created (scenarios 8-9)
- ✅ 1 comp-off usage created (scenario 10)

**Verification Query**:
```sql
SELECT COUNT(*) as total_records FROM attendance_logs;
-- Expected: 3 or more records
```

---

### STEP 2: Verify Test Data (5 minutes)

**Action**: Run verification queries to see the data

#### Query 1: Attendance Logs
```sql
SELECT 
  p.name,
  al.date,
  al.checkin_time,
  al.checkout_time,
  al.status
FROM attendance_logs al
LEFT JOIN profiles p ON al.user_id = p.id
ORDER BY al.date DESC, al.checkin_time DESC;
```

**Expected Result**:
| name | date | checkin_time | checkout_time | status |
|------|------|--------------|---------------|--------|
| Employee 1 | 2024-01-15 | 10:45 | 18:30 | CHECKED_OUT |
| Employee 2 | 2024-01-15 | 10:30 | 19:00 | CHECKED_OUT |
| Employee 3 | 2024-01-15 | 11:00 | 19:30 | CHECKED_OUT |

#### Query 2: On-Duty Events
```sql
SELECT 
  p.name,
  ode.event_date,
  ode.event_name,
  ode.event_type,
  ode.status
FROM on_duty_events ode
LEFT JOIN profiles p ON ode.user_id = p.id
ORDER BY ode.event_date DESC;
```

**Expected Result**:
| name | event_date | event_name | event_type | status |
|------|-----------|-----------|-----------|--------|
| Employee 5 | 2024-01-15 | Client Meeting - ABC Corp | client_visit | approved |

#### Query 3: Leaves
```sql
SELECT 
  p.name,
  l.start_date,
  l.end_date,
  l.type,
  l.status
FROM leaves l
LEFT JOIN profiles p ON l.user_id = p.id
ORDER BY l.start_date DESC;
```

**Expected Result**:
| name | start_date | end_date | type | status |
|------|-----------|----------|------|--------|
| Employee 6 | 2024-01-15 | 2024-01-15 | casual | approved |

#### Query 4: Comp-Off Credits
```sql
SELECT 
  p.name,
  cc.credit_date,
  cc.reason,
  cc.compoff_days,
  cc.status
FROM compoff_credits cc
LEFT JOIN profiles p ON cc.user_id = p.id
ORDER BY cc.credit_date DESC;
```

**Expected Result**:
| name | credit_date | reason | compoff_days | status |
|------|------------|--------|-------------|--------|
| Employee 3 | 2024-01-15 | overtime | 1 | active |
| Employee 4 | 2024-01-14 | sunday_work | 1 | active |

#### Query 5: Comp-Off Usage
```sql
SELECT 
  p.name,
  cu.usage_date,
  cc.reason,
  cu.compoff_days_used
FROM compoff_usage cu
LEFT JOIN profiles p ON cu.user_id = p.id
LEFT JOIN compoff_credits cc ON cu.compoff_credit_id = cc.id
ORDER BY cu.usage_date DESC;
```

**Expected Result**:
| name | usage_date | reason | compoff_days_used |
|------|-----------|--------|------------------|
| Employee 4 | 2024-01-15 | sunday_work | 1 |

---

### STEP 3: Test Late Detection (5 minutes)

**Action**: Run late detection test query

```sql
SELECT 
  p.name,
  al.date,
  al.checkin_time,
  EXTRACT(HOUR FROM al.checkin_time) as hour,
  EXTRACT(MINUTE FROM al.checkin_time) as minute,
  CASE 
    WHEN EXTRACT(HOUR FROM al.checkin_time) > 10 OR 
         (EXTRACT(HOUR FROM al.checkin_time) = 10 AND EXTRACT(MINUTE FROM al.checkin_time) > 35)
    THEN 'LATE'
    ELSE 'ON TIME'
  END as expected_status
FROM attendance_logs al
LEFT JOIN profiles p ON al.user_id = p.id
WHERE al.date = CURRENT_DATE;
```

**Expected Results**:
- ✅ Employee 1: 10:45 → LATE (15 minutes late)
- ✅ Employee 2: 10:30 → ON TIME
- ✅ Employee 3: 11:00 → LATE (30 minutes late)

**Verification**: 
- [ ] Scenario 1 shows LATE
- [ ] Scenario 2 shows ON TIME
- [ ] Scenario 3 shows LATE

---

### STEP 4: Test Overtime Detection (5 minutes)

**Action**: Run overtime detection test query

```sql
SELECT 
  p.name,
  al.date,
  al.checkout_time,
  EXTRACT(HOUR FROM al.checkout_time) as hour,
  EXTRACT(MINUTE FROM al.checkout_time) as minute,
  CASE 
    WHEN EXTRACT(HOUR FROM al.checkout_time) > 18 OR 
         (EXTRACT(HOUR FROM al.checkout_time) = 18 AND EXTRACT(MINUTE FROM al.checkout_time) > 45)
    THEN 'OVERTIME'
    ELSE 'NO OVERTIME'
  END as expected_status
FROM attendance_logs al
LEFT JOIN profiles p ON al.user_id = p.id
WHERE al.date = CURRENT_DATE;
```

**Expected Results**:
- ✅ Employee 1: 18:30 → NO OVERTIME
- ✅ Employee 2: 19:00 → OVERTIME (30 minutes)
- ✅ Employee 3: 19:30 → OVERTIME (60 minutes)

**Verification**:
- [ ] Scenario 1 shows NO OVERTIME
- [ ] Scenario 2 shows OVERTIME
- [ ] Scenario 3 shows OVERTIME

---

### STEP 5: Test Working Hours Calculation (5 minutes)

**Action**: Run working hours calculation query

```sql
SELECT 
  p.name,
  al.date,
  al.checkin_time,
  al.checkout_time,
  ROUND(EXTRACT(EPOCH FROM (al.checkout_time - al.checkin_time)) / 3600, 2) as working_hours
FROM attendance_logs al
LEFT JOIN profiles p ON al.user_id = p.id
WHERE al.date = CURRENT_DATE
AND al.checkout_time IS NOT NULL;
```

**Expected Results**:
- ✅ Employee 1: 10:45 to 18:30 = ~7.75 hours
- ✅ Employee 2: 10:30 to 19:00 = ~8.5 hours
- ✅ Employee 3: 11:00 to 19:30 = ~8.5 hours

**Verification**:
- [ ] All working hours calculated correctly
- [ ] Values are reasonable (7-9 hours)

---

### STEP 6: Test Sunday Detection (5 minutes)

**Action**: Run Sunday detection query

```sql
SELECT 
  p.name,
  al.date,
  EXTRACT(DOW FROM al.date) as day_of_week,
  CASE 
    WHEN EXTRACT(DOW FROM al.date) = 0 THEN 'SUNDAY'
    ELSE 'NOT SUNDAY'
  END as day_name
FROM attendance_logs al
LEFT JOIN profiles p ON al.user_id = p.id;
```

**Expected Results**:
- ✅ Scenario 5 (Employee 4): day_of_week = 0 → SUNDAY

**Verification**:
- [ ] Sunday work detected correctly
- [ ] day_of_week = 0 for Sunday

---

### STEP 7: Test Comp-Off Balance (5 minutes)

**Action**: Run comp-off balance query

```sql
SELECT 
  p.name,
  COALESCE(SUM(CASE WHEN cc.status = 'active' THEN cc.compoff_days ELSE 0 END), 0) as total_credits,
  COALESCE(SUM(cu.compoff_days_used), 0) as total_used,
  COALESCE(SUM(CASE WHEN cc.status = 'active' THEN cc.compoff_days ELSE 0 END), 0) - 
  COALESCE(SUM(cu.compoff_days_used), 0) as available_balance
FROM profiles p
LEFT JOIN compoff_credits cc ON p.id = cc.user_id
LEFT JOIN compoff_usage cu ON p.id = cu.user_id
GROUP BY p.id, p.name
ORDER BY p.name;
```

**Expected Results**:
- ✅ Employee 3: total_credits=1, total_used=0, available_balance=1
- ✅ Employee 4: total_credits=1, total_used=1, available_balance=0

**Verification**:
- [ ] Comp-off credits tracked correctly
- [ ] Comp-off usage deducted correctly
- [ ] Balance calculated correctly

---

### STEP 8: Test Views (5 minutes)

#### View 1: admin_attendance_export
```sql
SELECT * FROM admin_attendance_export
WHERE date = CURRENT_DATE
ORDER BY employee_name;
```

**Expected**: 3+ records with all attendance data

#### View 2: performance_leaderboard
```sql
SELECT * FROM performance_leaderboard
WHERE month = EXTRACT(MONTH FROM CURRENT_DATE)
AND year = EXTRACT(YEAR FROM CURRENT_DATE)
ORDER BY rank
LIMIT 3;
```

**Expected**: Top 3 performers (may be empty if no performance data yet)

#### View 3: monthly_attendance_report
```sql
SELECT * FROM monthly_attendance_report
WHERE month = EXTRACT(MONTH FROM CURRENT_DATE)
AND year = EXTRACT(YEAR FROM CURRENT_DATE)
ORDER BY employee_name;
```

**Expected**: Monthly summary for all employees

**Verification**:
- [ ] admin_attendance_export returns data
- [ ] performance_leaderboard view works
- [ ] monthly_attendance_report view works

---

### STEP 9: Test Services (10 minutes)

#### Test 9.1: Attendance Calculation Service

```typescript
import { AttendanceCalculationService } from "@/services/attendance-calculation.service";

// Test 1: Calculate attendance for today
const attendance = await AttendanceCalculationService.calculateAttendance({
  user_id: "test-user-id",
  date: "2024-01-15",
  punch_in_time: "2024-01-15T10:45:00Z",
  punch_out_time: "2024-01-15T18:50:00Z",
});

console.log("Attendance Calculation Result:");
console.log("is_late:", attendance.is_late); // Expected: true
console.log("late_minutes:", attendance.late_minutes); // Expected: 15
console.log("is_overtime:", attendance.is_overtime); // Expected: true
console.log("overtime_minutes:", attendance.overtime_minutes); // Expected: 20
console.log("working_hours:", attendance.working_hours); // Expected: ~8.08
console.log("status:", attendance.status); // Expected: "late"
```

**Expected Output**:
```
Attendance Calculation Result:
is_late: true
late_minutes: 15
is_overtime: true
overtime_minutes: 20
working_hours: 8.08
status: late
```

**Verification**:
- [ ] is_late = true
- [ ] late_minutes = 15
- [ ] is_overtime = true
- [ ] overtime_minutes = 20
- [ ] status = "late"

#### Test 9.2: Process Attendance Range

```typescript
// Test 2: Process attendance for date range
const result = await AttendanceCalculationService.processAttendanceRange(
  "2024-01-15",
  "2024-01-15"
);

console.log("Processing Result:");
console.log("Processed records:", result.processed); // Expected: 3+
```

**Expected Output**:
```
Processing Result:
Processed records: 3
```

**Verification**:
- [ ] Records processed successfully
- [ ] processed > 0

#### Test 9.3: Comp-Off Balance

```typescript
// Test 3: Get comp-off balance
const balance = await AttendanceCalculationService.getCompOffBalance("employee-4-id");

console.log("Comp-Off Balance:", balance); // Expected: 0 (1 credited, 1 used)
```

**Expected Output**:
```
Comp-Off Balance: 0
```

**Verification**:
- [ ] Balance calculated correctly

---

### STEP 10: Test Performance Service (10 minutes)

#### Test 10.1: Calculate Monthly Metrics

```typescript
import { PerformanceService } from "@/services/performance.service";

const metrics = await PerformanceService.calculateMonthlyMetrics(
  "employee-1-id",
  1, // January
  2024
);

console.log("Performance Metrics:");
console.log("present_days:", metrics.present_days);
console.log("late_days:", metrics.late_days);
console.log("absent_days:", metrics.absent_days);
console.log("punctuality_score:", metrics.punctuality_score);
console.log("consistency_score:", metrics.consistency_score);
```

**Expected Output**:
```
Performance Metrics:
present_days: 1
late_days: 1
absent_days: 0
punctuality_score: 50
consistency_score: 50
```

**Verification**:
- [ ] Metrics calculated
- [ ] Scores are between 0-100

#### Test 10.2: Get Top Performers

```typescript
const topPerformers = await PerformanceService.getTopPerformers(1, 2024);

console.log("Top Performers:", topPerformers.length); // Expected: 0-3
topPerformers.forEach((p, idx) => {
  console.log(`${idx + 1}. ${p.employee_name} - Score: ${p.overall_score}`);
});
```

**Expected Output**:
```
Top Performers: 0
(May be empty if no performance data calculated yet)
```

**Verification**:
- [ ] Top performers retrieved
- [ ] Scores calculated

---

### STEP 11: Test Report Service (10 minutes)

#### Test 11.1: Get Daily Report

```typescript
import { AttendanceReportService } from "@/services/attendance-report.service";

const records = await AttendanceReportService.getDailyReport("2024-01-15");

console.log("Daily Report Records:", records.length); // Expected: 3+
records.forEach(r => {
  console.log(`${r.employee_name}: ${r.punch_in_time} - ${r.punch_out_time}`);
});
```

**Expected Output**:
```
Daily Report Records: 3
Employee 1: 10:45 - 18:30
Employee 2: 10:30 - 19:00
Employee 3: 11:00 - 19:30
```

**Verification**:
- [ ] Records returned
- [ ] Data formatted correctly

#### Test 11.2: Generate CSV

```typescript
const csv = await AttendanceReportService.generateDailyCSV("2024-01-15");

console.log("CSV Generated:");
console.log("Size:", csv.length, "bytes");
console.log("First 200 chars:", csv.substring(0, 200));
```

**Expected Output**:
```
CSV Generated:
Size: 500+ bytes
First 200 chars: "Date","Employee Name","Employee ID",...
```

**Verification**:
- [ ] CSV generated
- [ ] Has headers
- [ ] Has data rows

#### Test 11.3: Get Summary Statistics

```typescript
const stats = await AttendanceReportService.getSummaryStats(
  "2024-01-15",
  "2024-01-15"
);

console.log("Summary Statistics:");
console.log("present_count:", stats.present_count);
console.log("late_count:", stats.late_count);
console.log("absent_count:", stats.absent_count);
console.log("overtime_count:", stats.overtime_count);
console.log("total_working_hours:", stats.total_working_hours);
```

**Expected Output**:
```
Summary Statistics:
present_count: 3
late_count: 2
absent_count: 0
overtime_count: 2
total_working_hours: 24.33
```

**Verification**:
- [ ] Statistics calculated
- [ ] Numbers are reasonable

---

### STEP 12: Test UI Screen (10 minutes)

#### Test 12.1: Navigate to Screen

```bash
1. Run your app
2. Navigate to Admin section
3. Look for "Attendance Reports" option
4. Click to open screen
```

**Expected**:
- ✅ Screen loads without errors
- ✅ No console errors
- ✅ UI renders correctly

#### Test 12.2: Test Daily Report Tab

```bash
1. Click "Daily" tab
2. Select today's date
3. Click "Search"
4. Verify records display
5. Click "Export as CSV"
6. Verify download
```

**Expected**:
- ✅ Records display
- ✅ CSV downloads
- ✅ No errors

#### Test 12.3: Test Weekly Report Tab

```bash
1. Click "Weekly" tab
2. Select date range (last 7 days)
3. Click "Search"
4. Verify records display
5. Check statistics
```

**Expected**:
- ✅ Records display
- ✅ Statistics show
- ✅ No errors

#### Test 12.4: Test Performance Tab

```bash
1. Click "Top Performers" tab
2. Verify leaderboard displays
3. Check scores
```

**Expected**:
- ✅ Leaderboard displays (or empty if no data)
- ✅ Scores visible
- ✅ No errors

---

## ✅ Test Results Summary

### Database Tests
- [ ] Test data loaded successfully
- [ ] Verification queries return expected data
- [ ] All tables have records

### Logic Tests
- [ ] Late detection works correctly
- [ ] Overtime detection works correctly
- [ ] Working hours calculated correctly
- [ ] Sunday detection works correctly
- [ ] Comp-off balance calculated correctly

### View Tests
- [ ] admin_attendance_export view works
- [ ] performance_leaderboard view works
- [ ] monthly_attendance_report view works

### Service Tests
- [ ] AttendanceCalculationService works
- [ ] PerformanceService works
- [ ] AttendanceReportService works

### UI Tests
- [ ] Screen loads without errors
- [ ] Daily report works
- [ ] Weekly report works
- [ ] Monthly report works
- [ ] CSV export works
- [ ] Performance leaderboard works

---

## 🐛 Troubleshooting

### Issue: Test data not inserting
**Solution**:
- Check if profiles table has at least 6 employees
- Check if offices table has at least 1 office
- Verify foreign key constraints
- Check for duplicate records

### Issue: Late detection not working
**Solution**:
- Verify punch_in_time is in correct format
- Check office start time is 10:30 AM
- Verify grace period is 5 minutes
- Check timezone handling

### Issue: Overtime not detecting
**Solution**:
- Verify punch_out_time is in correct format
- Check office end time is 6:30 PM
- Verify overtime threshold is 6:45 PM
- Check timezone handling

### Issue: Views returning no data
**Solution**:
- Verify attendance_summary table has data
- Run processAttendanceRange() first
- Check date filters
- Verify joins are working

### Issue: Services throwing errors
**Solution**:
- Check imports are correct
- Verify Supabase connection
- Check for TypeScript errors
- Review error messages in console

### Issue: UI screen not loading
**Solution**:
- Check navigation setup
- Verify imports
- Check for runtime errors
- Review console logs

---

## 📊 Expected Test Results

### All Tests Pass When:
✅ All 10 scenarios create test data
✅ Late detection identifies late arrivals
✅ Overtime detection identifies overtime
✅ Working hours calculated correctly
✅ Sunday work detected
✅ Comp-off balance correct
✅ Views return data
✅ Services execute without errors
✅ UI screen loads and displays data
✅ CSV export works

---

## 🎉 Test Complete!

When all tests pass, your attendance system is:
✅ Fully functional
✅ Ready for production
✅ All features working
✅ No errors

**Congratulations! Your attendance system is tested and ready! 🚀**

---

## 📝 Test Report Template

```
TEST EXECUTION REPORT
═════════════════════════════════════════════════════════════

Date: _______________
Tester: _______________
Environment: _______________

TEST RESULTS
────────────────────────────────────────────────────────────

Database Tests:        ☐ PASS  ☐ FAIL
Logic Tests:           ☐ PASS  ☐ FAIL
View Tests:            ☐ PASS  ☐ FAIL
Service Tests:         ☐ PASS  ☐ FAIL
UI Tests:              ☐ PASS  ☐ FAIL

OVERALL RESULT:        ☐ PASS  ☐ FAIL

Issues Found:
─────────────────────────────────────────────────────────────
1. _______________________________________________
2. _______________________________________________
3. _______________________________________________

Notes:
─────────────────────────────────────────────────────────────
_______________________________________________
_______________________________________________

Signed: _______________
```

---

**Ready to test? Start with STEP 1! 🧪**
