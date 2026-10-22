-- =============================================================================
-- 20261008140000_fix_another_visit_in_progress.sql
--
-- Bug: "You are still checked in at another visit" when the employee has no
-- visit in progress today.
--
-- Root cause: the one-visit-at-a-time guard (20261008110000 / 20261008130000)
-- looked at EVERY field_visits row of the employee with status CHECKED_IN and
-- no checkout, on ANY date. Before 20261008110000 nothing ever closed a visit
-- the employee forgot to check out of (auto_checkout_field_visits was never
-- scheduled), so old days still have CHECKED_IN rows. The Field Visits screen
-- only loads today's visits, so the blocking visit is invisible to the
-- employee and the new visit can never be checked in.
-- The guard also counted the verification copy of the same stop that the
-- "current location" fallback creates (source_field_visit_id).
--
-- Fix:
--   1. The guard only considers another stop of the SAME day.
--   2. Before checking, the employee's open visits from earlier days are
--      closed (completed at 20:00 IST of their day, flagged
--      AUTO_CLOSED_NO_CHECKOUT for review) — the same rule as the nightly job.
--   3. The nightly job closes open visits of any earlier date (no 30-day limit),
--      and is run once now to clean up existing rows.
-- Also fixes SERVER_MANAGED_FIELD: protect_field_visit_location_fields()
-- only lets trusted functions change verification / review / evidence fields
-- (they set app.current_location_server = 'on'). The risk-flag update, the
-- review and the check-out wrapper did not, so every site-visit check-out and
-- review since 20261008110000 failed.
-- Run AFTER 20261008130000_site_visit_photo_optional.sql. Idempotent.
-- =============================================================================

