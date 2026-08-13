-- ============================================================
-- Production readiness checks
-- Run in Supabase SQL Editor after deploying all attendance migrations.
-- Every result includes PASS / FAIL / NEEDS_REAL_TEST / NO_DATA.
-- This script does not change application or attendance data. It uses a
-- session-scoped temporary table only to safely inspect optional pg_cron tables.
-- ============================================================

-- 1. Actual 23:59 IST cron installation and recent execution.
DROP TABLE IF EXISTS pg_temp.attendance_readiness_results;
CREATE TEMP TABLE attendance_readiness_results (
  sort_order INTEGER,
  check_name TEXT,
  result TEXT,
  evidence TEXT
);

DO $$
DECLARE
  v_schedule TEXT;
  v_active BOOLEAN;
  v_status TEXT;
  v_run_at TIMESTAMPTZ;
BEGIN
  -- Never refer to cron.job statically: that relation is absent when the
  -- extension is disabled and PostgreSQL would stop before evaluating a guard.
  IF to_regclass('cron.job') IS NULL THEN
    INSERT INTO attendance_readiness_results VALUES (
      10,
      '23:59 auto-checkout cron installed',
      'FAIL',
      'pg_cron extension is not enabled or cron.job is unavailable'
    );
    INSERT INTO attendance_readiness_results VALUES (
      20,
      'Recent 23:59 cron execution',
      'NEEDS_CONFIGURATION',
      'No cron history can exist until pg_cron is enabled and the job is scheduled'
    );
    RETURN;
  END IF;

  EXECUTE $sql$
    SELECT schedule, active
    FROM cron.job
    WHERE jobname='attendance-auto-checkout-2359-ist'
    LIMIT 1
  $sql$ INTO v_schedule, v_active;

  INSERT INTO attendance_readiness_results VALUES (
    10,
    '23:59 auto-checkout cron installed',
    CASE WHEN v_schedule='29 18 * * *' AND COALESCE(v_active,FALSE) THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN v_schedule IS NULL THEN 'Job is missing' ELSE 'schedule='||v_schedule||', active='||COALESCE(v_active,FALSE) END
  );

  IF to_regclass('cron.job_run_details') IS NULL THEN
    INSERT INTO attendance_readiness_results VALUES (
      20,
      'Recent 23:59 cron execution','NEEDS_REAL_TEST','cron.job_run_details is unavailable'
    );
    RETURN;
  END IF;

  EXECUTE $sql$
    SELECT d.status, COALESCE(d.end_time,d.start_time)
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid=d.jobid
    WHERE j.jobname='attendance-auto-checkout-2359-ist'
    ORDER BY d.start_time DESC
    LIMIT 1
  $sql$ INTO v_status, v_run_at;

  INSERT INTO attendance_readiness_results VALUES (
    20,
    'Recent 23:59 cron execution',
    CASE WHEN v_status='succeeded' THEN 'PASS' WHEN v_status IS NULL THEN 'NEEDS_REAL_TEST' ELSE 'FAIL' END,
    CASE WHEN v_status IS NULL THEN 'No execution recorded yet' ELSE v_status||' at '||v_run_at::TEXT END
  );
END $$;

INSERT INTO attendance_readiness_results
SELECT 30, 'Recent system auto-checkout rows' AS check_name,
  CASE WHEN COUNT(*)>0 THEN 'PASS' ELSE 'NO_DATA' END AS result,
  COUNT(*)||' rows in last 14 days' AS evidence
FROM attendance_logs
WHERE checkout_source='SYSTEM'
  AND status='AUTO_CHECKED_OUT'
  AND date >= ((NOW() AT TIME ZONE 'Asia/Kolkata')::DATE - 14);

-- 2. Checkout candidates with a real earlier biometric punch.
WITH candidates AS (
  SELECT a.id,a.user_id,a.date,a.checkin_time,
    ((a.date::TEXT||' '||MIN(s.log_time)::TEXT)::TIMESTAMP AT TIME ZONE 'Asia/Kolkata') AS biometric_first
  FROM attendance_logs a JOIN smartoffice_device_logs s ON s.user_id=a.user_id AND s.log_date_only=a.date
  WHERE a.date >= ((NOW() AT TIME ZONE 'Asia/Kolkata')::DATE - 30)
  GROUP BY a.id,a.user_id,a.date,a.checkin_time
)
INSERT INTO attendance_readiness_results
SELECT 40, 'Earlier biometric punch available' AS check_name,
  CASE WHEN COUNT(*)>0 THEN 'PASS' ELSE 'NO_DATA' END AS result,
  COUNT(*)||' attendance rows where biometric first punch precedes app check-in' AS evidence
FROM candidates WHERE biometric_first<checkin_time;

