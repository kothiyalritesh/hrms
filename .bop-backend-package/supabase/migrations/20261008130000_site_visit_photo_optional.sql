-- =============================================================================
-- 20261008130000_site_visit_photo_optional.sql
--
-- Business change (8 Oct 2026): a site photo is NO LONGER required to check
-- out of a site visit. Run AFTER 20261008110000_site_visit_evidence_review.sql.
--
--   * Check-out keeps the GPS rules (accuracy <= 100 m, < 2 min old, no mock
--     location). A photo, when one is sent, is still verified.
--   * "No photo" is no longer a risk flag; visits flagged only for that are
--     returned to normal (unless already reviewed).
-- Idempotent.
-- =============================================================================

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
    IF EXISTS (SELECT 1 FROM public.field_visits
               WHERE user_id = v_uid AND id <> p_visit_id
                 AND status = 'CHECKED_IN' AND checkout_time IS NULL) THEN
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

      -- Optional photo: verified only when one is sent.
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
    UPDATE public.field_visits
    SET evidence_photo_path = coalesce(v_path, evidence_photo_path),
        evidence_file_hash = coalesce(v_hash, evidence_file_hash),
        evidence_photo_source = CASE WHEN v_path IS NOT NULL THEN coalesce(evidence_photo_source, 'CAMERA')
                                     ELSE evidence_photo_source END,
        checkout_distance_m = round(v_distance::numeric, 1),
        checkout_accuracy_m = v_acc
    WHERE id = p_visit_id;
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

-- Risk flags without "NO_PHOTO".
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
  RETURN v_flags;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_field_visit_risk_flags(uuid) FROM public, anon, authenticated;

-- Visits flagged only because they had no photo go back to normal.
-- (trusted server change for protect_field_visit_location_fields)
SELECT set_config('app.current_location_server', 'on', true);
UPDATE public.field_visits
SET risk_flags = risk_flags - 'NO_PHOTO',
    verification_status = CASE
      WHEN reviewed_at IS NULL AND verification_status = 'FLAGGED' AND jsonb_array_length(risk_flags - 'NO_PHOTO') = 0
        THEN 'PENDING'
      ELSE verification_status END
WHERE risk_flags ? 'NO_PHOTO';
SELECT set_config('app.current_location_server', '', true);

NOTIFY pgrst, 'reload schema';
