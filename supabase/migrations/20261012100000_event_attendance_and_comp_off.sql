-- =============================================================================
-- 20261012100000_event_attendance_and_comp_off.sql
--
-- 1. Event attendees were ABSENT in Today's Present, attendance screens and
--    reports (and the absence compliance job). Event check-in already writes
--    the day's attendance_logs row (checkin_source 'EVENT') in the same
--    transaction, but the canonical view / core RPC only accepted 'APP%'
--    sources as presence. 'EVENT' now counts too and is labelled 'EVENT'
--    (not 'APP') in first_in_source / presence_source.
--    One attendance row per employee per day (unique index) => one person is
--    still counted once, however many events they attend.
-- 2. Event on a weekly off earned TWO comp-offs (weekly-off trigger + event
--    engine). Now one per day: the event engine only adds its extended-duty
--    extra when the weekly-off credit already exists.
-- 3. Monthly attendance (v3): comp-off earned now counts every APPROVED
--    earning (weekly-off ones were missing); an event no longer overwrites an
--    office LATE; comp-off no longer replaces present/late as the day status.
-- 4. Events with comp-off ON could not be created (Marketing-only constraint
--    from the retired Sunday engine). Constraint dropped; the legacy v1 event
--    check-in/out RPCs (which used that engine) are no longer callable.
-- 5. Two events in one day: the first event's checkout no longer closes the
--    working day while the employee is still checked in at another event.
--
-- Idempotent. No historical data is changed. Fails loudly if production
-- objects don't look as expected (nothing is half-applied: run in one txn).
-- =============================================================================

-- 1a. Canonical view -----------------------------------------------------------
DO $$
DECLARE
  v_def  text;
  v_new  text;
  v_opts text[];
  v_n    int;
BEGIN
  IF to_regclass('public.v_attendance_daily_canonical') IS NULL THEN
    RAISE EXCEPTION 'v_attendance_daily_canonical missing';
  END IF;
  v_def := pg_get_viewdef('public.v_attendance_daily_canonical'::regclass, false);
  IF v_def ~ '\^\(APP\|EVENT\)' THEN
    RAISE NOTICE 'canonical view: event presence already applied';
    RETURN;
  END IF;
  SELECT reloptions INTO v_opts FROM pg_class WHERE oid = 'public.v_attendance_daily_canonical'::regclass;

  v_n := (length(v_def) - length(replace(v_def, $q$~~ 'APP%'::text$q$, ''))) / length($q$~~ 'APP%'::text$q$);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'canonical view: expected 1 APP%% source filter, found %', v_n;
  END IF;
  v_new := replace(v_def, $q$~~ 'APP%'::text$q$, $q$~ '^(APP|EVENT)'::text$q$);

  v_n := (SELECT count(*) FROM regexp_matches(v_new, $r$WHEN \(((d\.)?app_first_in) IS NOT NULL\) THEN 'APP'::text$r$, 'g'));
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'canonical view: expected 2 APP source labels, found %', v_n;
  END IF;
  v_new := regexp_replace(v_new,
    $r$WHEN \(((d\.)?app_first_in) IS NOT NULL\) THEN 'APP'::text$r$,
    $x$WHEN (\1 IS NOT NULL) THEN CASE WHEN upper(COALESCE(attendance_source::text, '')) = 'EVENT' THEN 'EVENT'::text ELSE 'APP'::text END$x$,
    'g');

  EXECUTE 'CREATE OR REPLACE VIEW public.v_attendance_daily_canonical AS ' || v_new;
  IF v_opts IS NOT NULL THEN
    EXECUTE format('ALTER VIEW public.v_attendance_daily_canonical SET (%s)', array_to_string(v_opts, ', '));
  END IF;
END $$;

-- 1b. Core range RPC (same rules as the view) ----------------------------------
DO $$
DECLARE
  v_def text;
  v_new text;
  v_n   int;
