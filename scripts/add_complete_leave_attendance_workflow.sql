-- ============================================================
-- Complete leave + attendance calendar workflow
-- Run AFTER add_attendance_calendar_and_status_engine.sql.
--
-- Canonical table: leave_requests
-- - employee application with overlap and balance validation
-- - working-day calculation using holidays and weekly offs
-- - HR approval/rejection with atomic balance deduction
-- - employee cancellation while pending
-- - immutable audit trail
-- - one-time import of legacy `leaves` rows
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  applied_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS review_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requested_days NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS is_half_day BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS half_day_period TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legacy_leave_id UUID;

UPDATE leave_requests SET status=LOWER(status),leave_type=LOWER(leave_type);
DO $$
DECLARE v_constraint RECORD;
BEGIN
  FOR v_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='leave_requests'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP EXECUTE format('ALTER TABLE leave_requests DROP CONSTRAINT %I',v_constraint.conname); END LOOP;
END $$;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_check
  CHECK(status IN ('pending','approved','rejected','cancelled'));

ALTER TABLE leave_balance
  ADD COLUMN IF NOT EXISTS sick NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS casual NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS earned NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comp_off NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Old installations occasionally contain more than one balance row per user.
-- Merge those rows before enforcing the invariant required by atomic approval.
WITH ranked AS (
  SELECT ctid,user_id,
    ROW_NUMBER() OVER(PARTITION BY user_id ORDER BY ctid) AS rn,
    SUM(sick) OVER(PARTITION BY user_id) AS sick_total,
    SUM(casual) OVER(PARTITION BY user_id) AS casual_total,
    SUM(earned) OVER(PARTITION BY user_id) AS earned_total,
    SUM(comp_off) OVER(PARTITION BY user_id) AS comp_total
  FROM leave_balance
)
UPDATE leave_balance lb SET sick=r.sick_total,casual=r.casual_total,earned=r.earned_total,comp_off=r.comp_total
FROM ranked r WHERE lb.ctid=r.ctid AND r.rn=1;
WITH ranked AS (
  SELECT ctid,ROW_NUMBER() OVER(PARTITION BY user_id ORDER BY ctid) AS rn FROM leave_balance
)
DELETE FROM leave_balance lb USING ranked r WHERE lb.ctid=r.ctid AND r.rn>1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_balance_one_per_user ON leave_balance(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_requests_legacy_id
  ON leave_requests(legacy_leave_id) WHERE legacy_leave_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leave_requests_user_dates
  ON leave_requests(user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status_created
  ON leave_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS leave_application_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id UUID REFERENCES leave_requests(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES profiles(id),
  actor_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  days NUMERIC(6,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leave_audit_request
  ON leave_application_audit(leave_request_id, created_at DESC);

ALTER TABLE leave_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE leave_application_audit DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS leave_accrual_runs (
  month_start DATE PRIMARY KEY,
  casual_days NUMERIC(6,2) NOT NULL,
  processed_count INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE leave_accrual_runs DISABLE ROW LEVEL SECURITY;

-- Import the old application table once. Dynamic SQL keeps this migration safe
-- on installations where the legacy table was never created.
DO $$
BEGIN
  IF to_regclass('public.leaves') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO leave_requests (
        user_id, leave_type, start_date, end_date, reason, status,
        applied_on, created_at, rejection_reason, legacy_leave_id
      )
      SELECT user_id, LOWER(type), start_date, end_date, reason,
             LOWER(status), COALESCE(created_at, NOW()),
             COALESCE(created_at, NOW()), rejection_reason, id
      FROM leaves
      WHERE user_id IS NOT NULL
      ON CONFLICT (legacy_leave_id) WHERE legacy_leave_id IS NOT NULL DO NOTHING
    $sql$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION leave_working_days(
  p_user_id UUID,
  p_start_date DATE,
  p_end_date DATE
) RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_date DATE;
  v_office_id UUID;
  v_week_number INTEGER;
  v_days NUMERIC := 0;
BEGIN
  IF p_end_date < p_start_date THEN RETURN 0; END IF;
  SELECT office_id INTO v_office_id FROM profiles WHERE id = p_user_id;

  FOR v_date IN SELECT generate_series(p_start_date, p_end_date, INTERVAL '1 day')::DATE
  LOOP
    v_week_number := ((EXTRACT(DAY FROM v_date)::INTEGER - 1) / 7) + 1;
    IF EXISTS (
      SELECT 1 FROM holiday_calendar h
      WHERE h.holiday_date = v_date
        AND NOT h.is_optional
        AND (h.office_id IS NULL OR h.office_id = v_office_id)
    ) THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM weekly_off_rules w
      WHERE w.is_active
        AND (w.user_id = p_user_id OR (w.user_id IS NULL AND w.office_id = v_office_id))
        AND w.weekday = EXTRACT(DOW FROM v_date)::INTEGER
        AND (w.week_of_month IS NULL OR w.week_of_month = v_week_number)
    ) THEN CONTINUE; END IF;

    v_days := v_days + 1;
  END LOOP;
  RETURN v_days;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_submit_leave_request(
  p_user_id UUID,
  p_leave_type TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_reason TEXT,
  p_is_half_day BOOLEAN DEFAULT FALSE,
  p_half_day_period TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_type TEXT := LOWER(TRIM(p_leave_type));
  v_days NUMERIC;
  v_balance NUMERIC := 0;
  v_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success',FALSE,'error','FORBIDDEN','message','You cannot apply leave for another employee.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=p_user_id AND COALESCE(is_active,TRUE)) THEN
    RETURN jsonb_build_object('success',FALSE,'error','USER_NOT_FOUND','message','Active employee profile not found.');
  END IF;
  IF v_type NOT IN ('sick','casual','earned','wfh','comp_off') THEN
    RETURN jsonb_build_object('success',FALSE,'error','INVALID_LEAVE_TYPE','message','Select a valid leave type.');
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RETURN jsonb_build_object('success',FALSE,'error','INVALID_DATES','message','End date must be on or after start date.');
  END IF;
  IF p_is_half_day AND p_start_date <> p_end_date THEN
    RETURN jsonb_build_object('success',FALSE,'error','INVALID_HALF_DAY','message','Half-day leave must use one date.');
  END IF;
  IF p_is_half_day AND COALESCE(UPPER(p_half_day_period),'') NOT IN ('FIRST_HALF','SECOND_HALF') THEN
    RETURN jsonb_build_object('success',FALSE,'error','HALF_DAY_PERIOD_REQUIRED','message','Select first half or second half.');
  END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 3 THEN
    RETURN jsonb_build_object('success',FALSE,'error','REASON_REQUIRED','message','Enter a meaningful leave reason.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM leave_requests
    WHERE user_id=p_user_id AND LOWER(status) IN ('pending','approved')
      AND daterange(start_date,end_date,'[]') && daterange(p_start_date,p_end_date,'[]')
  ) THEN
    RETURN jsonb_build_object('success',FALSE,'error','OVERLAPPING_LEAVE','message','A pending or approved leave already covers these dates.');
  END IF;

  v_days := leave_working_days(p_user_id,p_start_date,p_end_date);
  IF p_is_half_day AND v_days > 0 THEN v_days := 0.5; END IF;
  IF v_days <= 0 THEN
    RETURN jsonb_build_object('success',FALSE,'error','NO_WORKING_DAYS','message','The selected range contains only holidays or weekly offs.');
  END IF;

  IF v_type <> 'wfh' THEN
    EXECUTE format('SELECT COALESCE(%I,0) FROM leave_balance WHERE user_id=$1',v_type)
      INTO v_balance USING p_user_id;
    v_balance := COALESCE(v_balance,0);
    IF v_balance < v_days THEN
      RETURN jsonb_build_object('success',FALSE,'error','INSUFFICIENT_BALANCE',
        'message','Insufficient '||replace(v_type,'_',' ')||' balance. Available: '||v_balance||', requested: '||v_days||'.',
        'available_balance',v_balance,'requested_days',v_days);
    END IF;
  END IF;

  INSERT INTO leave_requests (
    user_id,leave_type,start_date,end_date,reason,status,applied_on,
    requested_days,is_half_day,half_day_period
  ) VALUES (
    p_user_id,v_type,p_start_date,p_end_date,TRIM(p_reason),'pending',NOW(),
    v_days,p_is_half_day,CASE WHEN p_is_half_day THEN UPPER(p_half_day_period) END
  ) RETURNING id INTO v_id;

  INSERT INTO leave_application_audit(leave_request_id,user_id,actor_id,action,new_status,days,notes)
  VALUES(v_id,p_user_id,p_user_id,'APPLIED','pending',v_days,TRIM(p_reason));

  RETURN jsonb_build_object('success',TRUE,'id',v_id,'status','pending','requested_days',v_days,'message','Leave request submitted for HR approval.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',FALSE,'error',SQLERRM,'message','Leave application failed: '||SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_review_leave_request(
  p_request_id UUID,
  p_admin_id UUID,
  p_approve BOOLEAN,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_request RECORD;
  v_type TEXT;
  v_balance NUMERIC;
  v_new_status TEXT := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id=p_admin_id
      AND UPPER(role) IN ('ADMIN','SYSTEM_ADMIN','HR','HRD','HR_MANAGER')
      AND COALESCE(is_active,TRUE)
  ) THEN RETURN jsonb_build_object('success',FALSE,'error','FORBIDDEN','message','Only HR/admin can review leave.'); END IF;
  IF NOT p_approve AND (p_notes IS NULL OR LENGTH(TRIM(p_notes)) < 3) THEN
    RETURN jsonb_build_object('success',FALSE,'error','REJECTION_REASON_REQUIRED','message','Enter a rejection reason.');
  END IF;

  SELECT * INTO v_request FROM leave_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',FALSE,'error','NOT_FOUND','message','Leave request not found.'); END IF;
  IF LOWER(v_request.status) <> 'pending' THEN
    RETURN jsonb_build_object('success',FALSE,'error','ALREADY_REVIEWED','message','This leave request has already been reviewed.');
  END IF;

  v_type := LOWER(v_request.leave_type);
  IF p_approve AND v_type <> 'wfh' THEN
    INSERT INTO leave_balance(user_id) VALUES(v_request.user_id) ON CONFLICT (user_id) DO NOTHING;
    EXECUTE format('SELECT COALESCE(%I,0) FROM leave_balance WHERE user_id=$1 FOR UPDATE',v_type)
      INTO v_balance USING v_request.user_id;
    IF COALESCE(v_balance,0) < v_request.requested_days THEN
      RETURN jsonb_build_object('success',FALSE,'error','INSUFFICIENT_BALANCE','message','Employee no longer has sufficient leave balance.');
    END IF;
    EXECUTE format('UPDATE leave_balance SET %I=%I-$1,updated_at=NOW() WHERE user_id=$2',v_type,v_type)
      USING v_request.requested_days,v_request.user_id;
  END IF;

  UPDATE leave_requests SET
    status=v_new_status, reviewed_by=p_admin_id, reviewed_at=NOW(),
    review_notes=NULLIF(TRIM(p_notes),''),
    rejection_reason=CASE WHEN p_approve THEN NULL ELSE TRIM(p_notes) END
  WHERE id=p_request_id;

  INSERT INTO leave_application_audit(leave_request_id,user_id,actor_id,action,old_status,new_status,days,notes)
  VALUES(p_request_id,v_request.user_id,p_admin_id,CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
    v_request.status,v_new_status,v_request.requested_days,NULLIF(TRIM(p_notes),''));

  RETURN jsonb_build_object('success',TRUE,'status',v_new_status,'message','Leave request '||v_new_status||'.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',FALSE,'error',SQLERRM,'message','Leave review failed: '||SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_cancel_leave_request(
  p_request_id UUID,
  p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_request RECORD;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success',FALSE,'error','FORBIDDEN');
  END IF;
  SELECT * INTO v_request FROM leave_requests
  WHERE id=p_request_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',FALSE,'error','NOT_FOUND','message','Leave request not found.'); END IF;
  IF LOWER(v_request.status) <> 'pending' THEN
    RETURN jsonb_build_object('success',FALSE,'error','CANNOT_CANCEL','message','Only pending leave requests can be cancelled.');
  END IF;
  UPDATE leave_requests SET status='cancelled',cancelled_at=NOW() WHERE id=p_request_id;
  INSERT INTO leave_application_audit(leave_request_id,user_id,actor_id,action,old_status,new_status,days)
  VALUES(p_request_id,p_user_id,p_user_id,'CANCELLED','pending','cancelled',v_request.requested_days);
  RETURN jsonb_build_object('success',TRUE,'status','cancelled','message','Leave request cancelled.');
END;
$$;

CREATE OR REPLACE FUNCTION rpc_grant_comp_off_credit(
  p_user_id UUID,
  p_admin_id UUID,
  p_days NUMERIC,
  p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_admin_id AND UPPER(role) IN ('ADMIN','SYSTEM_ADMIN','HR','HRD','HR_MANAGER')) THEN
    RETURN jsonb_build_object('success',FALSE,'error','FORBIDDEN','message','Only HR/admin can grant comp off.');
  END IF;
  IF p_days IS NULL OR p_days <= 0 OR p_days > 31 THEN
    RETURN jsonb_build_object('success',FALSE,'error','INVALID_DAYS','message','Comp-off credit must be between 0 and 31 days.');
  END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 3 THEN
    RETURN jsonb_build_object('success',FALSE,'error','REASON_REQUIRED','message','Enter the reason for granting comp off.');
  END IF;
  INSERT INTO leave_balance(user_id,comp_off) VALUES(p_user_id,p_days)
  ON CONFLICT(user_id) DO UPDATE SET comp_off=leave_balance.comp_off+EXCLUDED.comp_off,updated_at=NOW();
  INSERT INTO leave_application_audit(user_id,actor_id,action,days,notes)
  VALUES(p_user_id,p_admin_id,'COMP_OFF_GRANTED',p_days,TRIM(p_reason));
  RETURN jsonb_build_object('success',TRUE,'message','Comp-off balance granted.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',FALSE,'error',SQLERRM,'message','Unable to grant comp off: '||SQLERRM);
END;
$$;

-- Server-side monthly accrual. The month ledger makes the operation idempotent,
-- unlike the old per-device "increment on login" behavior.
CREATE OR REPLACE FUNCTION accrue_monthly_casual_leave(
  p_month_start DATE DEFAULT date_trunc('month',(NOW() AT TIME ZONE 'Asia/Kolkata'))::DATE,
  p_days NUMERIC DEFAULT 1
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  IF p_month_start <> date_trunc('month',p_month_start)::DATE OR p_days <= 0 THEN
    RETURN jsonb_build_object('success',FALSE,'error','INVALID_ACCRUAL');
  END IF;
  INSERT INTO leave_accrual_runs(month_start,casual_days) VALUES(p_month_start,p_days)
  ON CONFLICT(month_start) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',TRUE,'already_processed',TRUE,'month',p_month_start); END IF;

  INSERT INTO leave_balance(user_id,sick,casual,earned,comp_off)
  SELECT p.id,0,0,0,0 FROM profiles p
  WHERE COALESCE(p.is_active,TRUE) AND UPPER(p.role) NOT IN ('ADMIN','SYSTEM_ADMIN','HR','HRD','HR_MANAGER')
  ON CONFLICT(user_id) DO NOTHING;
  UPDATE leave_balance lb SET casual=lb.casual+p_days,updated_at=NOW()
  FROM profiles p WHERE p.id=lb.user_id AND COALESCE(p.is_active,TRUE)
    AND UPPER(p.role) NOT IN ('ADMIN','SYSTEM_ADMIN','HR','HRD','HR_MANAGER');
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE leave_accrual_runs SET processed_count=v_count,processed_at=NOW() WHERE month_start=p_month_start;
  RETURN jsonb_build_object('success',TRUE,'already_processed',FALSE,'month',p_month_start,'updated',v_count);
END;
$$;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='monthly-casual-leave-accrual';
    PERFORM cron.schedule('monthly-casual-leave-accrual','35 18 28-31 * *',
      $job$SELECT accrue_monthly_casual_leave(date_trunc('month',(NOW() AT TIME ZONE 'Asia/Kolkata'))::DATE,1) WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))=1$job$);
  ELSE
    RAISE NOTICE 'pg_cron unavailable: schedule accrue_monthly_casual_leave() for the first day of each IST month.';
  END IF;
END $$;

-- Populate requested_days for historical rows so HR approval is deterministic.
UPDATE leave_requests
SET requested_days = CASE WHEN is_half_day THEN 0.5 ELSE leave_working_days(user_id,start_date,end_date) END
WHERE requested_days IS NULL;

-- Keep attendance status tied to the canonical leave workflow.
CREATE OR REPLACE FUNCTION get_attendance_status(p_user_id UUID,p_date DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_profile RECORD; v_att RECORD; v_leave RECORD;
  v_status TEXT := 'A'; v_source TEXT := NULL; v_minutes INTEGER := 0;
  v_week_number INTEGER := ((EXTRACT(DAY FROM p_date)::INTEGER - 1) / 7) + 1;
BEGIN
  SELECT id,office_id INTO v_profile FROM profiles WHERE id=p_user_id;
  IF EXISTS(SELECT 1 FROM holiday_calendar h WHERE h.holiday_date=p_date AND (h.office_id IS NULL OR h.office_id=v_profile.office_id)) THEN
    RETURN jsonb_build_object('status','H','label','Holiday','source',NULL);
  END IF;
  IF EXISTS(SELECT 1 FROM weekly_off_rules w WHERE w.is_active
    AND (w.user_id=p_user_id OR (w.user_id IS NULL AND w.office_id=v_profile.office_id))
    AND w.weekday=EXTRACT(DOW FROM p_date)::INTEGER
    AND (w.week_of_month IS NULL OR w.week_of_month=v_week_number)) THEN
    RETURN jsonb_build_object('status','WO','label','Weekly Off','source',NULL);
  END IF;
  SELECT * INTO v_leave FROM leave_requests l WHERE l.user_id=p_user_id
    AND LOWER(l.status)='approved' AND p_date BETWEEN l.start_date AND l.end_date LIMIT 1;
  IF FOUND THEN
    IF LOWER(v_leave.leave_type)='wfh' THEN RETURN jsonb_build_object('status','WFH','label','Work From Home','source',NULL); END IF;
    IF COALESCE(v_leave.is_half_day,FALSE) THEN RETURN jsonb_build_object('status','HD','label','Half Day Leave','source',NULL); END IF;
    RETURN jsonb_build_object('status','L','label','Leave','source',NULL);
  END IF;
  SELECT * INTO v_att FROM attendance_logs a WHERE a.user_id=p_user_id AND a.date=p_date ORDER BY a.created_at LIMIT 1;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM field_visits f WHERE f.user_id=p_user_id AND f.date=p_date AND f.checkin_time IS NOT NULL) THEN
      RETURN jsonb_build_object('status','FV','label','Field Visit','source','APP');
    END IF;
    RETURN jsonb_build_object('status','A','label','Absent','source',NULL);
  END IF;
  v_source:=CASE WHEN v_att.attendance_type='BIOMETRIC' OR COALESCE(v_att.smartoffice_imported,FALSE) THEN 'BIO' ELSE 'APP' END;
  IF v_att.status IN ('AUTO_CHECKED_OUT','AUTO_CLOSED') THEN v_status:='AUTO-CO';
  ELSIF v_att.checkin_time IS NOT NULL AND v_att.checkout_time IS NULL AND p_date<(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE THEN v_status:='P-NC';
  ELSE
    IF v_att.checkout_time IS NOT NULL THEN v_minutes:=EXTRACT(EPOCH FROM(v_att.checkout_time-v_att.checkin_time))/60; END IF;
    IF v_minutes>0 AND v_minutes<240 THEN v_status:='HD';
    ELSIF (v_att.checkin_time AT TIME ZONE 'Asia/Kolkata')::TIME>TIME '10:30' THEN v_status:='PL';
    ELSE v_status:='P'; END IF;
  END IF;
  RETURN jsonb_build_object('status',v_status,'label',CASE v_status WHEN 'P' THEN 'Present' WHEN 'PL' THEN 'Present Late' WHEN 'HD' THEN 'Half Day' WHEN 'P-NC' THEN 'Present No Checkout' WHEN 'AUTO-CO' THEN 'Auto Checked Out' ELSE v_status END,'source',v_source);
END;
$$;

SELECT 'Complete leave and attendance calendar workflow installed' AS status;
