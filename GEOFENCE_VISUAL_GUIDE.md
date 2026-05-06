# 🎨 Smart Geofence Violation Engine - Visual Guide

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    EMPLOYEE CHECK-IN                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              GPS Location Captured                               │
│         (Latitude, Longitude, Timestamp)                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Calculate Distance to Nearest Office                     │
│              (Haversine Formula)                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─────────┴─────────┐
                    ↓                   ↓
        ┌──────────────────┐  ┌──────────────────┐
        │  ≤ 200m          │  │  > 200m          │
        │  SAFE ZONE       │  │  CHECK DISTANCE  │
        └──────────────────┘  └──────────────────┘
                    ↓                   ↓
            ✅ ALLOW CHECK-IN    ┌─────────┴─────────┐
            ✅ NO VIOLATION      ↓                   ↓
            ✅ NO ALERT      ┌──────────────┐  ┌──────────────┐
                             │ 200-400m     │  │ > 400m       │
                             │ WARNING ZONE │  │ VIOLATION    │
                             └──────────────┘  └──────────────┘
                                    ↓                   ↓
                            ✅ ALLOW CHECK-IN    ❌ BLOCK CHECK-IN
                            ⚠️ RECORD VIOLATION  🚨 RECORD VIOLATION
                            ⚠️ NOTIFY MANAGER    🚨 NOTIFY MANAGER
                            ⚠️ SOFT WARNING      🚨 HARD VIOLATION
                                    ↓                   ↓
                                    └─────────┬─────────┘
                                              ↓
                        ┌─────────────────────────────────────┐
                        │  Update Compliance Status           │
                        │  - Count weekly violations          │
                        │  - Calculate compliance score       │
                        │  - Check non-compliance threshold   │
                        └─────────────────────────────────────┘
                                              ↓
                        ┌─────────────────────────────────────┐
                        │  Check if Non-Compliant             │
                        │  (3+ violations in week)            │
                        └─────────────────────────────────────┘
                                              ↓
                                    ┌─────────┴─────────┐
                                    ↓                   ↓
                            ┌──────────────┐  ┌──────────────┐
                            │ YES          │  │ NO           │
                            │ NON-COMPLIANT│  │ COMPLIANT    │
                            └──────────────┘  └──────────────┘
                                    ↓                   ↓
                        ┌──────────────────┐  ┌──────────────┐
                        │ Apply -20 Point  │  │ No Penalty   │
                        │ Performance      │  │              │
                        │ Penalty          │  │              │
                        └──────────────────┘  └──────────────┘
                                    ↓                   ↓
                                    └─────────┬─────────┘
                                              ↓
                        ┌─────────────────────────────────────┐
                        │  Update Performance Metrics         │
                        │  - Compliance Score                 │
                        │  - Compliance Penalty               │
                        │  - Adjusted Overall Score           │
                        └─────────────────────────────────────┘
```

---

## Geofence Zones Visualization

```
                    OFFICE LOCATION
                          ⭐
                          
        ┌─────────────────────────────────────┐
        │                                     │
        │      SAFE ZONE (0-200m)             │
        │      ✅ No Violation                │
        │      ✅ Check-in Allowed            │
        │      ✅ No Alert                    │
        │                                     │
        │    ┌─────────────────────────┐      │
        │    │                         │      │
        │    │   OFFICE BUILDING       │      │
        │    │                         │      │
        │    └─────────────────────────┘      │
        │                                     │
        └─────────────────────────────────────┘
                      ↓ 200m
        ┌─────────────────────────────────────┐
        │                                     │
        │   WARNING ZONE (200-400m)           │
        │   ⚠️ Soft Warning                   │
        │   ✅ Check-in Allowed               │
        │   ⚠️ Manager Notified               │
        │   ⚠️ Violation Recorded             │
        │                                     │
        └─────────────────────────────────────┘
                      ↓ 400m
        ┌─────────────────────────────────────┐
        │                                     │
        │   VIOLATION ZONE (>400m)            │
        │   🚨 Hard Violation                 │
        │   ❌ Check-in BLOCKED               │
        │   🚨 Manager Notified               │
        │   🚨 Violation Flagged              │
        │                                     │
        └─────────────────────────────────────┘
```

---

## Compliance Status Progression

```
WEEK 1
├─ Day 1: 1st Violation → Status: WARNING (Score: 90)
├─ Day 3: 2nd Violation → Status: WARNING (Score: 80)
└─ Day 5: 3rd Violation → Status: NON-COMPLIANT (Score: 70)
                          Performance Penalty: -20 points

WEEK 2
├─ Day 1: 4th Violation → Status: NON-COMPLIANT (Score: 60)
├─ Day 3: 5th Violation → Status: NON-COMPLIANT (Score: 50)
└─ Day 5: No Violation → Status: NON-COMPLIANT (Score: 50)

WEEK 3 (Violations reset)
├─ Day 1: 1st Violation → Status: WARNING (Score: 90)
├─ Day 3: No Violation → Status: WARNING (Score: 90)
└─ Day 5: No Violation → Status: COMPLIANT (Score: 100)
                         Performance Penalty: 0 points
