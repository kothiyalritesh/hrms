# HRMS MIGRATION DEPLOYMENT GUIDE

## PRE-DEPLOYMENT CHECKLIST

### 1. Verify Prerequisites (BLOCKING)

Before deploying, verify these objects exist in your database:

```sql
-- Check for required tables
SELECT table_name FROM information_schema.tables 
WHERE table_name IN (
  'site_visit_live_locations',
  'employee_compliance_scores',
  'compliance_score_deductions',
  'biometric_mapping_audit'
);

-- Check for required functions
SELECT routine_name FROM information_schema.routines 
WHERE routine_name IN (
  'apply_leave_transaction',
  'can_access_user_data',
  'hrms_timestamp',
  'resolve_hrms_calendar_day',
  'field_visit_distance_metres',
  'log_audit_event'
);
```

**If any are missing**: Do NOT proceed. These must be created first.

### 2. Backup Database

```bash
# Create full backup
pg_dump -h <host> -U <user> -d <database> > hrms_backup_$(date +%Y%m%d_%H%M%S).sql

# Verify backup
ls -lh hrms_backup_*.sql
```

### 3. Backup Current Schema

```sql
-- Export current schema for comparison
pg_dump -h <host> -U <user> -d <database> --schema-only > schema_before.sql
```

### 4. Test on Staging

Deploy to staging environment first:

```bash
# Connect to staging database
psql -h <staging-host> -U <user> -d <staging-db>

-- Run corrected migration
\i COMBINED_MIGRATIONS_V3_CORRECTED.sql
\i COMBINED_MIGRATIONS_V3_CORRECTED_PART2.sql

-- Run test suite
\i MIGRATION_TEST_SUITE.sql
```

**Verify all tests pass before proceeding to production.**

---

## DEPLOYMENT STEPS

### Step 1: Maintenance Window

Schedule a maintenance window (minimum 30 minutes):

```
- Notify all users of maintenance
- Stop all background jobs
- Stop all API servers
- Disable cron jobs
```

### Step 2: Final Backup

```bash
# Create final backup before deployment
pg_dump -h <prod-host> -U <user> -d <prod-db> > hrms_backup_final_$(date +%Y%m%d_%H%M%S).sql

# Verify backup size is reasonable
ls -lh hrms_backup_final_*.sql
```

### Step 3: Deploy Migration Part 1

```bash
psql -h <prod-host> -U <user> -d <prod-db> << 'EOF'
-- Start transaction
BEGIN;

-- Set timeout to 5 minutes
SET statement_timeout = '5 minutes';

-- Run corrected migration part 1
\i COMBINED_MIGRATIONS_V3_CORRECTED.sql

-- Verify no errors
SELECT 'Part 1 completed successfully' as status;

-- Commit
COMMIT;
EOF
```

**If error occurs**: ROLLBACK immediately and investigate.

### Step 4: Deploy Migration Part 2

```bash
psql -h <prod-host> -U <user> -d <prod-db> << 'EOF'
-- Start transaction
BEGIN;

-- Set timeout to 5 minutes
SET statement_timeout = '5 minutes';

-- Run corrected migration part 2
\i COMBINED_MIGRATIONS_V3_CORRECTED_PART2.sql

-- Verify no errors
SELECT 'Part 2 completed successfully' as status;

-- Commit
COMMIT;
EOF
```

**If error occurs**: ROLLBACK immediately and investigate.

### Step 5: Run Validation Tests

```bash
psql -h <prod-host> -U <user> -d <prod-db> << 'EOF'
-- Run critical validation tests
\i MIGRATION_TEST_SUITE.sql
EOF
```

**Expected**: All tests pass with no errors.

### Step 6: Verify Data Integrity

