-- Production-safe extension for "Mark My Current Location".
-- This migration is additive and never rewrites attendance or existing visits.
create extension if not exists pgcrypto;

alter table public.field_visits
  add column if not exists selected_site_id uuid references public.predefined_sites(id),
  add column if not exists selected_site_latitude double precision,
  add column if not exists selected_site_longitude double precision,
  add column if not exists selected_site_radius_metres double precision,
  add column if not exists selected_site_distance_metres double precision,
  add column if not exists location_match_status text default 'MATCHED',
  add column if not exists actual_latitude double precision,
  add column if not exists actual_longitude double precision,
  add column if not exists actual_location_accuracy_metres double precision,
  add column if not exists actual_location_address text,
  add column if not exists actual_location_name text,
  add column if not exists actual_location_captured_at timestamptz,
  add column if not exists actual_location_provider text,
  add column if not exists location_mismatch_reason text,
  add column if not exists location_mismatch_explanation text,
  add column if not exists visit_purpose text,
  add column if not exists client_project_company_name text,
  add column if not exists expected_duration_minutes integer,
  add column if not exists additional_notes text,
  add column if not exists employee_declaration boolean not null default false,
  add column if not exists declaration_at timestamptz,
  add column if not exists evidence_photo_added boolean not null default false,
  add column if not exists evidence_photo_path text,
  add column if not exists evidence_photo_source text,
  add column if not exists mocked_location_detected boolean default false,
  add column if not exists location_risk_score integer default 0,
  add column if not exists device_platform text,
  add column if not exists app_version text,
  add column if not exists captured_offline boolean not null default false,
  add column if not exists offline_evidence_hash text,
  add column if not exists verification_status text default 'PENDING',
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewer_notes text,
  add column if not exists submitted_at timestamptz default now(),
  add column if not exists idempotency_key text;

create unique index if not exists field_visits_idempotency_key_uidx
  on public.field_visits(idempotency_key) where idempotency_key is not null;
create index if not exists field_visits_marked_review_idx
  on public.field_visits(verification_status, submitted_at desc)
  where location_match_status in ('CURRENT_LOCATION_MARKED', 'LOW_ACCURACY', 'MOCK_LOCATION_FLAGGED');
create index if not exists field_visits_selected_site_idx on public.field_visits(selected_site_id);

