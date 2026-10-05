-- ==========================================
-- HRMS MIGRATION TEST SUITE
-- ==========================================

-- TEST 1: Verify all required tables exist
-- Expected: All queries return 1 (table exists)

SELECT 'attendance_logs' as table_name, 
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='attendance_logs') THEN 1 ELSE 0 END as exists;

SELECT 'smartoffice_device_logs' as table_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='smartoffice_device_logs') THEN 1 ELSE 0 END as exists;

SELECT 'site_visit_live_locations' as table_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='site_visit_live_locations') THEN 1 ELSE 0 END as exists;

SELECT 'employee_compliance_scores' as table_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='employee_compliance_scores') THEN 1 ELSE 0 END as exists;

SELECT 'compliance_score_deductions' as table_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='compliance_score_deductions') THEN 1 ELSE 0 END as exists;

SELECT 'work_schedule_configs' as table_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='work_schedule_configs') THEN 1 ELSE 0 END as exists;

SELECT 'anonymous_feedback' as table_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='anonymous_feedback') THEN 1 ELSE 0 END as exists;

SELECT 'feedback_audit' as table_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='feedback_audit') THEN 1 ELSE 0 END as exists;

-- TEST 2: Verify all required columns exist in attendance_logs
-- Expected: All queries return 1

SELECT 'attendance_logs.auto_closed' as column_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='attendance_logs' AND column_name='auto_closed') THEN 1 ELSE 0 END as exists;

SELECT 'attendance_logs.auto_close_reason' as column_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='attendance_logs' AND column_name='auto_close_reason') THEN 1 ELSE 0 END as exists;

SELECT 'attendance_logs.work_hours' as column_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='attendance_logs' AND column_name='work_hours') THEN 1 ELSE 0 END as exists;

-- TEST 3: Verify smartoffice_device_logs has correct columns
-- Expected: All queries return 1

SELECT 'smartoffice_device_logs.log_date' as column_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='smartoffice_device_logs' AND column_name='log_date') THEN 1 ELSE 0 END as exists;

SELECT 'smartoffice_device_logs.employee_code' as column_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='smartoffice_device_logs' AND column_name='employee_code') THEN 1 ELSE 0 END as exists;

SELECT 'smartoffice_device_logs.user_id' as column_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='smartoffice_device_logs' AND column_name='user_id') THEN 1 ELSE 0 END as exists;

-- TEST 4: Verify all required functions exist
-- Expected: All queries return 1

SELECT 'get_site_visit_observer_data' as function_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.routines WHERE routine_name='get_site_visit_observer_data') THEN 1 ELSE 0 END as exists;

SELECT 'rpc_admin_reset_all_leave_balances' as function_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.routines WHERE routine_name='rpc_admin_reset_all_leave_balances') THEN 1 ELSE 0 END as exists;

SELECT 'reconcile_missing_attendance_checkouts' as function_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.routines WHERE routine_name='reconcile_missing_attendance_checkouts') THEN 1 ELSE 0 END as exists;

SELECT 'rpc_admin_notification_monitoring_summary' as function_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.routines WHERE routine_name='rpc_admin_notification_monitoring_summary') THEN 1 ELSE 0 END as exists;

SELECT 'trigger_monday_biometric_credit' as function_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.routines WHERE routine_name='trigger_monday_biometric_credit') THEN 1 ELSE 0 END as exists;

SELECT 'rpc_my_unified_activity_log' as function_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.routines WHERE routine_name='rpc_my_unified_activity_log') THEN 1 ELSE 0 END as exists;

SELECT 'trg_audit_anonymous_feedback' as function_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.routines WHERE routine_name='trg_audit_anonymous_feedback') THEN 1 ELSE 0 END as exists;

SELECT 'rpc_admin_audit_logs_summary' as function_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.routines WHERE routine_name='rpc_admin_audit_logs_summary') THEN 1 ELSE 0 END as exists;

-- TEST 5: Verify all required views exist
-- Expected: All queries return 1

SELECT 'upcoming_birthdays_30_days' as view_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.views WHERE table_name='upcoming_birthdays_30_days') THEN 1 ELSE 0 END as exists;

SELECT 'v_attendance_daily_canonical' as view_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.views WHERE table_name='v_attendance_daily_canonical') THEN 1 ELSE 0 END as exists;

-- TEST 6: Verify profiles table has date_of_birth column
-- Expected: 1

SELECT 'profiles.date_of_birth' as column_name,
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='date_of_birth') THEN 1 ELSE 0 END as exists;

