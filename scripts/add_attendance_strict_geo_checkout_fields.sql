-- ============================================================
-- Add strict GPS attendance fields + unique constraint
-- and update attendance RPCs to:
--  1) Enforce strict <= 100m check-in (nearest office)
--  2) Store checkout matched office/location + distance
--  3) Auto-checkout at 23:59 with AUTO_CHECKED_OUT status + flags
-- ============================================================

-- 1) Columns (attendance_logs)
ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS checkin_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkin_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkin_location_id UUID,
  ADD COLUMN IF NOT EXISTS checkin_location_name TEXT,
  ADD COLUMN IF NOT EXISTS checkin_distance_meters INTEGER,

  ADD COLUMN IF NOT EXISTS checkout_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkout_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkout_location_id UUID,
  ADD COLUMN IF NOT EXISTS checkout_location_name TEXT,
  ADD COLUMN IF NOT EXISTS checkout_distance_meters INTEGER,

  ADD COLUMN IF NOT EXISTS auto_checkout BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_checkout_reason TEXT;

-- This script is intentionally safe to run after attendance_checkout_protection.sql.
-- The protected RPCs use these fields for the minimum-duration and undo rules.
ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS checkout_source VARCHAR(20) DEFAULT 'APP',
  ADD COLUMN IF NOT EXISTS early_checkout_reason TEXT,
  ADD COLUMN IF NOT EXISTS undo_token UUID,
  ADD COLUMN IF NOT EXISTS undo_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS correction_reason TEXT;

ALTER TABLE offices
  ADD COLUMN IF NOT EXISTS allowed_radius_meters INTEGER DEFAULT 100;

-- The legacy protection script used a four-hour default. For the accidental
-- tap guard requested here, use a configurable 30-minute default instead.
UPDATE attendance_policies
SET min_work_duration_minutes = 30,
    updated_at = NOW()
WHERE min_work_duration_minutes = 240;

UPDATE offices
SET allowed_radius_meters = COALESCE(allowed_radius_meters, attendance_radius, 100)
WHERE allowed_radius_meters IS NULL;

-- 2) Unique constraint: one attendance record per user per date
-- (attendance_logs already uses date=YYYY-MM-DD)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'attendance_logs_user_id_date_unique'
  ) THEN
    ALTER TABLE attendance_logs
      ADD CONSTRAINT attendance_logs_user_id_date_unique UNIQUE (user_id, date);
  END IF;
END $$;

-- 3) Update RPCs
-- NOTE: We CREATE OR REPLACE to keep this migration self-contained.

