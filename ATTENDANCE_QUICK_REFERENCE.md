# Attendance System - Quick Reference & Implementation Checklist

## 📋 Implementation Checklist

### Phase 1: Database Setup
- [ ] Run `scripts/attendance_enhancements.sql` in Supabase
- [ ] Verify all new tables created:
  - [ ] `overtime_logs`
  - [ ] `compoff_credits`
  - [ ] `compoff_usage`
  - [ ] `on_duty_events`
  - [ ] `attendance_summary`
  - [ ] `performance_metrics`
- [ ] Verify views created:
  - [ ] `admin_attendance_export`
  - [ ] `performance_leaderboard`
  - [ ] `monthly_attendance_report`

### Phase 2: Service Implementation
- [ ] Copy `services/attendance-calculation.service.ts`
- [ ] Copy `services/performance.service.ts`
- [ ] Copy `services/attendance-report.service.ts`
- [ ] Verify imports in each service

### Phase 3: UI Implementation
- [ ] Copy `screens/admin/AttendanceReportingScreen.tsx`
- [ ] Add to `navigation/AdminStackNavigator.tsx`
- [ ] Test navigation

### Phase 4: Integration
- [ ] Hook up daily processing job
- [ ] Hook up monthly performance calculation
- [ ] Test with sample data

### Phase 5: Testing
- [ ] Test daily report generation
- [ ] Test weekly report generation
- [ ] Test monthly report generation
- [ ] Test CSV export
- [ ] Test performance leaderboard
- [ ] Test comp-off crediting
- [ ] Test comp-off usage

---

## 🔧 Quick Code Snippets

### 1. Process Attendance for a Date Range

```typescript
import { AttendanceCalculationService } from "@/services/attendance-calculation.service";

async function processAttendance() {
  try {
    const result = await AttendanceCalculationService.processAttendanceRange(
      "2024-01-01",
      "2024-01-31"
    );
    console.log(`Processed ${result.processed} records`);
  } catch (error) {
    console.error("Error:", error);
  }
}
```

### 2. Get Daily Report

```typescript
import { AttendanceReportService } from "@/services/attendance-report.service";

async function getDailyReport() {
  const records = await AttendanceReportService.getDailyReport(
    "2024-01-15",
    "office-id" // optional
  );
  console.log(`Found ${records.length} records`);
}
```

### 3. Export to CSV

```typescript
async function exportReport() {
  const csv = await AttendanceReportService.generateDailyCSV("2024-01-15");
  AttendanceReportService.downloadCSV(csv, "attendance_2024-01-15.csv");
}
```

### 4. Get Top Performers

```typescript
import { PerformanceService } from "@/services/performance.service";

async function getTopPerformers() {
  const performers = await PerformanceService.getTopPerformers(1, 2024);
  performers.forEach((p, idx) => {
    console.log(`${idx + 1}. ${p.employee_name} - Score: ${p.overall_score}`);
  });
}
```

### 5. Credit Comp-Off

```typescript
async function creditCompOff() {
  // Sunday work
  await AttendanceCalculationService.creditSundayCompOff(
    "user-id",
    "2024-01-14"
  );
  
  // Overtime (480 minutes = 8 hours)
  await AttendanceCalculationService.creditOvertimeCompOff(
    "user-id",
    "2024-01-15",
    480
  );
}
```

### 6. Use Comp-Off for Leave

```typescript
async function useCompOff() {
  const result = await AttendanceCalculationService.useCompOffForLeave(
    "user-id",
    "leave-id",
    1 // days to use
  );
  console.log(`Used ${result.used} days of comp-off`);
}
```

### 7. Get Comp-Off Balance

```typescript
async function getBalance() {
  const balance = await AttendanceCalculationService.getCompOffBalance("user-id");
  console.log(`Available comp-off: ${balance} days`);
}
```

### 8. Calculate Monthly Performance

```typescript
async function calculatePerformance() {
  const metrics = await PerformanceService.calculateMonthlyMetrics(
    "user-id",
    1, // month
    2024 // year
  );
  console.log(`Punctuality: ${metrics.punctuality_score}%`);
  console.log(`Consistency: ${metrics.consistency_score}%`);
}
```

### 9. Get Performance History

```typescript
async function getHistory() {
  const history = await PerformanceService.getEmployeePerformanceHistory(
    "user-id",
    6 // last 6 months
  );
  history.forEach((m) => {
    console.log(`${m.month}/${m.year}: ${m.punctuality_score}%`);
  });
}
```

### 10. Get Summary Statistics

```typescript
async function getStats() {
  const stats = await AttendanceReportService.getSummaryStats(
    "2024-01-01",
    "2024-01-31",
    "office-id" // optional
  );
  console.log(`Present: ${stats.present_count}`);
  console.log(`Late: ${stats.late_count}`);
  console.log(`Absent: ${stats.absent_count}`);
  console.log(`Avg Hours: ${stats.average_working_hours}`);
}
```

---

## 📊 Data Flow Diagram

```
Attendance Logs (punch in/out)
         ↓
AttendanceCalculationService.processAttendanceRange()
         ↓
attendance_summary (daily aggregation)
         ↓
PerformanceService.calculateAllMonthlyMetrics()
         ↓
performance_metrics (monthly scores)
         ↓
performance_leaderboard (ranked view)
         ↓
AttendanceReportingScreen (display)
         ↓
AttendanceReportService.generateCSV()
         ↓
CSV Download
```

---

## 🎯 Key Features Summary

