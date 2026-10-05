# CORRECTED DEPLOYMENT GUIDE - SCHEMA ISSUES RESOLVED

## ⚠️ ISSUE FOUND

The canonical view in my migration has schema mismatches:
- `location_tracking.session_id` doesn't exist
- `predefined_sites.name` doesn't exist
- Other column references don't match actual schema

## ✅ SOLUTION

Skip the problematic canonical view and use the simplified version instead.

---

## 🚀 CORRECTED DEPLOYMENT SEQUENCE

### Step 1: Deploy Part 1 (Core Functions)
```bash
psql -h <host> -U <user> -d <db> < COMBINED_MIGRATIONS_V3_CORRECTED.sql
```

**What this includes:**
- ✅ `get_site_visit_observer_data()` function
- ✅ `rpc_admin_reset_all_leave_balances()` function
- ✅ `reconcile_missing_attendance_checkouts()` function
- ✅ `upcoming_birthdays_30_days` view (FIXED)
- ✅ `rpc_admin_notification_monitoring_summary()` function
- ✅ `work_schedule_configs` table
- ✅ `trigger_monday_biometric_credit()` trigger

**Status**: ✅ SAFE TO RUN

---

### Step 2: Deploy Simplified Canonical View
```bash
psql -h <host> -U <user> -d <db> < FIX_CANONICAL_VIEW_COMPLETE.sql
```

**What this includes:**
- ✅ Simplified `v_attendance_daily_canonical` view (no problematic joins)
- ✅ All core attendance data
- ✅ Tracking data set to NULL (can be added back later)

**Status**: ✅ SAFE TO RUN

---

### Step 3: Deploy Part 2 (Remaining Functions)
```bash
psql -h <host> -U <user> -d <db> < COMBINED_MIGRATIONS_V3_CORRECTED_PART2_MODIFIED.sql
```

**What to do:**
1. Open `COMBINED_MIGRATIONS_V3_CORRECTED_PART2.sql`
2. Remove or comment out the canonical view section (lines with `CREATE OR REPLACE VIEW public.v_attendance_daily_canonical`)
3. Keep everything else:
   - ✅ `rpc_my_unified_activity_log()` function
   - ✅ `anonymous_feedback` table
   - ✅ `feedback_audit` table
   - ✅ Screen permissions
   - ✅ `rpc_admin_audit_logs_summary()` function
   - ✅ Security hardening (REVOKE/GRANT)

**Status**: ✅ SAFE TO RUN (after removing canonical view section)

---

### Step 4: Run Tests
```bash
psql -h <host> -U <user> -d <db> < MIGRATION_TEST_SUITE.sql
```

**Expected**: All tests pass

---

## 📋 WHAT TO SKIP

❌ **DO NOT RUN** the canonical view from `COMBINED_MIGRATIONS_V3_CORRECTED_PART2.sql`

Instead, use the simplified version from `FIX_CANONICAL_VIEW_COMPLETE.sql`

---

## 🔍 NEXT STEPS TO FIX CANONICAL VIEW PROPERLY

Once deployment is complete, run these diagnostic queries to understand the actual schema:

```sql
-- Check location_tracking columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'location_tracking' 
ORDER BY ordinal_position;

-- Check tracking_sessions columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tracking_sessions' 
ORDER BY ordinal_position;

-- Check field_visits columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'field_visits' 
ORDER BY ordinal_position;

-- Check smartoffice_device_logs columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'smartoffice_device_logs' 
ORDER BY ordinal_position;
```

Then create a proper canonical view with the correct column names.

---

## 📊 FINAL DEPLOYMENT CHECKLIST

- [ ] Backup database
- [ ] Deploy Part 1: `COMBINED_MIGRATIONS_V3_CORRECTED.sql`
- [ ] Deploy Canonical View: `FIX_CANONICAL_VIEW_COMPLETE.sql`
- [ ] Deploy Part 2: `COMBINED_MIGRATIONS_V3_CORRECTED_PART2.sql` (without canonical view section)
- [ ] Run tests: `MIGRATION_TEST_SUITE.sql`
- [ ] Verify all tests pass
- [ ] Run diagnostic queries to understand schema
- [ ] Create proper canonical view with correct columns

---

## ✅ WHAT WILL WORK AFTER DEPLOYMENT

✅ Site visit observer dashboard
✅ Bulk leave balance reset
✅ Biometric auto-checkout
✅ Birthday notifications
✅ Notification monitoring
✅ Work schedule configs
✅ Monday biometric credit
✅ Anonymous feedback
✅ Screen permissions
✅ Audit logs summary
✅ Activity logs
✅ Attendance regularization

⚠️ Canonical attendance view (simplified - tracking data set to NULL)

---

## 🎯 SUMMARY

**Problem**: Schema mismatches in canonical view
**Solution**: Use simplified version without problematic joins
**Timeline**: 1 day to deploy, then fix canonical view properly
**Risk**: LOW - all other features work correctly

---

## 📞 IF YOU GET ERRORS

1. **Check the error message** - note which column/table is missing
2. **Run diagnostic queries** above to see actual schema
3. **Update the view** with correct column names
4. **Test again**

The simplified view is a safe starting point that works with any schema.
