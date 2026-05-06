# 🚨 Smart Geofence Violation Engine - Implementation Guide

## Overview

The Smart Geofence Violation Engine transforms your HRMS from a passive tracking system to an **enforcement-driven control system** with rule-based geofence management, compliance scoring, and automatic performance impact.

**Status**: ✅ COMPLETE & PRODUCTION READY

---

## 🎯 Key Features

### 1. Rule-Based Geofence Zones

Three distinct zones with automatic enforcement:

```
SAFE ZONE (0-200m)
├─ No violation
├─ No notification
└─ No impact

WARNING ZONE (200-400m)
├─ Soft warning recorded
├─ Manager notified
├─ Employee can still check in
└─ Tracked for compliance

VIOLATION ZONE (>400m)
├─ Hard violation flagged
├─ Manager notified immediately
├─ Check-in BLOCKED
└─ Counts toward non-compliance
```

### 2. Compliance Scoring System

**Compliance Score**: 0-100 (100 = fully compliant)

- **Base Score**: 100
- **Penalty per Violation**: -10 points
- **Minimum Score**: 0

**Status Levels**:
- 🟢 **Compliant**: 0 violations this week
- 🟡 **Warning**: 1-2 violations this week
- 🔴 **Non-Compliant**: 3+ violations in a week

### 3. Automatic Performance Impact

When an employee becomes non-compliant:

```
Performance Score Calculation:
├─ Base Score = (Punctuality × 0.5) + (Consistency × 0.3) + (Hours × 0.2)
├─ Compliance Penalty = 20 points (for non-compliant status)
└─ Final Score = Base Score - Compliance Penalty
```

**Example**:
- Base Performance Score: 85
- Compliance Status: Non-Compliant (3 violations)
- Compliance Penalty: 20 points
- **Final Score: 65** ⬇️

### 4. Violation Tracking

Each violation records:
- Employee ID & Name
- Office Name & ID
- Distance from office (meters)
- Violation Type (safe/warning/violation)
- Check-in Time & Date
- Manager Notification Status
- Flagged Status

---

## 📊 Database Schema

### Tables Created

#### 1. `geofence_violations`
```sql
- id (UUID, PK)
- user_id (FK → profiles)
- office_id (FK → offices)
- office_name (TEXT)
- distance_meters (INTEGER)
- violation_type (safe|warning|violation)
- checkin_time (TIMESTAMP)
- date (DATE)
- flagged (BOOLEAN)
- manager_notified (BOOLEAN)
- created_at, updated_at
```

#### 2. `compliance_status`
```sql
- id (UUID, PK)
- user_id (FK → profiles, UNIQUE)
- is_compliant (BOOLEAN)
- violations_this_week (INTEGER)
- violations_this_month (INTEGER)
- total_violations (INTEGER)
- compliance_score (0-100)
- last_violation_date (DATE)
- non_compliant_since (TIMESTAMP)
- status (compliant|warning|non_compliant)
- created_at, updated_at
```

#### 3. Updated `attendance_logs`
```sql
- geofence_violation_type (safe|warning|violation)
```

#### 4. Updated `performance_metrics`
```sql
- compliance_score (0-100)
- compliance_penalty (NUMERIC)
- adjusted_overall_score (NUMERIC)
```

### Views Created

#### `compliance_dashboard`
Real-time compliance overview with employee details and violation counts.

#### `violation_analytics`
Weekly violation analytics grouped by office and violation type.

---

## 🔧 Configuration

Edit `GEOFENCE_CONFIG` in `geofence-violation.service.ts`:

```typescript
export const GEOFENCE_CONFIG = {
  SAFE_RADIUS: 200,                    // meters
  WARNING_RADIUS: 400,                 // meters
  VIOLATION_RADIUS: 400,               // meters
  VIOLATION_THRESHOLD_WEEKLY: 3,       // violations to mark non-compliant
  COMPLIANCE_PENALTY: 10,              // points per violation
  NON_COMPLIANT_PENALTY: 20,           // additional penalty for status
};
```

---

## 📱 Implementation Details

### Service: `GeofenceViolationService`

#### Core Methods

