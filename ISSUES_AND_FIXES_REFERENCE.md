# HRMS MIGRATION - ISSUES AND FIXES REFERENCE

## CRITICAL ISSUE #1: punch_timestamp Column Does Not Exist

### Original Code (BROKEN)
```sql
SELECT max(punch_timestamp)
FROM public.smartoffice_device_logs s
WHERE s.punch_timestamp > a.checkin_time + interval '5 minutes'
  AND (s.punch_timestamp at time zone 'Asia/Kolkata')::time <= time '20:30:00'
```

### Problem
- Column `punch_timestamp` does not exist in `smartoffice_device_logs`
- Actual column name is `log_date` (TIMESTAMPTZ)
- Function will fail with: `ERROR: column "punch_timestamp" does not exist`

### Fixed Code
```sql
SELECT max(log_date)
FROM public.smartoffice_device_logs s
WHERE s.log_date > a.checkin_time + interval '5 minutes'
  AND (s.log_date AT TIME ZONE 'Asia/Kolkata')::time <= time '20:30:00'
```

### Why This Works
- Uses correct column name `log_date`
- Maintains timezone conversion
- Maintains time comparison logic

---

## CRITICAL ISSUE #2: Date Comparison Without Timezone Conversion

### Original Code (BROKEN)
```sql
AND s.log_date = a.date
```

### Problem
- `s.log_date` is TIMESTAMPTZ (includes time component)
- `a.date` is DATE (no time component)
- Comparison will fail or produce incorrect results
- Example: 2026-09-26 10:30:00+05:30 ≠ 2026-09-26

### Fixed Code
```sql
AND (s.log_date AT TIME ZONE 'Asia/Kolkata')::date = a.date
```

### Why This Works
- Converts TIMESTAMPTZ to IST timezone first
- Extracts date component only
- Proper date comparison

---

## CRITICAL ISSUE #3: February 29 Birthday Calculation

### Original Code (BROKEN)
```sql
(date_of_birth + ((curr_year.y - extract(year FROM date_of_birth)::int) || ' years')::interval)::date AS birthday_this_year
```

### Problem
- For employee born 1990-02-29 in non-leap year (e.g., 2025):
  - Tries to create: 1990-02-29 + 35 years = 2025-02-29
  - But 2025 is not a leap year
  - PostgreSQL throws error or produces invalid date

### Fixed Code
```sql
CASE 
  WHEN extract(month FROM date_of_birth) = 2 AND extract(day FROM date_of_birth) = 29
    THEN make_date(curr_year.y, 2, 28)
  ELSE (date_of_birth + ((curr_year.y - extract(year FROM date_of_birth)::int) || ' years')::interval)::date
END AS birthday_this_year
```

### Why This Works
- Detects February 29 birthdays
- Uses February 28 in non-leap years
- Handles leap years correctly
- No errors or invalid dates

---

## CRITICAL ISSUE #4: Timezone Handling in Audit Summary

### Original Code (BROKEN)
```sql
'total_today', (SELECT count(*) FROM audit_logs WHERE performed_at >= current_date),
'total_week', (SELECT count(*) FROM audit_logs WHERE performed_at >= current_date - interval '7 days'),
```

### Problem
- `current_date` is in server timezone, not IST
- For India-based HRMS, "today" should be IST date
- Example: Server in UTC, IST is UTC+5:30
  - Server 2026-09-26 00:00 UTC = 2026-09-26 05:30 IST
  - `current_date` returns 2026-09-26 (UTC)
  - But IST "today" started at 2026-09-25 19:30 UTC
  - Audit summary includes records from wrong day

### Fixed Code
```sql
v_today_start := ((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamptz AT TIME ZONE 'Asia/Kolkata';
v_today_end := (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamptz AT TIME ZONE 'Asia/Kolkata') - interval '1 second';

'total_today', (SELECT count(*) FROM audit_logs WHERE performed_at >= v_today_start AND performed_at <= v_today_end),
'total_week', (SELECT count(*) FROM audit_logs WHERE performed_at >= v_week_start),
```

