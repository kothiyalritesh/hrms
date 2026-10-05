-- ==========================================
-- COMBINED HRMS MIGRATIONS (PHASE 3 & 4) - V3 CORRECTED
-- PRODUCTION HARDENED WITH CRITICAL FIXES
-- ==========================================

-- PREREQUISITE VERIFICATION
-- This migration requires the following to exist:
-- 1. public.site_visit_live_locations table
-- 2. public.apply_leave_transaction() function
-- 3. public.can_access_user_data() function
-- 4. public.hrms_timestamp() function
-- 5. public.resolve_hrms_calendar_day() function
-- 6. public.field_visit_distance_metres() function
-- 7. public.log_audit_event() function
-- 8. public.employee_compliance_scores table
-- 9. public.compliance_score_deductions table
-- 10. public.biometric_mapping_audit table

-- >>> START: 20260926125423_fix_observer_summary_aggregation.sql <<<

CREATE OR REPLACE FUNCTION public.get_site_visit_observer_data(
  p_date        date,
  p_employee_id uuid DEFAULT NULL,
  p_visit_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_live   boolean;
  v_is_admin  boolean;
  v_summary   jsonb;
  v_employees jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'AUTHENTICATION_REQUIRED');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')) INTO v_is_admin;
  v_is_live  := (p_date = CURRENT_DATE);

  IF NOT v_is_admin THEN
    IF NOT EXISTS(SELECT 1 FROM public.user_permissions WHERE user_id = auth.uid() AND permission = 'view_site_visit_observer' AND revoked_at IS NULL) THEN
      RETURN jsonb_build_object('error', 'PERMISSION_DENIED');
    END IF;
  END IF;

  WITH relevant_visits AS (
    SELECT fv.id AS visit_id, fv.user_id, fv.status AS visit_status, 
           fv.location_name, fv.project_name,
           to_char(fv.checkin_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS checkin_time,
           to_char(fv.checkout_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS checkout_time,
           fv.visit_type, (fv.destination_coords->>'latitude')::double precision AS dest_lat, (fv.destination_coords->>'longitude')::double precision AS dest_lon, COALESCE(fv.client_name, fv.contact_name) AS client_name, COALESCE(fv.client_phone, fv.contact_phone) AS client_phone,
           svl.updated_at AS last_ping_at,
           svl.tracking_status AS svl_tracking_status
    FROM public.field_visits fv
    LEFT JOIN LATERAL (
      SELECT updated_at, tracking_status FROM public.site_visit_live_locations s WHERE s.user_id = fv.user_id ORDER BY updated_at DESC LIMIT 1
    ) svl ON true
    WHERE fv.date = p_date
      AND COALESCE(fv.verification_status,'PENDING') <> 'REJECTED'
      AND (p_employee_id IS NULL OR fv.user_id = p_employee_id)
      AND (p_visit_id    IS NULL OR fv.id      = p_visit_id)
      AND (v_is_admin OR public.can_access_user_data(fv.user_id,'view_site_visit_observer'))
  ),
  distinct_employees AS (SELECT DISTINCT user_id FROM relevant_visits),
  employee_cards AS (
    SELECT
      p.id AS employee_id, p.name, p.employee_number AS employee_no,
      p.role, p.department, off.name AS office_name,
      CASE
        WHEN NOT v_is_live THEN 'COMPLETED'
        WHEN has_active.val AND (svl.updated_at IS NULL OR svl.updated_at < now()-INTERVAL '5 minutes') THEN 'SIGNAL_LOST'
        WHEN svl.tracking_status='AT_SITE'    THEN 'AT_SITE'
        WHEN svl.tracking_status='IN_TRANSIT' THEN 'IN_TRANSIT'
        WHEN has_active.val THEN 'IN_TRANSIT'
        ELSE 'COMPLETED'
      END AS computed_status,
      CASE
        WHEN NOT v_is_live THEN 'COMPLETED'
        WHEN svl.updated_at IS NULL OR svl.updated_at < now()-INTERVAL '5 minutes' THEN 'SIGNAL_LOST'
        WHEN svl.updated_at < now()-INTERVAL '2 minutes' THEN 'DELAYED'
        ELSE 'LIVE'
      END AS computed_signal_status,
      CASE
        WHEN NOT v_is_live THEN 'STALE'
        WHEN svl.last_uploaded_at IS NULL OR svl.last_uploaded_at < now()-INTERVAL '60 seconds' THEN 'STALE'
        WHEN svl.last_uploaded_at < now()-INTERVAL '15 seconds' THEN 'DELAYED'
        ELSE 'ACTIVE'
      END AS computed_tracking_health,
      COALESCE(svl.gps_quality,'HIGH') AS computed_gps_quality,
      svl.latitude, svl.longitude, svl.accuracy_m, svl.battery_level,
      svl.speed_mps, svl.source, svl.last_location_at, svl.last_uploaded_at,
      COALESCE(svl.pending_ping_count,0) AS pending_ping_count,
      svl.updated_at AS ping_updated_at,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'visit_id',        rv.visit_id,
          'status',          rv.visit_status,
          'location_name',   rv.location_name,
          'project_name',    rv.project_name,
          'checkin_time',    rv.checkin_time,
          'checkout_time',   rv.checkout_time,
          'visit_type',      rv.visit_type,
          'destination_lat', rv.dest_lat,
          'destination_lon', rv.dest_lon,
          'client_name',     rv.client_name,
          'client_phone',    rv.client_phone
        ) ORDER BY rv.visit_status ASC)
        FROM relevant_visits rv WHERE rv.user_id = p.id
      ) AS visits_json
    FROM distinct_employees de
    JOIN public.profiles p ON p.id = de.user_id
    LEFT JOIN public.offices off ON off.id = p.office_id
    LEFT JOIN LATERAL (
      SELECT * FROM public.site_visit_live_locations s WHERE s.user_id = p.id ORDER BY updated_at DESC LIMIT 1
    ) svl ON v_is_live
    CROSS JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM relevant_visits v
        WHERE v.user_id = p.id AND v.visit_status IN ('IN_TRANSIT','CHECKED_IN')
      ) AS val
    ) has_active
    ORDER BY p.name ASC
  )
  SELECT jsonb_build_object(
    'total_employees', COALESCE(COUNT(*)::int, 0),
    'employees_in_transit', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'IN_TRANSIT')::int, 0),
    'employees_at_site', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'AT_SITE')::int, 0),
    'employees_completed', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'COMPLETED')::int, 0),
    'employees_signal_lost', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'SIGNAL_LOST')::int, 0)
  ) INTO v_summary
  FROM employee_cards;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'employee_id',     ec.employee_id,
    'name',            ec.name,
    'employee_no',     ec.employee_no,
    'role',            ec.role,
    'department',      ec.department,
    'office_name',     ec.office_name,
    'tracking', jsonb_build_object(
      'status',             ec.computed_status,
      'signal_status',      ec.computed_signal_status,
      'tracking_health',    ec.computed_tracking_health,
      'gps_quality',        ec.computed_gps_quality,
      'latitude',           ec.latitude,
      'longitude',          ec.longitude,
      'accuracy',           ec.accuracy_m,
      'battery_level',      ec.battery_level,
      'speed_mps',          ec.speed_mps,
      'source',             ec.source,
      'last_location_at',   ec.last_location_at,
      'last_uploaded_at',   ec.last_uploaded_at,
      'pending_ping_count', ec.pending_ping_count,
      'updated_at',         ec.ping_updated_at
    ),
    'visits',          COALESCE(ec.visits_json,'[]'::jsonb),
    'latest_lat',      ec.latitude,
    'latest_lon',      ec.longitude,
    'tracking_status', ec.computed_status,
    'updated_at',      ec.ping_updated_at
  )), '[]'::jsonb) INTO v_employees
  FROM employee_cards ec;

  RETURN jsonb_build_object(
    'date',      p_date::text,
    'mode',      CASE WHEN v_is_live THEN 'LIVE' ELSE 'HISTORICAL' END,
    'is_live',   v_is_live,
    'summary',   COALESCE(v_summary, '{}'::jsonb),
    'employees', COALESCE(v_employees,'[]'::jsonb)
  );