CREATE OR REPLACE FUNCTION rpc_attendance_checkin(
  p_user_id UUID,
  p_office_id UUID,
  p_checkin_location JSONB,
  p_distance NUMERIC,
  p_source VARCHAR DEFAULT 'APP'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_now TIMESTAMPTZ := NOW();
  v_existing RECORD;
  v_office_name TEXT;
  v_new_id UUID;
  v_audit_id UUID;

  v_checkin_lat DOUBLE PRECISION;
  v_checkin_lon DOUBLE PRECISION;

  v_dist_int INTEGER;

  v_nearest_office RECORD;
  v_nearest_dist INTEGER := NULL;
BEGIN
  -- Parse incoming coords
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'FORBIDDEN', 'message', 'You cannot create attendance for another employee.');
  END IF;

  IF p_checkin_location IS NULL
     OR NOT (p_checkin_location ? 'latitude')
     OR NOT (p_checkin_location ? 'longitude') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'GPS_REQUIRED', 'message', 'A valid GPS location is required to check in.');
  END IF;

  v_checkin_lat := (p_checkin_location->>'latitude')::DOUBLE PRECISION;
  v_checkin_lon := (p_checkin_location->>'longitude')::DOUBLE PRECISION;
  v_dist_int := COALESCE(p_distance::INTEGER, NULL);

  -- STEP 1: auto-close stale previous-day CHECKED_IN records (keeps system consistent)
  FOR v_existing IN
    SELECT al.id, al.date, al.checkin_time
    FROM attendance_logs al
    WHERE al.user_id = p_user_id
      AND al.date < v_today
      AND al.checkin_time IS NOT NULL
      AND al.checkout_time IS NULL
    ORDER BY al.date ASC
  LOOP
    UPDATE attendance_logs
    SET
      checkout_time = (v_existing.date::TEXT || ' 23:59+05:30')::TIMESTAMPTZ,
      checkout_source = 'SYSTEM',
      status = 'AUTO_CHECKED_OUT',
      auto_checkout = TRUE,
      auto_checkout_reason = 'Day changed / End of day auto checkout',
      updated_at = v_now
    WHERE id = v_existing.id;

    -- best-effort audit
    BEGIN
      INSERT INTO attendance_audit_logs (attendance_id, user_id, action, old_status, new_status, old_checkout_at, new_checkout_at, reason, source)
      VALUES (
        v_existing.id, p_user_id, 'CHECKOUT_AUTO',
        'CHECKED_IN', 'AUTO_CHECKED_OUT',
        NULL,
        (v_existing.date::TEXT || ' 23:59+05:30')::TIMESTAMPTZ,
        'Day changed / End of day auto checkout',
        'SYSTEM'
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  -- STEP 2: prevent duplicates (unique constraint will also protect)
  SELECT id, checkin_time
  INTO v_existing
  FROM attendance_logs
  WHERE user_id = p_user_id AND date = v_today
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_existing.checkin_time IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'existing', TRUE,
      'id', v_existing.id,
      'checkin_time', v_existing.checkin_time,
      'status', (SELECT status FROM attendance_logs WHERE id = v_existing.id),
      'message', 'Already checked in today'
    );
  END IF;

  -- STEP 3: Strict nearest-office enforcement at 100m
  -- Find nearest office from ALL saved offices
  SELECT o.*, 
         ROUND(
           (6371000 * 2 * ASIN(SQRT(
             POWER(SIN(RADIANS(o.latitude - v_checkin_lat)/2),2) +
             COS(RADIANS(v_checkin_lat)) * COS(RADIANS(o.latitude)) *
             POWER(SIN(RADIANS(o.longitude - v_checkin_lon)/2),2)
           )))
         )::INT AS dist_m
  INTO v_nearest_office
  FROM offices o
  WHERE o.latitude IS NOT NULL
    AND o.longitude IS NOT NULL
    AND COALESCE(o.is_active, TRUE) = TRUE
  ORDER BY
    (6371000 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(o.latitude - v_checkin_lat)/2),2) +
      COS(RADIANS(v_checkin_lat)) * COS(RADIANS(o.latitude)) *
      POWER(SIN(RADIANS(o.longitude - v_checkin_lon)/2),2)
    )))
  LIMIT 1;

  IF v_nearest_office.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'NO_OFFICE_LOCATION',
      'message', 'No office location found. Please contact admin.'
    );
  END IF;

  v_nearest_dist := v_nearest_office.dist_m;

  IF v_nearest_dist > 100 THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'OUTSIDE_100M',
      'message', 'You are outside the allowed 100 meter check-in range.'
    );
  END IF;

  v_office_name := v_nearest_office.name;

  -- STEP 4: INSERT attendance record
  INSERT INTO attendance_logs (
    user_id, date, attendance_type,
    office_id,
    checkin_location,
    distance_from_office,
    checkin_latitude, checkin_longitude,
    checkin_location_id, checkin_location_name, checkin_distance_meters,
    checkin_source,
    status,
    checkin_time
  ) VALUES (
    p_user_id, v_today, 'OFFICE',
    v_nearest_office.id,
    p_checkin_location,
    v_nearest_dist,
    v_checkin_lat, v_checkin_lon,
    v_nearest_office.id, v_office_name, v_nearest_dist,
    p_source,
    'CHECKED_IN',
    v_now
  ) RETURNING id INTO v_new_id;

  -- STEP 5: audit log (best-effort)
  BEGIN
    INSERT INTO attendance_audit_logs (
      attendance_id, user_id, action,
      old_status, new_status,
      reason, source
    ) VALUES (
      v_new_id, p_user_id, 'CHECK_IN',
      NULL, 'CHECKED_IN',
      'Checked in at ' || COALESCE(v_office_name,'office'),
      p_source
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success', TRUE,
    'existing', FALSE,
    'id', v_new_id,
    'checkin_time', v_now,
    'status', 'CHECKED_IN',
    'message', 'Check-in successful'
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', TRUE, 'existing', TRUE, 'message', 'Already checked in today');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM, 'message', 'Check-in failed: ' || SQLERRM);
END;
$$;


CREATE OR REPLACE FUNCTION rpc_attendance_checkout(
  p_user_id UUID,
  p_checkout_location JSONB DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_force BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_now TIMESTAMPTZ := NOW();
  v_attendance RECORD;
  v_worked_minutes INTEGER;
  v_biometric_checkin TIMESTAMPTZ;
  v_effective_checkin TIMESTAMPTZ;
  v_nearest_office RECORD;
  v_nearest_dist INTEGER := NULL;

  v_checkout_lat DOUBLE PRECISION;
  v_checkout_lon DOUBLE PRECISION;

  v_checkout_time TIMESTAMPTZ;
  v_undo_expires TIMESTAMPTZ;
  v_undo_token UUID;
  v_policy RECORD;
  v_min_work INTEGER := 30;
  v_undo_minutes INTEGER := 5;
  v_earliest_checkout TIME := TIME '18:30';
  v_current_ist_time TIME;
  v_is_early BOOLEAN := FALSE;
BEGIN
  -- STEP 1: Find today's active attendance record
  IF p_force AND NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND UPPER(p.role) IN ('ADMIN', 'SYSTEM_ADMIN', 'HR', 'HRD', 'HR_MANAGER')
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'FORBIDDEN', 'message', 'Only HR/admin may force a checkout.');
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id AND NOT p_force THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'FORBIDDEN', 'message', 'You cannot check out another employee.');
  END IF;

  IF NOT p_force AND (
    p_checkout_location IS NULL
    OR NOT (p_checkout_location ? 'latitude')
    OR NOT (p_checkout_location ? 'longitude')
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'GPS_REQUIRED', 'message', 'A valid GPS location is required to check out.');
  END IF;

  SELECT al.* INTO v_attendance
  FROM attendance_logs al
  WHERE al.user_id = p_user_id
    AND al.date = v_today
    AND al.checkin_time IS NOT NULL
    AND al.checkout_time IS NULL
  ORDER BY al.checkin_time DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'NO_ACTIVE_SESSION',
      'message', 'No active check-in session found. You need to check in first.'
    );
  END IF;

  -- Use the employee's true first arrival for the day. SmartOffice log_time is
  -- an IST wall-clock TIME, so combine it with the attendance date before
  -- converting it to TIMESTAMPTZ. LEAST ignores a missing source.
  SELECT
    ((v_today::TEXT || ' ' || MIN(s.log_time)::TEXT)::TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
  INTO v_biometric_checkin
  FROM smartoffice_device_logs s
  WHERE s.user_id = p_user_id
    AND s.log_date_only = v_today;

  v_effective_checkin := LEAST(v_attendance.checkin_time, v_biometric_checkin);
  v_effective_checkin := COALESCE(v_effective_checkin, v_attendance.checkin_time, v_biometric_checkin);
  v_worked_minutes := EXTRACT(EPOCH FROM (v_now - v_effective_checkin)) / 60;
  IF v_effective_checkin IS NULL OR v_worked_minutes < 0 THEN
    v_worked_minutes := 0;
  END IF;

  -- STEP 2: enforce the office policy on the backend.  Never trust the UI
  -- for this guard: it also protects mobile clients on older app versions.
  BEGIN
    SELECT * INTO v_policy FROM get_attendance_policy(p_user_id);
    v_min_work := GREATEST(COALESCE(v_policy.min_work_duration_minutes, 30), 0);
    v_undo_minutes := GREATEST(COALESCE(v_policy.undo_checkout_minutes, 5), 0);
    v_earliest_checkout := COALESCE(v_policy.earliest_checkout_time, '18:30')::TIME;
  EXCEPTION WHEN undefined_function THEN
    v_min_work := 30;
    v_undo_minutes := 5;
    v_earliest_checkout := TIME '18:30';
  END;

  IF NOT p_force AND v_worked_minutes < v_min_work THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'MINIMUM_WORK_DURATION',
      'message', 'Checkout is available after ' || v_min_work || ' minutes. You have worked ' || v_worked_minutes || ' minutes.',
      'worked_minutes', v_worked_minutes,
      'effective_checkin_time', v_effective_checkin,
      'app_checkin_time', v_attendance.checkin_time,
      'biometric_checkin_time', v_biometric_checkin,
      'required_minimum', v_min_work,
      'attendance_id', v_attendance.id
    );
  END IF;

  v_current_ist_time := (v_now AT TIME ZONE 'Asia/Kolkata')::TIME;
  v_is_early := NOT p_force AND v_current_ist_time < v_earliest_checkout;
  IF v_is_early AND (p_reason IS NULL OR TRIM(p_reason) = '') THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'EARLY_CHECKOUT_NO_REASON',
      'message', 'You checked in at ' || TO_CHAR(v_effective_checkin AT TIME ZONE 'Asia/Kolkata','HH:MI AM') ||
        ' IST and have worked ' || (v_worked_minutes/60) || 'h ' || (v_worked_minutes%60) ||
        'm. Checkout before ' || TO_CHAR(v_earliest_checkout,'HH:MI AM') || ' requires a reason.',
      'worked_minutes', v_worked_minutes,
      'attendance_id', v_attendance.id
    );
  END IF;

  -- STEP 3: nearest office/site match for checkout
  v_checkout_lat := NULL;
  v_checkout_lon := NULL;
  IF p_checkout_location IS NOT NULL THEN
    v_checkout_lat := (p_checkout_location->>'latitude')::DOUBLE PRECISION;
    v_checkout_lon := (p_checkout_location->>'longitude')::DOUBLE PRECISION;
  END IF;

  SELECT NULL::UUID AS id, NULL::TEXT AS name, NULL::INT AS dist_m
  INTO v_nearest_office;

  IF v_checkout_lat IS NOT NULL AND v_checkout_lon IS NOT NULL THEN
    SELECT candidate.id, candidate.name, candidate.dist_m
    INTO v_nearest_office
    FROM (
      SELECT o.id, o.name,
           ROUND(
             (6371000 * 2 * ASIN(SQRT(
               POWER(SIN(RADIANS(o.latitude - v_checkout_lat)/2),2) +
               COS(RADIANS(v_checkout_lat)) * COS(RADIANS(o.latitude)) *
               POWER(SIN(RADIANS(o.longitude - v_checkout_lon)/2),2)
             )))
           )::INT AS dist_m
      FROM offices o
      WHERE o.latitude IS NOT NULL AND o.longitude IS NOT NULL
        AND COALESCE(o.is_active, TRUE) = TRUE
      UNION ALL
      SELECT s.id, COALESCE(s.site_label, 'Site') AS name,
           ROUND(
             (6371000 * 2 * ASIN(SQRT(
               POWER(SIN(RADIANS(s.latitude - v_checkout_lat)/2),2) +
               COS(RADIANS(v_checkout_lat)) * COS(RADIANS(s.latitude)) *
               POWER(SIN(RADIANS(s.longitude - v_checkout_lon)/2),2)
             )))
           )::INT AS dist_m
      FROM predefined_sites s
      WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
        AND COALESCE(s.is_active, TRUE) = TRUE
    ) candidate
    ORDER BY candidate.dist_m
    LIMIT 1;

    IF v_nearest_office.id IS NOT NULL THEN
      v_nearest_dist := v_nearest_office.dist_m;
    END IF;
  END IF;

  -- STEP 4: undo token
  v_undo_token := gen_random_uuid();
  v_undo_expires := v_now + (v_undo_minutes || ' minutes')::INTERVAL;

  v_checkout_time := v_now;

  -- STEP 4: update attendance with checkout + matched office fields
  UPDATE attendance_logs
  SET
    checkout_time = v_checkout_time,
    checkout_location = p_checkout_location,
    checkout_source = CASE WHEN p_force THEN 'ADMIN' WHEN v_is_early THEN 'APP_EARLY' ELSE 'APP' END,
    early_checkout_reason = CASE WHEN v_is_early THEN TRIM(p_reason) ELSE NULL END,
    undo_token = v_undo_token,
    undo_expires_at = v_undo_expires,
    status = 'CHECKED_OUT',

    checkout_latitude = v_checkout_lat,
    checkout_longitude = v_checkout_lon,
    checkout_location_id = v_nearest_office.id,
    checkout_location_name = v_nearest_office.name,
    checkout_distance_meters = v_nearest_dist,

    auto_checkout = FALSE,
    auto_checkout_reason = NULL,

    updated_at = v_now
  WHERE id = v_attendance.id;

  -- Audit best-effort
  BEGIN
    INSERT INTO attendance_audit_logs (
      attendance_id, user_id, action,
      old_status, new_status,
      reason, source,
      old_checkout_at, new_checkout_at
    ) VALUES (
      v_attendance.id, p_user_id,
      CASE WHEN p_force THEN 'ADMIN_CORRECT' ELSE 'CHECKOUT_MANUAL' END,
      v_attendance.status, 'CHECKED_OUT',
      CASE WHEN v_is_early THEN TRIM(p_reason) ELSE 'Manual checkout' END,
      CASE WHEN p_force THEN 'ADMIN' ELSE 'APP' END,
      NULL, v_checkout_time
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success', TRUE,
    'id', v_attendance.id,
    'checkout_time', v_checkout_time,
    'checkin_time', v_effective_checkin,
    'app_checkin_time', v_attendance.checkin_time,
    'biometric_checkin_time', v_biometric_checkin,
    'worked_minutes', v_worked_minutes,
    'status', 'CHECKED_OUT',
    'undo_token', v_undo_token,
    'undo_expires_at', v_undo_expires,
    'message', 'Checkout successful',
    'matched_checkout_office_id', v_nearest_office.id,
    'matched_checkout_office_name', v_nearest_office.name,
    'matched_checkout_distance_meters', v_nearest_dist
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM, 'message', 'Checkout failed: ' || SQLERRM);
END;
$$;