### Late Detection
- **Threshold**: 10:30 AM + 5 minutes grace = 10:35 AM
- **Marked as**: `is_late = true`, `late_minutes = X`
- **Status**: "late"

### Overtime Tracking
- **Threshold**: 6:45 PM (18:45)
- **Calculation**: Minutes after 6:30 PM (18:30)
- **Marked as**: `is_overtime = true`, `overtime_minutes = X`
- **Comp-off**: 1 day per 8 hours overtime

### Comp-Off Management
- **Sunday Work**: 1 comp-off automatically credited
- **Overtime**: 1 comp-off per 8 hours
- **Holiday Work**: 1 comp-off per holiday
- **Usage**: Can be used to fill leaves
- **Audit**: Tracks which comp-off used for which leave

### On-Duty Events
- **Types**: Training, Conference, Client Visit, Company Event, Other
- **Status**: Pending → Approved → Completed
- **Effect**: Marked as "on_duty" in attendance
- **Approval**: By manager/admin

### Performance Scoring
- **Punctuality**: 100% if zero late marks (decreases with each late)
- **Consistency**: Based on attendance % and absences
- **Overall**: Weighted (50% punctuality, 30% consistency, 20% hours)
- **Ranking**: Top 3 performers displayed monthly

### Reports Available
1. **Daily**: Single day attendance
2. **Weekly**: 7-day range
3. **Monthly**: Full month
4. **Last Month**: Previous month
5. **This Month**: Current month
6. **Performance**: Top 3 performers leaderboard

---

## 🔐 Security Considerations

1. **RLS Disabled**: System uses custom auth, not Supabase Auth
2. **Access Control**: Implement in your app layer
3. **Audit Trail**: All changes logged in `audit_logs`
4. **Data Privacy**: Don't expose sensitive data in exports

---

## 📱 Mobile vs Web

### Mobile (React Native)
- Uses `expo-file-system` for file operations
- Uses `expo-sharing` for file sharing
- CSV download via share dialog

### Web (React)
- Uses Blob API for file creation
- Uses `<a>` tag for download
- Direct browser download

---

## 🚀 Performance Optimization

### Indexes Created
- `idx_attendance_summary_user_date` - Fast user-date lookups
- `idx_attendance_summary_status` - Fast status filtering
- `idx_performance_user_month` - Fast performance lookups
- `idx_compoff_user` - Fast comp-off balance queries

### Query Optimization
- Use date range filters
- Filter by office when possible
- Limit results for large datasets
- Use views for complex aggregations

---

## 🐛 Common Issues & Solutions

### Issue: Late detection not working
**Solution**: 
- Verify punch in time is in ISO 8601 format
- Check office start time is 10:30 AM
- Verify grace period is 5 minutes

### Issue: Comp-off not crediting
**Solution**:
- Check `is_sunday` flag in `attendance_summary`
- Verify `compoff_credits` table has records
- Check status is "active"

### Issue: Performance scores are 0
**Solution**:
- Ensure `attendance_summary` has data for the month
- Run `calculateAllMonthlyMetrics()` after processing attendance
- Check `performance_metrics` table has records

### Issue: CSV export is empty
**Solution**:
- Verify date range has data
- Check office filter is correct
- Ensure `admin_attendance_export` view is working

---

## 📞 Support Resources

1. **Database**: Check `MASTER_SETUP_FIXED.sql` for schema
2. **Services**: Check service files for detailed comments
3. **UI**: Check `AttendanceReportingScreen.tsx` for implementation
4. **Setup**: Check `ATTENDANCE_SYSTEM_SETUP.md` for full guide

---

## 🎓 Learning Path

1. Start with `AttendanceCalculationService` - understand core logic
2. Then `AttendanceReportService` - understand reporting
3. Then `PerformanceService` - understand scoring
4. Finally `AttendanceReportingScreen` - understand UI

---

## 📝 Notes

- All times are in ISO 8601 format (UTC)
- Dates are in YYYY-MM-DD format
- Decimal hours are used for calculations (e.g., 8.5 hours)
- Comp-off is tracked in days (can be fractional)
- Performance scores are 0-100

---

## 🔄 Workflow Example

```
1. Employee punches in at 10:45 AM
   → Late by 10 minutes
   → Status: "late"

2. Employee punches out at 6:50 PM
   → Overtime by 20 minutes
   → Status: "late" (late takes precedence)

3. System credits 0.04 comp-off (20 min / 480 min per day)

4. At month end, performance calculated:
   → Punctuality: 95% (1 late out of 20 days)
   → Consistency: 98% (19 present + 1 late out of 20)
   → Overall: 96.1% (weighted score)

5. Employee ranked in leaderboard

6. Admin exports monthly report with all metrics
```

---

## ✅ Verification Checklist

After implementation, verify:

- [ ] All tables exist in database
- [ ] All views are working
- [ ] Services can be imported without errors
- [ ] Screen renders without errors
- [ ] Daily report shows correct data
- [ ] Weekly report shows correct data
- [ ] Monthly report shows correct data
- [ ] CSV export downloads correctly
- [ ] Performance leaderboard shows top 3
- [ ] Comp-off crediting works
- [ ] Comp-off usage works
- [ ] Late detection works
- [ ] Overtime detection works
- [ ] On-duty events work
- [ ] Leave integration works

---

## 🎉 You're Ready!

Your attendance system is now complete with:
✅ Daily, weekly, monthly reporting
✅ Late & overtime detection
✅ Comp-off management
✅ On-duty event tracking
✅ Performance leaderboard
✅ CSV export
✅ Full audit trail

Start using it today!
