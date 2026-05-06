-- ============================================================
-- ATTENDANCE SYSTEM - TEST DATA & SCENARIOS
-- ============================================================

-- ============================================================
-- TEST SCENARIO 1: LATE ARRIVAL
-- ============================================================
-- Employee arrives at 10:45 AM (15 minutes late)
-- Leaves at 6:30 PM (on time)
-- Expected: is_late=true, late_minutes=15, status="late"

INSERT INTO attendance_logs (user_id, date, checkin_time, checkout_time, attendance_type, office_id, status)
VALUES (
  (SELECT id FROM profiles LIMIT 1),
  CURRENT_DATE,
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' + INTERVAL '10 hours 45 minutes',
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' + INTERVAL '18 hours 30 minutes',
  'OFFICE',
  (SELECT id FROM offices LIMIT 1),
  'CHECKED_OUT'
);

-- ============================================================
-- TEST SCENARIO 2: OVERTIME
-- ============================================================
-- Employee arrives at 10:30 AM (on time)
-- Leaves at 7:00 PM (30 minutes overtime)
-- Expected: is_late=false, is_overtime=true, overtime_minutes=30

INSERT INTO attendance_logs (user_id, date, checkin_time, checkout_time, attendance_type, office_id, status)
VALUES (
  (SELECT id FROM profiles LIMIT 1 OFFSET 1),
  CURRENT_DATE,
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' + INTERVAL '10 hours 30 minutes',
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' + INTERVAL '19 hours',
  'OFFICE',
  (SELECT id FROM offices LIMIT 1),
  'CHECKED_OUT'
);

-- ============================================================
-- TEST SCENARIO 3: LATE + OVERTIME
-- ============================================================
-- Employee arrives at 11:00 AM (30 minutes late)
-- Leaves at 7:30 PM (60 minutes overtime)
-- Expected: is_late=true, late_minutes=30, is_overtime=true, overtime_minutes=60

INSERT INTO attendance_logs (user_id, date, checkin_time, checkout_time, attendance_type, office_id, status)
VALUES (
  (SELECT id FROM profiles LIMIT 1 OFFSET 2),
  CURRENT_DATE,
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' + INTERVAL '11 hours',
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' + INTERVAL '19 hours 30 minutes',
  'OFFICE',
  (SELECT id FROM offices LIMIT 1),
  'CHECKED_OUT'
);

-- ============================================================
-- TEST SCENARIO 4: ABSENT (NO PUNCH)
-- ============================================================
-- No punch in or out
-- Expected: is_absent=true, status="absent"

-- (No insert needed - absence is detected by absence of record)

-- ============================================================
-- TEST SCENARIO 5: SUNDAY WORK
-- ============================================================
-- Employee works on Sunday
-- Expected: is_sunday=true, comp-off credited

INSERT INTO attendance_logs (user_id, date, checkin_time, checkout_time, attendance_type, office_id, status)
VALUES (
  (SELECT id FROM profiles LIMIT 1 OFFSET 3),
  CURRENT_DATE - INTERVAL '1 day' * ((EXTRACT(DOW FROM CURRENT_DATE) + 6) % 7), -- Last Sunday
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' + INTERVAL '10 hours 30 minutes',
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata' + INTERVAL '18 hours 30 minutes',
  'OFFICE',
  (SELECT id FROM offices LIMIT 1),
  'CHECKED_OUT'
);

-- ============================================================
-- TEST SCENARIO 6: ON-DUTY EVENT
-- ============================================================
-- Employee on approved on-duty event
-- Expected: is_on_duty=true, status="on_duty"

INSERT INTO on_duty_events (user_id, event_date, event_name, event_type, location, status, requested_by, approved_by)
VALUES (
  (SELECT id FROM profiles LIMIT 1 OFFSET 4),
  CURRENT_DATE,
  'Client Meeting - ABC Corp',
  'client_visit',
  'Gurugram Office',
  'approved',
  (SELECT id FROM profiles LIMIT 1 OFFSET 4),
  (SELECT id FROM profiles WHERE role = 'SYSTEM_ADMIN' LIMIT 1)
);

-- ============================================================
-- TEST SCENARIO 7: LEAVE
-- ============================================================
-- Employee on approved leave
-- Expected: is_leave=true, status="leave"

INSERT INTO leaves (user_id, type, start_date, end_date, reason, status, approved_by)
VALUES (
  (SELECT id FROM profiles LIMIT 1 OFFSET 5),
  'casual',
  CURRENT_DATE,
  CURRENT_DATE,
  'Personal work',
  'approved',
  (SELECT id FROM profiles WHERE role = 'SYSTEM_ADMIN' LIMIT 1)
);

-- ============================================================
-- TEST SCENARIO 8: COMP-OFF CREDIT (SUNDAY)
-- ============================================================

INSERT INTO compoff_credits (user_id, credit_date, reason, compoff_days)
VALUES (
  (SELECT id FROM profiles LIMIT 1 OFFSET 3),
  CURRENT_DATE - INTERVAL '1 day' * ((EXTRACT(DOW FROM CURRENT_DATE) + 6) % 7),
  'sunday_work',
  1
);