```sql
-- Check attendance_logs integrity
SELECT COUNT(*) as total_records,
  COUNT(CASE WHEN auto_closed = true THEN 1 END) as auto_closed_count,
  COUNT(CASE WHEN work_hours IS NOT NULL THEN 1 END) as with_work_hours
FROM public.attendance_logs;

-- Check leave_balances integrity
SELECT COUNT(*) as total_employees,
  COUNT(CASE WHEN sick IS NOT NULL THEN 1 END) as with_sick,
  COUNT(CASE WHEN casual IS NOT NULL THEN 1 END) as with_casual,
  COUNT(CASE WHEN earned IS NOT NULL THEN 1 END) as with_earned,
  COUNT(CASE WHEN comp_off IS NOT NULL THEN 1 END) as with_comp_off
FROM public.leave_balances;

-- Check permissions seeded
SELECT COUNT(*) as permission_count
FROM public.permissions
WHERE category = 'screens';

-- Check work schedule configs
SELECT COUNT(*) as config_count
FROM public.work_schedule_configs;
```

### Step 7: Verify Functions Compile

```sql
-- Test each function
SELECT public.rpc_admin_audit_logs_summary();
SELECT public.rpc_admin_notification_monitoring_summary();
SELECT COUNT(*) FROM public.upcoming_birthdays_30_days;
SELECT COUNT(*) FROM public.v_attendance_daily_canonical LIMIT 1;
```

### Step 8: Re-enable Services

```bash
# Re-enable cron jobs
# Restart API servers
# Restart background jobs
# Notify users that maintenance is complete
```

---

## ROLLBACK PROCEDURE

### If Deployment Fails

**IMMEDIATE ACTION**: Do NOT attempt to fix in production. Rollback immediately.

```bash
# Restore from backup
psql -h <prod-host> -U <user> -d <prod-db> < hrms_backup_final_$(date +%Y%m%d_%H%M%S).sql
```

### Manual Rollback (If Backup Restore Fails)

```sql
-- Drop new functions
DROP FUNCTION IF EXISTS public.get_site_visit_observer_data(date, uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) CASCADE;
DROP FUNCTION IF EXISTS public.reconcile_missing_attendance_checkouts(date) CASCADE;
DROP FUNCTION IF EXISTS public.rpc_admin_notification_monitoring_summary(date, date) CASCADE;
DROP FUNCTION IF EXISTS public.trigger_monday_biometric_credit() CASCADE;
DROP FUNCTION IF EXISTS public.rpc_my_unified_activity_log(text, int, int) CASCADE;
DROP FUNCTION IF EXISTS public.trg_audit_anonymous_feedback() CASCADE;
DROP FUNCTION IF EXISTS public.rpc_admin_audit_logs_summary() CASCADE;

-- Drop new views
DROP VIEW IF EXISTS public.upcoming_birthdays_30_days CASCADE;
DROP VIEW IF EXISTS public.v_attendance_daily_canonical CASCADE;

-- Drop new tables
DROP TABLE IF EXISTS public.work_schedule_configs CASCADE;
DROP TABLE IF EXISTS public.feedback_audit CASCADE;
DROP TABLE IF EXISTS public.anonymous_feedback CASCADE;

-- Drop new trigger
DROP TRIGGER IF EXISTS tr_monday_biometric_credit ON public.smartoffice_device_logs;

-- Drop new column
ALTER TABLE public.profiles DROP COLUMN IF EXISTS date_of_birth;

-- Delete seeded permissions
DELETE FROM public.permissions 
WHERE category = 'screens' AND name LIKE 'screen.%';
```

### Verify Rollback

```sql
-- Verify functions are gone
SELECT COUNT(*) as function_count
FROM information_schema.routines
WHERE routine_name IN (
  'get_site_visit_observer_data',
  'rpc_admin_reset_all_leave_balances',
  'reconcile_missing_attendance_checkouts'
);

-- Verify views are gone
SELECT COUNT(*) as view_count
FROM information_schema.views
WHERE table_name IN (
  'upcoming_birthdays_30_days',
  'v_attendance_daily_canonical'
);

-- Verify tables are gone
SELECT COUNT(*) as table_count
FROM information_schema.tables
WHERE table_name IN (
  'work_schedule_configs',
  'anonymous_feedback',
  'feedback_audit'
);
```

