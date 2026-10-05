-- =============================================================================
-- MIGRATION: Add side-by-side offices for AttendanceScreen
-- Date: 2026-10-01
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_my_monthly_attendance_v3(p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE 
  v_uid uuid := auth.uid();
  v_base jsonb;
  v_record jsonb;
  v_records jsonb := '[]'::jsonb;
  v_date date;
  v_attendance public.attendance_logs%rowtype;
  v_event record;
  v_visit record;
  v_comp_days numeric;
  v_comp_name text;
  v_reg_office_name text;
  v_check_in_office_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  
  SELECT o.name INTO v_reg_office_name 
  FROM public.profiles p 
  LEFT JOIN public.offices o ON o.id = p.office_id 
  WHERE p.id = v_uid;

  v_base := public.rpc_get_my_monthly_attendance_v2(p_month);
  IF NOT coalesce((v_base->>'success')::boolean,false) OR jsonb_typeof(v_base->'records')<>'array' THEN
    RAISE EXCEPTION 'MONTHLY_ATTENDANCE_NOT_CONFIRMED'; 
  END IF;

  FOR v_record IN SELECT item.value FROM jsonb_array_elements(v_base->'records') item(value) LOOP
    v_date := (v_record->>'date')::date;
    
    SELECT * INTO v_attendance FROM public.attendance_logs 
    WHERE user_id = v_uid AND date = v_date ORDER BY created_at LIMIT 1;
    
    SELECT name INTO v_check_in_office_name 
    FROM public.offices WHERE id = v_attendance.office_id;

    SELECT event.id, event.title, event.address, checkin.arrival_status, checkin.late_minutes,
      checkin.checkin_time, checkin.checkout_time, checkin.comp_off_eligible_days
      INTO v_event FROM public.event_checkins checkin JOIN public.events event ON event.id=checkin.event_id
      WHERE checkin.user_id=v_uid AND event.event_date=v_date ORDER BY checkin.checkin_time LIMIT 1;
      
    SELECT visit.id, coalesce(visit.project_name,visit.location_name) name, visit.location_address,
      visit.checkin_time, visit.checkout_time INTO v_visit FROM public.field_visits visit
      WHERE visit.user_id=v_uid AND visit.date=v_date AND visit.checkin_time IS NOT NULL
      ORDER BY visit.checkin_time DESC LIMIT 1;
      
    SELECT coalesce(sum(earning.units),0), string_agg(distinct event.title,', ' ORDER BY event.title)
      INTO v_comp_days, v_comp_name FROM public.comp_off_earnings earning
      JOIN public.events event ON event.id=earning.source_id
      WHERE earning.user_id=v_uid AND earning.eligible_work_date=v_date
        AND earning.source_type='EVENT_ATTENDANCE' AND earning.status='APPROVED';
        
    IF v_comp_days = 0 THEN
      SELECT coalesce(sum(credit.days),0), string_agg(distinct event.title,', ' ORDER BY event.title)
        INTO v_comp_days, v_comp_name FROM public.event_comp_off_credits credit
        JOIN public.events event ON event.id=credit.event_id
        WHERE credit.user_id=v_uid AND event.event_date=v_date;
    END IF;

    v_record := v_record || jsonb_build_object(
      'registeredOfficeName', v_reg_office_name,
      'checkInOfficeName', v_check_in_office_name,
      'attendanceContext', coalesce(v_attendance.attendance_context,
        CASE WHEN v_event.id IS NOT NULL THEN 'EVENT' WHEN v_visit.id IS NOT NULL THEN 'FIELD_VISIT' END,
        upper(coalesce(v_attendance.attendance_type, v_attendance.checkin_source, 'OFFICE'))),
      'contextName', coalesce(v_attendance.context_location_name, v_event.title, v_visit.name, v_attendance.checkin_location_name),
      'eventId', v_event.id, 'eventName', v_event.title, 'eventLocation', v_event.address,
      'eventArrivalStatus', v_event.arrival_status, 'eventLateMinutes', v_event.late_minutes,
      'eventCheckIn', v_event.checkin_time, 'eventCheckOut', v_event.checkout_time,
      'fieldVisitName', coalesce(v_record->>'fieldVisitName', v_visit.name),
      'compOffEligible', coalesce(v_event.comp_off_eligible_days,0),
      'compOffEarned', coalesce(v_comp_days,0), 'compOffEventName', v_comp_name);
      
    IF v_event.id IS NOT NULL THEN
      v_record := v_record || jsonb_build_object('status', CASE WHEN v_event.arrival_status='LATE' THEN 'late' ELSE 'present' END,
        'is_late', v_event.arrival_status='LATE');
    ELSIF v_comp_days > 0 THEN
      v_record := v_record || jsonb_build_object('status', 'compoff');
    END IF;
    
    v_records := v_records || v_record;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'records', v_records,
    'late_cutoff', v_base->>'late_cutoff'
  );
END $$;

NOTIFY pgrst, 'reload schema';