**1. Record Violation**
```typescript
await GeofenceViolationService.recordViolation(
  userId,
  officeId,
  officeName,
  distance,
  checkinTime
);
```
- Automatically determines violation type
- Records in database
- Updates compliance status
- Triggers manager notification

**2. Get Weekly Violations**
```typescript
const violations = await GeofenceViolationService.getWeeklyViolations(userId);
```
Returns all violations in past 7 days.

**3. Update Compliance Status**
```typescript
const status = await GeofenceViolationService.updateComplianceStatus(userId);
```
- Counts violations
- Calculates compliance score
- Updates status (compliant/warning/non_compliant)
- Triggers performance impact

**4. Get Compliance Status**
```typescript
const status = await GeofenceViolationService.getComplianceStatus(userId);
```
Returns current compliance status for employee.

**5. Notify Manager**
```typescript
await GeofenceViolationService.notifyManagerOfViolation(
  userId,
  officeName,
  distance,
  violationType
);
```
Sends appropriate notification based on violation type.

**6. Get Non-Compliant Employees**
```typescript
const employees = await GeofenceViolationService.getNonCompliantEmployees();
```
Returns all non-compliant employees with details.

**7. Get Compliance Analytics**
```typescript
const analytics = await GeofenceViolationService.getComplianceAnalytics();
```
Returns organization-wide compliance metrics.

---

## 🔄 Workflow

### Employee Check-in Flow

```
Employee Initiates Check-in
    ↓
GPS Location Captured
    ↓
Calculate Distance to Nearest Office
    ↓
Determine Violation Type
    ├─ Safe (≤200m) → Allow check-in
    ├─ Warning (200-400m) → Record + Notify + Allow check-in
    └─ Violation (>400m) → Record + Notify + BLOCK check-in
    ↓
Update Compliance Status
    ├─ Count weekly violations
    ├─ Calculate compliance score
    └─ Update status if threshold reached
    ↓
Impact Performance Score (if non-compliant)
    ├─ Apply -20 point penalty
    └─ Update performance metrics
```

### Manager Notification Flow

```
Violation Recorded
    ↓
Determine Notification Type
    ├─ Warning: "⚠️ Employee checked in 250m away"
    └─ Violation: "🚨 Employee checked in 500m away (VIOLATION)"
    ↓
Send to Manager
    ├─ Title: Geofence Warning/Violation
    ├─ Message: Details with distance
    └─ Metadata: Violation type, distance, office
    ↓
Mark as Notified
```

---

## 📊 Admin Dashboard

### Geofence Compliance Screen

**Location**: Admin Tab → Geofence Compliance

**Features**:

1. **Analytics Cards**
   - Compliance Rate (%)
   - Average Compliance Score
   - Violations This Week
   - Violations This Month

2. **Status Breakdown**
   - Compliant Employees
   - Warning Employees
   - Non-Compliant Employees

3. **Filter Tabs**
   - All Employees
   - Warning Status
   - Non-Compliant Status

4. **Employee List**
   - Employee Name & Number
   - Office Location
   - Violations This Week/Month
   - Compliance Score
   - Status Badge

---

## 🧪 Testing Guide

### Test 1: Safe Zone Check-in
```
1. Employee at 150m from office
2. Check-in initiated
3. Expected: ✅ Check-in allowed, no violation recorded
4. Verify: No notification sent to manager
```

### Test 2: Warning Zone Check-in
```
1. Employee at 300m from office
2. Check-in initiated
3. Expected: ✅ Check-in allowed, warning recorded
4. Verify: Manager receives ⚠️ warning notification
5. Verify: Violation recorded in database
```

### Test 3: Violation Zone Check-in
```
1. Employee at 500m from office
2. Check-in initiated
3. Expected: ❌ Check-in blocked with error
4. Verify: Manager receives 🚨 violation notification
5. Verify: Violation flagged in database
```

### Test 4: Non-Compliance Threshold
```
1. Employee has 2 violations this week
2. Third violation occurs
3. Expected: Status changes to "non_compliant"
4. Verify: Compliance score drops to 70
5. Verify: Performance score reduced by 20 points
```

### Test 5: Admin Dashboard
```
1. Navigate to Admin → Geofence Compliance
2. Expected: Analytics cards show correct counts
3. Filter by "Non-Compliant"
4. Expected: Only non-compliant employees shown
5. Verify: Compliance scores and violation counts accurate
```