BEGIN
  v_def := pg_get_functiondef('public.rpc_attendance_canonical_range_core(date,date,uuid,uuid,uuid)'::regprocedure);
  IF position($q$'^(APP|EVENT)'$q$ IN v_def) > 0 THEN
    RAISE NOTICE 'canonical core: event presence already applied';
    RETURN;
  END IF;
  v_n := (SELECT count(*) FROM regexp_matches(v_def, $r$\)\s+LIKE\s+'APP%'$r$, 'g'));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'canonical core: expected 1 APP%% source filter, found %', v_n;
  END IF;
  v_new := regexp_replace(v_def, $r$\)\s+LIKE\s+'APP%'$r$, $x$) ~ '^(APP|EVENT)'$x$);

  v_n := (SELECT count(*) FROM regexp_matches(v_new, $r$WHEN e\.app_first_in IS NOT NULL\s+THEN 'APP'$r$, 'g'));
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'canonical core: expected 2 APP source labels, found %', v_n;
  END IF;
  v_new := regexp_replace(v_new,
    $r$WHEN e\.app_first_in IS NOT NULL\s+THEN 'APP'$r$,
    $x$WHEN e.app_first_in IS NOT NULL THEN CASE WHEN upper(COALESCE(e.attendance_source, '')) = 'EVENT' THEN 'EVENT' ELSE 'APP' END$x$,
    'g');
  EXECUTE v_new;
END $$;

