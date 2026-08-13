-- ============================================================
-- Fix: attendance_checkout_protection.sql bugs
-- 1. rpc_admin_correct_attendance referenced non-existent columns
--    old_checkin_at / new_checkin_at in attendance_audit_logs
-- 2. Add pg_cron schedule for auto_close_stale_attendance
-- ============================================================

-- ── 1. Fix rpc_admin_correct_attendance ──────────────────────────────────────
-- The original INSERT into attendance_audit_logs used old_checkin_at /
-- new_checkin_at which don't exist in that table (only old_checkout_at /
-- new_checkout_at exist). This caused the RPC to throw on every admin correction.

CREATE OR REPLACE FUNCTION rpc_admin_correct_attendance(
  p_admin_id     UUID,
  p_attendance_id UUID,
  p_new_checkin  TIMESTAMPTZ DEFAULT NULL,
  p_new_checkout TIMESTAMPTZ DEFAULT NULL,
  p_new_status   VARCHAR     DEFAULT NULL,
  p_reason       TEXT        DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_record   RECORD;
  v_audit_id UUID;
BEGIN
  -- Validate admin role
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_admin_id AND role IN ('admin', 'hr', 'hr_manager', 'HRD', 'SYSTEM_ADMIN', 'ADMIN', 'HR')
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error',   'FORBIDDEN',
      'message', 'Only admin/HR users can correct attendance records.'
    );
  END IF;

  -- Require reason
  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error',   'REASON_REQUIRED',
      'message', 'A reason is required for attendance correction.'
    );
  END IF;

  -- Fetch current record
  SELECT * INTO v_record FROM attendance_logs WHERE id = p_attendance_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error',   'NOT_FOUND',
      'message', 'Attendance record not found.'
    );
  END IF;

  -- Apply corrections
  UPDATE attendance_logs SET
    checkin_time      = COALESCE(p_new_checkin,  checkin_time),
    checkout_time     = COALESCE(p_new_checkout, checkout_time),
    status            = COALESCE(p_new_status::VARCHAR, status),
    corrected_by      = p_admin_id,
    correction_reason = p_reason,
    updated_at        = NOW()
  WHERE id = p_attendance_id;

  -- Audit log — only uses columns that actually exist in attendance_audit_logs
  INSERT INTO attendance_audit_logs (
    attendance_id, user_id, action,
    old_status,        new_status,
    old_checkout_at,   new_checkout_at,
    reason, source
  ) VALUES (
    p_attendance_id, v_record.user_id, 'ADMIN_CORRECT',
    v_record.status,  COALESCE(p_new_status, v_record.status),
    v_record.checkout_time, p_new_checkout,
    p_reason, 'ADMIN'
  ) RETURNING id INTO v_audit_id;

  UPDATE attendance_logs SET last_audit_id = v_audit_id WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'success',   TRUE,
    'message',   'Attendance record corrected successfully',
    'record_id', p_attendance_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', FALSE,
    'error',   SQLERRM,
    'message', 'Failed to correct attendance: ' || SQLERRM
  );
END;
$$;

-- ── 2. Schedule auto_close_stale_attendance via pg_cron ──────────────────────
-- Runs every day at 00:05 IST (18:35 UTC previous day).
-- pg_cron must be enabled in Supabase: Dashboard → Database → Extensions → pg_cron
--
-- If pg_cron is not available, you can call auto_close_stale_attendance()
-- manually or via a Supabase Edge Function on a schedule.

DO $$
BEGIN
  -- Only schedule if pg_cron extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove any existing schedule with this name first
    PERFORM cron.unschedule('auto-close-stale-attendance')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'auto-close-stale-attendance'
    );

    -- Schedule: 18:35 UTC = 00:05 IST next day
    PERFORM cron.schedule(
      'auto-close-stale-attendance',
      '35 18 * * *',
      $cmd$SELECT auto_close_stale_attendance()$cmd$
    );

    RAISE NOTICE 'pg_cron job scheduled: auto-close-stale-attendance at 18:35 UTC (00:05 IST)';
  ELSE
    RAISE NOTICE 'pg_cron not available. Run auto_close_stale_attendance() manually or via Edge Function.';
  END IF;
END;
$$;

-- ── 3. Verify ────────────────────────────────────────────────────────────────
SELECT 'rpc_admin_correct_attendance fixed' AS status;
SELECT 'Run: SELECT * FROM auto_close_stale_attendance(); to test auto-close' AS tip;
