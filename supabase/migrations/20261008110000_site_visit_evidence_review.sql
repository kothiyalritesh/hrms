-- =============================================================================
-- 20261008110000_site_visit_evidence_review.sql
--
-- Site visits become a verification workflow, not only a GPS trail.
-- Run AFTER 20261008100000_production_integrity_phase_a.sql.
--
--   1. Check-out needs a site photo (business decision 7 Oct 2026: a photo on
--      every visit), a fresh GPS reading (accuracy <= 100 m, < 2 min old) and no
--      mock location. Only one visit can be checked in at a time.
--   2. Every completed visit gets risk flags (checked out away from the site,
--      very short stay, left the site long before check-out, fake GPS / jumps
--      in its pings, closed automatically). Flagged visits go to review.
--   3. rpc_review_field_visit: APPROVED / FLAGGED / REJECTED / NEEDS_INFORMATION
--      with notes, audit row, notification to the employee, manager + HR on
--      FLAGGED / REJECTED, compliance deduction on REJECTED (once).
--   4. Open visits are closed every night at 20:05 IST (checked-in → completed
--      and flagged; never started → missed).
--   5. Site Visit Observer data: counts visits (not employees), status from the
--      visit itself, review fields, flagged count, realistic signal window for
--      movement-only tracking.
--   6. Reviewers in scope can open the evidence photo.
-- Idempotent.
-- =============================================================================

SET statement_timeout = '10min';

ALTER TABLE public.field_visits ADD COLUMN IF NOT EXISTS risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.field_visits ADD COLUMN IF NOT EXISTS checkout_distance_m double precision;
ALTER TABLE public.field_visits ADD COLUMN IF NOT EXISTS checkout_accuracy_m double precision;
ALTER TABLE public.field_visits ADD COLUMN IF NOT EXISTS auto_closed boolean NOT NULL DEFAULT false;

INSERT INTO public.compliance_score_config (violation_type, default_deduction_amount, description)
VALUES ('SITE_VISIT_REJECTED', 5, 'Deduction when a site visit is rejected after review')
ON CONFLICT (violation_type) DO NOTHING;