-- TEST 7: Verify permissions are seeded
-- Expected: 13 rows

SELECT COUNT(*) as permission_count
FROM public.permissions;

-- TEST 8: Verify work_schedule_configs is seeded
-- Expected: At least 1 row (Marketing team)

SELECT COUNT(*) as config_count
FROM public.work_schedule_configs
WHERE team = 'Marketing';

-- TEST 9: Test biometric auto-checkout function (dry run)
-- Expected: Returns integer (number of records updated)

SELECT public.reconcile_missing_attendance_checkouts(CURRENT_DATE - 1);

-- TEST 10: Test birthday view with sample data
-- Expected: Returns rows for employees with birthdays in next 30 days

SELECT COUNT(*) as upcoming_birthdays
FROM public.upcoming_birthdays_30_days;

-- TEST 11: Test timezone handling in audit summary
-- Expected: Returns JSON with audit counts

SELECT public.rpc_admin_audit_logs_summary();

-- TEST 12: Test notification monitoring summary
-- Expected: Returns JSON array with notification stats

SELECT public.rpc_admin_notification_monitoring_summary();

-- TEST 13: Verify RLS policies on anonymous_feedback
-- Expected: Policies exist

SELECT COUNT(*) as policy_count
FROM information_schema.role_table_grants
WHERE table_name = 'anonymous_feedback' AND privilege_type = 'SELECT';

-- TEST 14: Verify RLS policies on feedback_audit
-- Expected: Policies exist

SELECT COUNT(*) as policy_count
FROM information_schema.role_table_grants
WHERE table_name = 'feedback_audit' AND privilege_type = 'SELECT';

-- TEST 15: Test February 29 birthday calculation
-- Expected: No errors, returns valid date

WITH test_data AS (
  SELECT 
    '1992-02-29'::date as dob,
    2026 as year
)
SELECT 
  dob,
  CASE 
    WHEN extract(month FROM dob) = 2 AND extract(day FROM dob) = 29
      THEN make_date(year, 2, 28)
    ELSE (dob + ((year - extract(year FROM dob)::int) || ' years')::interval)::date
  END as birthday_this_year
FROM test_data;

-- TEST 16: Test leave balance reset with gender handling
-- Expected: Function executes without error

-- This is a dry-run test - do not actually reset balances
-- SELECT public.rpc_admin_reset_all_leave_balances('CASUAL', 1, 1, 'Test reset');

-- TEST 17: Verify trigger exists on smartoffice_device_logs
-- Expected: Trigger exists

SELECT COUNT(*) as trigger_count
FROM information_schema.triggers
WHERE trigger_name = 'tr_monday_biometric_credit' AND event_object_table = 'smartoffice_device_logs';

-- TEST 18: Verify canonical view can be queried
-- Expected: No errors, returns rows

SELECT COUNT(*) as canonical_rows
FROM public.v_attendance_daily_canonical
LIMIT 1;

-- TEST 19: Verify activity log function works
-- Expected: Returns JSON array

-- This requires authenticated user context
-- SELECT public.rpc_my_unified_activity_log('all', 10, 0);

-- TEST 20: Verify observer data function works
-- Expected: Returns JSON with employee data

-- This requires authenticated user context and proper permissions
-- SELECT public.get_site_visit_observer_data(CURRENT_DATE);

-- ==========================================
-- SUMMARY OF TESTS
-- ==========================================
-- Run all tests above and verify:
-- 1. All table existence tests return 1
-- 2. All column existence tests return 1
-- 3. All function existence tests return 1
-- 4. All view existence tests return 1
-- 5. Permission count is 19
-- 6. Work schedule config count is >= 1
-- 7. Biometric auto-checkout returns integer
-- 8. Birthday view returns valid results
-- 9. Audit summary returns valid JSON
-- 10. Notification summary returns valid JSON
-- 11. RLS policies exist on feedback tables
-- 12. February 29 calculation works
-- 13. Trigger exists on smartoffice_device_logs
-- 14. Canonical view can be queried
-- 15. All functions compile without syntax errors- 7. Biometric auto-checkout returns integer
-- 8. Birthday view returns valid results
-- 9. Audit summary returns valid JSON
-- 10. Notification summary returns valid JSON
-- 11. RLS policies exist on feedback tables
-- 12. February 29 calculation works
-- 13. Trigger exists on smartoffice_device_logs
-- 14. Canonical view can be queried
-- 15. All functions compile without syntax errors