do $$ begin
  alter table public.field_visits add constraint field_visits_selected_lat_ck check (selected_site_latitude is null or selected_site_latitude between -90 and 90);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_selected_lon_ck check (selected_site_longitude is null or selected_site_longitude between -180 and 180);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_actual_lat_ck check (actual_latitude is null or actual_latitude between -90 and 90);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_actual_lon_ck check (actual_longitude is null or actual_longitude between -180 and 180);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_distance_ck check (selected_site_distance_metres is null or selected_site_distance_metres >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_accuracy_ck check (actual_location_accuracy_metres is null or actual_location_accuracy_metres >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_risk_ck check (location_risk_score between 0 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_duration_ck check (expected_duration_minutes is null or expected_duration_minutes between 1 and 1440);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_location_status_ck check (location_match_status in ('MATCHED','MISMATCHED','CURRENT_LOCATION_MARKED','LOW_ACCURACY','MOCK_LOCATION_FLAGGED'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_verification_status_ck check (verification_status in ('PENDING','APPROVED','REJECTED','NEEDS_INFORMATION','FLAGGED'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_photo_source_ck check (evidence_photo_source is null or evidence_photo_source in ('CAMERA','GALLERY'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_marked_required_ck check (
    location_match_status not in ('CURRENT_LOCATION_MARKED','LOW_ACCURACY','MOCK_LOCATION_FLAGGED') or
    (selected_site_id is not null and actual_latitude is not null and actual_longitude is not null and
     nullif(trim(actual_location_name),'') is not null and nullif(trim(visit_purpose),'') is not null and
     nullif(trim(location_mismatch_reason),'') is not null and employee_declaration and declaration_at is not null)
  );
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.field_visits add constraint field_visits_photo_consistency_ck check (
    (not evidence_photo_added and evidence_photo_path is null and evidence_photo_source is null) or
    (evidence_photo_added and evidence_photo_path is not null and evidence_photo_source is not null)
  );
exception when duplicate_object then null; end $$;

create table if not exists public.field_visit_location_audit (
  id uuid primary key default gen_random_uuid(),
  field_visit_id uuid not null references public.field_visits(id) on delete restrict,
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('SUBMITTED','APPROVED','REJECTED','NEEDS_INFORMATION','FLAGGED','SITE_PIN_REVIEWED')),
  previous_status text,
  new_status text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists field_visit_location_audit_visit_idx on public.field_visit_location_audit(field_visit_id, created_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('field-visit-evidence', 'field-visit-evidence', false, 8388608, array['image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.field_visit_distance_metres(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable strict parallel safe as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2-lat1)/2),2) + cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lon2-lon1)/2),2)
  ));
$$;

create or replace function public.current_user_can_review(employee_id uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive team(id) as (
    select p.id from profiles p where p.reports_to=auth.uid() and p.is_active=true
    union
    select p.id from profiles p join team t on p.reports_to=t.id where p.is_active=true
  )
  select exists (
    select 1 from profiles me where me.id=auth.uid() and me.is_active=true and
      (me.role in ('SYSTEM_ADMIN','ADMIN','HR','HRD') or employee_id in (select id from team))
  );
$$;
revoke all on function public.current_user_can_review(uuid) from public;
grant execute on function public.current_user_can_review(uuid) to authenticated;

alter table public.field_visits enable row level security;
drop policy if exists field_visits_employee_select on public.field_visits;
create policy field_visits_employee_select on public.field_visits for select to authenticated
  using (user_id = auth.uid() or public.current_user_can_review(user_id));
drop policy if exists field_visits_employee_insert on public.field_visits;
create policy field_visits_employee_insert on public.field_visits for insert to authenticated with check (user_id = auth.uid());
drop policy if exists field_visits_employee_update on public.field_visits;
create policy field_visits_employee_update on public.field_visits for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.field_visit_location_audit enable row level security;
drop policy if exists field_visit_audit_select on public.field_visit_location_audit;
create policy field_visit_audit_select on public.field_visit_location_audit for select to authenticated using (
  exists (select 1 from field_visits v where v.id = field_visit_id and (v.user_id = auth.uid() or public.current_user_can_review(v.user_id)))
);
-- No INSERT/UPDATE/DELETE policies: only SECURITY DEFINER RPCs can write audit rows.

drop policy if exists field_visit_evidence_owner_insert on storage.objects;
-- Inserts are intentionally service-role only via field-visit-evidence-upload,
-- which authenticates the JWT and validates the file's magic bytes.
drop policy if exists field_visit_evidence_owner_select on storage.objects;
create policy field_visit_evidence_owner_select on storage.objects for select to authenticated using (
  bucket_id = 'field-visit-evidence' and (
    (storage.foldername(name))[1] = auth.uid()::text or
    exists (select 1 from field_visits v where v.evidence_photo_path = name and public.current_user_can_review(v.user_id))
  )
);
drop policy if exists field_visit_evidence_owner_delete on storage.objects;
create policy field_visit_evidence_owner_delete on storage.objects for delete to authenticated using (
  bucket_id = 'field-visit-evidence' and (storage.foldername(name))[1] = auth.uid()::text and
  not exists (select 1 from field_visits v where v.evidence_photo_path = name)
);

create or replace function public.check_in_field_visit_at_selected_site(
  p_visit_id uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy_metres double precision, p_captured_at timestamptz,
  p_location_provider text, p_mocked_location boolean default false
) returns double precision language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_visit field_visits%rowtype; v_site predefined_sites%rowtype; v_distance double precision;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  select * into v_visit from field_visits where id=p_visit_id and user_id=v_uid and status='PENDING' for update;
  if not found or v_visit.predefined_site_id is null then raise exception 'FIELD_VISIT_NOT_FOUND'; end if;
  select * into v_site from predefined_sites where id=v_visit.predefined_site_id and is_active=true;
  if not found then raise exception 'SELECTED_SITE_NOT_ACTIVE'; end if;
  if p_latitude is null or p_longitude is null or p_latitude=0 or p_longitude=0 or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'INVALID_COORDINATES'; end if;
  if p_accuracy_metres is null or p_accuracy_metres<0 or p_accuracy_metres>100 then raise exception 'GPS_ACCURACY_NOT_ACCEPTABLE'; end if;
  if p_captured_at<now()-interval '60 seconds' or p_captured_at>now()+interval '10 seconds' then raise exception 'STALE_LOCATION_EVIDENCE'; end if;
  if coalesce(p_mocked_location,false) then raise exception 'MOCK_LOCATION_DETECTED'; end if;
  v_distance:=field_visit_distance_metres(v_site.latitude,v_site.longitude,p_latitude,p_longitude);
  if v_distance>coalesce(v_site.checkin_radius_m,100) then raise exception 'OUTSIDE_SELECTED_SITE_RADIUS'; end if;
  update field_visits set checkin_time=now(),checkin_location=jsonb_build_object('latitude',p_latitude,'longitude',p_longitude,'accuracy',p_accuracy_metres,'captured_at',p_captured_at,'provider',left(p_location_provider,80)),status='CHECKED_IN' where id=p_visit_id;
  return v_distance;
end $$;
revoke all on function public.check_in_field_visit_at_selected_site(uuid,double precision,double precision,double precision,timestamptz,text,boolean) from public;
grant execute on function public.check_in_field_visit_at_selected_site(uuid,double precision,double precision,double precision,timestamptz,text,boolean) to authenticated;

create or replace function public.submit_field_visit_current_location(
  p_visit_id uuid, p_selected_site_id uuid, p_actual_latitude double precision, p_actual_longitude double precision,
  p_accuracy_metres double precision, p_captured_at timestamptz, p_location_provider text,
  p_mocked_location boolean, p_actual_address text, p_actual_location_name text, p_visit_purpose text,
  p_client_project_company_name text, p_expected_duration_minutes integer, p_additional_notes text,
  p_mismatch_reason text, p_mismatch_explanation text, p_declaration_at timestamptz,
  p_evidence_photo_path text, p_evidence_photo_source text, p_device_platform text, p_app_version text,
  p_idempotency_key text, p_captured_offline boolean default false, p_offline_evidence_hash text default null
) returns table (visit_id uuid, verification_status text, distance_metres double precision, duplicate boolean)
language plpgsql security definer set search_path = public, storage as $$
declare
  v_uid uuid := auth.uid(); v_site predefined_sites%rowtype; v_distance double precision;
  v_existing field_visits%rowtype; v_status text := 'CURRENT_LOCATION_MARKED'; v_risk integer := 0;
  v_manager uuid; v_photo boolean := p_evidence_photo_path is not null;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '28000'; end if;
  if not exists(select 1 from profiles where id=v_uid and is_active=true) then raise exception 'ACTIVE_EMPLOYEE_REQUIRED'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;

  select * into v_existing from field_visits where user_id=v_uid and idempotency_key=p_idempotency_key limit 1;
  if found then return query select v_existing.id, v_existing.verification_status, v_existing.selected_site_distance_metres, true; return; end if;
  if (select count(*) from field_visits where user_id=v_uid and submitted_at > now()-interval '1 hour' and location_match_status <> 'MATCHED') >= 10 then
    raise exception 'RATE_LIMIT_EXCEEDED';
  end if;

  select * into v_site from predefined_sites where id=p_selected_site_id and is_active=true;
  if not found then raise exception 'SELECTED_SITE_NOT_ACTIVE'; end if;
  if p_actual_latitude is null or p_actual_longitude is null or p_actual_latitude=0 or p_actual_longitude=0 or
     p_actual_latitude not between -90 and 90 or p_actual_longitude not between -180 and 180 then raise exception 'INVALID_COORDINATES'; end if;
  if p_accuracy_metres is null or p_accuracy_metres < 0 or p_accuracy_metres > 100 then raise exception 'GPS_ACCURACY_NOT_ACCEPTABLE'; end if;
  if p_captured_at > now()+interval '10 seconds' then raise exception 'INVALID_CAPTURE_TIME'; end if;
  if (not p_captured_offline and p_captured_at < now()-interval '60 seconds') or
     (p_captured_offline and p_captured_at < now()-interval '24 hours') then raise exception 'STALE_LOCATION_EVIDENCE'; end if;
  if p_captured_offline and (p_offline_evidence_hash is null or p_offline_evidence_hash !~ '^[0-9a-f]{64}$') then raise exception 'OFFLINE_INTEGRITY_PROOF_REQUIRED'; end if;
  if nullif(trim(p_actual_location_name),'') is null or length(p_actual_location_name)>255 then raise exception 'LOCATION_NAME_REQUIRED'; end if;
  if nullif(trim(p_visit_purpose),'') is null or length(p_visit_purpose)>1000 then raise exception 'VISIT_PURPOSE_REQUIRED'; end if;
  if nullif(trim(p_mismatch_reason),'') is null or p_mismatch_reason not in (
    'Visiting a different project site','Client meeting','Channel partner meeting','Property inspection','Event duty',
    'Temporary office location','The saved site pin appears incorrect','Site location is not available in the predefined list','Other official work'
  ) then raise exception 'MISMATCH_REASON_REQUIRED'; end if;
  if p_mismatch_reason in ('The saved site pin appears incorrect','Other official work') and nullif(trim(p_mismatch_explanation),'') is null then raise exception 'MISMATCH_EXPLANATION_REQUIRED'; end if;
  if p_expected_duration_minutes not between 1 and 1440 then raise exception 'INVALID_EXPECTED_DURATION'; end if;
  if p_declaration_at is null or p_declaration_at > now()+interval '10 seconds' then raise exception 'DECLARATION_REQUIRED'; end if;

  v_distance := field_visit_distance_metres(v_site.latitude, v_site.longitude, p_actual_latitude, p_actual_longitude);
  if v_distance <= coalesce(v_site.checkin_radius_m,100) then raise exception 'LOCATION_NOW_MATCHES_SITE'; end if;
  select * into v_existing from field_visits where user_id=v_uid and selected_site_id=p_selected_site_id
    and submitted_at > now()-interval '5 minutes' and actual_latitude is not null
    and field_visit_distance_metres(actual_latitude,actual_longitude,p_actual_latitude,p_actual_longitude)<=25 limit 1;
  if found then return query select v_existing.id, v_existing.verification_status, v_existing.selected_site_distance_metres, true; return; end if;

  if v_photo then
    if p_evidence_photo_source not in ('CAMERA','GALLERY') or split_part(p_evidence_photo_path,'/',1) <> v_uid::text or
       split_part(p_evidence_photo_path,'/',4) <> p_visit_id::text then raise exception 'INVALID_PHOTO_OWNERSHIP'; end if;
    if not exists(select 1 from storage.objects where bucket_id='field-visit-evidence' and name=p_evidence_photo_path and
      lower(coalesce(metadata->>'mimetype','')) in ('image/jpeg','image/png')) then raise exception 'PHOTO_NOT_FOUND_OR_INVALID'; end if;
  elsif p_evidence_photo_source is not null then raise exception 'PHOTO_SOURCE_WITHOUT_PHOTO'; end if;

  if p_accuracy_metres>50 then v_status:='LOW_ACCURACY'; v_risk:=v_risk+20; end if;
  if coalesce(p_mocked_location,false) then v_status:='MOCK_LOCATION_FLAGGED'; v_risk:=v_risk+70; end if;
  if p_captured_offline then v_risk:=v_risk+10; end if;
  if p_mismatch_reason='The saved site pin appears incorrect' then v_risk:=v_risk+10; end if;
  v_risk:=least(v_risk,100);

  perform set_config('app.current_location_server','on',true);
  insert into field_visits (
    id,user_id,predefined_site_id,selected_site_id,visit_type,location_name,location_address,destination_coords,checkin_radius_m,status,date,
    selected_site_latitude,selected_site_longitude,selected_site_radius_metres,selected_site_distance_metres,location_match_status,
    actual_latitude,actual_longitude,actual_location_accuracy_metres,actual_location_address,actual_location_name,actual_location_captured_at,actual_location_provider,
    location_mismatch_reason,location_mismatch_explanation,visit_purpose,client_project_company_name,expected_duration_minutes,additional_notes,
    employee_declaration,declaration_at,evidence_photo_added,evidence_photo_path,evidence_photo_source,mocked_location_detected,location_risk_score,
    device_platform,app_version,captured_offline,offline_evidence_hash,verification_status,submitted_at,idempotency_key
  ) values (
    p_visit_id,v_uid,v_site.id,v_site.id,'site',trim(p_actual_location_name),p_actual_address,
    jsonb_build_object('latitude',v_site.latitude,'longitude',v_site.longitude),coalesce(v_site.checkin_radius_m,100),'PENDING',(p_captured_at at time zone 'Asia/Kolkata')::date,
    v_site.latitude,v_site.longitude,coalesce(v_site.checkin_radius_m,100),v_distance,v_status,
    p_actual_latitude,p_actual_longitude,p_accuracy_metres,p_actual_address,trim(p_actual_location_name),p_captured_at,left(p_location_provider,80),
    p_mismatch_reason,nullif(trim(p_mismatch_explanation),''),trim(p_visit_purpose),nullif(trim(p_client_project_company_name),''),p_expected_duration_minutes,nullif(trim(p_additional_notes),''),
    true,p_declaration_at,v_photo,p_evidence_photo_path,p_evidence_photo_source,coalesce(p_mocked_location,false),v_risk,
    left(p_device_platform,30),left(p_app_version,30),p_captured_offline,p_offline_evidence_hash,'PENDING',now(),p_idempotency_key
  );
  insert into field_visit_location_audit(field_visit_id,actor_id,action,new_status,metadata)
    values(p_visit_id,v_uid,'SUBMITTED','PENDING',jsonb_build_object('distance_metres',v_distance,'accuracy_metres',p_accuracy_metres,'captured_offline',p_captured_offline,'photo_added',v_photo));

  select reports_to into v_manager from profiles where id=v_uid;
  if v_manager is not null then
    begin insert into notifications(user_id,title,message,type,read)
      values(v_manager,'New current-location request',(select name from profiles where id=v_uid)||' marked a location outside the selected site radius.','field_visit',false);
    exception when others then null; end;
  end if;
  return query select p_visit_id,'PENDING'::text,v_distance,false;
end $$;
revoke all on function public.submit_field_visit_current_location(uuid,uuid,double precision,double precision,double precision,timestamptz,text,boolean,text,text,text,text,integer,text,text,text,timestamptz,text,text,text,text,text,boolean,text) from public;
grant execute on function public.submit_field_visit_current_location(uuid,uuid,double precision,double precision,double precision,timestamptz,text,boolean,text,text,text,text,integer,text,text,text,timestamptz,text,text,text,text,text,boolean,text) to authenticated;

create or replace function public.review_field_visit_current_location(p_visit_id uuid, p_decision text, p_notes text default null)
returns table(visit_id uuid, new_status text) language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_visit field_visits%rowtype; v_previous text; v_reviewer_role text;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  select * into v_visit from field_visits where id=p_visit_id for update;
  if not found or v_visit.location_match_status='MATCHED' then raise exception 'MARKED_VISIT_NOT_FOUND'; end if;
  if v_visit.user_id=v_uid then raise exception 'EMPLOYEES_CANNOT_REVIEW_OWN_REQUESTS'; end if;
  if not current_user_can_review(v_visit.user_id) then raise exception 'REVIEW_NOT_AUTHORIZED'; end if;
  select role into v_reviewer_role from profiles where id=v_uid;
  if p_decision not in ('APPROVED','REJECTED','NEEDS_INFORMATION','FLAGGED') then raise exception 'INVALID_REVIEW_DECISION'; end if;
  if p_decision in ('REJECTED','NEEDS_INFORMATION','FLAGGED') and nullif(trim(p_notes),'') is null then raise exception 'REVIEWER_NOTES_REQUIRED'; end if;
  v_previous:=v_visit.verification_status;
  perform set_config('app.current_location_server','on',true);
  update field_visits set verification_status=p_decision,reviewed_by=v_uid,reviewed_at=now(),reviewer_notes=nullif(trim(p_notes),'') where id=p_visit_id;
  insert into field_visit_location_audit(field_visit_id,actor_id,action,previous_status,new_status,notes,metadata)
    values(p_visit_id,v_uid,p_decision,v_previous,p_decision,nullif(trim(p_notes),''),jsonb_build_object('reviewer_role',v_reviewer_role));
  begin insert into notifications(user_id,title,message,type,read) values(v_visit.user_id,
    case p_decision when 'APPROVED' then 'Marked location approved' when 'REJECTED' then 'Marked location rejected' else 'Marked location update' end,
    case p_decision when 'APPROVED' then 'Your field visit at "'||v_visit.actual_location_name||'" has been approved.' when 'REJECTED' then 'Your marked-location request has been rejected. Reviewer note: '||coalesce(p_notes,'') when 'NEEDS_INFORMATION' then 'Additional information is required. Reviewer note: '||coalesce(p_notes,'') else 'Your marked-location request has been flagged for review.' end,
    'field_visit',false);
  exception when others then null; end;
  return query select p_visit_id,p_decision;
end $$;
revoke all on function public.review_field_visit_current_location(uuid,text,text) from public;
grant execute on function public.review_field_visit_current_location(uuid,text,text) to authenticated;

create or replace function public.review_predefined_site_location(
  p_field_visit_id uuid, p_new_latitude double precision, p_new_longitude double precision,
  p_new_radius_metres double precision, p_notes text, p_keep_existing boolean default false
) returns void language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_visit field_visits%rowtype; v_role text;
begin
  select role into v_role from profiles where id=v_uid and is_active=true;
  if v_role not in ('SYSTEM_ADMIN','ADMIN','HRD') then raise exception 'SITE_LOCATION_REVIEW_NOT_AUTHORIZED'; end if;
  select * into v_visit from field_visits where id=p_field_visit_id and location_mismatch_reason='The saved site pin appears incorrect';
  if not found then raise exception 'SITE_PIN_REQUEST_NOT_FOUND'; end if;
  if nullif(trim(p_notes),'') is null then raise exception 'SITE_REVIEW_NOTES_REQUIRED'; end if;
  if not p_keep_existing then
    if p_new_latitude not between -90 and 90 or p_new_longitude not between -180 and 180 or p_new_latitude=0 or p_new_longitude=0 or p_new_radius_metres not between 10 and 5000 then
      raise exception 'INVALID_SITE_LOCATION';
    end if;
    update predefined_sites set latitude=p_new_latitude,longitude=p_new_longitude,checkin_radius_m=round(p_new_radius_metres)::integer where id=v_visit.selected_site_id;
  end if;
  insert into field_visit_location_audit(field_visit_id,actor_id,action,previous_status,new_status,notes,metadata)
    values(v_visit.id,v_uid,'SITE_PIN_REVIEWED',v_visit.verification_status,v_visit.verification_status,trim(p_notes),
      jsonb_build_object('site_id',v_visit.selected_site_id,'kept_existing',p_keep_existing,'latitude',case when p_keep_existing then v_visit.selected_site_latitude else p_new_latitude end,'longitude',case when p_keep_existing then v_visit.selected_site_longitude else p_new_longitude end,'radius_metres',case when p_keep_existing then v_visit.selected_site_radius_metres else p_new_radius_metres end));
end $$;
revoke all on function public.review_predefined_site_location(uuid,double precision,double precision,double precision,text,boolean) from public;
grant execute on function public.review_predefined_site_location(uuid,double precision,double precision,double precision,text,boolean) to authenticated;

-- Prevent direct clients from changing server-calculated/reviewer fields while
-- retaining the existing employee check-in/check-out update workflow.
create or replace function public.protect_field_visit_location_fields() returns trigger language plpgsql as $$
begin
  if current_setting('app.current_location_server',true)='on' then return new; end if;
  if tg_op='INSERT' then
    if new.location_match_status <> 'MATCHED' or new.verification_status <> 'PENDING' or new.selected_site_distance_metres is not null or
       new.actual_latitude is not null or new.actual_longitude is not null or new.location_mismatch_reason is not null or
       new.location_risk_score <> 0 or new.reviewed_by is not null or new.reviewed_at is not null or new.evidence_photo_path is not null then
      raise exception 'CURRENT_LOCATION_SUBMISSION_REQUIRES_PROTECTED_RPC';
    end if;
    return new;
  end if;
  if (
    new.selected_site_id is distinct from old.selected_site_id or new.selected_site_latitude is distinct from old.selected_site_latitude or
    new.selected_site_longitude is distinct from old.selected_site_longitude or new.selected_site_radius_metres is distinct from old.selected_site_radius_metres or
    new.selected_site_distance_metres is distinct from old.selected_site_distance_metres or new.location_match_status is distinct from old.location_match_status or
    new.actual_latitude is distinct from old.actual_latitude or new.actual_longitude is distinct from old.actual_longitude or
    new.actual_location_accuracy_metres is distinct from old.actual_location_accuracy_metres or new.actual_location_captured_at is distinct from old.actual_location_captured_at or
    new.location_mismatch_reason is distinct from old.location_mismatch_reason or new.location_mismatch_explanation is distinct from old.location_mismatch_explanation or
    new.employee_declaration is distinct from old.employee_declaration or new.declaration_at is distinct from old.declaration_at or
    new.location_risk_score is distinct from old.location_risk_score or new.verification_status is distinct from old.verification_status or
    new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at or new.reviewer_notes is distinct from old.reviewer_notes or
    new.evidence_photo_path is distinct from old.evidence_photo_path
  ) then raise exception 'SERVER_MANAGED_FIELD'; end if;
  return new;
end $$;
drop trigger if exists protect_field_visit_location_fields_trigger on public.field_visits;
create trigger protect_field_visit_location_fields_trigger before insert or update on public.field_visits for each row execute function public.protect_field_visit_location_fields();

create or replace function public.prevent_location_audit_mutation() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_LOG_IS_IMMUTABLE'; end $$;
drop trigger if exists prevent_location_audit_mutation_trigger on public.field_visit_location_audit;
create trigger prevent_location_audit_mutation_trigger before update or delete on public.field_visit_location_audit for each row execute function public.prevent_location_audit_mutation();