-- ─── 1. Risk flags for one visit ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hrms_field_visit_risk_flags(p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.field_visits%rowtype;
  v_flags jsonb := '[]'::jsonb;
  v_radius double precision;
  v_in timestamptz;
  v_out timestamptz;
BEGIN
  SELECT * INTO v FROM public.field_visits WHERE id = p_visit_id;
  IF NOT FOUND THEN RETURN v_flags; END IF;
  v_radius := greatest(coalesce(v.checkin_radius_m, v.arrival_radius_m, 100), 25);
  v_in := public.hrms_timestamp(v.checkin_time);
  v_out := public.hrms_timestamp(v.checkout_time);

  IF v.auto_closed THEN
    v_flags := v_flags || '["AUTO_CLOSED_NO_CHECKOUT"]'::jsonb;
  END IF;
  IF v.checkout_distance_m IS NOT NULL AND v.checkout_distance_m > v_radius + 100 THEN
    v_flags := v_flags || '["CHECKED_OUT_AWAY_FROM_SITE"]'::jsonb;
  END IF;
  IF v_in IS NOT NULL AND v_out IS NOT NULL AND v_out - v_in < interval '5 minutes' THEN
    v_flags := v_flags || '["VERY_SHORT_VISIT"]'::jsonb;
  END IF;
  IF v.departed_at IS NOT NULL AND v_out IS NOT NULL AND v.departed_at < v_out - interval '20 minutes' THEN
    v_flags := v_flags || '["LEFT_SITE_BEFORE_CHECKOUT"]'::jsonb;
  END IF;
  IF EXISTS (SELECT 1 FROM public.location_tracking lt
             WHERE lt.field_visit_id = v.id AND lt.quality_status = 'MOCKED') THEN
    v_flags := v_flags || '["MOCK_LOCATION_PINGS"]'::jsonb;
  END IF;
  IF (SELECT count(*) FROM public.location_tracking lt
      WHERE lt.field_visit_id = v.id AND lt.quality_status = 'IMPOSSIBLE_SPEED') >= 2 THEN
    v_flags := v_flags || '["GPS_JUMPS"]'::jsonb;
  END IF;
  IF nullif(v.evidence_photo_path, '') IS NULL AND v.status = 'COMPLETED' THEN
    v_flags := v_flags || '["NO_PHOTO"]'::jsonb;
  END IF;
  RETURN v_flags;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_field_visit_risk_flags(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hrms_apply_field_visit_risk(p_visit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_flags jsonb := public.hrms_field_visit_risk_flags(p_visit_id);
BEGIN
  UPDATE public.field_visits
  SET risk_flags = v_flags,
      verification_status = CASE
        WHEN reviewed_at IS NOT NULL THEN verification_status
        WHEN jsonb_array_length(v_flags) > 0 THEN 'FLAGGED'
        ELSE coalesce(verification_status, 'PENDING') END
  WHERE id = p_visit_id;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_apply_field_visit_risk(uuid) FROM public, anon, authenticated;

-- ─── 2. Employee mutations: evidence + location rules at check-out ───────────
CREATE OR REPLACE FUNCTION public.hrms_evidence_exists(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_exists boolean := true;
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2)'
      INTO v_exists USING 'field-visit-evidence', p_path;
  END IF;
  RETURN coalesce(v_exists, false);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_evidence_exists(text) FROM public, anon, authenticated;


DO $$
BEGIN
  IF to_regprocedure('public.rpc_mutate_own_field_visit__core(text, uuid, jsonb)') IS NULL THEN
    ALTER FUNCTION public.rpc_mutate_own_field_visit(text, uuid, jsonb)
      RENAME TO rpc_mutate_own_field_visit__core;
    REVOKE ALL ON FUNCTION public.rpc_mutate_own_field_visit__core(text, uuid, jsonb) FROM public, anon, authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_mutate_own_field_visit(
  p_action text, p_visit_id uuid DEFAULT NULL, p_values jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_row public.field_visits%rowtype;
  v_path text;
  v_hash text;
  v_lat double precision;
  v_lon double precision;
  v_acc double precision;
  v_captured timestamptz;
  v_dest_lat double precision;
  v_dest_lon double precision;
  v_distance double precision;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;

  IF v_action = 'CHECK_IN' AND p_visit_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.field_visits
               WHERE user_id = v_uid AND id <> p_visit_id
                 AND status = 'CHECKED_IN' AND checkout_time IS NULL) THEN
      RAISE EXCEPTION 'ANOTHER_VISIT_IN_PROGRESS';
    END IF;
  END IF;

  IF v_action = 'CHECK_OUT' AND p_visit_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.field_visits WHERE id = p_visit_id AND user_id = v_uid FOR UPDATE;
    IF FOUND AND v_row.status = 'CHECKED_IN' AND v_row.checkout_time IS NULL THEN
      v_lat := nullif(v_values->>'latitude', '')::double precision;
      v_lon := nullif(v_values->>'longitude', '')::double precision;
      v_acc := nullif(v_values->>'accuracy', '')::double precision;
      v_captured := nullif(coalesce(v_values->>'captured_at', v_values->>'capturedAt'), '')::timestamptz;
      IF v_acc IS NULL OR v_acc < 0 OR v_acc > 100 THEN RAISE EXCEPTION 'GPS_ACCURACY_NOT_ACCEPTABLE'; END IF;
      IF v_captured IS NULL OR v_captured < now() - interval '120 seconds' OR v_captured > now() + interval '10 seconds' THEN
        RAISE EXCEPTION 'STALE_LOCATION_EVIDENCE';
      END IF;
      IF coalesce((v_values->>'mocked')::boolean, false) THEN RAISE EXCEPTION 'MOCK_LOCATION_DETECTED'; END IF;

      v_path := coalesce(nullif(btrim(v_values->>'evidence_photo_path'), ''), nullif(v_row.evidence_photo_path, ''));
      v_hash := nullif(btrim(v_values->>'evidence_file_hash'), '');
      IF v_path IS NULL THEN RAISE EXCEPTION 'EVIDENCE_PHOTO_REQUIRED'; END IF;
      IF v_path IS DISTINCT FROM v_row.evidence_photo_path THEN
        IF left(v_path, length(v_uid::text) + 1) <> v_uid::text || '/'
           OR position('/' || p_visit_id::text || '/' IN v_path) = 0
           OR position('..' IN v_path) > 0 THEN
          RAISE EXCEPTION 'INVALID_EVIDENCE_PATH';
        END IF;
        IF NOT public.hrms_evidence_exists(v_path) THEN
          RAISE EXCEPTION 'EVIDENCE_PHOTO_NOT_UPLOADED';
        END IF;
      END IF;

      v_dest_lat := nullif(v_row.destination_coords->>'latitude', '')::double precision;
      v_dest_lon := nullif(v_row.destination_coords->>'longitude', '')::double precision;
      IF v_dest_lat IS NOT NULL AND v_dest_lon IS NOT NULL AND v_lat IS NOT NULL AND v_lon IS NOT NULL THEN
        v_distance := public.tracking_distance_metres(v_dest_lat, v_dest_lon, v_lat, v_lon);
      END IF;
    END IF;
  END IF;

  v_result := public.rpc_mutate_own_field_visit__core(p_action, p_visit_id, p_values);

  IF v_action = 'CHECK_OUT' AND coalesce((v_result->>'success')::boolean, false) AND v_path IS NOT NULL THEN
    UPDATE public.field_visits
    SET evidence_photo_path = v_path,
        evidence_file_hash = coalesce(v_hash, evidence_file_hash),
        evidence_photo_source = coalesce(evidence_photo_source, 'CAMERA'),
        checkout_distance_m = round(v_distance::numeric, 1),
        checkout_accuracy_m = v_acc
    WHERE id = p_visit_id;
    PERFORM public.hrms_apply_field_visit_risk(p_visit_id);
    SELECT jsonb_set(v_result, '{visit}', to_jsonb(fv)) INTO v_result FROM public.field_visits fv WHERE fv.id = p_visit_id;
    INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, new_values, source)
    VALUES (v_uid, v_uid, 'FIELD_VISIT_COMPLETED_WITH_EVIDENCE', 'field_visit', p_visit_id,
            jsonb_build_object('distance_metres', round(v_distance), 'accuracy_metres', v_acc,
                               'evidence_photo_path', v_path,
                               'risk_flags', (SELECT risk_flags FROM public.field_visits WHERE id = p_visit_id)),
            'FIELD_VISIT_ENGINE');
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_mutate_own_field_visit(text, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_mutate_own_field_visit(text, uuid, jsonb) TO authenticated;

-- ─── 3. Review ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_review_field_visit(
  p_visit_id uuid, p_decision text, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.field_visits%rowtype;
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_name text;
  v_place text;
  v_points integer;
  v_month date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF v_decision NOT IN ('APPROVED', 'FLAGGED', 'REJECTED', 'NEEDS_INFORMATION') THEN
    RAISE EXCEPTION 'INVALID_DECISION';
  END IF;
  IF v_decision <> 'APPROVED' AND (v_notes IS NULL OR length(v_notes) < 3) THEN
    RAISE EXCEPTION 'NOTES_REQUIRED';
  END IF;
  SELECT * INTO v FROM public.field_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIELD_VISIT_NOT_FOUND'; END IF;
  IF v.user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_REVIEW_OWN_VISIT'; END IF;
  IF NOT (public.is_profile_admin() OR public.can_access_user_data(v.user_id, 'field_visits.view')) THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.field_visits
  SET verification_status = v_decision, reviewer_notes = v_notes,
      reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_visit_id;

  INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, old_values, new_values, source)
  VALUES (auth.uid(), v.user_id, 'FIELD_VISIT_REVIEWED', 'field_visit', p_visit_id,
          jsonb_build_object('verification_status', v.verification_status, 'reviewer_notes', v.reviewer_notes),
          jsonb_build_object('verification_status', v_decision, 'reviewer_notes', v_notes, 'risk_flags', v.risk_flags),
          'FIELD_VISIT_REVIEW');

  SELECT name INTO v_name FROM public.profiles WHERE id = v.user_id;
  v_place := coalesce(v.project_name, v.location_name, 'the site');

  PERFORM public.enqueue_hrms_notification(v.user_id,
    CASE v_decision WHEN 'APPROVED' THEN 'Site visit approved'
                    WHEN 'NEEDS_INFORMATION' THEN 'More information needed for your site visit'
                    WHEN 'FLAGGED' THEN 'Your site visit was flagged'
                    ELSE 'Your site visit was rejected' END,
    v_place || coalesce(': ' || v_notes, ''),
    'field_visit_' || lower(v_decision), 'field-visit-review:' || p_visit_id || ':' || v_decision || ':' || extract(epoch FROM now())::bigint,
    '/HRMS/field-visits', p_visit_id, NULL, jsonb_build_object('fieldVisitId', p_visit_id));

  IF v_decision IN ('FLAGGED', 'REJECTED') THEN
    PERFORM public.hrms_notify_line_and_hr(v.user_id,
      'Site visit ' || lower(v_decision),
      coalesce(v_name, 'An employee') || ' — ' || v_place || coalesce(': ' || v_notes, ''),
      'field_visit_' || lower(v_decision), 'field-visit-escalation:' || p_visit_id || ':' || v_decision,
      '/HRMS/admin/site-visit-observer', jsonb_build_object('fieldVisitId', p_visit_id));
  END IF;

  IF v_decision = 'REJECTED'
     AND NOT EXISTS (SELECT 1 FROM public.compliance_score_deductions
                     WHERE source_table = 'field_visits' AND source_id = p_visit_id) THEN
    SELECT coalesce(max(default_deduction_amount), 5) INTO v_points
    FROM public.compliance_score_config WHERE violation_type = 'SITE_VISIT_REJECTED';
    v_month := date_trunc('month', v.date)::date;
    INSERT INTO public.employee_compliance_scores (user_id, score_month, current_score)
    VALUES (v.user_id, v_month, 100) ON CONFLICT (user_id, score_month) DO NOTHING;
    UPDATE public.employee_compliance_scores
    SET current_score = greatest(0, current_score - v_points), updated_at = now()
    WHERE user_id = v.user_id AND score_month = v_month;
    INSERT INTO public.compliance_score_deductions
      (user_id, score_month, deduction_amount, reason, source_table, source_id, deducted_by)
    VALUES (v.user_id, v_month, v_points, 'Site visit rejected: ' || left(coalesce(v_notes, ''), 200),
            'field_visits', p_visit_id, auth.uid());
  END IF;

  RETURN jsonb_build_object('success', true, 'decision', v_decision);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_review_field_visit(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_review_field_visit(uuid, text, text) TO authenticated;

-- ─── 4. Nightly close of open visits ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hrms_close_stale_field_visits()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r record;
  v_completed integer := 0;
  v_missed integer := 0;
BEGIN
  FOR r IN
    SELECT id, date FROM public.field_visits
    WHERE status = 'CHECKED_IN' AND checkout_time IS NULL
      AND date <= v_today AND date >= v_today - 30
      AND now() >= public.hrms_auto_checkout_at(date)
    FOR UPDATE
  LOOP
    UPDATE public.field_visits
    SET checkout_time = public.hrms_auto_checkout_at(r.date),
        status = 'COMPLETED', visit_state = 'COMPLETED', journey_status = 'COMPLETED',
        auto_closed = true
    WHERE id = r.id;
    PERFORM public.hrms_apply_field_visit_risk(r.id);
    v_completed := v_completed + 1;
  END LOOP;

  UPDATE public.field_visits
  SET status = 'MISSED', visit_state = 'CANCELLED', journey_status = 'CANCELLED'
  WHERE status IN ('PENDING', 'IN_TRANSIT') AND checkin_time IS NULL
    AND date < v_today AND date >= v_today - 30;
  GET DIAGNOSTICS v_missed = ROW_COUNT;

  RETURN jsonb_build_object('completed', v_completed, 'missed', v_missed);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_close_stale_field_visits() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_close_stale_field_visits() TO service_role;

-- ─── 5. Site Visit Observer data ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_site_visit_observer_data(
  p_date date,
  p_employee_id uuid DEFAULT NULL,
  p_visit_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_live boolean := (p_date = (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_is_admin boolean;
  v_summary jsonb;
  v_employees jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'AUTHENTICATION_REQUIRED'); END IF;
  v_is_admin := public.is_profile_admin();
  IF NOT v_is_admin AND NOT public.hrms_has_permission('field_visits.view') THEN
    RETURN jsonb_build_object('error', 'PERMISSION_DENIED');
  END IF;

  WITH visits AS (
    SELECT fv.*,
           live.latitude AS live_lat, live.longitude AS live_lon, live.accuracy_m AS live_acc,
           live.tracking_status AS live_status, live.speed_mps AS live_speed,
           coalesce(live.last_location_at, live.recorded_at) AS live_at,
           live.gps_quality AS live_quality, live.battery_level AS live_battery
    FROM public.field_visits fv
    LEFT JOIN public.site_visit_live_locations live ON live.field_visit_id = fv.id
    WHERE fv.date = p_date
      AND fv.source_field_visit_id IS NULL            -- one row per stop (fallback children collapse)
      AND (p_employee_id IS NULL OR fv.user_id = p_employee_id)
      AND (p_visit_id IS NULL OR fv.id = p_visit_id)
      AND (v_is_admin OR public.can_access_user_data(fv.user_id, 'field_visits.view'))
  ), per_employee AS (
    SELECT v.user_id,
           bool_or(v.status = 'CHECKED_IN') AS has_at_site,
           bool_or(v.status IN ('PENDING', 'IN_TRANSIT')) AS has_en_route,
           bool_or(v.status = 'COMPLETED') AS has_completed,
           count(*) FILTER (WHERE v.verification_status IN ('FLAGGED', 'NEEDS_INFORMATION')) AS flagged_count,
           max(v.live_at) AS last_ping_at,
           (array_agg(v.live_lat ORDER BY v.live_at DESC NULLS LAST))[1] AS lat,
           (array_agg(v.live_lon ORDER BY v.live_at DESC NULLS LAST))[1] AS lon,
           (array_agg(v.live_acc ORDER BY v.live_at DESC NULLS LAST))[1] AS acc,
           (array_agg(v.live_speed ORDER BY v.live_at DESC NULLS LAST))[1] AS speed,
           (array_agg(v.live_quality ORDER BY v.live_at DESC NULLS LAST))[1] AS quality,
           (array_agg(v.live_battery ORDER BY v.live_at DESC NULLS LAST))[1] AS battery,
           jsonb_agg(jsonb_build_object(
             'visit_id', v.id,
             'status', v.status,
             'location_name', v.location_name,
             'project_name', v.project_name,
             'checkin_time', to_char(public.hrms_timestamp(v.checkin_time) AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'),
             'checkout_time', to_char(public.hrms_timestamp(v.checkout_time) AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'),
             'visit_type', v.visit_type,
             'destination_lat', nullif(v.destination_coords->>'latitude', '')::double precision,
             'destination_lon', nullif(v.destination_coords->>'longitude', '')::double precision,
             'radius_m', coalesce(v.checkin_radius_m, v.arrival_radius_m, 100),
             'client_name', coalesce(v.contact_name, v.company_name),
             'client_phone', v.contact_phone,
             'verification_status', coalesce(v.verification_status, 'PENDING'),
             'risk_flags', coalesce(v.risk_flags, '[]'::jsonb),
             'reviewer_notes', v.reviewer_notes,
             'reviewed_at', v.reviewed_at,
             'evidence_photo_path', v.evidence_photo_path,
             'checkout_notes', v.checkout_notes,
             'checkout_distance_m', v.checkout_distance_m,
             'arrived_at', v.arrived_at,
             'departed_at', v.departed_at,
             'auto_closed', v.auto_closed,
             'last_ping_at', v.live_at
           ) ORDER BY v.created_at) AS visits_json
    FROM visits v
    GROUP BY v.user_id
  ), cards AS (
    SELECT pe.*, p.name, p.employee_number, p.role, coalesce(p.department, t.name, p.team) AS department, o.name AS office_name,
      CASE
        WHEN v_is_live AND pe.has_at_site THEN 'AT_SITE'
        WHEN v_is_live AND pe.has_en_route THEN 'IN_TRANSIT'
        WHEN pe.has_completed THEN 'COMPLETED'
        ELSE 'MISSED'
      END AS status,
      CASE
        WHEN NOT v_is_live OR NOT (pe.has_at_site OR pe.has_en_route) THEN 'ENDED'
        WHEN pe.last_ping_at IS NULL OR pe.last_ping_at < now() - interval '30 minutes' THEN 'SIGNAL_LOST'
        WHEN pe.last_ping_at < now() - interval '5 minutes' THEN 'DELAYED'
        ELSE 'LIVE'
      END AS signal_status
    FROM per_employee pe
    JOIN public.profiles p ON p.id = pe.user_id
    LEFT JOIN public.teams t ON t.id = p.team_id
    LEFT JOIN public.offices o ON o.id = p.office_id
  )
  SELECT
    jsonb_build_object(
      'total_visits', (SELECT count(*) FROM visits),
      'at_site', (SELECT count(*) FROM cards WHERE status = 'AT_SITE'),
      'in_transit', (SELECT count(*) FROM cards WHERE status = 'IN_TRANSIT'),
      'completed', (SELECT count(*) FROM visits WHERE status = 'COMPLETED'),
      'missed', (SELECT count(*) FROM visits WHERE status = 'MISSED'),
      'signal_lost', (SELECT count(*) FROM cards WHERE signal_status = 'SIGNAL_LOST'),
      'flagged', (SELECT count(*) FROM visits WHERE verification_status IN ('FLAGGED', 'NEEDS_INFORMATION')),
      'to_review', (SELECT count(*) FROM visits WHERE status = 'COMPLETED' AND reviewed_at IS NULL)
    ),
    coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', c.user_id,
      'name', c.name,
      'employee_no', c.employee_number,
      'role', c.role,
      'department', c.department,
      'office_name', c.office_name,
      'flagged_count', c.flagged_count,
      'tracking', jsonb_build_object(
        'status', c.status,
        'signal_status', c.signal_status,
        'tracking_health', CASE c.signal_status WHEN 'LIVE' THEN 'ACTIVE' WHEN 'DELAYED' THEN 'DELAYED' ELSE 'STALE' END,
        'gps_quality', coalesce(c.quality, 'HIGH'),
        'latitude', c.lat,
        'longitude', c.lon,
        'accuracy', c.acc,
        'battery_level', c.battery,
        'speed_mps', c.speed,
        'source', 'background',
        'last_location_at', c.last_ping_at,
        'last_uploaded_at', c.last_ping_at,
        'pending_ping_count', 0,
        'updated_at', c.last_ping_at
      ),
      'visits', c.visits_json,
      'latest_lat', c.lat,
      'latest_lon', c.lon,
      'tracking_status', c.status,
      'updated_at', c.last_ping_at
    ) ORDER BY c.name), '[]'::jsonb)
  INTO v_summary, v_employees
  FROM cards c;

  RETURN jsonb_build_object(
    'date', p_date::text,
    'mode', CASE WHEN v_is_live THEN 'LIVE' ELSE 'HISTORICAL' END,
    'is_live', v_is_live,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'employees', coalesce(v_employees, '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) TO authenticated;

-- ─── 6. Evidence photo visible to reviewers in scope ─────────────────────────
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS field_visit_evidence_scoped_reviewer_select ON storage.objects';
    EXECUTE $p$
      CREATE POLICY field_visit_evidence_scoped_reviewer_select ON storage.objects
      FOR SELECT TO authenticated USING (
        bucket_id = 'field-visit-evidence' AND EXISTS (
          SELECT 1 FROM public.field_visits v
          WHERE v.evidence_photo_path = storage.objects.name
            AND (public.is_profile_admin() OR public.can_access_user_data(v.user_id, 'field_visits.view'))
        )
      )$p$;
  END IF;
END $$;

-- Realtime for the observer map.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = 'site_visit_live_locations') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.site_visit_live_locations';
  END IF;
END $$;

-- ─── 7. Schedule ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hrms-close-stale-field-visits';
    PERFORM cron.schedule('hrms-close-stale-field-visits', '35 14 * * *',
      $job$ select public.hrms_close_stale_field_visits(); $job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed: schedule hrms_close_stale_field_visits() daily at 20:05 IST.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
