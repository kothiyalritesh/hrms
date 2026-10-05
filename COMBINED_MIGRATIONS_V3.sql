-- ==========================================
-- COMBINED HRMS MIGRATIONS (PHASE 3 & 4) - V3 (PRODUCTION HARDENED)
-- Run this entire script in your Supabase SQL Editor
-- ==========================================



-- >>> START: 20260926125423_fix_observer_summary_aggregation.sql <<<

﻿CREATE OR REPLACE FUNCTION public.get_site_visit_observer_data(
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

﻿CREATE OR REPLACE FUNCTION public.rpc_admin_reset_all_leave_balances(
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
    SELECT id, gender FROM public.profiles WHERE active = true
  LOOP
    -- Determine target balance based on gender
    IF upper(v_emp.gender) = 'FEMALE' THEN
      v_target := p_female_days;
    ELSIF upper(v_emp.gender) = 'MALE' THEN
      v_target := p_male_days;
    ELSE
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

  RETURN jsonb_build_object('success', true, 'employees_updated', v_count);
END;
$$;


-- <<< END: 20260926130011_reset_all_leave_balances_rpc.sql >>>


-- >>> START: 20260926130345_biometric_auto_checkout_2030.sql <<<

﻿CREATE OR REPLACE FUNCTION public.reconcile_missing_attendance_checkouts(
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
             SELECT max(punch_timestamp)
             FROM public.smartoffice_device_logs s
             JOIN public.profiles p ON p.smartoffice_employee_code = s.employee_code
             WHERE p.id = a.user_id 
               AND s.log_date = a.date
               AND (s.punch_timestamp at time zone 'Asia/Kolkata')::time <= time '20:30:00'
               AND s.punch_timestamp > a.checkin_time + interval '5 minutes'
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

﻿-- Add date_of_birth to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Create view for upcoming birthdays in the next 30 days
CREATE OR REPLACE VIEW public.upcoming_birthdays_30_days AS
WITH curr_year AS (
  SELECT extract(year FROM current_date)::int as y
),
dob_this_year AS (
  SELECT 
    id AS user_id,
    name,
    date_of_birth,
    (date_of_birth + ((curr_year.y - extract(year FROM date_of_birth)::int) || ' years')::interval)::date AS birthday_this_year
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

-- Grant access to the view
GRANT SELECT ON public.upcoming_birthdays_30_days TO authenticated;


-- <<< END: 20260926130514_employee_birthdays.sql >>>


-- >>> START: 20260926131226_notification_monitoring_rpc.sql <<<

﻿CREATE OR REPLACE FUNCTION public.rpc_admin_notification_monitoring_summary(
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
      'delivery_rate', CASE WHEN count(*) > 0 THEN round((count(*) FILTER (WHERE read = true))::numeric / count(*) * 100, 2) ELSE 0 END,
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

﻿-- Create work_schedule_configs table
CREATE TABLE IF NOT EXISTS public.work_schedule_configs (
  id uuid primary key default gen_random_uuid(),
  team text not null unique,
  saturday_policy text check(saturday_policy in ('WFH', 'OFF', 'OFFICE')) default 'OFFICE',
  sunday_policy text check(sunday_policy in ('WFH', 'OFF', 'OFFICE')) default 'OFF',
  monday_credit_bonus boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed Marketing Team
INSERT INTO public.work_schedule_configs (team, saturday_policy, sunday_policy, monday_credit_bonus)
VALUES ('Marketing', 'WFH', 'OFF', true)
ON CONFLICT (team) DO UPDATE SET 
  saturday_policy = EXCLUDED.saturday_policy,
  sunday_policy = EXCLUDED.sunday_policy,
  monday_credit_bonus = EXCLUDED.monday_credit_bonus;

-- Monday biometric punch credit trigger
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
  -- We only run this on insert of a biometric punch
  v_punch_date := (NEW.punch_timestamp at time zone 'Asia/Kolkata')::date;
  v_is_monday := extract(isodow from (NEW.punch_timestamp at time zone 'Asia/Kolkata')) = 1;

  IF NOT v_is_monday THEN
    RETURN NEW;
  END IF;

  -- Find the user's team from profiles
  SELECT p.id, p.department INTO v_user_id, v_team
  FROM public.profiles p
  WHERE p.smartoffice_employee_code = NEW.employee_code
  LIMIT 1;

  IF v_user_id IS NULL OR v_team IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if their team has monday_credit_bonus
  SELECT monday_credit_bonus INTO v_bonus_enabled
  FROM public.work_schedule_configs
  WHERE team = v_team;

  IF coalesce(v_bonus_enabled, false) THEN
    -- Check if we already granted a bonus this Monday
    IF NOT EXISTS (
      SELECT 1 FROM public.compliance_score_deductions
      WHERE user_id = v_user_id
        AND reason = 'Monday Biometric Attendance Credit'
        AND (created_at at time zone 'Asia/Kolkata')::date = v_punch_date
    ) THEN
      v_month_start := date_trunc('month', v_punch_date)::date;

      -- Ensure score row exists
      INSERT INTO public.employee_compliance_scores (user_id, score_month, current_score)
      VALUES (v_user_id, v_month_start, 100)
      ON CONFLICT (user_id, score_month) DO NOTHING;

      -- Add credit (+1 score by applying -1 deduction)
      UPDATE public.employee_compliance_scores
      SET current_score = current_score + 1,
          updated_at = now()
      WHERE user_id = v_user_id AND score_month = v_month_start;

      -- Log it
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


-- >>> START: 20260926132004_extend_canonical_view_site_name.sql <<<

﻿CREATE OR REPLACE VIEW public.v_attendance_daily_canonical
WITH (security_invoker=true) AS
WITH employee_days AS (
  SELECT p.id user_id, day::date work_date, p.name employee_name, p.employee_number,
    p.office_id, o.name office_name, p.team_id, COALESCE(t.name,p.team) team_name,
    p.reports_to team_head_id, manager.name team_head_name, p.role, p.show_on_tv,
    p.joining_date, p.is_active
  FROM public.profiles p
  LEFT JOIN public.offices o ON o.id=p.office_id
  LEFT JOIN public.teams t ON t.id=p.team_id
  LEFT JOIN public.profiles manager ON manager.id=p.reports_to
  CROSS JOIN LATERAL generate_series(
    greatest(COALESCE(p.joining_date,(p.created_at AT TIME ZONE 'Asia/Kolkata')::date), date '2020-01-01'),
    least(COALESCE(p.last_working_date,(now() AT TIME ZONE 'Asia/Kolkata')::date),(now() AT TIME ZONE 'Asia/Kolkata')::date),
    INTERVAL '1 day') day
  WHERE p.attendance_reporting_enabled
    AND (day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR p.is_active)
), evidence AS (
SELECT employee.*,
  attendance.id attendance_log_id,
  COALESCE(attendance.app_checkin_time,
    CASE WHEN upper(COALESCE(attendance.checkin_source,attendance.attendance_type,'')) LIKE 'APP%'
         THEN attendance.checkin_time END) app_first_in,
  COALESCE(attendance.biometric_first_punch,biometric.first_punch) biometric_first_in,
  visit.first_in field_visit_first_in,
  attendance.checkout_time raw_checkout,
  CASE WHEN upper(COALESCE(attendance.checkout_source,''))
         NOT IN ('ADMIN','REGULARIZATION','SYSTEM','BIOMETRIC','FIELD_VISIT')
       THEN attendance.checkout_time END app_checkout,
  regularization.requested_checkout approved_regularization_checkout,
  CASE WHEN regularization.id IS NULL
         AND upper(COALESCE(attendance.checkout_source,''))='ADMIN'
       THEN attendance.checkout_time END admin_corrected_checkout,
  COALESCE(attendance.biometric_last_punch,biometric.last_punch) biometric_last_punch_evidence,
  visit.last_out field_visit_checkout, visit.has_visit, visit.active_id, visit.active_name,
  visit.distance_m,
  policy.late_checkin_time, policy.allow_field_visit_checkout, policy.policy_id,
  calendar.value calendar_value, leave_request.leave_type,
  attendance.warning attendance_warning,
  ping.recorded_at latest_ping_at, ping.accuracy latest_accuracy_m,
  ping.status latest_tracking_status,
  ping.distance_from_base distance_from_office_m,
  session.status tracking_session_status,
  health.reason tracking_health_reason,
  settings.tv_tracking_stale_minutes,
  visit.active_site_name
FROM employee_days employee
LEFT JOIN LATERAL (
  SELECT a.* FROM public.attendance_logs a
  WHERE a.user_id=employee.user_id AND a.date=employee.work_date
  ORDER BY a.created_at, a.id LIMIT 1) attendance ON true
LEFT JOIN LATERAL (
  SELECT min(d.punch_timestamp) first_punch, max(d.punch_timestamp) last_punch
  FROM public.smartoffice_device_logs d
  WHERE d.user_id=employee.user_id AND d.log_date_only=employee.work_date) biometric ON true
LEFT JOIN LATERAL (
  SELECT
    min(public.hrms_timestamp(v.checkin_time))  first_in,
    max(public.hrms_timestamp(v.checkout_time)) last_out,
    bool_or(v.checkin_time IS NOT NULL) has_visit,
    (array_agg(v.id ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_id,
    (array_agg(COALESCE(v.project_name,v.location_name)
      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_name,
    (array_agg(v.last_distance_m ORDER BY v.last_distance_at DESC NULLS LAST))[1] distance_m,
    (array_agg(s.name
      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_site_name
  FROM public.field_visits v
  LEFT JOIN public.predefined_sites s ON s.id = v.selected_site_id
  WHERE v.user_id=employee.user_id AND v.date=employee.work_date
  AND COALESCE(v.verification_status,'PENDING') <> 'REJECTED') visit ON true
LEFT JOIN LATERAL (
  SELECT r.id, r.requested_checkout
  FROM public.attendance_regularization_requests r
  WHERE r.attendance_id=attendance.id AND r.status='APPROVED'
  ORDER BY r.reviewed_at DESC NULLS LAST, r.created_at DESC LIMIT 1) regularization ON true
LEFT JOIN LATERAL (
  SELECT p.id policy_id, p.late_checkin_time, p.allow_field_visit_checkout
  FROM public.attendance_policies p
  WHERE p.is_active
    AND employee.work_date BETWEEN p.effective_from AND COALESCE(p.effective_to,'infinity'::date)
    AND (p.office_id=employee.office_id OR p.office_id IS NULL)
    AND lower(COALESCE(p.role,'all')) IN (lower(COALESCE(employee.role,'')),'all')
  ORDER BY CASE
    WHEN p.office_id=employee.office_id AND lower(p.role)=lower(COALESCE(employee.role,'')) THEN 1
    WHEN p.office_id=employee.office_id AND lower(COALESCE(p.role,'all'))='all' THEN 2
    WHEN p.office_id IS NULL AND lower(p.role)=lower(COALESCE(employee.role,'')) THEN 3
    ELSE 4 END
  LIMIT 1) policy ON true
LEFT JOIN LATERAL (
  SELECT public.resolve_hrms_calendar_day(employee.user_id,employee.work_date) value) calendar ON true
LEFT JOIN LATERAL (
  SELECT r.leave_type
  FROM public.leave_requests r
  WHERE r.user_id=employee.user_id AND r.status='APPROVED'
    AND employee.work_date BETWEEN r.start_date AND r.end_date
  ORDER BY r.created_at DESC LIMIT 1) leave_request ON true
LEFT JOIN LATERAL (
  SELECT tl.recorded_at, tl.accuracy, tl.distance_from_base, ts.status,
    th.reason
  FROM public.location_tracking tl
  JOIN public.tracking_sessions ts ON ts.id=tl.session_id
  LEFT JOIN public.tracking_health th ON th.session_id=ts.id
  WHERE tl.user_id=employee.user_id
  ORDER BY tl.recorded_at DESC LIMIT 1
) ping ON true
LEFT JOIN LATERAL (
  SELECT t.status
  FROM public.tracking_sessions t
  WHERE t.user_id=employee.user_id AND t.date=employee.work_date
  ORDER BY t.created_at DESC LIMIT 1
) session ON true
LEFT JOIN LATERAL (
  SELECT th.reason
  FROM public.tracking_health th
  JOIN public.tracking_sessions ts ON ts.id=th.session_id
  WHERE ts.user_id=employee.user_id AND ts.date=employee.work_date
  ORDER BY th.created_at DESC LIMIT 1
) health ON true
CROSS JOIN (
  SELECT COALESCE(
    current_setting('app.tv_tracking_stale_minutes', true),
    '15'
  )::integer tv_tracking_stale_minutes
) settings
)
SELECT e.*,
  COALESCE(
    e.approved_regularization_checkout,
    e.admin_corrected_checkout,
    CASE WHEN COALESCE(e.allow_field_visit_checkout,true) THEN COALESCE(e.app_checkout,e.field_visit_checkout) ELSE e.app_checkout END,
    e.app_checkout,
    e.raw_checkout
  ) effective_checkout,
  COALESCE(
    e.app_first_in,
    e.field_visit_first_in,
    e.biometric_first_in
  ) effective_checkin,
  (CASE
    WHEN e.leave_type IS NOT NULL THEN 'LEAVE'
    WHEN e.calendar_value->>'kind'='WEEK_OFF' THEN 'WEEK_OFF'
    WHEN e.calendar_value->>'kind'='HOLIDAY' THEN 'HOLIDAY'
    WHEN e.raw_checkout IS NOT NULL OR e.approved_regularization_checkout IS NOT NULL OR e.admin_corrected_checkout IS NOT NULL THEN 'CHECKED_OUT'
    WHEN e.app_first_in IS NOT NULL OR e.biometric_first_in IS NOT NULL OR e.field_visit_first_in IS NOT NULL THEN 'CHECKED_IN'
    ELSE 'ABSENT'
  END) effective_status,
  EXISTS(
    SELECT 1 FROM public.attendance_logs a
    WHERE a.id=e.attendance_log_id AND a.auto_closed=true
  ) is_auto_closed
FROM evidence e;


-- <<< END: 20260926132004_extend_canonical_view_site_name.sql >>>


-- >>> START: 20260926132549_unified_activity_log.sql <<<

﻿CREATE OR REPLACE FUNCTION public.rpc_my_unified_activity_log(
  p_category text default 'all',
  p_limit int default 50,
  p_offset int default 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  WITH combined AS (
    -- 1. Attendance (Check-ins/Outs)
    SELECT id, 'attendance' as category, 'Check-in recorded' as title, 'Checked in' as description, checkin_time as log_time
    FROM public.attendance_logs WHERE user_id = v_uid AND checkin_time IS NOT NULL
    UNION ALL
    SELECT id, 'attendance' as category, 'Check-out recorded' as title, 'Checked out' as description, checkout_time as log_time
    FROM public.attendance_logs WHERE user_id = v_uid AND checkout_time IS NOT NULL
    
    -- 2. Leaves
    UNION ALL
    SELECT id, 'leave' as category, 'Leave ' || status as title, leave_type || ' from ' || start_date || ' to ' || end_date as description, created_at as log_time
    FROM public.leave_requests WHERE user_id = v_uid
    
    -- 3. Field Visits (Activity Logs)
    UNION ALL
    SELECT id, 'field_visit' as category, activity_type as title, summary as description, timestamp as log_time
    FROM public.activity_logs WHERE user_id = v_uid
    
    -- 4. System Actions (Audit)
    UNION ALL
    SELECT id, 'system' as category, 'System Action: ' || action as title, 'Table: ' || table_name as description, performed_at as log_time
    FROM public.audit_logs WHERE performed_by = v_uid
  ), filtered AS (
    SELECT * FROM combined
    WHERE p_category = 'all' OR category = p_category
    ORDER BY log_time DESC NULLS LAST
    OFFSET p_offset LIMIT p_limit
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'category', category,
    'title', title,
    'description', description,
    'timestamp', log_time
  )) INTO v_res FROM filtered;
  
  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_my_unified_activity_log(text, int, int) TO authenticated;


-- <<< END: 20260926132549_unified_activity_log.sql >>>


-- >>> START: 20260926132726_anonymous_feedback.sql <<<

﻿CREATE TABLE public.anonymous_feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  message text not null,
  created_at timestamptz not null default now(),
  org_id text
);

CREATE TABLE public.feedback_audit (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid references public.anonymous_feedback(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  inserted_at timestamptz not null default now()
);

-- RLS for anonymous_feedback
ALTER TABLE public.anonymous_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert anonymous feedback" ON public.anonymous_feedback
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "HR and Admins can view anonymous feedback" ON public.anonymous_feedback
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRBP', 'DIRECTOR'))
  );

-- RLS for feedback_audit
ALTER TABLE public.feedback_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only system admin can view audit" ON public.feedback_audit
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'SYSTEM_ADMIN')
  );
-- Insert is done by trigger, no policy needed for insert

-- Trigger to populate audit
CREATE OR REPLACE FUNCTION public.trg_audit_anonymous_feedback()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.feedback_audit (feedback_id, user_id)
  VALUES (NEW.id, auth.uid());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_anonymous_feedback_trg
AFTER INSERT ON public.anonymous_feedback
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_anonymous_feedback();

-- Notify real-time
ALTER PUBLICATION supabase_realtime ADD TABLE public.anonymous_feedback;


-- <<< END: 20260926132726_anonymous_feedback.sql >>>


-- >>> START: 20260926132902_seed_screen_permissions.sql <<<

﻿INSERT INTO public.permissions (name, description, category)
VALUES
  ('screen.attendance_control', 'Access Attendance Control Screen', 'screens'),
  ('screen.user_management', 'Access User Management Screen', 'screens'),
  ('screen.leave_balance', 'Access Leave Balance Screen', 'screens'),
  ('screen.audit_logs', 'Access Audit Logs', 'screens'),
  ('screen.birthday_management', 'Access Birthday Management', 'screens'),
  ('screen.task_project_control', 'Access Task/Project Control', 'screens'),
  ('screen.ticket_management', 'Access Ticket Management', 'screens'),
  ('screen.live_tracking', 'Access Live Tracking', 'screens'),
  ('screen.field_visit_admin', 'Access Field Visit Admin', 'screens'),
  ('screen.team_hierarchy', 'Access Team Hierarchy', 'screens'),
  ('screen.check_in_logs', 'Access Check In Logs', 'screens'),
  ('screen.suspicious_attendance', 'Access Suspicious Attendance', 'screens'),
  ('screen.attendance_regularization', 'Access Attendance Regularization', 'screens'),
  ('screen.event_management', 'Access Event Management', 'screens'),
  ('screen.smartoffice_integration', 'Access SmartOffice Integration', 'screens'),
  ('screen.site_settings', 'Access Site Settings', 'screens'),
  ('screen.office_settings', 'Access Office Settings', 'screens'),
  ('screen.notification_management', 'Access Notification Management', 'screens'),
  ('screen.anonymous_feedback', 'Access Anonymous Feedback', 'screens')
ON CONFLICT (name) DO NOTHING;


-- <<< END: 20260926132902_seed_screen_permissions.sql >>>


-- >>> START: 20260926135000_audit_logs_summary.sql <<<

﻿CREATE OR REPLACE FUNCTION public.rpc_admin_audit_logs_summary()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'total_today', (SELECT count(*) FROM audit_logs WHERE performed_at >= current_date),
        'total_week', (SELECT count(*) FROM audit_logs WHERE performed_at >= current_date - interval '7 days'),
        'most_active_admin', (
            SELECT p.name 
            FROM audit_logs a 
            JOIN profiles p ON p.id = a.performed_by 
            WHERE a.performed_at >= current_date - interval '30 days'
            GROUP BY p.name 
            ORDER BY count(*) DESC 
            LIMIT 1
        ),
        'most_modified_table', (
            SELECT table_name 
            FROM audit_logs 
            WHERE performed_at >= current_date - interval '30 days'
            GROUP BY table_name 
            ORDER BY count(*) DESC 
            LIMIT 1
        )
    ) INTO result;
    
    RETURN result;
END;
$$;


-- <<< END: 20260926135000_audit_logs_summary.sql >>>



-- ==========================================
-- SECURITY HARDENING (Least Privilege)
-- ==========================================
REVOKE ALL ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_audit_logs_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_audit_logs_summary() TO authenticated;