---

## 📈 Metrics & Analytics

### Compliance Analytics

```typescript
{
  totalEmployees: 50,
  compliantEmployees: 45,
  warningEmployees: 3,
  nonCompliantEmployees: 2,
  complianceRate: 90,              // 45/50 = 90%
  averageComplianceScore: 92,      // Average of all scores
  totalViolationsThisWeek: 8,
  totalViolationsThisMonth: 25
}
```

### Violation Analytics View

```sql
SELECT
  week_start,
  office_name,
  violation_type,
  violation_count,
  affected_employees,
  avg_distance_meters,
  max_distance_meters
FROM violation_analytics
ORDER BY week_start DESC;
```

---

## 🔐 Security & Permissions

### Row-Level Security (RLS)

**geofence_violations**:
- Users can view their own violations
- Admins can view all violations

**compliance_status**:
- Users can view their own compliance
- Admins can view all compliance

### Audit Trail

All violations are automatically logged in `audit_logs` table with:
- Action: INSERT
- Table: geofence_violations
- Changed columns: user_id, office_name, distance_meters, violation_type, flagged
- Performed by: auth.uid()
- Timestamp: NOW()

---

## 🚀 Deployment Steps

### Step 1: Run Database Migration
```bash
# Execute the SQL script in Supabase
supabase/scripts/geofence_violation_schema.sql
```

### Step 2: Update Services
- ✅ `geofence-violation.service.ts` - Created
- ✅ `attendance.service.ts` - Updated
- ✅ `performance.service.ts` - Updated

### Step 3: Add Admin Screen
- ✅ `GeofenceComplianceScreen.tsx` - Created
- ✅ `AdminStackNavigator.tsx` - Updated

### Step 4: Test
```bash
npm install
npm run build
npm start
```

### Step 5: Deploy
```bash
npm run deploy
```

---

## 📋 Integration Checklist

- [x] Database schema created
- [x] Geofence violation service implemented
- [x] Attendance service updated with violation logic
- [x] Performance service updated with compliance penalty
- [x] Admin dashboard screen created
- [x] Navigation updated
- [x] RLS policies configured
- [x] Audit triggers created
- [x] Views created for analytics
- [x] Documentation complete

---

## 🔄 Maintenance

### Weekly Tasks
- Monitor compliance analytics
- Review non-compliant employees
- Check violation trends

### Monthly Tasks
- Calculate performance metrics with compliance penalties
- Generate compliance reports
- Review and adjust geofence radii if needed

### Cleanup
```typescript
// Clear violations older than 90 days
await GeofenceViolationService.clearOldViolations();
```

---

## 🎯 Key Improvements Over Previous System

| Aspect | Before | After |
|--------|--------|-------|
| **Tracking** | Passive (records only) | Enforcement-driven (rules + control) |
| **Zones** | Single radius | Three zones (safe/warning/violation) |
| **Violations** | Recorded but not enforced | Blocked at violation zone |
| **Compliance** | No tracking | Scored 0-100 with status levels |
| **Performance Impact** | None | -20 points for non-compliance |
| **Manager Alerts** | Generic warning | Specific violation type alerts |
| **Analytics** | Basic distance tracking | Comprehensive compliance dashboard |
| **Accountability** | Low | High (automatic enforcement) |

---

## 📞 Support & Troubleshooting

### Issue: Check-in blocked but employee is at office
**Solution**: Verify office GPS coordinates and attendance_radius in offices table.

### Issue: Violations not being recorded
**Solution**: Check that geofence_violations table exists and RLS policies allow inserts.

### Issue: Manager not receiving notifications
**Solution**: Verify reporting_manager_id is set in profiles table.

### Issue: Compliance score not updating
**Solution**: Ensure compliance_status table exists and updateComplianceStatus() is called after recording violation.

---

## 📚 Related Documentation

- [Attendance System](./ATTENDANCE_SYSTEM_COMPLETE.txt)
- [Performance Management](./PERFORMANCE_ADMIN_GUIDE.md)
- [Location Tracking](./LOCATION_COMPLIANCE_GUIDE.md)

---

**Version**: 1.0
**Status**: Production Ready ✅
**Last Updated**: Today