-- Undo a manual checkout during its policy-controlled window and remove every
-- checkout-derived value so reports never retain stale GPS evidence.
CREATE OR REPLACE FUNCTION rpc_attendance_undo_checkout(
  p_user_id UUID,
  p_attendance_id UUID,
  p_undo_token UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_record RECORD;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'FORBIDDEN', 'message', 'You cannot undo another employee''s checkout.');
  END IF;

  SELECT * INTO v_record
  FROM attendance_logs
  WHERE id = p_attendance_id
    AND user_id = p_user_id
    AND status = 'CHECKED_OUT'
    AND checkout_time IS NOT NULL
    AND checkout_source IN ('APP', 'APP_EARLY')
    AND undo_token = p_undo_token
    AND undo_expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'UNDO_EXPIRED',
      'message', 'The undo window expired or this checkout cannot be reversed. Contact HR for a correction.'
    );
  END IF;

  UPDATE attendance_logs
  SET checkout_time = NULL,
      checkout_location = NULL,
      checkout_source = NULL,
      early_checkout_reason = NULL,
      undo_token = NULL,
      undo_expires_at = NULL,
      checkout_latitude = NULL,
      checkout_longitude = NULL,
      checkout_location_id = NULL,
      checkout_location_name = NULL,
      checkout_distance_meters = NULL,
      status = 'CHECKED_IN',
      updated_at = NOW()
  WHERE id = p_attendance_id;

  BEGIN
    INSERT INTO attendance_audit_logs (
      attendance_id, user_id, action, old_status, new_status,
      old_checkout_at, new_checkout_at, reason, source
    ) VALUES (
      p_attendance_id, p_user_id, 'UNDO_CHECKOUT', 'CHECKED_OUT',
      'CHECKED_IN', v_record.checkout_time, NULL,
      'Checkout undone by employee within allowed window', 'APP'
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('success', TRUE, 'message', 'Checkout has been undone.');
END;
$$;

-- 4) Ensure auto-checkout behavior on date change
-- If you have pg_cron / external scheduler, it should call auto_close_stale_attendance()
-- at least daily. We also auto-close previous day check-ins inside rpc_attendance_checkin.