-- 1c. Per-row display patch: label event presence 'EVENT' ----------------------
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.hrms_canonical_row_patch(jsonb)'::regprocedure);
  IF position($q$c.src = 'EVENT'$q$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := regexp_replace(v_def,
    $r$WHEN c\.first_in = c\.app_in THEN 'APP'$r$,
    $x$WHEN c.first_in = c.app_in THEN CASE WHEN c.src = 'EVENT' THEN 'EVENT' ELSE 'APP' END$x$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'hrms_canonical_row_patch: APP label not found';
  END IF;
  EXECUTE v_new;
END $$;

-- 2. One comp-off per worked weekly off -----------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_event_comp_off(p_event_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_event public.events%rowtype;
  v_checkin public.event_checkins%rowtype;
  v_policy public.event_attendance_policy%rowtype;
  v_calendar jsonb;
  v_base numeric := 0;
  v_units numeric := 0;
  v_already numeric := 0;
  v_hours numeric := null;
  v_reason text;
  v_earning public.comp_off_earnings%rowtype;
  v_tx uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('event-comp-off:'||p_event_id||':'||p_user_id, 0));
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  SELECT * INTO v_checkin FROM public.event_checkins WHERE event_id = p_event_id AND user_id = p_user_id FOR UPDATE;
  SELECT * INTO v_policy FROM public.event_attendance_policy WHERE singleton = true;
  IF v_event.id IS NULL OR v_checkin.id IS NULL OR NOT coalesce(v_event.comp_off_enabled, false) THEN
    RETURN jsonb_build_object('eligible', false, 'days', 0, 'credited', false);
  END IF;
  v_calendar := public.resolve_hrms_calendar_day(p_user_id, v_event.event_date);
  IF v_calendar->>'kind' = 'WEEKLY_OFF' THEN
    v_base := v_policy.weekly_off_event_comp_off;
    -- Working on the weekly off already earned its comp-off (attendance
    -- trigger); the event must not credit the same day a second time.
    SELECT coalesce(sum(e.units), 0) INTO v_already
    FROM public.comp_off_earnings e
    WHERE e.user_id = p_user_id AND e.eligible_work_date = v_event.event_date
      AND e.source_type = 'WEEKLY_OFF_ATTENDANCE' AND upper(e.status) <> 'REJECTED';
    v_base := greatest(v_base - v_already, 0);
  ELSIF v_calendar->>'kind' = 'HOLIDAY' THEN
    v_base := v_policy.holiday_event_comp_off;
  ELSE
    INSERT INTO public.hrms_audit_events(actor_user_id, target_user_id, action, entity_type, entity_id, new_values, source)
    VALUES (v_event.created_by, p_user_id, 'COMP_OFF_REJECTED', 'event', p_event_id,
      jsonb_build_object('reason', 'WORKING_DAY', 'calendar_kind', v_calendar->>'kind'), 'EVENT_ENGINE');
    RETURN jsonb_build_object('eligible', false, 'days', 0, 'credited', false, 'calendar_kind', v_calendar->>'kind');
  END IF;
  IF coalesce(v_checkin.approved_duty_end_time, v_checkin.travel_end_time, v_checkin.checkout_time) IS NOT NULL THEN
    v_hours := extract(epoch FROM (coalesce(v_checkin.approved_duty_end_time, v_checkin.travel_end_time, v_checkin.checkout_time) -
      coalesce(v_checkin.approved_duty_start_time, v_checkin.travel_start_time, v_checkin.checkin_time))) / 3600.0;
  END IF;
  v_units := v_base + CASE WHEN v_policy.extended_event_duty_enabled AND v_hours >= v_policy.extended_event_threshold_hours
    THEN v_policy.additional_extended_duty_comp_off ELSE 0 END;
  v_units := greatest(least(v_units, v_policy.maximum_comp_off_per_event - v_already), 0);
  v_reason := 'Company Event - ' || CASE WHEN v_calendar->>'kind' = 'WEEKLY_OFF' THEN 'Weekly Off' ELSE 'Holiday' END ||
    CASE WHEN v_units > v_base THEN ' + Extended Duty' ELSE '' END;
  UPDATE public.event_checkins SET comp_off_eligible_days = v_units + v_already WHERE id = v_checkin.id;

  SELECT * INTO v_earning FROM public.comp_off_earnings
    WHERE user_id = p_user_id AND eligible_work_date = v_event.event_date
      AND source_type = 'EVENT_ATTENDANCE' AND source_id = p_event_id FOR UPDATE;

  IF v_units <= 0 THEN
    IF FOUND AND v_earning.status = 'PENDING' THEN
      UPDATE public.comp_off_earnings SET status = 'REJECTED', updated_at = now(),
        reason = 'Already credited as weekly-off comp-off'
      WHERE id = v_earning.id;
    END IF;
    RETURN jsonb_build_object('eligible', v_already > 0, 'days', v_already, 'credited', v_already > 0,
      'reason', 'Weekly off comp-off already credited for this day');
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.comp_off_earnings(user_id, eligible_work_date, units, remaining_units,
      source_type, source_id, reason, status, created_by)
    VALUES (p_user_id, v_event.event_date, v_units, v_units, 'EVENT_ATTENDANCE', p_event_id, v_reason, 'PENDING', v_event.created_by)
    RETURNING * INTO v_earning;
  ELSIF v_earning.status = 'PENDING' THEN
    UPDATE public.comp_off_earnings SET units = v_units, remaining_units = v_units, reason = v_reason, updated_at = now()
      WHERE id = v_earning.id RETURNING * INTO v_earning;
  END IF;
  IF v_policy.auto_approve_comp_off AND v_earning.status = 'PENDING' THEN
    v_tx := public.apply_leave_transaction(p_user_id, 'COMP_OFF', 'COMP_OFF_EARNING', v_earning.units,
      v_event.event_date, null, 'EVENT_ATTENDANCE', p_event_id, v_reason, v_event.created_by,
      'comp-off-earning:' || v_earning.id);
    UPDATE public.comp_off_earnings SET status = 'APPROVED', approved_by = v_event.created_by,
      approved_at = now(), credited_transaction_id = v_tx, updated_at = now() WHERE id = v_earning.id RETURNING * INTO v_earning;
  END IF;
  INSERT INTO public.hrms_audit_events(actor_user_id, target_user_id, action, entity_type, entity_id, new_values, source)
  VALUES (v_event.created_by, p_user_id, 'COMP_OFF_EARNED', 'comp_off_earning', v_earning.id,
    jsonb_build_object('event_id', p_event_id, 'days', v_units, 'reason', v_reason, 'status', v_earning.status), 'EVENT_ENGINE');
  RETURN jsonb_build_object('eligible', true, 'days', v_units + v_already, 'credited', v_earning.status = 'APPROVED',
    'status', v_earning.status, 'earning_id', v_earning.id, 'reason', v_reason, 'duty_hours', v_hours);
END $$;

-- 3. Monthly attendance -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_my_monthly_attendance_v3(p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;

  SELECT o.name INTO v_reg_office_name
  FROM public.profiles p LEFT JOIN public.offices o ON o.id = p.office_id
  WHERE p.id = v_uid;

  v_base := public.rpc_get_my_monthly_attendance_v2(p_month);
  IF NOT coalesce((v_base->>'success')::boolean, false) OR jsonb_typeof(v_base->'records') <> 'array' THEN
    RAISE EXCEPTION 'MONTHLY_ATTENDANCE_NOT_CONFIRMED';
  END IF;

  FOR v_record IN SELECT item.value FROM jsonb_array_elements(v_base->'records') item(value) LOOP
    v_date := (v_record->>'date')::date;
    v_attendance := NULL;
    v_check_in_office_name := NULL;

    SELECT * INTO v_attendance FROM public.attendance_logs
    WHERE user_id = v_uid AND date = v_date ORDER BY created_at LIMIT 1;

    SELECT name INTO v_check_in_office_name FROM public.offices WHERE id = v_attendance.office_id;

    SELECT event.id, event.title, event.address, checkin.arrival_status, checkin.late_minutes,
      checkin.checkin_time, checkin.checkout_time, checkin.comp_off_eligible_days
      INTO v_event FROM public.event_checkins checkin JOIN public.events event ON event.id = checkin.event_id
      WHERE checkin.user_id = v_uid AND event.event_date = v_date ORDER BY checkin.checkin_time LIMIT 1;

    SELECT visit.id, coalesce(visit.project_name, visit.location_name) name, visit.location_address,
      visit.checkin_time, visit.checkout_time INTO v_visit FROM public.field_visits visit
      WHERE visit.user_id = v_uid AND visit.date = v_date AND visit.checkin_time IS NOT NULL
      ORDER BY visit.checkin_time DESC LIMIT 1;

    -- Every approved comp-off earned for this day (event, weekly off, ...).
    SELECT coalesce(sum(earning.units), 0),
           string_agg(DISTINCT coalesce(event.title,
             CASE earning.source_type WHEN 'WEEKLY_OFF_ATTENDANCE' THEN 'Worked on weekly off'
                  ELSE initcap(replace(lower(earning.source_type), '_', ' ')) END), ', ')
      INTO v_comp_days, v_comp_name
      FROM public.comp_off_earnings earning
      LEFT JOIN public.events event ON earning.source_type = 'EVENT_ATTENDANCE' AND event.id = earning.source_id
      WHERE earning.user_id = v_uid AND earning.eligible_work_date = v_date AND upper(earning.status) = 'APPROVED';

    IF v_comp_days = 0 THEN
      SELECT coalesce(sum(credit.days), 0), string_agg(DISTINCT event.title, ', ' ORDER BY event.title)
        INTO v_comp_days, v_comp_name FROM public.event_comp_off_credits credit
        JOIN public.events event ON event.id = credit.event_id
        WHERE credit.user_id = v_uid AND event.event_date = v_date;
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
      'compOffEligible', coalesce(v_event.comp_off_eligible_days, 0),
      'compOffEarned', coalesce(v_comp_days, 0), 'compOffEventName', v_comp_name);

    v_status := lower(coalesce(v_record->>'status', ''));
    IF v_event.id IS NOT NULL
       AND upper(coalesce(v_attendance.checkin_source, v_attendance.attendance_type, 'EVENT')) = 'EVENT'
       AND v_status NOT IN ('leave', 'wfh') THEN
      -- The day started at the event: the event's own start time decides lateness.
      v_record := v_record || jsonb_build_object(
        'status', CASE WHEN v_event.arrival_status = 'LATE' THEN 'late' ELSE 'present' END,
        'is_late', v_event.arrival_status = 'LATE');
    ELSIF v_comp_days > 0 AND v_status NOT IN ('present', 'late', 'leave', 'wfh') THEN
      v_record := v_record || jsonb_build_object('status', 'compoff');
    END IF;

    v_records := v_records || v_record;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'records', v_records, 'late_cutoff', v_base->>'late_cutoff');
END $$;

-- 4. Event creation with comp-off; retire the legacy Sunday/Marketing engine ----
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_comp_off_team_marketing_only_ck;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('rpc_event_check_in', 'rpc_event_check_out', 'grant_sunday_event_comp_off')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- 5. Second event the same day keeps the working day open --------------------
DO $$
DECLARE
  v_def text;
  v_new text;
  v_anchor text := 'if not found or v_attendance.checkout_time is not null then return new; end if;';
BEGIN
  IF to_regprocedure('public.sync_event_checkout_to_attendance()') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.sync_event_checkout_to_attendance()'::regprocedure);
  IF position('still checked in at another event' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'sync_event_checkout_to_attendance: anchor not found';
  END IF;
  v_new := replace(v_def, v_anchor, v_anchor || $x$
  -- still checked in at another event that day: the working day is not over
  if exists (
    select 1 from public.event_checkins other
    join public.events other_event on other_event.id = other.event_id
    where other.user_id = new.user_id and other.id <> new.id
      and other_event.event_date = v_event.event_date
      and other.checkout_time is null
  ) then return new; end if;$x$);
  EXECUTE v_new;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- Event attendees today now present (expect CHECKED_IN / CHECKED_OUT, source EVENT):
-- SELECT p.name, c.effective_status, c.first_in_source
-- FROM event_checkins ec JOIN events e ON e.id = ec.event_id JOIN profiles p ON p.id = ec.user_id
-- CROSS JOIN LATERAL rpc_attendance_canonical_range_core(e.event_date, e.event_date, NULL, NULL, ec.user_id) c
-- WHERE e.event_date = (now() AT TIME ZONE 'Asia/Kolkata')::date;
