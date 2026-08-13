-- ============================================================
-- Run this ALONE in Supabase SQL Editor (no cron line)
-- ============================================================

CREATE OR REPLACE FUNCTION check_stale_location_pings()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  rec           RECORD;
  last_ping     TIMESTAMP;
  minutes_stale INTEGER;
BEGIN
  FOR rec IN
    SELECT p.id AS user_id, p.name AS user_name
    FROM profiles p
    INNER JOIN attendance_logs al
      ON al.user_id = p.id
      AND al.date = CURRENT_DATE
      AND al.checkin_time IS NOT NULL
      AND al.checkout_time IS NULL
    WHERE p.is_active = TRUE
  LOOP
    SELECT recorded_at INTO last_ping
    FROM location_tracking
    WHERE user_id = rec.user_id AND date = CURRENT_DATE
    ORDER BY recorded_at DESC LIMIT 1;

    IF last_ping IS NULL THEN
      SELECT checkin_time INTO last_ping
      FROM attendance_logs
      WHERE user_id = rec.user_id AND date = CURRENT_DATE LIMIT 1;
    END IF;

    minutes_stale := EXTRACT(EPOCH FROM (NOW() - last_ping)) / 60;

    IF minutes_stale >= 15 THEN
      IF NOT EXISTS (
        SELECT 1 FROM location_alerts
        WHERE user_id = rec.user_id
          AND alert_type = 'NO_DATA'
          AND resolved = FALSE
          AND created_at > NOW() - INTERVAL '30 minutes'
      ) THEN
        INSERT INTO location_alerts (user_id, alert_type, message, escalation_level)
        VALUES (
          rec.user_id, 'NO_DATA',
          '⚠️ ' || rec.user_name || ' — no location ping for ' || minutes_stale || ' minutes.',
          CASE WHEN minutes_stale >= 30 THEN 2 ELSE 1 END
        );

        INSERT INTO notifications (user_id, title, message, type)
        SELECT em.user_id,
          '⚠️ No Location — ' || rec.user_name,
          rec.user_name || ' has not shared location for ' || minutes_stale || ' minutes.',
          'location_alert'
        FROM escalation_matrix em WHERE em.notify_no_data = TRUE;

        INSERT INTO notifications (user_id, title, message, type)
        VALUES (
          rec.user_id,
          '📍 Location Sharing Paused',
          'Your location hasn''t been shared for ' || minutes_stale || ' minutes. Please open the app.',
          'location_reminder'
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

SELECT 'check_stale_location_pings created' AS status;