END;
$$;

-- <<< END: 20260926125423_fix_observer_summary_aggregation.sql >>>

-- >>> START: 20260926130011_reset_all_leave_balances_rpc.sql <<<

CREATE OR REPLACE FUNCTION public.rpc_admin_reset_all_leave_balances(
  p_leave_type text,
  p_female_days numeric,
  p_male_days numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_emp RECORD;
  v_current_balance numeric;
  v_target numeric;
  v_delta numeric;
  v_tx uuid;
  v_count int := 0;
  v_skipped int := 0;
BEGIN
  -- Verify admin permissions
  SELECT EXISTS(
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
      AND role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_REQUIRED';
  END IF;

  FOR v_emp IN 
    SELECT id, gender FROM public.profiles WHERE is_active = true
  LOOP
    -- Determine target balance based on gender
    -- BUSINESS RULE: Only MALE and FEMALE are supported. Other values are skipped.
    IF upper(v_emp.gender) = 'FEMALE' THEN
      v_target := p_female_days;
    ELSIF upper(v_emp.gender) = 'MALE' THEN
      v_target := p_male_days;
    ELSE
      -- Skip employees with NULL, UNKNOWN, or OTHER gender values
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Get current balance for this leave type
    SELECT 
      CASE upper(p_leave_type)
        WHEN 'SICK' THEN sick
        WHEN 'CASUAL' THEN casual
        WHEN 'EARNED' THEN earned
        WHEN 'COMP_OFF' THEN comp_off
        ELSE 0
      END INTO v_current_balance
    FROM public.leave_balances
    WHERE user_id = v_emp.id;

    v_current_balance := COALESCE(v_current_balance, 0);
    v_delta := v_target - v_current_balance;

    IF v_delta <> 0 THEN
      -- Create transaction to adjust balance
      v_tx := public.apply_leave_transaction(
        v_emp.id, 
        upper(p_leave_type), 
        CASE WHEN v_delta > 0 THEN 'MANUAL_CREDIT' ELSE 'MANUAL_DEBIT' END,
        v_delta, 
        (now() at time zone 'Asia/Kolkata')::date, 
        null, 
        'HR_MANUAL', 
        null, 
        btrim(p_reason), 
        auth.uid(), 
        gen_random_uuid()::text
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 
    'employees_updated', v_count,
    'employees_skipped', v_skipped,
    'note', 'Employees with NULL or non-standard gender values were skipped'
  );
END;
$$;

-- <<< END: 20260926130011_reset_all_leave_balances_rpc.sql >>>

-- >>> START: 20260926130345_biometric_auto_checkout_2030.sql <<<

CREATE OR REPLACE FUNCTION public.reconcile_missing_attendance_checkouts(
  p_target_date date default (now() at time zone 'Asia/Kolkata')::date
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_count int := 0;
BEGIN
  WITH candidates AS (
    SELECT a.id as attendance_id,
           (
             SELECT max(log_date)
             FROM public.smartoffice_device_logs s
             WHERE s.user_id = a.user_id 
               AND (s.log_date AT TIME ZONE 'Asia/Kolkata')::date = a.date
               AND (s.log_date AT TIME ZONE 'Asia/Kolkata')::time <= time '20:30:00'
               AND s.log_date > a.checkin_time + interval '5 minutes'
           ) as calculated_checkout
    FROM public.attendance_logs a
    WHERE a.date = p_target_date
      AND a.checkin_time IS NOT NULL
      AND a.checkout_time IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.field_visits fv
        WHERE fv.user_id = a.user_id AND fv.date = p_target_date
          AND fv.status IN ('IN_TRANSIT', 'CHECKED_IN')
      )
  )
  UPDATE public.attendance_logs a
  SET
    checkout_time = c.calculated_checkout,
    auto_closed = true,
    auto_close_reason = 'BIOMETRIC_LAST_PUNCH_BEFORE_2030',
    work_hours = greatest(0, round((extract(epoch from (c.calculated_checkout - a.checkin_time)) / 3600)::numeric, 2)),
    updated_at = now()
  FROM candidates c
  WHERE c.attendance_id = a.id
    AND c.calculated_checkout IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = row_count;

  IF v_updated_count > 0 THEN
    PERFORM public.log_audit_event(
      'ATTENDANCE_AUTO_CLOSED',
      'attendance_logs',
      null, null,
      jsonb_build_object('date', p_target_date, 'closed_count', v_updated_count, 'strategy', 'BIOMETRIC_LAST_PUNCH_BEFORE_2030')
    );
  END IF;

  RETURN v_updated_count;
END $$;

-- <<< END: 20260926130345_biometric_auto_checkout_2030.sql >>>

-- >>> START: 20260926130514_employee_birthdays.sql <<<

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;

CREATE OR REPLACE VIEW public.upcoming_birthdays_30_days AS
WITH curr_year AS (
  SELECT extract(year FROM current_date)::int as y
),
dob_this_year AS (
  SELECT 
    id AS user_id,
    name,
    date_of_birth,
    CASE 
      WHEN extract(month FROM date_of_birth) = 2 AND extract(day FROM date_of_birth) = 29
        THEN make_date(curr_year.y, 2, 28)
      ELSE (date_of_birth + ((curr_year.y - extract(year FROM date_of_birth)::int) || ' years')::interval)::date
    END AS birthday_this_year
  FROM public.profiles
  CROSS JOIN curr_year
  WHERE date_of_birth IS NOT NULL AND is_active = true
),
next_bday AS (
  SELECT
    user_id,
    name,
    date_of_birth,
    CASE 
      WHEN birthday_this_year >= current_date THEN birthday_this_year
      ELSE birthday_this_year + interval '1 year'
    END::date AS next_birthday
  FROM dob_this_year
)
SELECT *
FROM next_bday
WHERE next_birthday BETWEEN current_date AND current_date + interval '30 days'
ORDER BY next_birthday ASC;

GRANT SELECT ON public.upcoming_birthdays_30_days TO authenticated;

-- <<< END: 20260926130514_employee_birthdays.sql >>>

-- >>> START: 20260926131226_notification_monitoring_rpc.sql <<<

CREATE OR REPLACE FUNCTION public.rpc_admin_notification_monitoring_summary(
  p_start_date date default null,
  p_end_date date default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'type', type,
      'total_sent', count(*),
      'read_count', count(*) FILTER (WHERE read = true),
      'unread_count', count(*) FILTER (WHERE coalesce(read, false) = false),
      'read_rate', CASE WHEN count(*) > 0 THEN round((count(*) FILTER (WHERE read = true))::numeric / count(*) * 100, 2) ELSE 0 END,
      'last_sent', max(created_at)
    )
  )
  INTO v_result
  FROM (
    SELECT type, read, created_at
    FROM public.notifications
    WHERE type IN ('hr_announcement', 'policy', 'emergency')
      AND (p_start_date IS NULL OR (created_at at time zone 'Asia/Kolkata')::date >= p_start_date)
      AND (p_end_date IS NULL OR (created_at at time zone 'Asia/Kolkata')::date <= p_end_date)
  ) sub
  GROUP BY type;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_notification_monitoring_summary(date, date) TO authenticated;

-- <<< END: 20260926131226_notification_monitoring_rpc.sql >>>

-- >>> START: 20260926131337_work_schedule_configs.sql <<<

CREATE TABLE IF NOT EXISTS public.work_schedule_configs (
  id uuid primary key default gen_random_uuid(),
  team text not null unique,
  saturday_policy text check(saturday_policy in ('WFH', 'OFF', 'OFFICE')) default 'OFFICE',
  sunday_policy text check(sunday_policy in ('WFH', 'OFF', 'OFFICE')) default 'OFF',
  monday_credit_bonus boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

INSERT INTO public.work_schedule_configs (team, saturday_policy, sunday_policy, monday_credit_bonus)
VALUES ('Marketing', 'WFH', 'OFF', true)
ON CONFLICT (team) DO UPDATE SET 
  saturday_policy = EXCLUDED.saturday_policy,
  sunday_policy = EXCLUDED.sunday_policy,
  monday_credit_bonus = EXCLUDED.monday_credit_bonus;

CREATE OR REPLACE FUNCTION public.trigger_monday_biometric_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_team text;
  v_is_monday boolean;
  v_bonus_enabled boolean;
  v_month_start date;
  v_punch_date date;
BEGIN
  v_punch_date := (NEW.log_date at time zone 'Asia/Kolkata')::date;
  v_is_monday := extract(isodow from (NEW.log_date at time zone 'Asia/Kolkata')) = 1;

  IF NOT v_is_monday THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.department INTO v_user_id, v_team
  FROM public.profiles p
  WHERE p.smartoffice_employee_code = NEW.employee_code
  LIMIT 1;

  IF v_user_id IS NULL OR v_team IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT monday_credit_bonus INTO v_bonus_enabled
  FROM public.work_schedule_configs
  WHERE team = v_team;

  IF coalesce(v_bonus_enabled, false) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.compliance_score_deductions
      WHERE user_id = v_user_id
        AND reason = 'Monday Biometric Attendance Credit'
        AND (created_at at time zone 'Asia/Kolkata')::date = v_punch_date
    ) THEN
      v_month_start := date_trunc('month', v_punch_date)::date;

      INSERT INTO public.employee_compliance_scores (user_id, score_month, current_score)
      VALUES (v_user_id, v_month_start, 100)
      ON CONFLICT (user_id, score_month) DO NOTHING;

      UPDATE public.employee_compliance_scores
      SET current_score = current_score + 1,
          updated_at = now()
      WHERE user_id = v_user_id AND score_month = v_month_start;

      INSERT INTO public.compliance_score_deductions (user_id, score_month, deduction_amount, reason, source_table, source_id, deducted_by)
      VALUES (v_user_id, v_month_start, -1, 'Monday Biometric Attendance Credit', 'smartoffice_device_logs', NEW.id, null);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_monday_biometric_credit ON public.smartoffice_device_logs;
CREATE TRIGGER tr_monday_biometric_credit
AFTER INSERT ON public.smartoffice_device_logs
FOR EACH ROW
EXECUTE FUNCTION public.trigger_monday_biometric_credit();

-- <<< END: 20260926131337_work_schedule_configs.sql >>>