-- Risk flags: a trusted server update.
CREATE OR REPLACE FUNCTION public.hrms_apply_field_visit_risk(p_visit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_flags jsonb := public.hrms_field_visit_risk_flags(p_visit_id);
  v_prev text := coalesce(current_setting('app.current_location_server', true), '');
BEGIN
  PERFORM set_config('app.current_location_server', 'on', true);
  UPDATE public.field_visits
  SET risk_flags = v_flags,
      verification_status = CASE
        WHEN reviewed_at IS NOT NULL THEN verification_status
        WHEN jsonb_array_length(v_flags) > 0 THEN 'FLAGGED'
        ELSE coalesce(verification_status, 'PENDING') END
  WHERE id = p_visit_id;
  PERFORM set_config('app.current_location_server', v_prev, true);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_apply_field_visit_risk(uuid) FROM public, anon, authenticated;

-- Review: a trusted server update.
DO $$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.rpc_review_field_visit(uuid, text, text)'::regprocedure);
  IF position('app.current_location_server' IN v_def) = 0 THEN
    v_new := replace(v_def,
$o$  UPDATE public.field_visits
  SET verification_status = v_decision, reviewer_notes = v_notes,
      reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_visit_id;$o$,
$n$  PERFORM set_config('app.current_location_server', 'on', true);
  UPDATE public.field_visits
  SET verification_status = v_decision, reviewer_notes = v_notes,
      reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_visit_id;
  PERFORM set_config('app.current_location_server', '', true);$n$);
    IF v_new = v_def THEN RAISE EXCEPTION 'rpc_review_field_visit: expected text not found'; END IF;
    EXECUTE v_new;
  END IF;
END $$;

-- Close one employee's (or everyone's) open visits from days before today.
CREATE OR REPLACE FUNCTION public.hrms_close_open_field_visits_before_today(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT id, date FROM public.field_visits
    WHERE status = 'CHECKED_IN' AND checkout_time IS NULL
      AND date < v_today
      AND (p_user_id IS NULL OR user_id = p_user_id)
    FOR UPDATE
  LOOP
    UPDATE public.field_visits
    SET checkout_time = public.hrms_auto_checkout_at(r.date),
        status = 'COMPLETED', visit_state = 'COMPLETED', journey_status = 'COMPLETED',
        auto_closed = true
    WHERE id = r.id;
    PERFORM public.hrms_apply_field_visit_risk(r.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_close_open_field_visits_before_today(uuid) FROM public, anon, authenticated;

-- Nightly job: today's open visits after 20:00, every earlier day, missed starts.
CREATE OR REPLACE FUNCTION public.hrms_close_stale_field_visits()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r record;
  v_completed integer;
  v_missed integer := 0;
BEGIN
  v_completed := public.hrms_close_open_field_visits_before_today(NULL);

  IF now() >= public.hrms_auto_checkout_at(v_today) THEN
    FOR r IN
      SELECT id FROM public.field_visits
      WHERE status = 'CHECKED_IN' AND checkout_time IS NULL AND date = v_today
      FOR UPDATE
    LOOP
      UPDATE public.field_visits
      SET checkout_time = public.hrms_auto_checkout_at(v_today),
          status = 'COMPLETED', visit_state = 'COMPLETED', journey_status = 'COMPLETED',
          auto_closed = true
      WHERE id = r.id;
      PERFORM public.hrms_apply_field_visit_risk(r.id);
      v_completed := v_completed + 1;
    END LOOP;
  END IF;

  UPDATE public.field_visits
  SET status = 'MISSED', visit_state = 'CANCELLED', journey_status = 'CANCELLED'
  WHERE status IN ('PENDING', 'IN_TRANSIT') AND checkin_time IS NULL AND date < v_today;
  GET DIAGNOSTICS v_missed = ROW_COUNT;

  RETURN jsonb_build_object('completed', v_completed, 'missed', v_missed);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_close_stale_field_visits() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_close_stale_field_visits() TO service_role;

-- Employee mutations (same as 20261008130000 except the CHECK_IN guard).
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
  v_target public.field_visits%rowtype;
  v_checkout boolean := false;
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
    -- Forgotten visits of earlier days never block today.
    PERFORM public.hrms_close_open_field_visits_before_today(v_uid);

    SELECT * INTO v_target FROM public.field_visits WHERE id = p_visit_id AND user_id = v_uid;
    IF FOUND AND EXISTS (
      SELECT 1 FROM public.field_visits o
      WHERE o.user_id = v_uid
        AND o.date = v_target.date
        AND o.status = 'CHECKED_IN' AND o.checkout_time IS NULL
        AND o.id <> p_visit_id
        -- not the same stop (current-location verification copy and its source)
        AND coalesce(o.source_field_visit_id, o.id)
            <> coalesce(v_target.source_field_visit_id, v_target.id)
    ) THEN
      RAISE EXCEPTION 'ANOTHER_VISIT_IN_PROGRESS';
    END IF;
  END IF;

  IF v_action = 'CHECK_OUT' AND p_visit_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.field_visits WHERE id = p_visit_id AND user_id = v_uid FOR UPDATE;
    IF FOUND AND v_row.status = 'CHECKED_IN' AND v_row.checkout_time IS NULL THEN
      v_checkout := true;
      v_lat := nullif(v_values->>'latitude', '')::double precision;
      v_lon := nullif(v_values->>'longitude', '')::double precision;
      v_acc := nullif(v_values->>'accuracy', '')::double precision;
      v_captured := nullif(coalesce(v_values->>'captured_at', v_values->>'capturedAt'), '')::timestamptz;
      IF v_acc IS NULL OR v_acc < 0 OR v_acc > 100 THEN RAISE EXCEPTION 'GPS_ACCURACY_NOT_ACCEPTABLE'; END IF;
      IF v_captured IS NULL OR v_captured < now() - interval '120 seconds' OR v_captured > now() + interval '10 seconds' THEN
        RAISE EXCEPTION 'STALE_LOCATION_EVIDENCE';
      END IF;
      IF coalesce((v_values->>'mocked')::boolean, false) THEN RAISE EXCEPTION 'MOCK_LOCATION_DETECTED'; END IF;

      v_path := nullif(btrim(v_values->>'evidence_photo_path'), '');
      v_hash := nullif(btrim(v_values->>'evidence_file_hash'), '');
      IF v_path IS NOT NULL AND v_path IS DISTINCT FROM v_row.evidence_photo_path THEN
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

  IF v_checkout AND coalesce((v_result->>'success')::boolean, false) THEN
    PERFORM set_config('app.current_location_server', 'on', true);
    UPDATE public.field_visits
    SET evidence_photo_path = coalesce(v_path, evidence_photo_path),
        evidence_file_hash = coalesce(v_hash, evidence_file_hash),
        evidence_photo_source = CASE WHEN v_path IS NOT NULL THEN coalesce(evidence_photo_source, 'CAMERA')
                                     ELSE evidence_photo_source END,
        checkout_distance_m = round(v_distance::numeric, 1),
        checkout_accuracy_m = v_acc
    WHERE id = p_visit_id;
    PERFORM set_config('app.current_location_server', '', true);
    PERFORM public.hrms_apply_field_visit_risk(p_visit_id);
    SELECT jsonb_set(v_result, '{visit}', to_jsonb(fv)) INTO v_result FROM public.field_visits fv WHERE fv.id = p_visit_id;
    INSERT INTO public.hrms_audit_events (actor_user_id, target_user_id, action, entity_type, entity_id, new_values, source)
    VALUES (v_uid, v_uid, 'FIELD_VISIT_COMPLETED', 'field_visit', p_visit_id,
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

-- Clean up the visits that are blocking employees right now.
SELECT public.hrms_close_stale_field_visits() AS closed_now;

NOTIFY pgrst, 'reload schema';
