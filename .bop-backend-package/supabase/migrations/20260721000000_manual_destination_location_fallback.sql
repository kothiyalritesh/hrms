-- Allow the current-location fallback for both saved sites and manually pinned
-- destinations. The source visit is authoritative for manual destination data.

alter table public.field_visits
  add column if not exists source_field_visit_id uuid
    references public.field_visits(id) on delete restrict;

create index if not exists field_visits_source_visit_idx
  on public.field_visits(source_field_visit_id);

alter table public.field_visits
  drop constraint if exists field_visits_marked_required_ck;

alter table public.field_visits
  add constraint field_visits_marked_required_ck check (
    location_match_status not in ('CURRENT_LOCATION_MARKED','LOW_ACCURACY','MOCK_LOCATION_FLAGGED') or
    ((selected_site_id is not null or source_field_visit_id is not null) and
     selected_site_latitude is not null and selected_site_longitude is not null and
     actual_latitude is not null and actual_longitude is not null and
     nullif(trim(actual_location_name),'') is not null and
     nullif(trim(visit_purpose),'') is not null and
     nullif(trim(location_mismatch_reason),'') is not null and
     employee_declaration and declaration_at is not null)
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
  if not exists(select 1 from profiles where id=v_uid and is_active=true) then
    raise exception 'ACTIVE_EMPLOYEE_REQUIRED';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select * into v_existing from field_visits
    where user_id=v_uid and idempotency_key=p_idempotency_key limit 1;
  if found then
    return query select v_existing.id, v_existing.verification_status,
      v_existing.selected_site_distance_metres, true;
    return;
  end if;

  select * into v_source from field_visits
    where id=p_source_visit_id and user_id=v_uid limit 1;
  if not found then raise exception 'SOURCE_FIELD_VISIT_NOT_FOUND'; end if;
  if v_source.status not in ('PENDING','IN_TRANSIT') then
    raise exception 'SOURCE_FIELD_VISIT_NOT_ELIGIBLE';
  end if;

  if (select count(*) from field_visits
      where user_id=v_uid and submitted_at > now()-interval '1 hour'
        and location_match_status <> 'MATCHED') >= 10 then
    raise exception 'RATE_LIMIT_EXCEEDED';
  end if;

  if p_selected_site_id is not null then
    select * into v_site from predefined_sites
      where id=p_selected_site_id and is_active=true;
    if not found then raise exception 'SELECTED_SITE_NOT_ACTIVE'; end if;
    v_selected_latitude := v_site.latitude;
    v_selected_longitude := v_site.longitude;
    v_selected_radius := coalesce(v_site.checkin_radius_m,100);

    -- A legacy source visit may lack predefined_site_id, but its saved pin must
    -- still correspond to the supplied site before the server accepts it.
    if v_source.predefined_site_id is distinct from p_selected_site_id then
      v_source_to_site_distance := field_visit_distance_metres(
        coalesce((v_source.destination_coords->>'latitude')::double precision,
                 (v_source.destination_coords->>'lat')::double precision),
        coalesce((v_source.destination_coords->>'longitude')::double precision,
                 (v_source.destination_coords->>'lng')::double precision,
                 (v_source.destination_coords->>'lon')::double precision),
        v_site.latitude, v_site.longitude
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
    v_selected_radius := coalesce(v_source.checkin_radius_m,100);
  end if;

  if v_selected_latitude is null or v_selected_longitude is null or
     v_selected_latitude not between -90 and 90 or
     v_selected_longitude not between -180 and 180 or
     v_selected_radius not between 1 and 5000 then
    raise exception 'SOURCE_DESTINATION_INVALID';
  end if;
  if p_actual_latitude is null or p_actual_longitude is null or
     p_actual_latitude=0 or p_actual_longitude=0 or
     p_actual_latitude not between -90 and 90 or
     p_actual_longitude not between -180 and 180 then
    raise exception 'INVALID_COORDINATES';
  end if;
  if p_accuracy_metres is null or p_accuracy_metres < 0 or
     p_accuracy_metres > 100 then
    raise exception 'GPS_ACCURACY_NOT_ACCEPTABLE';
  end if;
  if p_captured_at > now()+interval '10 seconds' then
    raise exception 'INVALID_CAPTURE_TIME';
  end if;
  if (not p_captured_offline and p_captured_at < now()-interval '60 seconds') or
     (p_captured_offline and p_captured_at < now()-interval '24 hours') then
    raise exception 'STALE_LOCATION_EVIDENCE';
  end if;
  if p_captured_offline and (p_offline_evidence_hash is null or
     p_offline_evidence_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'OFFLINE_INTEGRITY_PROOF_REQUIRED';
  end if;
  if nullif(trim(p_actual_location_name),'') is null or
     length(p_actual_location_name)>255 then
    raise exception 'LOCATION_NAME_REQUIRED';
  end if;
  if nullif(trim(p_visit_purpose),'') is null or
     length(p_visit_purpose)>1000 then
    raise exception 'VISIT_PURPOSE_REQUIRED';
  end if;
  if nullif(trim(p_mismatch_reason),'') is null or p_mismatch_reason not in (
    'Visiting a different project site','Client meeting',
    'Channel partner meeting','Property inspection','Event duty',
    'Temporary office location','The saved site pin appears incorrect',
    'Site location is not available in the predefined list','Other official work'
  ) then raise exception 'MISMATCH_REASON_REQUIRED'; end if;
  if p_mismatch_reason in ('The saved site pin appears incorrect','Other official work')
     and nullif(trim(p_mismatch_explanation),'') is null then
    raise exception 'MISMATCH_EXPLANATION_REQUIRED';
  end if;
  if p_expected_duration_minutes not between 1 and 1440 then
    raise exception 'INVALID_EXPECTED_DURATION';
  end if;
  if p_declaration_at is null or p_declaration_at > now()+interval '10 seconds' then
    raise exception 'DECLARATION_REQUIRED';
  end if;

  v_distance := field_visit_distance_metres(
    v_selected_latitude,v_selected_longitude,
    p_actual_latitude,p_actual_longitude
  );
  if v_distance <= v_selected_radius then
    raise exception 'LOCATION_NOW_MATCHES_SITE';
  end if;

  select * into v_existing from field_visits
    where user_id=v_uid
      and source_field_visit_id=p_source_visit_id
      and submitted_at > now()-interval '5 minutes'
      and actual_latitude is not null
      and field_visit_distance_metres(
        actual_latitude,actual_longitude,p_actual_latitude,p_actual_longitude
      ) <= 25
    limit 1;
  if found then
    return query select v_existing.id, v_existing.verification_status,
      v_existing.selected_site_distance_metres, true;
    return;
  end if;

  if v_photo then
    if p_evidence_photo_source not in ('CAMERA','GALLERY') or
       split_part(p_evidence_photo_path,'/',1) <> v_uid::text or
       split_part(p_evidence_photo_path,'/',4) <> p_visit_id::text then
      raise exception 'INVALID_PHOTO_OWNERSHIP';
    end if;
    if not exists(select 1 from storage.objects
      where bucket_id='field-visit-evidence' and name=p_evidence_photo_path
        and lower(coalesce(metadata->>'mimetype','')) in ('image/jpeg','image/png')) then
      raise exception 'PHOTO_NOT_FOUND_OR_INVALID';
    end if;
  elsif p_evidence_photo_source is not null then
    raise exception 'PHOTO_SOURCE_WITHOUT_PHOTO';
  end if;

  if p_accuracy_metres>50 then v_status:='LOW_ACCURACY'; v_risk:=v_risk+20; end if;
  if coalesce(p_mocked_location,false) then
    v_status:='MOCK_LOCATION_FLAGGED'; v_risk:=v_risk+70;
  end if;
  if p_captured_offline then v_risk:=v_risk+10; end if;
  if p_mismatch_reason='The saved site pin appears incorrect' then
    v_risk:=v_risk+10;
  end if;
  v_risk:=least(v_risk,100);

  perform set_config('app.current_location_server','on',true);
  insert into field_visits (
    id,user_id,source_field_visit_id,predefined_site_id,selected_site_id,
    visit_type,location_name,location_address,destination_coords,
    checkin_radius_m,status,date,selected_site_latitude,
    selected_site_longitude,selected_site_radius_metres,
    selected_site_distance_metres,location_match_status,actual_latitude,
    actual_longitude,actual_location_accuracy_metres,actual_location_address,
    actual_location_name,actual_location_captured_at,actual_location_provider,
    location_mismatch_reason,location_mismatch_explanation,visit_purpose,
    client_project_company_name,expected_duration_minutes,additional_notes,
    employee_declaration,declaration_at,evidence_photo_added,
    evidence_photo_path,evidence_photo_source,mocked_location_detected,
    location_risk_score,device_platform,app_version,captured_offline,
    offline_evidence_hash,verification_status,submitted_at,idempotency_key
  ) values (
    p_visit_id,v_uid,p_source_visit_id,p_selected_site_id,p_selected_site_id,
    v_source.visit_type,trim(p_actual_location_name),p_actual_address,
    jsonb_build_object('latitude',v_selected_latitude,'longitude',v_selected_longitude),
    round(v_selected_radius)::integer,'PENDING',
    (p_captured_at at time zone 'Asia/Kolkata')::date,
    v_selected_latitude,v_selected_longitude,v_selected_radius,v_distance,v_status,
    p_actual_latitude,p_actual_longitude,p_accuracy_metres,p_actual_address,
    trim(p_actual_location_name),p_captured_at,left(p_location_provider,80),
    p_mismatch_reason,nullif(trim(p_mismatch_explanation),''),
    trim(p_visit_purpose),nullif(trim(p_client_project_company_name),''),
    p_expected_duration_minutes,nullif(trim(p_additional_notes),''),true,
    p_declaration_at,v_photo,p_evidence_photo_path,p_evidence_photo_source,
    coalesce(p_mocked_location,false),v_risk,left(p_device_platform,30),
    left(p_app_version,30),p_captured_offline,p_offline_evidence_hash,
    'PENDING',now(),p_idempotency_key
  );

  insert into field_visit_location_audit(
    field_visit_id,actor_id,action,new_status,metadata
  ) values (
    p_visit_id,v_uid,'SUBMITTED','PENDING',
    jsonb_build_object(
      'source_visit_id',p_source_visit_id,
      'distance_metres',v_distance,
      'accuracy_metres',p_accuracy_metres,
      'captured_offline',p_captured_offline,
      'photo_added',v_photo
    )
  );

  select reports_to into v_manager from profiles where id=v_uid;
  if v_manager is not null then
    begin
      insert into notifications(user_id,title,message,type,read)
      values(
        v_manager,'New current-location request',
        (select name from profiles where id=v_uid) ||
          ' marked a location outside the selected destination radius.',
        'field_visit',false
      );
    exception when others then null;
    end;
  end if;

  return query select p_visit_id,'PENDING'::text,v_distance,false;
end $$;

revoke all on function public.submit_field_visit_current_location_v2(
  uuid,uuid,uuid,double precision,double precision,double precision,
  timestamptz,text,boolean,text,text,text,text,integer,text,text,text,
  timestamptz,text,text,text,text,text,boolean,text
) from public;
grant execute on function public.submit_field_visit_current_location_v2(
  uuid,uuid,uuid,double precision,double precision,double precision,
  timestamptz,text,boolean,text,text,text,text,integer,text,text,text,
  timestamptz,text,text,text,text,text,boolean,text
) to authenticated;

-- Keep source linkage server-managed like the other verification fields.
create or replace function public.protect_field_visit_location_fields()
returns trigger language plpgsql as $$
begin
  if current_setting('app.current_location_server',true)='on' then return new; end if;
  if tg_op='INSERT' then
    if new.source_field_visit_id is not null or
       new.location_match_status <> 'MATCHED' or
       new.verification_status <> 'PENDING' or
       new.selected_site_distance_metres is not null or
       new.actual_latitude is not null or new.actual_longitude is not null or
       new.location_mismatch_reason is not null or new.location_risk_score <> 0 or
       new.reviewed_by is not null or new.reviewed_at is not null or
       new.evidence_photo_path is not null then
      raise exception 'CURRENT_LOCATION_SUBMISSION_REQUIRES_PROTECTED_RPC';
    end if;
    return new;
  end if;
  if (
    new.source_field_visit_id is distinct from old.source_field_visit_id or
    new.selected_site_id is distinct from old.selected_site_id or
    new.selected_site_latitude is distinct from old.selected_site_latitude or
    new.selected_site_longitude is distinct from old.selected_site_longitude or
    new.selected_site_radius_metres is distinct from old.selected_site_radius_metres or
    new.selected_site_distance_metres is distinct from old.selected_site_distance_metres or
    new.location_match_status is distinct from old.location_match_status or
    new.actual_latitude is distinct from old.actual_latitude or
    new.actual_longitude is distinct from old.actual_longitude or
    new.actual_location_accuracy_metres is distinct from old.actual_location_accuracy_metres or
    new.actual_location_captured_at is distinct from old.actual_location_captured_at or
    new.location_mismatch_reason is distinct from old.location_mismatch_reason or
    new.location_mismatch_explanation is distinct from old.location_mismatch_explanation or
    new.employee_declaration is distinct from old.employee_declaration or
    new.declaration_at is distinct from old.declaration_at or
    new.location_risk_score is distinct from old.location_risk_score or
    new.verification_status is distinct from old.verification_status or
    new.reviewed_by is distinct from old.reviewed_by or
    new.reviewed_at is distinct from old.reviewed_at or
    new.reviewer_notes is distinct from old.reviewer_notes or
    new.evidence_photo_path is distinct from old.evidence_photo_path
  ) then raise exception 'SERVER_MANAGED_FIELD'; end if;
  return new;
end $$;

