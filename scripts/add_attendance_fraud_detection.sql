-- Attendance GPS fraud evidence and scoring.
CREATE TABLE IF NOT EXISTS attendance_fraud_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID REFERENCES attendance_logs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  severity TEXT NOT NULL CHECK (severity IN ('NORMAL', 'WARNING', 'SUSPICIOUS')),
  reasons JSONB NOT NULL DEFAULT '[]'::JSONB,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  accuracy_m DOUBLE PRECISION,
  is_mocked BOOLEAN DEFAULT FALSE,
  developer_mode BOOLEAN DEFAULT FALSE,
  ip_latitude DOUBLE PRECISION,
  ip_longitude DOUBLE PRECISION,
  ip_gps_distance_m INTEGER,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES profiles(id),
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_fraud_score ON attendance_fraud_events(score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_fraud_user ON attendance_fraud_events(user_id, created_at DESC);
ALTER TABLE attendance_fraud_events DISABLE ROW LEVEL SECURITY;

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS fraud_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fraud_severity TEXT DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS fraud_reasons JSONB DEFAULT '[]'::JSONB;

CREATE OR REPLACE FUNCTION rpc_analyze_attendance_fraud(
  p_user_id UUID,
  p_attendance_id UUID,
  p_event_type TEXT,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_accuracy_m DOUBLE PRECISION DEFAULT NULL,
  p_is_mocked BOOLEAN DEFAULT FALSE,
  p_developer_mode BOOLEAN DEFAULT FALSE,
  p_ip_latitude DOUBLE PRECISION DEFAULT NULL,
  p_ip_longitude DOUBLE PRECISION DEFAULT NULL,
  p_office_distance_m INTEGER DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_score INTEGER := 0;
  v_reasons JSONB := '[]'::JSONB;
  v_severity TEXT;
  v_ip_distance INTEGER;
  v_same_location_count INTEGER := 0;
  v_boundary_count INTEGER := 0;
  v_previous RECORD;
  v_travel_distance INTEGER;
  v_elapsed_seconds NUMERIC;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'FORBIDDEN');
  END IF;

  IF COALESCE(p_is_mocked, FALSE) THEN
    v_score := v_score + 70;
    v_reasons := v_reasons || jsonb_build_array('Mock location reported by device');
  END IF;
  IF COALESCE(p_developer_mode, FALSE) THEN
    v_score := v_score + 20;
    v_reasons := v_reasons || jsonb_build_array('Developer mode enabled');
  END IF;
  IF p_accuracy_m IS NULL OR p_accuracy_m > 100 THEN
    v_score := v_score + 25;
    v_reasons := v_reasons || jsonb_build_array('Poor GPS accuracy');
  END IF;

  IF p_ip_latitude IS NOT NULL AND p_ip_longitude IS NOT NULL THEN
    v_ip_distance := ROUND(6371000 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(p_ip_latitude - p_latitude) / 2), 2) +
      COS(RADIANS(p_latitude)) * COS(RADIANS(p_ip_latitude)) *
      POWER(SIN(RADIANS(p_ip_longitude - p_longitude) / 2), 2)
    )))::INTEGER;
    IF v_ip_distance > 50000 THEN
      v_score := v_score + 25;
      v_reasons := v_reasons || jsonb_build_array('VPN/IP location differs from GPS by over 50km');
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_same_location_count
  FROM attendance_fraud_events f
  WHERE f.user_id <> p_user_id
    AND f.created_at > NOW() - INTERVAL '15 minutes'
    AND ROUND(6371000 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(f.latitude - p_latitude) / 2), 2) +
      COS(RADIANS(p_latitude)) * COS(RADIANS(f.latitude)) *
      POWER(SIN(RADIANS(f.longitude - p_longitude) / 2), 2)
    ))) <= 5;
  IF v_same_location_count >= 2 THEN
    v_score := v_score + 30;
    v_reasons := v_reasons || jsonb_build_array('Same GPS coordinates used by multiple employees');
  END IF;

  SELECT latitude, longitude, recorded_at INTO v_previous
  FROM location_tracking
  WHERE user_id = p_user_id AND latitude IS NOT NULL AND longitude IS NOT NULL
  ORDER BY recorded_at DESC LIMIT 1;
  IF FOUND THEN
    v_elapsed_seconds := EXTRACT(EPOCH FROM (NOW() - v_previous.recorded_at));
    v_travel_distance := ROUND(6371000 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(v_previous.latitude - p_latitude) / 2), 2) +
      COS(RADIANS(p_latitude)) * COS(RADIANS(v_previous.latitude)) *
      POWER(SIN(RADIANS(v_previous.longitude - p_longitude) / 2), 2)
    )))::INTEGER;
    IF v_elapsed_seconds BETWEEN 1 AND 120 AND v_travel_distance > 20000 THEN
      v_score := v_score + 45;
      v_reasons := v_reasons || jsonb_build_array('Impossible travel: over 20km within two minutes');
    END IF;
  END IF;

  IF p_office_distance_m BETWEEN 90 AND 110 THEN
    SELECT COUNT(*) INTO v_boundary_count FROM attendance_fraud_events
    WHERE user_id = p_user_id
      AND created_at > NOW() - INTERVAL '30 days'
      AND reasons ? 'Boundary-range check-in';
    v_reasons := v_reasons || jsonb_build_array('Boundary-range check-in');
    IF v_boundary_count >= 2 THEN v_score := v_score + 15; END IF;
  END IF;

  v_score := LEAST(v_score, 100);
  v_severity := CASE WHEN v_score <= 30 THEN 'NORMAL' WHEN v_score <= 60 THEN 'WARNING' ELSE 'SUSPICIOUS' END;

  INSERT INTO attendance_fraud_events (
    attendance_id, user_id, event_type, score, severity, reasons,
    latitude, longitude, accuracy_m, is_mocked, developer_mode,
    ip_latitude, ip_longitude, ip_gps_distance_m
  ) VALUES (
    p_attendance_id, p_user_id, UPPER(p_event_type), v_score, v_severity, v_reasons,
    p_latitude, p_longitude, p_accuracy_m, p_is_mocked, p_developer_mode,
    p_ip_latitude, p_ip_longitude, v_ip_distance
  );

  IF p_attendance_id IS NOT NULL THEN
    UPDATE attendance_logs SET fraud_score = v_score, fraud_severity = v_severity, fraud_reasons = v_reasons
    WHERE id = p_attendance_id;
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'score', v_score, 'severity', v_severity, 'reasons', v_reasons);
END;
$$;