CREATE OR REPLACE FUNCTION auto_checkout_attendance_end_of_day()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_checkout_time TIMESTAMPTZ := (v_today::TEXT || ' 23:59+05:30')::TIMESTAMPTZ;
  v_updated_count INTEGER := 0;
  v_closed RECORD;
BEGIN
  FOR v_closed IN
    UPDATE attendance_logs
    SET
      checkout_time = v_checkout_time,
      checkout_source = 'SYSTEM',
      status = 'AUTO_CHECKED_OUT',
      auto_checkout = TRUE,
      auto_checkout_reason = 'Day changed / End of day auto checkout',
      undo_token = NULL,
      undo_expires_at = NULL,
      updated_at = NOW()
    WHERE date = v_today
      AND checkin_time IS NOT NULL
      AND checkout_time IS NULL
    RETURNING id, user_id
  LOOP
    v_updated_count := v_updated_count + 1;
    BEGIN
      INSERT INTO attendance_audit_logs (
        attendance_id, user_id, action, old_status, new_status,
        old_checkout_at, new_checkout_at, reason, source
      ) VALUES (
        v_closed.id, v_closed.user_id, 'CHECKOUT_AUTO', 'CHECKED_IN',
        'AUTO_CHECKED_OUT', NULL, v_checkout_time,
        'End of day auto checkout at 23:59 IST', 'SYSTEM'
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'updated', v_updated_count,
    'checkout_time', v_checkout_time,
    'message', 'Auto checkout completed'
  );