```

---

## Performance Score Impact

```
SCENARIO 1: Compliant Employee
┌─────────────────────────────────────┐
│ Punctuality Score:        80        │
│ Consistency Score:        85        │
│ Working Hours Score:      90        │
│ Base Score = (80×0.5) + (85×0.3) + (90×0.2) = 83.5
│ Compliance Status:        COMPLIANT │
│ Compliance Penalty:       0         │
│ ─────────────────────────────────── │
│ FINAL SCORE:              83.5 ✅   │
└─────────────────────────────────────┘

SCENARIO 2: Non-Compliant Employee
┌─────────────────────────────────────┐
│ Punctuality Score:        80        │
│ Consistency Score:        85        │
│ Working Hours Score:      90        │
│ Base Score = (80×0.5) + (85×0.3) + (90×0.2) = 83.5
│ Compliance Status:        NON-COMPLIANT
│ Compliance Penalty:       -20       │
│ ─────────────────────────────────── │
│ FINAL SCORE:              63.5 ⬇️   │
└─────────────────────────────────────┘
```

---

## Database Schema Diagram

```
┌──────────────────────────────────────┐
│      geofence_violations             │
├──────────────────────────────────────┤
│ id (UUID, PK)                        │
│ user_id (FK → profiles)              │
│ office_id (FK → offices)             │
│ office_name (TEXT)                   │
│ distance_meters (INTEGER)            │
│ violation_type (safe|warning|viol)   │
│ checkin_time (TIMESTAMP)             │
│ date (DATE)                          │
│ flagged (BOOLEAN)                    │
│ manager_notified (BOOLEAN)           │
│ created_at, updated_at               │
└──────────────────────────────────────┘
         ↓ (user_id)
┌──────────────────────────────────────┐
│      compliance_status               │
├──────────────────────────────────────┤
│ id (UUID, PK)                        │
│ user_id (FK → profiles, UNIQUE)      │
│ is_compliant (BOOLEAN)               │
│ violations_this_week (INTEGER)       │
│ violations_this_month (INTEGER)      │
│ total_violations (INTEGER)           │
│ compliance_score (0-100)             │
│ last_violation_date (DATE)           │
│ non_compliant_since (TIMESTAMP)      │
│ status (compliant|warning|non_comp)  │
│ created_at, updated_at               │
└──────────────────────────────────────┘
         ↓ (user_id)
┌──────────────────────────────────────┐
│      profiles                        │
├──────────────────────────────────────┤
│ id (UUID, PK)                        │
│ name (TEXT)                          │
│ email (TEXT)                         │
│ reporting_manager_id (FK)            │
│ office_id (FK → offices)             │
│ ...                                  │
└──────────────────────────────────────┘
         ↓ (office_id)
┌──────────────────────────────────────┐
│      offices                         │
├──────────────────────────────────────┤
│ id (UUID, PK)                        │
│ name (TEXT)                          │
│ latitude (NUMERIC)                   │
│ longitude (NUMERIC)                  │
│ attendance_radius (INTEGER)          │
│ ...                                  │
└──────────────────────────────────────┘
```

---

## Admin Dashboard Layout

```
┌─────────────────────────────────────────────────────────────┐
│  🚨 GEOFENCE COMPLIANCE                                     │
│  Monitor employee location compliance                       │
└─────────────────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────┐
│ Compliance Rate  │  │  Avg Score       │
│      90%         │  │      92           │
│ 45 of 50 OK      │  │  Out of 100      │
└──────────────────┘  └──────────────────┘

┌──────────────────┐  ┌──────────────────┐
│ This Week        │  │ This Month       │
│      8           │  │      25          │
│  Violations      │  │  Violations      │
└──────────────────┘  └──────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STATUS BREAKDOWN                                            │
│ ✅ Compliant: 45    ⚠️ Warning: 3    🚨 Non-Compliant: 2   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ FILTER: [All] [Warning] [Non-Compliant]                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ EMPLOYEE LIST                                               │
├─────────────────────────────────────────────────────────────┤
│ 🚨 John Doe (EMP001) • Mumbai Office                        │
│    This Week: 3 violations  This Month: 8  Score: 60       │
├─────────────────────────────────────────────────────────────┤
│ ⚠️ Jane Smith (EMP002) • Delhi Office                       │
│    This Week: 1 violation   This Month: 2  Score: 90       │
├─────────────────────────────────────────────────────────────┤
│ ⚠️ Bob Wilson (EMP003) • Bangalore Office                   │
│    This Week: 2 violations  This Month: 5  Score: 80       │
└─────────────────────────────────────────────────────────────┘
```

---

## Manager Notification Examples

```
SAFE ZONE (≤200m)
┌─────────────────────────────────────┐
│ ✅ No Notification Sent              │
└─────────────────────────────────────┘

WARNING ZONE (200-400m)
┌─────────────────────────────────────┐
│ ⚠️ GEOFENCE WARNING                  │
│                                     │
│ John Doe checked in 300m away from  │
│ Mumbai Office (Warning Zone)        │
│                                     │
│ [View Details] [Dismiss]            │
└─────────────────────────────────────┘

