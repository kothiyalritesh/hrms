-- Align current-location mismatch evidence with the row that is actually
-- mutated by v2. The existing field visit is the authoritative identity;
-- no unpersisted client-generated child ID is accepted or returned.

create or replace function public.submit_field_visit_current_location_v3(
  p_visit_id uuid,
  p_source_visit_id uuid,
  p_selected_site_id uuid,
  p_actual_latitude double precision,
  p_actual_longitude double precision,
  p_accuracy_metres double precision,
  p_captured_at timestamptz,
  p_location_provider text,
  p_mocked_location boolean,
  p_actual_address text,
  p_actual_location_name text,
  p_visit_purpose text,
  p_client_project_company_name text,
  p_expected_duration_minutes integer,
  p_additional_notes text,
  p_mismatch_reason text,
  p_mismatch_explanation text,
  p_declaration_at timestamptz,
  p_evidence_photo_path text,
  p_evidence_photo_source text,
  p_device_platform text,
  p_app_version text,
  p_idempotency_key text,
  p_captured_offline boolean default false,
  p_offline_evidence_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result record;
  v_confirmed public.field_visits%rowtype;
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  if p_visit_id is null
     or p_source_visit_id is null
     or p_visit_id is distinct from p_source_visit_id then
    raise exception 'AUTHORITATIVE_FIELD_VISIT_ID_REQUIRED';
  end if;

  select *
  into v_result
  from public.submit_field_visit_current_location_v2(
    p_visit_id,
    p_source_visit_id,
    p_selected_site_id,
    p_actual_latitude,
    p_actual_longitude,
    p_accuracy_metres,
    p_captured_at,
    p_location_provider,
    p_mocked_location,
    p_actual_address,
    p_actual_location_name,
    p_visit_purpose,
    p_client_project_company_name,
    p_expected_duration_minutes,
    p_additional_notes,
    p_mismatch_reason,
    p_mismatch_explanation,
    p_declaration_at,
    p_evidence_photo_path,
    p_evidence_photo_source,
    p_device_platform,
    p_app_version,
    p_idempotency_key,
    p_captured_offline,
    p_offline_evidence_hash
  );

  if not found
     or v_result.visit_id is distinct from p_visit_id
     or v_result.verification_status not in (
       'PENDING', 'APPROVED', 'REJECTED', 'NEEDS_INFORMATION', 'FLAGGED'
     )
     or v_result.distance_metres is null
     or v_result.duplicate is null then
    raise exception 'CURRENT_LOCATION_RESULT_NOT_CONFIRMED';
  end if;

  select *
  into v_confirmed
  from public.field_visits
  where id = p_visit_id
    and user_id = v_actor
    and idempotency_key = p_idempotency_key;

  if not found
     or v_confirmed.status is distinct from 'CHECKED_IN'
     or v_confirmed.checkin_time is null
     or v_confirmed.submitted_at is null
     or v_confirmed.verification_status is distinct from
       v_result.verification_status then
    raise exception 'CURRENT_LOCATION_COMMIT_NOT_CONFIRMED';
  end if;

  return jsonb_build_object(
    'success', true,
    'visit_id', v_confirmed.id,
    'source_visit_id', p_source_visit_id,
    'status', v_confirmed.status,
    'verification_status', v_confirmed.verification_status,
    'distance_metres', v_confirmed.selected_site_distance_metres,
    'duplicate', v_result.duplicate,
    'photo_added', coalesce(v_confirmed.evidence_photo_added, false),
    'checkin_time', v_confirmed.checkin_time,
    'submitted_at', v_confirmed.submitted_at
  );
end;
$$;

revoke all on function public.submit_field_visit_current_location_v3(
  uuid, uuid, uuid, double precision, double precision, double precision,
  timestamptz, text, boolean, text, text, text, text, integer, text, text,
  text, timestamptz, text, text, text, text, text, boolean, text
) from public, anon;
grant execute on function public.submit_field_visit_current_location_v3(
  uuid, uuid, uuid, double precision, double precision, double precision,
  timestamptz, text, boolean, text, text, text, text, integer, text, text,
  text, timestamptz, text, text, text, text, text, boolean, text
) to authenticated;

notify pgrst, 'reload schema';