### Why This Works
- Explicitly converts to IST timezone
- Uses IST date boundaries
- Correct "today" definition for India

---

## CRITICAL ISSUE #5: Misleading Metric Name

### Original Code (MISLEADING)
```sql
'delivery_rate', CASE WHEN count(*) > 0 THEN round((count(*) FILTER (WHERE read = true))::numeric / count(*) * 100, 2) ELSE 0 END,
```

### Problem
- Called "delivery_rate" but actually measures "read_rate"
- Delivery rate = percentage of notifications successfully sent
- Read rate = percentage of notifications that were opened/read
- These are different metrics
- Admin dashboard will show misleading information

### Fixed Code
```sql
'read_rate', CASE WHEN count(*) > 0 THEN round((count(*) FILTER (WHERE read = true))::numeric / count(*) * 100, 2) ELSE 0 END,
```

### Why This Works
- Accurate metric name
- Reflects actual data being measured
- Admin dashboard shows correct information

---

## CRITICAL ISSUE #6: Gender Handling in Leave Balance Reset

### Original Code (PROBLEMATIC)
```sql
IF upper(v_emp.gender) = 'FEMALE' THEN
  v_target := p_female_days;
ELSIF upper(v_emp.gender) = 'MALE' THEN
  v_target := p_male_days;
ELSE
  CONTINUE;
END IF;
```

### Problem
- Silently skips employees with NULL gender
- Silently skips employees with 'OTHER' or 'UNKNOWN' gender
- No visibility into how many employees were skipped
- Incomplete leave balance reset without warning
- Admin doesn't know if reset was successful

### Fixed Code
```sql
IF upper(v_emp.gender) = 'FEMALE' THEN
  v_target := p_female_days;
ELSIF upper(v_emp.gender) = 'MALE' THEN
  v_target := p_male_days;
ELSE
  -- Skip employees with NULL, UNKNOWN, or OTHER gender values
  v_skipped := v_skipped + 1;
  CONTINUE;
END IF;

-- ... later ...

RETURN jsonb_build_object(
  'success', true, 
  'employees_updated', v_count,
  'employees_skipped', v_skipped,
  'note', 'Employees with NULL or non-standard gender values were skipped'
);
```

### Why This Works
- Tracks skipped employees
- Returns count in response
- Admin knows exactly what happened
- Explicit business rule documented

---

## CRITICAL ISSUE #7: Anonymous Feedback Privacy Model Not Documented

### Original Code (AMBIGUOUS)
```sql
CREATE TABLE public.anonymous_feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  message text not null,
  created_at timestamptz not null default now(),
  org_id text
);

CREATE TABLE public.feedback_audit (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid references public.anonymous_feedback(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  inserted_at timestamptz not null default now()
);
```

### Problem
- Privacy model is unclear
- Is feedback truly anonymous?
- Can HR identify submitter?
- Can SYSTEM_ADMIN identify submitter?
- Potential privacy concerns if model is misunderstood

### Fixed Code
```sql
-- Privacy Model Documentation:
-- Model B - Confidential but Auditable
-- - Feedback is submitted anonymously (no user_id in anonymous_feedback table)
-- - Submitter identity is recorded in feedback_audit table
-- - HR/Admin/HRBP/Director can view feedback but cannot identify submitter
-- - SYSTEM_ADMIN can view audit table and identify submitter
-- - This provides accountability while maintaining employee privacy
```

### Why This Works
- Explicit privacy model documented
- Clear expectations for all users
- Accountability maintained
- Privacy respected

---

## HIGH-PRIORITY ISSUE #1: Biometric Punch Column Reference

### Original Code (BROKEN)
```sql
FROM public.smartoffice_device_logs s
WHERE d.user_id=employee.user_id AND d.log_date_only=employee.work_date
```

