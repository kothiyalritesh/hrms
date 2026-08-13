-- ============================================================
-- Fix: Stale checkout bugs
--
-- Root cause 1: earliest_checkout_time was bypassable with a reason.
--   Both min_work_duration AND earliest_checkout_time set the same
--   v_is_early flag, so providing a reason bypassed BOTH checks.
--   Fix: split into two independent gates.
--     - earliest_checkout_time  → HARD BLOCK, no bypass ever
--     - min_work_duration       → soft block, bypassable with reason
--
-- Root cause 2: rpc_attendance_checkout could operate on a previous-day
--   CHECKED_IN record if the employee forgot to check out yesterday and
--   hasn't checked in today yet. The ORDER BY date DESC picks the most
--   recent open record regardless of date.
--   Fix: add a DATE_MISMATCH guard — if the open record is from a
--   previous day AND today has no check-in, block checkout and tell
--   the employee to check in for today first (the check-in RPC will
--   auto-close the stale record).
-- ============================================================

CREATE OR REPLACE FUNCTION rpc_attendance_checkout(
  p_user_id          UUID,
  p_checkout_location JSONB    DEFAULT NULL,
  p_reason           TEXT     DEFAULT NULL,
  p_force            BOOLEAN  DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_today            DATE        := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_now              TIMESTAMPTZ := NOW();
  v_attendance       RECORD;
  v_policy           RECORD;
  v_worked_minutes   INTEGER;
  v_min_work         INTEGER;
  v_earliest_checkout TIME;
  v_current_ist_time  TIME;
  v_is_time_blocked  BOOLEAN := FALSE;   -- hard block: before earliest_checkout_time
  v_is_duration_early BOOLEAN := FALSE;  -- soft block: under min_work_duration
  v_audit_id         UUID;
  v_checkout_time    TIMESTAMPTZ;
  v_undo_expires     TIMESTAMPTZ;
  v_undo_token       UUID;
BEGIN
  -- ── STEP 1: Find the active attendance record ─────────────────────────────
  SELECT al.* INTO v_attendance
  FROM attendance_logs al
  WHERE al.user_id = p_user_id
    AND al.status IN ('CHECKED_IN', 'CHECKOUT_REQUESTED')
    AND al.checkout_time IS NULL
  ORDER BY al.date DESC, al.checkin_time DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error',   'NO_ACTIVE_SESSION',
      'message', 'No active check-in session found. Please check in first.'
    );
  END IF;

  -- ── STEP 2: Guard — stale previous-day record ─────────────────────────────
  -- If the open record belongs to a PREVIOUS day AND the employee has NOT
  -- checked in for today, block checkout entirely.
  -- Rationale: the employee should check in for today first; the check-in RPC
  -- will auto-close the stale record. Allowing checkout here would stamp
  -- today's time onto yesterday's record, corrupting worked-hours data.
  IF v_attendance.date < v_today AND NOT p_force THEN
    -- Check whether today already has a check-in (edge: they checked in today
    -- but the query above returned yesterday's record — shouldn't happen, but
    -- be safe).
    IF NOT EXISTS (
      SELECT 1 FROM attendance_logs
      WHERE user_id = p_user_id
        AND date = v_today
        AND checkin_time IS NOT NULL
    ) THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'error',   'STALE_RECORD',
        'message', 'Your last check-in was on ' ||
                   TO_CHAR(v_attendance.date, 'DD Mon YYYY') ||
                   '. Please check in for today first — your previous session will be closed automatically.'
      );
    END IF;
    -- Today has a check-in but the query still returned yesterday's record
    -- (shouldn't happen after rpcCheckIn auto-closes, but handle it):
    -- Re-fetch today's record.
    SELECT al.* INTO v_attendance
    FROM attendance_logs al
    WHERE al.user_id = p_user_id
      AND al.date = v_today
      AND al.status IN ('CHECKED_IN', 'CHECKOUT_REQUESTED')
      AND al.checkout_time IS NULL
    ORDER BY al.checkin_time DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'error',   'NO_ACTIVE_SESSION',
        'message', 'No active check-in found for today. Please check in first.'
      );
    END IF;
  END IF;

  -- ── STEP 3: Load policy ───────────────────────────────────────────────────
  SELECT * INTO v_policy FROM get_attendance_policy(p_user_id);

  -- ── STEP 4: Calculate worked duration ────────────────────────────────────
  v_worked_minutes := GREATEST(
    0,
    EXTRACT(EPOCH FROM (v_now - v_attendance.checkin_time)) / 60
  )::INTEGER;

  v_min_work          := COALESCE(v_policy.min_work_duration_minutes, 240);
  v_earliest_checkout := COALESCE(v_policy.earliest_checkout_time, '14:00')::TIME;
  -- Use IST time for the wall-clock check
  v_current_ist_time  := (v_now AT TIME ZONE 'Asia/Kolkata')::TIME;

  -- ── STEP 5: Apply policy gates (skip entirely when p_force = TRUE) ────────
  IF NOT p_force THEN

    -- Gate A — HARD BLOCK: before earliest_checkout_time
    -- Night-shift employees are exempt (their check-in date < today).
    IF NOT COALESCE(v_policy.allow_night_shift, FALSE)
       AND v_current_ist_time < v_earliest_checkout
    THEN
      v_is_time_blocked := TRUE;
      RETURN jsonb_build_object(
        'success',          FALSE,
        'error',            'BEFORE_EARLIEST_CHECKOUT',
        'message',          'Checkout is not allowed before ' ||
                            TO_CHAR(v_earliest_checkout, 'HH12:MI AM') ||
                            ' IST. Current time: ' ||
                            TO_CHAR(v_current_ist_time, 'HH12:MI AM') || ' IST.',
        'earliest_checkout_time', v_policy.earliest_checkout_time,
        'worked_minutes',   v_worked_minutes,
        'is_time_blocked',  TRUE
      );
    END IF;

    -- Gate B — SOFT BLOCK: under minimum work duration
    -- Bypassable by providing a reason.
    IF v_worked_minutes < v_min_work THEN
      v_is_duration_early := TRUE;
      IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
        RETURN jsonb_build_object(
          'success',          FALSE,
          'error',            'EARLY_CHECKOUT_NO_REASON',
          'message',          'You checked in at ' ||
                              TO_CHAR(v_attendance.checkin_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') ||
                              ' and have worked only ' ||
                              (v_worked_minutes / 60) || 'h ' ||
                              (v_worked_minutes % 60) || 'm. ' ||
                              'Minimum required: ' ||
                              (v_min_work / 60) || 'h ' ||
                              (v_min_work % 60) || 'm. ' ||
                              'Please provide a reason for early checkout.',
          'worked_minutes',   v_worked_minutes,
          'required_minimum', v_min_work,
          'is_early',         TRUE
        );
      END IF;
    END IF;

  END IF;

  -- ── STEP 6: Generate undo token ──────────────────────────────────────────
  v_undo_token   := gen_random_uuid();
  v_undo_expires := v_now + (COALESCE(v_policy.undo_checkout_minutes, 5) || ' minutes')::INTERVAL;
  v_checkout_time := v_now;

  -- ── STEP 7: Perform checkout ──────────────────────────────────────────────
  UPDATE attendance_logs SET
    checkout_time         = v_checkout_time,
    checkout_location     = p_checkout_location,
    checkout_source       = CASE
                              WHEN p_force            THEN 'ADMIN'
                              WHEN v_is_duration_early THEN 'APP_EARLY'
                              ELSE 'APP'
                            END,
    early_checkout_reason = CASE WHEN v_is_duration_early THEN p_reason ELSE NULL END,
    undo_token            = v_undo_token,
    undo_expires_at       = v_undo_expires,
    status                = 'CHECKED_OUT',
    updated_at            = v_now
  WHERE id = v_attendance.id;

  -- ── STEP 8: Audit log ─────────────────────────────────────────────────────
  INSERT INTO attendance_audit_logs (
    attendance_id, user_id, action,
    old_status,    new_status,
    old_checkout_at, new_checkout_at,
    reason, source
  ) VALUES (
    v_attendance.id, p_user_id,
    CASE
      WHEN p_force             THEN 'ADMIN_CORRECT'
      WHEN v_is_duration_early THEN 'CHECKOUT_EARLY'
      ELSE 'CHECKOUT_MANUAL'
    END,
    v_attendance.status, 'CHECKED_OUT',
    NULL, v_checkout_time,
    CASE
      WHEN p_force             THEN 'Forced checkout by admin'
      WHEN v_is_duration_early THEN p_reason
      ELSE 'Manual checkout'
    END,
    CASE WHEN p_force THEN 'ADMIN' ELSE 'APP' END
  ) RETURNING id INTO v_audit_id;

  UPDATE attendance_logs SET last_audit_id = v_audit_id WHERE id = v_attendance.id;

  -- ── STEP 9: Return result ─────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',        TRUE,
    'id',             v_attendance.id,
    'checkin_time',   v_attendance.checkin_time,
    'checkout_time',  v_checkout_time,
    'worked_minutes', v_worked_minutes,
    'status',         'CHECKED_OUT',
    'is_early',       v_is_duration_early,
    'early_reason',   CASE WHEN v_is_duration_early THEN p_reason ELSE NULL END,
    'undo_token',     v_undo_token,
    'undo_expires_at', v_undo_expires,
    'message',        'Checkout successful'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', FALSE,
    'error',   SQLERRM,
    'message', 'Checkout failed: ' || SQLERRM
  );
END;
$$;

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT 'rpc_attendance_checkout patched — stale-record guard + hard time wall' AS status;