-- 3. Android early-checkout reason reaching the deployed database.
INSERT INTO attendance_readiness_results
SELECT 50, 'Early-checkout reasons saved' AS check_name,
  CASE WHEN COUNT(*) FILTER(WHERE early_checkout_reason IS NOT NULL AND LENGTH(TRIM(early_checkout_reason))>=3)>0 THEN 'PASS' ELSE 'NEEDS_REAL_TEST' END AS result,
  COUNT(*) FILTER(WHERE checkout_source='APP_EARLY')||' APP_EARLY rows; '||COUNT(*) FILTER(WHERE early_checkout_reason IS NOT NULL)||' with reasons' AS evidence
FROM attendance_logs
WHERE date >= ((NOW() AT TIME ZONE 'Asia/Kolkata')::DATE - 30);

-- 4. Five-minute undo RPC deployment and actual successful undo evidence.
INSERT INTO attendance_readiness_results
SELECT 60, 'Undo RPC deployed' AS check_name,
  CASE WHEN to_regprocedure('rpc_attendance_undo_checkout(uuid,uuid,uuid)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
  COALESCE(to_regprocedure('rpc_attendance_undo_checkout(uuid,uuid,uuid)')::TEXT,'missing') AS evidence;
INSERT INTO attendance_readiness_results
SELECT 70, 'Successful checkout undo observed' AS check_name,
  CASE WHEN COUNT(*)>0 THEN 'PASS' ELSE 'NEEDS_REAL_TEST' END AS result,
  COUNT(*)||' UNDO_CHECKOUT audit events in last 30 days' AS evidence
FROM attendance_audit_logs WHERE action='UNDO_CHECKOUT' AND created_at>=NOW()-INTERVAL '30 days';

-- 5. Fraud scoring across real employee/device submissions.
INSERT INTO attendance_readiness_results
SELECT 80, 'Fraud scoring with multiple devices/users' AS check_name,
  CASE WHEN COUNT(DISTINCT user_id)>=3 THEN 'PASS' ELSE 'NEEDS_REAL_TEST' END AS result,
  COUNT(*)||' events from '||COUNT(DISTINCT user_id)||' users; '||COUNT(*) FILTER(WHERE severity='SUSPICIOUS')||' suspicious' AS evidence
FROM attendance_fraud_events WHERE created_at>=NOW()-INTERVAL '30 days';

-- 6. Native developer-mode signal actually received from rebuilt APK.
INSERT INTO attendance_readiness_results
SELECT 90, 'Developer-mode native signal received' AS check_name,
  CASE WHEN COUNT(*)>0 THEN 'PASS' ELSE 'NEEDS_REAL_TEST' END AS result,
  COUNT(*)||' events reported developer_mode=true in last 30 days' AS evidence
FROM attendance_fraud_events WHERE developer_mode AND created_at>=NOW()-INTERVAL '30 days';

-- 7. Reconciliation volume used by the seven-sheet export.
INSERT INTO attendance_readiness_results
SELECT 100, 'Production reconciliation volume' AS check_name,
  CASE WHEN COUNT(*)>1000 THEN 'PASS' WHEN COUNT(*)>0 THEN 'PASS_SMALL_VOLUME' ELSE 'NO_DATA' END AS result,
  COUNT(*)||' rows in current month; app export now fetches in 1,000-row pages' AS evidence
FROM attendance_reconciliation
WHERE date >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
  AND date <= (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;

-- 8. HR regularization approval against real records.
INSERT INTO attendance_readiness_results
SELECT 110, 'Regularization approvals applied' AS check_name,
  CASE WHEN COUNT(*)>0 THEN 'PASS' ELSE 'NEEDS_REAL_TEST' END AS result,
  COUNT(*)||' approved requests; '||COUNT(*) FILTER(WHERE a.status='ADMIN_CORRECTED')||' linked attendance rows corrected' AS evidence
FROM attendance_regularization_requests r LEFT JOIN attendance_logs a ON a.id=r.attendance_id
WHERE r.status='APPROVED' AND r.reviewed_at>=NOW()-INTERVAL '30 days';

-- Calendar + leave workflow sanity.
INSERT INTO attendance_readiness_results
SELECT 120, 'Calendar configuration' AS check_name,
  CASE WHEN (SELECT COUNT(*) FROM holiday_calendar)>0 AND (SELECT COUNT(*) FROM weekly_off_rules WHERE is_active)>0 THEN 'PASS' ELSE 'NEEDS_CONFIGURATION' END AS result,
  (SELECT COUNT(*) FROM holiday_calendar)||' holidays; '||(SELECT COUNT(*) FROM weekly_off_rules WHERE is_active)||' active weekly-off rules' AS evidence;
INSERT INTO attendance_readiness_results
SELECT 130, 'Leave workflow deployment' AS check_name,
  CASE WHEN to_regprocedure('rpc_submit_leave_request(uuid,text,date,date,text,boolean,text)') IS NOT NULL
         AND to_regprocedure('rpc_review_leave_request(uuid,uuid,boolean,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
  COUNT(*)||' canonical leave requests' AS evidence
FROM leave_requests;

-- Supabase SQL Editor now shows one complete result grid instead of only the
-- final individual SELECT result.
SELECT check_name,result,evidence
FROM attendance_readiness_results
ORDER BY sort_order;