### Problem
- Column `log_date_only` does not exist
- Actual column is `log_date` (TIMESTAMPTZ)
- Need to extract date component

### Fixed Code
```sql
FROM public.smartoffice_device_logs d
WHERE d.user_id=employee.user_id AND (d.log_date AT TIME ZONE 'Asia/Kolkata')::date=employee.work_date
```

---

## HIGH-PRIORITY ISSUE #2: Canonical View Biometric Lookup

### Original Code (BROKEN)
```sql
SELECT min(d.punch_timestamp) first_punch, max(d.punch_timestamp) last_punch
FROM public.smartoffice_device_logs d
WHERE d.user_id=employee.user_id AND d.log_date_only=employee.work_date
```

### Problem
- Column `punch_timestamp` doesn't exist
- Column `log_date_only` doesn't exist
- Should use `log_date` with timezone conversion

### Fixed Code
```sql
SELECT min(d.log_date) first_punch, max(d.log_date) last_punch
FROM public.smartoffice_device_logs d
WHERE d.user_id=employee.user_id AND (d.log_date AT TIME ZONE 'Asia/Kolkata')::date=employee.work_date
```

---

## SUMMARY OF FIXES

| Issue | Type | Severity | Status |
|-------|------|----------|--------|
| punch_timestamp column | Column Reference | CRITICAL | ✅ FIXED |
| Date comparison without timezone | Timezone | CRITICAL | ✅ FIXED |
| February 29 calculation | Date Arithmetic | CRITICAL | ✅ FIXED |
| Audit summary timezone | Timezone | CRITICAL | ✅ FIXED |
| Misleading metric name | Semantics | CRITICAL | ✅ FIXED |
| Gender handling visibility | Business Logic | CRITICAL | ✅ FIXED |
| Privacy model documentation | Documentation | CRITICAL | ✅ FIXED |
| Biometric column references | Column Reference | HIGH | ✅ FIXED |
| Canonical view biometric lookup | Column Reference | HIGH | ✅ FIXED |

---

## VERIFICATION CHECKLIST

After applying corrected migration, verify:

- [ ] All functions compile without errors
- [ ] All views compile without errors
- [ ] All triggers compile without errors
- [ ] Biometric auto-checkout works correctly
- [ ] Leave balance reset includes skip count
- [ ] Birthday view handles February 29
- [ ] Audit summary uses IST dates
- [ ] Notification monitoring shows read_rate
- [ ] Anonymous feedback privacy model is documented
- [ ] All tests in MIGRATION_TEST_SUITE.sql pass

---

## TESTING RECOMMENDATIONS

### Unit Tests
```sql
-- Test February 29 calculation
SELECT make_date(2025, 2, 28) as feb_28_non_leap;

-- Test timezone conversion
SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date as ist_today;

-- Test date comparison
SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date = CURRENT_DATE as dates_match;
```

### Integration Tests
```sql
-- Test biometric auto-checkout
SELECT public.reconcile_missing_attendance_checkouts(CURRENT_DATE - 1);

-- Test birthday view
SELECT COUNT(*) FROM public.upcoming_birthdays_30_days;

-- Test audit summary
SELECT public.rpc_admin_audit_logs_summary();
```

### End-to-End Tests
```sql
-- Test full attendance workflow
-- 1. Create attendance record
-- 2. Add biometric punch
-- 3. Run auto-checkout
-- 4. Verify work hours calculated
-- 5. Verify audit logged
```

---

## DEPLOYMENT CHECKLIST

- [ ] All critical issues fixed
- [ ] All high-priority issues fixed
- [ ] All tests pass on staging
- [ ] Performance acceptable
- [ ] Rollback procedure tested
- [ ] Backup created
- [ ] Maintenance window scheduled
- [ ] Stakeholders notified
- [ ] Post-deployment monitoring in place
