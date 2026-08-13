-- A location mismatch is an alternate check-in path for the existing stop.
-- Keep evidence pending for manager review, but make the employee operationally
-- CHECKED_IN immediately after the reason and optional photo are accepted.

alter table public.field_visits
  drop constraint if exists field_visits_marked_required_ck;

alter table public.field_visits
  add constraint field_visits_marked_required_ck check (
    location_match_status not in (
      'CURRENT_LOCATION_MARKED',
      'LOW_ACCURACY',
      'MOCK_LOCATION_FLAGGED'
    ) or (
      selected_site_latitude is not null and
      selected_site_longitude is not null and
      actual_latitude is not null and
      actual_longitude is not null and
      nullif(trim(actual_location_name), '') is not null and
      nullif(trim(visit_purpose), '') is not null and
      nullif(trim(location_mismatch_reason), '') is not null and
      employee_declaration and
      declaration_at is not null
    )
  );

create or replace function public.submit_field_visit_current_location_v2(
  p_visit_id uuid, p_source_visit_id uuid, p_selected_site_id uuid,
  p_actual_latitude double precision, p_actual_longitude double precision,
  p_accuracy_metres double precision, p_captured_at timestamptz,
  p_location_provider text, p_mocked_location boolean, p_actual_address text,
  p_actual_location_name text, p_visit_purpose text,
  p_client_project_company_name text, p_expected_duration_minutes integer,
  p_additional_notes text, p_mismatch_reason text,
  p_mismatch_explanation text, p_declaration_at timestamptz,
  p_evidence_photo_path text, p_evidence_photo_source text,
  p_device_platform text, p_app_version text, p_idempotency_key text,
  p_captured_offline boolean default false,
  p_offline_evidence_hash text default null
) returns table (
  visit_id uuid, verification_status text,
  distance_metres double precision, duplicate boolean
)
language plpgsql security definer set search_path = public, storage as $$
declare
  v_uid uuid := auth.uid();
  v_source field_visits%rowtype;
  v_site predefined_sites%rowtype;
  v_existing field_visits%rowtype;
  v_selected_latitude double precision;
  v_selected_longitude double precision;
  v_selected_radius double precision;
  v_distance double precision;
  v_source_to_site_distance double precision;
  v_status text := 'CURRENT_LOCATION_MARKED';
  v_risk integer := 0;
  v_manager uuid;
  v_photo boolean := p_evidence_photo_path is not null;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '28000';
  end if;
  if not exists(select 1 from profiles where id = v_uid and is_active = true) then
    raise exception 'ACTIVE_EMPLOYEE_REQUIRED';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select * into v_existing
  from field_visits
  where user_id = v_uid and idempotency_key = p_idempotency_key
  limit 1;
  if found then
    return query select v_existing.id, v_existing.verification_status,
      v_existing.selected_site_distance_metres, true;
    return;
  end if;

  select * into v_source
  from field_visits
  where id = p_source_visit_id and user_id = v_uid
  for update;
  if not found then raise exception 'SOURCE_FIELD_VISIT_NOT_FOUND'; end if;
  if v_source.status not in ('PENDING', 'IN_TRANSIT') then
    raise exception 'SOURCE_FIELD_VISIT_NOT_ELIGIBLE';
  end if;

  if (select count(*) from field_visits
      where user_id = v_uid
        and submitted_at > now() - interval '1 hour'
        and location_match_status <> 'MATCHED') >= 10 then
    raise exception 'RATE_LIMIT_EXCEEDED';
  end if;

  if p_selected_site_id is not null then
    select * into v_site
    from predefined_sites
    where id = p_selected_site_id and is_active = true;
    if not found then raise exception 'SELECTED_SITE_NOT_ACTIVE'; end if;

    v_selected_latitude := v_site.latitude;
    v_selected_longitude := v_site.longitude;
    v_selected_radius := coalesce(v_site.checkin_radius_m, 100);

    if v_source.predefined_site_id is distinct from p_selected_site_id then
      v_source_to_site_distance := field_visit_distance_metres(
        coalesce(
          (v_source.destination_coords->>'latitude')::double precision,
          (v_source.destination_coords->>'lat')::double precision
        ),
        coalesce(
          (v_source.destination_coords->>'longitude')::double precision,
          (v_source.destination_coords->>'lng')::double precision,
          (v_source.destination_coords->>'lon')::double precision
        ),
        v_site.latitude,
        v_site.longitude
      );
      if v_source_to_site_distance is null or v_source_to_site_distance > 25 then
        raise exception 'SOURCE_VISIT_SITE_MISMATCH';
      end if;
    end if;
  else
    v_selected_latitude := coalesce(
      (v_source.destination_coords->>'latitude')::double precision,
      (v_source.destination_coords->>'lat')::double precision
    );
    v_selected_longitude := coalesce(
      (v_source.destination_coords->>'longitude')::double precision,
      (v_source.destination_coords->>'lng')::double precision,
      (v_source.destination_coords->>'lon')::double precision
    );
    v_selected_radius := coalesce(v_source.checkin_radius_m, 100);
  end if;

  if v_selected_latitude is null or v_selected_longitude is null or
     v_selected_latitude not between -90 and 90 or
     v_selected_longitude not between -180 and 180 or
     v_selected_radius not between 1 and 5000 then
    raise exception 'SOURCE_DESTINATION_INVALID';
  end if;
  if p_actual_latitude is null or p_actual_longitude is null or
     p_actual_latitude = 0 or p_actual_longitude = 0 or
     p_actual_latitude not between -90 and 90 or
     p_actual_longitude not between -180 and 180 then
    raise exception 'INVALID_COORDINATES';
  end if;
  if p_accuracy_metres is null or p_accuracy_metres < 0 or
     p_accuracy_metres > 100 then
    raise exception 'GPS_ACCURACY_NOT_ACCEPTABLE';
  end if;
  if p_captured_at > now() + interval '10 seconds' then
    raise exception 'INVALID_CAPTURE_TIME';
  end if;
  if (not p_captured_offline and p_captured_at < now() - interval '60 seconds') or
     (p_captured_offline and p_captured_at < now() - interval '24 hours') then
    raise exception 'STALE_LOCATION_EVIDENCE';
  end if;
  if p_captured_offline and (
    p_offline_evidence_hash is null or
    p_offline_evidence_hash !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'OFFLINE_INTEGRITY_PROOF_REQUIRED';
  end if;
  if nullif(trim(p_actual_location_name), '') is null or
     length(p_actual_location_name) > 255 then
    raise exception 'LOCATION_NAME_REQUIRED';
  end if;
  if nullif(trim(p_visit_purpose), '') is null or
     length(p_visit_purpose) > 1000 then
    raise exception 'VISIT_PURPOSE_REQUIRED';
  end if;
  if nullif(trim(p_mismatch_reason), '') is null or p_mismatch_reason not in (
    'Visiting a different project site', 'Client meeting',
    'Channel partner meeting', 'Property inspection', 'Event duty',
    'Temporary office location', 'The saved site pin appears incorrect',
    'Site location is not available in the predefined list',
    'Other official work'
  ) then
    raise exception 'MISMATCH_REASON_REQUIRED';
  end if;
  if p_mismatch_reason in (
    'The saved site pin appears incorrect', 'Other official work'
  ) and nullif(trim(p_mismatch_explanation), '') is null then
    raise exception 'MISMATCH_EXPLANATION_REQUIRED';
  end if;
  if p_expected_duration_minutes not between 1 and 1440 then
    raise exception 'INVALID_EXPECTED_DURATION';
  end if;
  if p_declaration_at is null or
     p_declaration_at > now() + interval '10 seconds' then
    raise exception 'DECLARATION_REQUIRED';
  end if;

  v_distance := field_visit_distance_metres(
    v_selected_latitude, v_selected_longitude,
    p_actual_latitude, p_actual_longitude
  );
  if v_distance <= v_selected_radius then
    raise exception 'LOCATION_NOW_MATCHES_SITE';
  end if;

  if v_photo then
    if p_evidence_photo_source not in ('CAMERA', 'GALLERY') or
       split_part(p_evidence_photo_path, '/', 1) <> v_uid::text or
       split_part(p_evidence_photo_path, '/', 4) not in (
         p_source_visit_id::text,
         p_visit_id::text
       ) then
      raise exception 'INVALID_PHOTO_OWNERSHIP';
    end if;
    if not exists(
      select 1 from storage.objects
      where bucket_id = 'field-visit-evidence'
        and name = p_evidence_photo_path
        and lower(coalesce(metadata->>'mimetype', '')) in ('image/jpeg', 'image/png')
    ) then
      raise exception 'PHOTO_NOT_FOUND_OR_INVALID';
    end if;
  end if;

  if p_accuracy_metres > 50 then
    v_status := 'LOW_ACCURACY';
    v_risk := v_risk + 20;
  end if;
  if coalesce(p_mocked_location, false) then
    v_status := 'MOCK_LOCATION_FLAGGED';
    v_risk := v_risk + 70;
  end if;
  if p_captured_offline then v_risk := v_risk + 10; end if;
  if p_mismatch_reason = 'The saved site pin appears incorrect' then
    v_risk := v_risk + 10;
  end if;
  v_risk := least(v_risk, 100);

  perform set_config('app.current_location_server', 'on', true);
  update field_visits set
    selected_site_id = p_selected_site_id,
    selected_site_latitude = v_selected_latitude,
    selected_site_longitude = v_selected_longitude,
    selected_site_radius_metres = v_selected_radius,
    selected_site_distance_metres = v_distance,
    location_match_status = v_status,
    actual_latitude = p_actual_latitude,
    actual_longitude = p_actual_longitude,
    actual_location_accuracy_metres = p_accuracy_metres,
    actual_location_address = p_actual_address,
    actual_location_name = trim(p_actual_location_name),
    actual_location_captured_at = p_captured_at,
    actual_location_provider = left(p_location_provider, 80),
    location_mismatch_reason = p_mismatch_reason,
    location_mismatch_explanation = nullif(trim(p_mismatch_explanation), ''),
    visit_purpose = trim(p_visit_purpose),
    client_project_company_name = nullif(trim(p_client_project_company_name), ''),
    expected_duration_minutes = p_expected_duration_minutes,
    additional_notes = nullif(trim(p_additional_notes), ''),
    employee_declaration = true,
    declaration_at = p_declaration_at,
    evidence_photo_added = v_photo,
    evidence_photo_path = p_evidence_photo_path,
    evidence_photo_source = p_evidence_photo_source,
    mocked_location_detected = coalesce(p_mocked_location, false),
    location_risk_score = v_risk,
    device_platform = left(p_device_platform, 30),
    app_version = left(p_app_version, 30),
    captured_offline = p_captured_offline,
    offline_evidence_hash = p_offline_evidence_hash,
    verification_status = 'PENDING',
    reviewed_by = null,
    reviewed_at = null,
    reviewer_notes = null,
    submitted_at = now(),
    idempotency_key = p_idempotency_key,
    checkin_time = p_captured_at,
    checkin_location = jsonb_build_object(
      'latitude', p_actual_latitude,
      'longitude', p_actual_longitude,
      'accuracy', p_accuracy_metres,
      'captured_at', p_captured_at,
      'provider', left(p_location_provider, 80),
      'mismatch', true
    ),
    status = 'CHECKED_IN'
  where id = p_source_visit_id and user_id = v_uid;

  insert into field_visit_location_audit(
    field_visit_id, actor_id, action, previous_status, new_status, metadata
  ) values (
    p_source_visit_id, v_uid, 'SUBMITTED',
    v_source.verification_status, 'PENDING',
    jsonb_build_object(
      'distance_metres', v_distance,
      'accuracy_metres', p_accuracy_metres,
      'captured_offline', p_captured_offline,
      'photo_added', v_photo,
      'operational_status', 'CHECKED_IN'
    )
  );

  select reports_to into v_manager from profiles where id = v_uid;
  if v_manager is not null then
    begin
      insert into notifications(user_id, title, message, type, read)
      values(
        v_manager,
        'New current-location check-in',
        (select name from profiles where id = v_uid) ||
          ' checked in outside the selected destination radius. Evidence is pending verification.',
        'field_visit',
        false
      );
    exception when others then null;
    end;
  end if;

  return query select p_source_visit_id, 'PENDING'::text, v_distance, false;
end $$;

revoke all on function public.submit_field_visit_current_location_v2(
  uuid, uuid, uuid, double precision, double precision, double precision,
  timestamptz, text, boolean, text, text, text, text, integer, text, text,
  text, timestamptz, text, text, text, text, text, boolean, text
) from public;

grant execute on function public.submit_field_visit_current_location_v2(
  uuid, uuid, uuid, double precision, double precision, double precision,
  timestamptz, text, boolean, text, text, text, text, integer, text, text,
  text, timestamptz, text, text, text, text, text, boolean, text
) to authenticated;
