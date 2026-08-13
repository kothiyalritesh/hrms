CREATE TABLE IF NOT EXISTS holiday_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date DATE NOT NULL,
  name TEXT NOT NULL,
  office_id UUID REFERENCES offices(id) ON DELETE CASCADE,
  is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(holiday_date, office_id)
);

CREATE TABLE IF NOT EXISTS weekly_off_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  office_id UUID REFERENCES offices(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  week_of_month INTEGER CHECK (week_of_month BETWEEN 1 AND 5),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR office_id IS NOT NULL)
);

ALTER TABLE holiday_calendar DISABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_off_rules DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_attendance_status(
  p_user_id UUID,
  p_date DATE
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_profile RECORD; v_att RECORD; v_leave RECORD;
  v_status TEXT := 'A'; v_source TEXT := NULL; v_minutes INTEGER := 0;
  v_week_number INTEGER := ((EXTRACT(DAY FROM p_date)::INTEGER - 1) / 7) + 1;
BEGIN
  SELECT id, office_id INTO v_profile FROM profiles WHERE id = p_user_id;
  IF EXISTS (SELECT 1 FROM holiday_calendar h WHERE h.holiday_date = p_date AND (h.office_id IS NULL OR h.office_id = v_profile.office_id)) THEN
    RETURN jsonb_build_object('status','H','label','Holiday','source',NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM weekly_off_rules w WHERE w.is_active AND (w.user_id = p_user_id OR (w.user_id IS NULL AND w.office_id = v_profile.office_id))
    AND w.weekday = EXTRACT(DOW FROM p_date)::INTEGER AND (w.week_of_month IS NULL OR w.week_of_month = v_week_number)) THEN
    RETURN jsonb_build_object('status','WO','label','Weekly Off','source',NULL);
  END IF;
  SELECT * INTO v_leave FROM leave_requests l WHERE l.user_id = p_user_id AND LOWER(l.status) = 'approved' AND p_date BETWEEN l.start_date AND l.end_date LIMIT 1;
  IF FOUND THEN
    IF LOWER(v_leave.leave_type) = 'wfh' THEN RETURN jsonb_build_object('status','WFH','label','Work From Home','source',NULL); END IF;
    RETURN jsonb_build_object('status','L','label','Leave','source',NULL);
  END IF;
  SELECT * INTO v_att FROM attendance_logs a WHERE a.user_id = p_user_id AND a.date = p_date ORDER BY a.created_at LIMIT 1;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM field_visits f WHERE f.user_id = p_user_id AND f.date = p_date AND f.checkin_time IS NOT NULL) THEN
      RETURN jsonb_build_object('status','FV','label','Field Visit','source','APP');
    END IF;
    RETURN jsonb_build_object('status','A','label','Absent','source',NULL);
  END IF;
  v_source := CASE WHEN v_att.attendance_type = 'BIOMETRIC' OR COALESCE(v_att.smartoffice_imported,FALSE) THEN 'BIO' ELSE 'APP' END;
  IF v_att.status IN ('AUTO_CHECKED_OUT','AUTO_CLOSED') THEN v_status := 'AUTO-CO';
  ELSIF v_att.checkin_time IS NOT NULL AND v_att.checkout_time IS NULL AND p_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE THEN v_status := 'P-NC';
  ELSE
    IF v_att.checkout_time IS NOT NULL THEN v_minutes := EXTRACT(EPOCH FROM (v_att.checkout_time-v_att.checkin_time))/60; END IF;
    IF v_minutes > 0 AND v_minutes < 240 THEN v_status := 'HD';
    ELSIF (v_att.checkin_time AT TIME ZONE 'Asia/Kolkata')::TIME > TIME '10:30' THEN v_status := 'PL';
    ELSE v_status := 'P'; END IF;
  END IF;
  RETURN jsonb_build_object('status',v_status,'label',CASE v_status WHEN 'P' THEN 'Present' WHEN 'PL' THEN 'Present Late' WHEN 'HD' THEN 'Half Day' WHEN 'P-NC' THEN 'Present No Checkout' WHEN 'AUTO-CO' THEN 'Auto Checked Out' ELSE v_status END,'source',v_source);
END;
$$;