---

## POST-DEPLOYMENT VERIFICATION

### Day 1 (Immediate)

- [ ] All functions execute without errors
- [ ] All views return data
- [ ] No error logs in application
- [ ] Attendance records are being created correctly
- [ ] Biometric sync is working
- [ ] Field visits are being tracked

### Day 2-3 (Monitoring)

- [ ] Monitor query performance
- [ ] Check for any slow queries
- [ ] Verify leave balance calculations
- [ ] Verify birthday notifications
- [ ] Verify audit logs are being recorded
- [ ] Verify anonymous feedback is working

### Week 1 (Full Validation)

- [ ] Run full data validation
- [ ] Verify all attendance calculations
- [ ] Verify all leave transactions
- [ ] Verify all audit logs
- [ ] Verify all permissions are working
- [ ] Verify all notifications are being sent

---

## TROUBLESHOOTING

### Issue: Function compilation error

**Symptom**: `ERROR: function does not exist`

**Solution**:
1. Verify all dependent functions exist
2. Check function signatures match
3. Verify search_path is correct

### Issue: View compilation error

**Symptom**: `ERROR: column does not exist`

**Solution**:
1. Verify all referenced columns exist
2. Check table names are correct
3. Verify all dependent functions exist

### Issue: Trigger not firing

**Symptom**: Monday biometric credit not being applied

**Solution**:
1. Verify trigger exists: `SELECT * FROM information_schema.triggers WHERE trigger_name = 'tr_monday_biometric_credit'`
2. Verify tables exist: `employee_compliance_scores`, `compliance_score_deductions`
3. Check trigger logs

### Issue: Biometric auto-checkout not working

**Symptom**: Attendance records not being auto-closed

**Solution**:
1. Verify `smartoffice_device_logs` has `user_id` column
2. Verify `log_date` column exists and has correct data
3. Run function manually: `SELECT public.reconcile_missing_attendance_checkouts(CURRENT_DATE - 1)`

### Issue: Birthday view returns no results

**Symptom**: `upcoming_birthdays_30_days` returns empty

**Solution**:
1. Verify `profiles.date_of_birth` column exists
2. Verify employees have `is_active = true`
3. Verify employees have `date_of_birth` set
4. Check date range: `SELECT * FROM public.upcoming_birthdays_30_days`

---

## PERFORMANCE MONITORING

### Monitor These Queries

```sql
-- Check canonical view performance
EXPLAIN ANALYZE
SELECT COUNT(*) FROM public.v_attendance_daily_canonical
WHERE work_date = CURRENT_DATE;

-- Check observer data performance
EXPLAIN ANALYZE
SELECT public.get_site_visit_observer_data(CURRENT_DATE);

-- Check activity log performance
EXPLAIN ANALYZE
SELECT public.rpc_my_unified_activity_log('all', 50, 0);
```

### Expected Performance

- Canonical view: < 1 second for single day
- Observer data: < 2 seconds for current date
- Activity log: < 500ms for 50 records

If slower, check:
1. Missing indexes
2. Table statistics (ANALYZE)
3. Query plans (EXPLAIN)

---

## SUPPORT CONTACTS

- **Database Admin**: [contact]
- **Application Owner**: [contact]
- **On-Call Engineer**: [contact]

---

## SIGN-OFF

- [ ] Pre-deployment checklist completed
- [ ] Staging deployment successful
- [ ] Production deployment successful
- [ ] All validation tests passed
- [ ] Post-deployment verification completed
- [ ] Performance monitoring in place

**Deployed by**: ________________
**Date**: ________________
**Time**: ________________
**Approved by**: ________________