END;
$$;

-- Employees may only change today's record through the protected RPCs.  HR/admin
-- corrections remain possible through rpc_admin_correct_attendance (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION lock_closed_attendance_day()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF OLD.date < (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
     AND v_actor IS NOT NULL
     AND NOT (
       TG_OP = 'UPDATE'
       AND OLD.checkout_time IS NULL
       AND NEW.checkout_source = 'SYSTEM'
       AND NEW.status = 'AUTO_CHECKED_OUT'
       AND NEW.checkout_time IS NOT NULL
     )
     AND NOT EXISTS (
       SELECT 1 FROM profiles p
       WHERE p.id = v_actor
         AND UPPER(p.role) IN ('ADMIN', 'SYSTEM_ADMIN', 'HR', 'HRD', 'HR_MANAGER')
     ) THEN
    RAISE EXCEPTION 'ATTENDANCE_DAY_LOCKED: previous-day attendance can only be corrected by HR';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_closed_attendance_day ON attendance_logs;
CREATE TRIGGER trg_lock_closed_attendance_day
BEFORE UPDATE OR DELETE ON attendance_logs
FOR EACH ROW EXECUTE FUNCTION lock_closed_attendance_day();

-- pg_cron uses UTC.  18:29 UTC is 23:59 IST.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN ('attendance-auto-checkout-2359-ist', 'auto-close-stale-attendance');
    PERFORM cron.schedule(
      'attendance-auto-checkout-2359-ist',
      '29 18 * * *',
      $job$SELECT auto_checkout_attendance_end_of_day()$job$
    );
  ELSE
    RAISE NOTICE 'Enable pg_cron or schedule SELECT auto_checkout_attendance_end_of_day() externally at 23:59 IST.';
  END IF;
END;
$$;

-- Done.

