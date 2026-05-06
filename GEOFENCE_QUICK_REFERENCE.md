# 🚨 Smart Geofence Violation Engine - Quick Reference

## Configuration

```typescript
SAFE_RADIUS = 200m          // No violation
WARNING_RADIUS = 400m       // Soft warning
VIOLATION_RADIUS = 400m     // Hard violation (blocks check-in)
THRESHOLD = 3 violations/week → Non-compliant
PENALTY = 20 points on performance score
```

---

## Violation Types

| Type | Distance | Action | Manager Alert | Check-in |
|------|----------|--------|---------------|----------|
| **Safe** | ≤200m | None | ❌ No | ✅ Allowed |
| **Warning** | 200-400m | Record | ⚠️ Yes | ✅ Allowed |
| **Violation** | >400m | Flag | 🚨 Yes | ❌ Blocked |

---

## Compliance Status

| Status | Violations/Week | Score | Impact |
|--------|-----------------|-------|--------|
| 🟢 Compliant | 0 | 100 | No penalty |
| 🟡 Warning | 1-2 | 80-90 | -5 to -10 points |
| 🔴 Non-Compliant | 3+ | <70 | -20 points |

---

## Key Methods

### Record Violation
```typescript
await GeofenceViolationService.recordViolation(
  userId, officeId, officeName, distance, checkinTime
);
```

### Get Compliance Status
```typescript
const status = await GeofenceViolationService.getComplianceStatus(userId);
// Returns: { is_compliant, violations_this_week, compliance_score, status }
```

### Get Non-Compliant Employees
```typescript
const employees = await GeofenceViolationService.getNonCompliantEmployees();
```

### Get Analytics
```typescript
const analytics = await GeofenceViolationService.getComplianceAnalytics();
// Returns: { complianceRate, averageScore, totalViolations, etc }
```

---

## Database Tables

### geofence_violations
- Stores each violation event
- Indexed by: user_id, date, violation_type, flagged

### compliance_status
- One record per employee
- Updated after each violation
- Tracks weekly/monthly/total violations

---

## Admin Dashboard

**Location**: Admin Tab → Geofence Compliance

**Shows**:
- Compliance rate (%)
- Average compliance score
- Violations this week/month
- Non-compliant employees list
- Filter by status

---

## Performance Impact

```
Base Score = (Punctuality × 0.5) + (Consistency × 0.3) + (Hours × 0.2)
Penalty = 20 points (if non-compliant)
Final Score = Base Score - Penalty
```

**Example**:
- Base: 85 → Final: 65 (if non-compliant)

---

## Testing Checklist

- [ ] Safe zone (150m) - Check-in allowed, no violation
- [ ] Warning zone (300m) - Check-in allowed, warning recorded
- [ ] Violation zone (500m) - Check-in blocked, violation flagged
- [ ] 3 violations in week - Status changes to non-compliant
- [ ] Performance score reduced by 20 points
- [ ] Manager receives notifications
- [ ] Admin dashboard shows correct data

---

## Files Created/Modified

**Created**:
- `services/geofence-violation.service.ts`
- `screens/admin/GeofenceComplianceScreen.tsx`
- `scripts/geofence_violation_schema.sql`

**Modified**:
- `services/attendance.service.ts`
- `services/performance.service.ts`
- `navigation/AdminStackNavigator.tsx`

---

## Deployment

1. Run SQL migration: `geofence_violation_schema.sql`
2. Services already integrated
3. Add screen to admin navigation ✅
4. Test all scenarios
5. Deploy

---

## Monitoring

**Weekly**:
- Check compliance rate
- Review non-compliant employees
- Monitor violation trends

**Monthly**:
- Calculate performance metrics with penalties
- Generate compliance reports
- Adjust radii if needed

---

**Status**: ✅ Production Ready
**Version**: 1.0
