-- ============================================================
-- Live Location Tracking & Escalation Matrix
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Location pings — stores every GPS heartbeat from employees
CREATE TABLE IF NOT EXISTS location_tracking (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  accuracy      DOUBLE PRECISION,
  distance_from_base DOUBLE PRECISION,   -- metres from assigned/checkin location
  status        VARCHAR(20) NOT NULL DEFAULT 'GREEN'
                CHECK (status IN ('GREEN','YELLOW','ORANGE','RED_RANGE','RED_GPS_OFF')),
  gps_available BOOLEAN NOT NULL DEFAULT TRUE,
  recorded_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  date          DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX IF NOT EXISTS idx_lt_user_date ON location_tracking(user_id, date);
CREATE INDEX IF NOT EXISTS idx_lt_recorded  ON location_tracking(recorded_at DESC);
ALTER TABLE location_tracking DISABLE ROW LEVEL SECURITY;

-- 2. Alerts log
CREATE TABLE IF NOT EXISTS location_alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  alert_type  VARCHAR(30) NOT NULL
              CHECK (alert_type IN ('GPS_OFF','OUT_OF_RANGE','NO_DATA','BACK_IN_RANGE','GPS_RESTORED')),
  message     TEXT NOT NULL,
  distance_m  DOUBLE PRECISION,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_la_user      ON location_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_la_created   ON location_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_la_resolved  ON location_alerts(resolved);
ALTER TABLE location_alerts DISABLE ROW LEVEL SECURITY;

-- 3. Escalation matrix — who gets notified
CREATE TABLE IF NOT EXISTS escalation_matrix (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label      VARCHAR(100),           -- e.g. "HRD", "Admin", "Komal"
  notify_gps_off    BOOLEAN DEFAULT TRUE,
  notify_out_range  BOOLEAN DEFAULT TRUE,
  notify_no_data    BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);
ALTER TABLE escalation_matrix DISABLE ROW LEVEL SECURITY;

-- 4. Add is_escalation_member flag to profiles (quick lookup)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_escalation_member BOOLEAN DEFAULT FALSE;

-- 5. Add assigned_location to profiles (base lat/lng for 500m fence)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS base_latitude  DOUBLE PRECISION;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS base_longitude DOUBLE PRECISION;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS geo_fence_radius INTEGER DEFAULT 500;

-- 6. Latest ping view — one row per employee (most recent ping today)
CREATE OR REPLACE VIEW employee_live_status AS
SELECT DISTINCT ON (lt.user_id)
  lt.user_id,
  p.name,
  p.employee_number,
  p.role,
  lt.latitude,
  lt.longitude,
  lt.distance_from_base,
  lt.status,
  lt.gps_available,
  lt.recorded_at,
  p.base_latitude,
  p.base_longitude,
  p.geo_fence_radius
FROM location_tracking lt
JOIN profiles p ON p.id = lt.user_id
WHERE lt.date = CURRENT_DATE
ORDER BY lt.user_id, lt.recorded_at DESC;

-- 7. Escalation level tracking on alerts (L1=dashboard, L2=notified, L3=auto-escalated)
ALTER TABLE location_alerts ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE location_alerts ADD COLUMN IF NOT EXISTS escalated_at    TIMESTAMP;

-- 8. Auto-escalation log — records when L3 fires (unresolved after 15 min)
CREATE TABLE IF NOT EXISTS escalation_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id    UUID NOT NULL REFERENCES location_alerts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  level       INTEGER NOT NULL DEFAULT 3,
  note        TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_elog_alert ON escalation_log(alert_id);
ALTER TABLE escalation_log DISABLE ROW LEVEL SECURITY;

-- 9. Seed escalation matrix for the 6 named members
--    Replace the phone numbers below with the actual values in your profiles table.
--    This is an UPSERT so it is safe to re-run.
INSERT INTO escalation_matrix (user_id, label, notify_gps_off, notify_out_range, notify_no_data)
SELECT p.id, em.label, TRUE, TRUE, TRUE
FROM (
  VALUES
    ('HRD'),
    ('Admin'),
    ('Komal'),
    ('Kiranpal'),
    ('JP'),
    ('Gaurav Ji')
) AS em(label)
JOIN profiles p ON LOWER(TRIM(p.name)) LIKE LOWER(TRIM(em.label)) || '%'
ON CONFLICT (user_id) DO UPDATE
  SET label             = EXCLUDED.label,
      notify_gps_off    = TRUE,
      notify_out_range  = TRUE,
      notify_no_data    = TRUE;

-- Also flag them in profiles for fast lookup
UPDATE profiles
SET is_escalation_member = TRUE
WHERE id IN (SELECT user_id FROM escalation_matrix);

-- 10. Auto-escalation function (L3) — call via pg_cron or Supabase Edge Function
--     Fires when an alert is unresolved for > 15 minutes and not yet at level 3
CREATE OR REPLACE FUNCTION trigger_l3_escalation() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, user_id, alert_type, message
    FROM location_alerts
    WHERE resolved = FALSE
      AND escalation_level < 3
      AND created_at < NOW() - INTERVAL '15 minutes'
  LOOP
    -- Bump to level 3
    UPDATE location_alerts
    SET escalation_level = 3, escalated_at = NOW()
    WHERE id = rec.id;

    -- Log it
    INSERT INTO escalation_log (alert_id, user_id, level, note)
    VALUES (rec.id, rec.user_id, 3,
      'Auto-escalated: unresolved for 15+ minutes. Type: ' || rec.alert_type);

    -- Notify escalation team with L3 urgency
    INSERT INTO notifications (user_id, title, message, type)
    SELECT em.user_id,
           '🚨 L3 ESCALATION: ' || rec.alert_type,
           '[AUTO] Unresolved 15+ min — ' || rec.message,
           'location_alert'
    FROM escalation_matrix em;
  END LOOP;
END;
$$;

-- To enable pg_cron scheduling (optional):
-- 1. Go to Supabase Dashboard → Database → Extensions
-- 2. Enable the "pg_cron" extension
-- 3. Then run this once:
--    SELECT cron.schedule('l3-escalation', '*/5 * * * *', 'SELECT trigger_l3_escalation()');
--
-- Alternative: call trigger_l3_escalation() from a Supabase Edge Function on a timer,
-- or call it directly from the app via: supabase.rpc('trigger_l3_escalation')

SELECT 'location tracking schema ready' AS status;