-- ============================================================
-- TEST SCENARIO 9: COMP-OFF CREDIT (OVERTIME)
-- ============================================================
-- 8 hours overtime = 1 comp-off

INSERT INTO compoff_credits (user_id, credit_date, reason, compoff_days)
VALUES (
  (SELECT id FROM profiles LIMIT 1 OFFSET 2),
  CURRENT_DATE,
  'overtime',
  1
);

-- ============================================================
-- TEST SCENARIO 10: COMP-OFF USAGE
-- ============================================================
-- Employee uses comp-off for leave

INSERT INTO compoff_usage (user_id, leave_id, compoff_credit_id, usage_date, compoff_days_used)
VALUES (
  (SELECT id FROM profiles LIMIT 1 OFFSET 3),
  (SELECT id FROM leaves LIMIT 1),
  (SELECT id FROM compoff_credits WHERE reason = 'sunday_work' LIMIT 1),
  CURRENT_DATE,
  1
);

-- ============================================================
-- TEST DATA VERIFICATION QUERIES
-- ============================================================

-- Verify attendance logs
SELECT 
  p.name,
  al.date,
  al.checkin_time,
  al.checkout_time,
  al.status
FROM attendance_logs al
LEFT JOIN profiles p ON al.user_id = p.id
ORDER BY al.date DESC, al.checkin_time DESC;

-- Verify on-duty events
SELECT 
  p.name,
  ode.event_date,
  ode.event_name,
  ode.event_type,
  ode.status
FROM on_duty_events ode
LEFT JOIN profiles p ON ode.user_id = p.id
ORDER BY ode.event_date DESC;

-- Verify leaves
SELECT 
  p.name,
  l.start_date,
  l.end_date,
  l.type,
  l.status
FROM leaves l
LEFT JOIN profiles p ON l.user_id = p.id
ORDER BY l.start_date DESC;

-- Verify comp-off credits
SELECT 
  p.name,
  cc.credit_date,
  cc.reason,
  cc.compoff_days,
  cc.status
FROM compoff_credits cc
LEFT JOIN profiles p ON cc.user_id = p.id
ORDER BY cc.credit_date DESC;

-- Verify comp-off usage
SELECT 
  p.name,
  cu.usage_date,
  cc.reason,
  cu.compoff_days_used
FROM compoff_usage cu
LEFT JOIN profiles p ON cu.user_id = p.id
LEFT JOIN compoff_credits cc ON cu.compoff_credit_id = cc.id
ORDER BY cu.usage_date DESC;

-- ============================================================
-- TESTING QUERIES
-- ============================================================

-- Test 1: Check if late detection works
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

-- Test 2: Check if overtime detection works
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

-- Test 3: Check working hours calculation
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

-- Test 4: Check Sunday detection
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

-- Test 5: Check comp-off balance
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

-- Test 6: Check attendance summary view
SELECT * FROM admin_attendance_export
WHERE date = CURRENT_DATE
ORDER BY employee_name;

-- Test 7: Check performance leaderboard
SELECT * FROM performance_leaderboard
WHERE month = EXTRACT(MONTH FROM CURRENT_DATE)
AND year = EXTRACT(YEAR FROM CURRENT_DATE)
ORDER BY rank
LIMIT 3;

-- Test 8: Check monthly attendance report
SELECT * FROM monthly_attendance_report
WHERE month = EXTRACT(MONTH FROM CURRENT_DATE)
AND year = EXTRACT(YEAR FROM CURRENT_DATE)
ORDER BY employee_name;

-- ============================================================
-- CLEANUP (Run if needed to reset test data)
-- ============================================================

-- DELETE FROM compoff_usage WHERE user_id IN (SELECT id FROM profiles LIMIT 6);
-- DELETE FROM compoff_credits WHERE user_id IN (SELECT id FROM profiles LIMIT 6);
-- DELETE FROM on_duty_events WHERE user_id IN (SELECT id FROM profiles LIMIT 6);
-- DELETE FROM leaves WHERE user_id IN (SELECT id FROM profiles LIMIT 6);
-- DELETE FROM attendance_logs WHERE user_id IN (SELECT id FROM profiles LIMIT 6);
-- DELETE FROM attendance_summary WHERE user_id IN (SELECT id FROM profiles LIMIT 6);
-- DELETE FROM performance_metrics WHERE user_id IN (SELECT id FROM profiles LIMIT 6);

-- ============================================================
-- SAMPLE TEST EXECUTION
-- ============================================================

/*
1. Run all INSERT statements above to create test data

2. Run verification queries to see the data

3. Run testing queries to validate logic

4. In your application, call:
   - AttendanceCalculationService.processAttendanceRange(CURRENT_DATE, CURRENT_DATE)
   - PerformanceService.calculateMonthlyMetrics(user_id, month, year)

5. Run the views queries again to see calculated results

6. Verify:
   - Late detection: is_late should be true for scenario 1, 3
   - Overtime detection: is_overtime should be true for scenario 2, 3
   - Sunday work: is_sunday should be true for scenario 5
   - On-duty: is_on_duty should be true for scenario 6
   - Leave: is_leave should be true for scenario 7
   - Comp-off credits: Should have records for scenarios 5, 8, 9
   - Comp-off usage: Should have records for scenario 10
   - Performance scores: Should be calculated for all employees
*/
