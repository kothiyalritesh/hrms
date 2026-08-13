-- Return explicit, identity-bound confirmations for current-location evidence
-- and fraud review, then publish the updated backend compatibility contract.

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
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_visit_id is null or p_source_visit_id is null
     or p_visit_id = p_source_visit_id then
    raise exception 'DISTINCT_VERIFICATION_VISIT_ID_REQUIRED';
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

  select * into v_confirmed
  from public.field_visits
  where id = p_visit_id
    and user_id = v_actor
    and source_field_visit_id = p_source_visit_id
    and idempotency_key = p_idempotency_key;
  if not found
     or v_confirmed.verification_status is distinct from
       v_result.verification_status then
    raise exception 'CURRENT_LOCATION_COMMIT_NOT_CONFIRMED';
  end if;

  return jsonb_build_object(
    'success', true,
    'visit_id', v_confirmed.id,
    'source_visit_id', v_confirmed.source_field_visit_id,
    'verification_status', v_confirmed.verification_status,
    'distance_metres', v_confirmed.selected_site_distance_metres,
    'duplicate', v_result.duplicate,
    'photo_added', coalesce(v_confirmed.evidence_photo_added, false),
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

-- Employees must use the confirming wrapper; the implementation RPC remains
-- callable by its database owner from v3 but is no longer a browser API.
revoke execute on function public.submit_field_visit_current_location_v2(
  uuid, uuid, uuid, double precision, double precision, double precision,
  timestamptz, text, boolean, text, text, text, text, integer, text, text,
  text, timestamptz, text, text, text, text, text, boolean, text
) from authenticated;

create or replace function public.rpc_admin_review_fraud_event(
  p_event_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_reviewed_at timestamptz;
begin
  perform public.require_profile_admin();
  update public.attendance_fraud_events
  set
    reviewed_at = now(),
    reviewed_by = v_actor,
    review_notes = left(
      coalesce(nullif(btrim(p_notes), ''), 'Reviewed by admin'),
      500
    )
  where id = p_event_id
  returning reviewed_at into v_reviewed_at;
  if not found then raise exception 'FRAUD_EVENT_NOT_FOUND'; end if;

  return jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'reviewed_at', v_reviewed_at,
    'reviewed_by', v_actor
  );
end;
$$;

revoke all on function public.rpc_admin_review_fraud_event(uuid, text)
  from public, anon;
grant execute on function public.rpc_admin_review_fraud_event(uuid, text)
  to authenticated;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260730250000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'field_visit_evidence_rpc', 'submit_field_visit_current_location_v3',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260731.1',
      'otp-auth', '20260731.1',
      'field-visit-evidence-upload', '20260731.2',
      'smartoffice-proxy', '20260731.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
