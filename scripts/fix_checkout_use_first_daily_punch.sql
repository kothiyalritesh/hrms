-- Synchronize the attendance row to the employee's earliest arrival before
-- checkout. This works with both the legacy and strict checkout RPC versions.
-- The accidental-checkout rule is duration-based (30 minutes), so disable the
-- legacy fixed 14:00 clock-time rule that was flagging employees after 5+ hours.
UPDATE attendance_policies
SET earliest_checkout_time='18:30',
    min_work_duration_minutes=30,
    updated_at=NOW()
WHERE is_active=TRUE;

-- Legacy early-checkout attempts changed an open row to CHECKOUT_REQUESTED.
-- It is still an active attendance session, so normalize existing open rows.
UPDATE attendance_logs
SET status='CHECKED_IN', updated_at=NOW()
WHERE status='CHECKOUT_REQUESTED' AND checkout_time IS NULL;

CREATE OR REPLACE FUNCTION rpc_sync_first_daily_checkin(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_attendance RECORD;
  v_bio_checkin TIMESTAMPTZ;
  v_effective TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success',FALSE,'error','FORBIDDEN');
  END IF;
  SELECT * INTO v_attendance FROM attendance_logs
  WHERE user_id=p_user_id AND date=v_today ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',FALSE,'error','NO_ATTENDANCE'); END IF;

  SELECT ((v_today::TEXT||' '||MIN(log_time)::TEXT)::TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
  INTO v_bio_checkin FROM smartoffice_device_logs
  WHERE user_id=p_user_id AND log_date_only=v_today;

  v_effective:=LEAST(v_attendance.checkin_time,v_bio_checkin);
  v_effective:=COALESCE(v_effective,v_attendance.checkin_time,v_bio_checkin);
  IF v_effective IS NOT NULL AND v_effective IS DISTINCT FROM v_attendance.checkin_time THEN
    UPDATE attendance_logs SET checkin_time=v_effective,updated_at=NOW() WHERE id=v_attendance.id;
  END IF;
  RETURN jsonb_build_object('success',TRUE,'attendance_id',v_attendance.id,'effective_checkin_time',v_effective,'app_checkin_time',v_attendance.checkin_time,'biometric_checkin_time',v_bio_checkin);
END; $$;