VIOLATION ZONE (>400m)
┌─────────────────────────────────────┐
│ 🚨 GEOFENCE VIOLATION                │
│                                     │
│ John Doe checked in 500m away from  │
│ Mumbai Office (VIOLATION)           │
│                                     │
│ [View Details] [Take Action]        │
└─────────────────────────────────────┘
```

---

## Compliance Score Calculation

```
FORMULA:
Compliance Score = 100 - (Total Violations × 10)

EXAMPLES:
0 violations  → 100 - (0 × 10) = 100 ✅ COMPLIANT
1 violation   → 100 - (1 × 10) = 90  ⚠️ WARNING
2 violations  → 100 - (2 × 10) = 80  ⚠️ WARNING
3 violations  → 100 - (3 × 10) = 70  🚨 NON-COMPLIANT
4 violations  → 100 - (4 × 10) = 60  🚨 NON-COMPLIANT
5+ violations → 100 - (5+ × 10) = 50 or less 🚨 NON-COMPLIANT
```

---

## Performance Score Calculation

```
FORMULA:
Final Score = Base Score - Compliance Penalty

WHERE:
Base Score = (Punctuality × 0.5) + (Consistency × 0.3) + (Hours × 0.2)
Compliance Penalty = 0 (if compliant) or 20 (if non-compliant)

EXAMPLE:
Punctuality Score:    80
Consistency Score:    85
Working Hours Score:  90

Base Score = (80 × 0.5) + (85 × 0.3) + (90 × 0.2)
           = 40 + 25.5 + 18
           = 83.5

IF COMPLIANT:
Final Score = 83.5 - 0 = 83.5 ✅

IF NON-COMPLIANT:
Final Score = 83.5 - 20 = 63.5 ⬇️
```

---

## Data Flow Diagram

```
┌──────────────────┐
│  Employee        │
│  Check-in        │
└────────┬─────────┘
         ↓
┌──────────────────────────────────────┐
│  GeofenceViolationService            │
│  .recordViolation()                  │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│  geofence_violations Table           │
│  (Insert violation record)           │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│  GeofenceViolationService            │
│  .updateComplianceStatus()           │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│  compliance_status Table             │
│  (Update compliance metrics)         │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│  PerformanceService                  │
│  .calculateMonthlyMetrics()          │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│  performance_metrics Table           │
│  (Update with compliance penalty)    │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│  Manager Notification                │
│  (Alert sent to reporting manager)   │
└──────────────────────────────────────┘
```

---

## Testing Workflow

```
TEST 1: SAFE ZONE
Employee at 150m
    ↓
Check-in Initiated
    ↓
✅ Check-in Allowed
✅ No Violation Recorded
✅ No Manager Alert
    ↓
PASS ✅

TEST 2: WARNING ZONE
Employee at 300m
    ↓
Check-in Initiated
    ↓
✅ Check-in Allowed
✅ Violation Recorded (type: warning)
✅ Manager Alert Sent (⚠️)
    ↓
PASS ✅

TEST 3: VIOLATION ZONE
Employee at 500m
    ↓
Check-in Initiated
    ↓
❌ Check-in Blocked
✅ Violation Recorded (type: violation)
✅ Violation Flagged
✅ Manager Alert Sent (🚨)
    ↓
PASS ✅

TEST 4: NON-COMPLIANCE THRESHOLD
Employee has 2 violations
    ↓
3rd Violation Occurs
    ↓
✅ Status Changes to NON-COMPLIANT
✅ Compliance Score Drops to 70
✅ Performance Score Reduced by 20
    ↓
PASS ✅

TEST 5: ADMIN DASHBOARD
Navigate to Admin → Geofence Compliance
    ↓
✅ Analytics Cards Display Correct Data
✅ Filter Tabs Work
✅ Employee List Shows Violations
✅ Compliance Scores Accurate
    ↓
PASS ✅
```

---

## Integration Points

```
┌─────────────────────────────────────────────────────────────┐
│                    HRMS SYSTEM                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Attendance System                                   │  │
│  │  ├─ Check-in/Check-out                              │  │
│  │  ├─ Geofence Violation Detection ← NEW              │  │
│  │  └─ Attendance Logging                              │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Geofence Violation Engine ← NEW                     │  │
│  │  ├─ Violation Recording                              │  │
│  │  ├─ Compliance Scoring                               │  │
│  │  ├─ Manager Notifications                            │  │
│  │  └─ Analytics                                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Performance System                                  │  │
│  │  ├─ Performance Metrics                              │  │
│  │  ├─ Compliance Penalty ← NEW                         │  │
│  │  ├─ Leaderboards                                     │  │
│  │  └─ Performance Reports                              │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Admin Dashboard                                     │  │
│  │  ├─ Geofence Compliance Screen ← NEW                │  │
│  │  ├─ Compliance Analytics                             │  │
│  │  ├─ Non-Compliant Employees                          │  │
│  │  └─ Violation Reports                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

**Visual Guide Complete** ✅
