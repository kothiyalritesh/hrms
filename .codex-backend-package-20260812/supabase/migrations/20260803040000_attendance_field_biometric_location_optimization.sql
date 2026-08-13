-- Server-authoritative attendance, biometric, visit, session and retention
-- contract. Additive: historical attendance/audit evidence is never deleted by
-- this migration. Retention only runs later through bounded scheduled jobs.

create extension if not exists pgcrypto;

do $$
begin
  begin
    create extension if not exists postgis;
  exception when insufficient_privilege or feature_not_supported or undefined_file then
    raise notice 'PostGIS is unavailable; numeric-coordinate fallbacks remain active.';
  end;
end $$;

-- -------------------------------------------------------------------------
-- Authoritative attendance state and checkout idempotency
-- -------------------------------------------------------------------------

alter table public.attendance_logs
  add column if not exists attendance_state text,
  add column if not exists checkout_reason text,
  add column if not exists checkout_accuracy_metres double precision,
  add column if not exists checkout_captured_at timestamptz,
  add column if not exists biometric_first_punch timestamptz,
  add column if not exists biometric_last_punch timestamptz,
  add column if not exists biometric_punch_count integer not null default 0;

update public.attendance_logs
set attendance_state = case
  when checkout_time is not null then 'CHECKED_OUT'
  when checkin_time is not null then 'WORKING'
  else 'NOT_CHECKED_IN'
end
where attendance_state is null
   or attendance_state not in (
     'NOT_CHECKED_IN','WORKING','ON_FIELD_VISIT','CHECKED_OUT'
   );

alter table public.attendance_logs alter column attendance_state set default 'NOT_CHECKED_IN';
alter table public.attendance_logs alter column attendance_state set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_logs_state_ck') then
    alter table public.attendance_logs add constraint attendance_logs_state_ck
      check (attendance_state in ('NOT_CHECKED_IN','WORKING','ON_FIELD_VISIT','CHECKED_OUT')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_logs_biometric_count_ck') then
    alter table public.attendance_logs add constraint attendance_logs_biometric_count_ck
      check (biometric_punch_count >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_logs_checkout_after_checkin_ck') then
    alter table public.attendance_logs add constraint attendance_logs_checkout_after_checkin_ck
      check (checkout_time is null or checkin_time is null or checkout_time >= checkin_time) not valid;
  end if;
end $$;

create unique index if not exists attendance_logs_user_business_date_uidx
  on public.attendance_logs(user_id, date);
create index if not exists attendance_logs_user_date_desc_idx
  on public.attendance_logs(user_id, date desc);
create index if not exists attendance_logs_date_status_idx
  on public.attendance_logs(date, status);
create index if not exists attendance_logs_office_date_idx
  on public.attendance_logs(office_id, date);
create index if not exists attendance_logs_open_user_idx
  on public.attendance_logs(user_id, checkout_time)
  where checkout_time is null and checkin_time is not null;

create table if not exists public.attendance_action_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  attendance_id uuid not null references public.attendance_logs(id) on delete restrict,
  idempotency_key uuid not null,
  action text not null check (action in ('GOING_HOME','RETURN_TO_WORK')),
  request_hash text not null,
  status text not null default 'PROCESSING'
    check (status in ('PROCESSING','COMMITTED','REJECTED')),
  response jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique(user_id, idempotency_key)
);
create index if not exists attendance_action_requests_attendance_idx
  on public.attendance_action_requests(attendance_id, created_at desc);

create table if not exists public.hrms_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete restrict,
  target_user_id uuid references public.profiles(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  source text not null,
  device_id text,
  created_at timestamptz not null default now()
);
create index if not exists hrms_audit_target_time_idx
  on public.hrms_audit_events(target_user_id, created_at desc, id desc);
create index if not exists hrms_audit_entity_idx
  on public.hrms_audit_events(entity_type, entity_id, created_at desc);

alter table public.notifications add column if not exists event_key text;
create unique index if not exists notifications_event_key_uidx
  on public.notifications(event_key) where event_key is not null;

drop function if exists public.rpc_attendance_checkout_reconciled(uuid, jsonb, text, boolean);
drop function if exists public.rpc_attendance_checkout_reconciled(uuid, uuid, jsonb, text, uuid);

create function public.rpc_attendance_checkout_reconciled(
  p_user_id uuid,
  p_attendance_id uuid,
  p_checkout_location jsonb,
  p_checkout_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_business_date date := (v_now at time zone 'Asia/Kolkata')::date;
  v_attendance public.attendance_logs%rowtype;
  v_existing public.attendance_action_requests%rowtype;
  v_sync jsonb;
  v_result jsonb;
  v_hash text;
  v_lat double precision;
  v_lon double precision;
  v_accuracy double precision;
  v_captured_at timestamptz;
  v_max_accuracy double precision := 100;
  v_closed_visits integer := 0;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_user_id is distinct from v_uid then raise exception 'USER_ID_MISMATCH'; end if;
  if p_attendance_id is null or p_idempotency_key is null then
    raise exception 'ATTENDANCE_ID_AND_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if upper(btrim(coalesce(p_checkout_reason, ''))) <> 'GOING_HOME' then
    raise exception 'INVALID_CHECKOUT_REASON';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_uid and p.is_active
  ) then raise exception 'EMPLOYEE_INACTIVE'; end if;

  begin
    v_lat := (p_checkout_location->>'latitude')::double precision;
    v_lon := (p_checkout_location->>'longitude')::double precision;
    v_accuracy := (p_checkout_location->>'accuracy')::double precision;
    v_captured_at := coalesce(
      nullif(p_checkout_location->>'captured_at',''),
      nullif(p_checkout_location->>'capturedAt','')
    )::timestamptz;
  exception when others then
    raise exception 'INVALID_CHECKOUT_LOCATION';
  end;
  if v_lat is null or v_lat not between -90 and 90
     or v_lon is null or v_lon not between -180 and 180 then
    raise exception 'INVALID_CHECKOUT_COORDINATES';
  end if;
  if v_accuracy is null or v_accuracy < 0 or v_accuracy > v_max_accuracy then
    raise exception 'CHECKOUT_GPS_ACCURACY_REJECTED';
  end if;
  if v_captured_at is null or v_captured_at < v_now - interval '120 seconds'
     or v_captured_at > v_now + interval '10 seconds' then
    raise exception 'STALE_CHECKOUT_LOCATION';
  end if;
  if coalesce((p_checkout_location->>'mocked')::boolean, false) then
    raise exception 'MOCK_LOCATION_REJECTED';
  end if;

  v_hash := encode(digest(
    concat_ws('|', p_attendance_id, upper(p_checkout_reason),
      round(v_lat::numeric, 6), round(v_lon::numeric, 6),
      round(v_accuracy::numeric, 1), v_captured_at), 'sha256'
  ), 'hex');

  insert into public.attendance_action_requests(
    user_id, attendance_id, idempotency_key, action, request_hash
  ) values (v_uid, p_attendance_id, p_idempotency_key, 'GOING_HOME', v_hash)
  on conflict(user_id, idempotency_key) do nothing;

  select * into strict v_existing
  from public.attendance_action_requests
  where user_id = v_uid and idempotency_key = p_idempotency_key
  for update;
  if v_existing.attendance_id <> p_attendance_id
     or v_existing.request_hash <> v_hash then
    raise exception 'IDEMPOTENCY_KEY_REUSE_CONFLICT';
  end if;
  if v_existing.status = 'COMMITTED' and v_existing.response is not null then
    return v_existing.response || jsonb_build_object('idempotent', true);
  end if;

  select * into v_attendance
  from public.attendance_logs
  where id = p_attendance_id
  for update;
  if not found then raise exception 'ATTENDANCE_NOT_FOUND'; end if;
  if v_attendance.user_id <> v_uid then raise exception 'ATTENDANCE_OWNERSHIP_REQUIRED'; end if;
  if v_attendance.checkin_time is null then raise exception 'NO_ACTIVE_CHECKIN'; end if;
  if v_attendance.date <> v_business_date then raise exception 'ATTENDANCE_BUSINESS_DATE_MISMATCH'; end if;

  if v_attendance.checkout_time is not null then
    v_result := jsonb_build_object(
      'success', true, 'idempotent', true, 'already_checked_out', true,
      'id', v_attendance.id, 'attendance_id', v_attendance.id,
      'checkin_time', v_attendance.checkin_time,
      'checkout_time', v_attendance.checkout_time,
      'status', v_attendance.status, 'attendance_state', 'CHECKED_OUT',
      'attendance', to_jsonb(v_attendance),
      'message', 'Attendance was already checked out.'
    );
    update public.attendance_action_requests
      set status='COMMITTED', response=v_result, committed_at=now()
      where id=v_existing.id;
    return v_result;
  end if;

  -- Reconcile biometric first-punch data before committing the final action.
  v_sync := public.rpc_sync_first_daily_checkin(v_uid);
  if not coalesce((v_sync->>'success')::boolean, false) then
    raise exception 'BIOMETRIC_RECONCILIATION_FAILED';
  end if;

  update public.attendance_logs
  set checkout_time = v_now,
      checkout_location = p_checkout_location || jsonb_build_object(
        'captured_at', v_captured_at, 'provider',
        coalesce(nullif(p_checkout_location->>'provider',''), 'gps')
      ),
      checkout_accuracy_metres = v_accuracy,
      checkout_captured_at = v_captured_at,
      checkout_reason = 'GOING_HOME',
      checkout_source = 'APP',
      status = 'CHECKED_OUT',
      attendance_state = 'CHECKED_OUT',
      updated_at = v_now
  where id = v_attendance.id
  returning * into v_attendance;

  update public.tracking_sessions
  set status='STOPPED', stopped_at=v_now, stop_reason='GOING_HOME',
      native_task_active=false, updated_at=v_now
  where attendance_log_id=v_attendance.id and status='ACTIVE';

  with changed as (
    update public.field_visits
    set status = case when status='CHECKED_IN' then 'COMPLETED' else 'MISSED' end,
        checkout_time = case when status='CHECKED_IN' then v_now else checkout_time end,
        checkout_location = case when status='CHECKED_IN' then p_checkout_location else checkout_location end,
        journey_status = case when status='CHECKED_IN' then 'COMPLETED' else 'CANCELLED' end,
        visit_state = case when status='CHECKED_IN' then 'COMPLETED' else 'CANCELLED' end,
        notes = concat_ws(E'\n', nullif(notes,''), 'Closed by confirmed Going Home checkout.')
    where user_id=v_uid and date=v_business_date
      and status in ('PENDING','IN_TRANSIT','CHECKED_IN')
    returning id
  ) select count(*) into v_closed_visits from changed;

  insert into public.attendance_audit_logs(
    attendance_id, user_id, action, old_status, new_status,
    old_checkout_at, new_checkout_at, reason, source
  ) values (
    v_attendance.id, v_uid, 'GOING_HOME_CHECKOUT', 'CHECKED_IN',
    'CHECKED_OUT', null, v_now, 'GOING_HOME', 'APP'
  );
  insert into public.hrms_audit_events(
    actor_user_id, target_user_id, action, entity_type, entity_id,
    old_values, new_values, source
  ) values (
    v_uid, v_uid, 'GOING_HOME_CHECKOUT', 'attendance', v_attendance.id,
    jsonb_build_object('attendance_state','WORKING'),
    jsonb_build_object('attendance_state','CHECKED_OUT','checkout_time',v_now,
      'checkout_reason','GOING_HOME','closed_visit_count',v_closed_visits), 'APP'
  );
  insert into public.activity_logs(
    user_id, location_type, location_name, notes, destination,
    gps_coordinates, timestamp, activity_type
  ) values (
    v_uid, 'others', 'Home', 'Confirmed Going Home checkout', 'Home',
    jsonb_build_object('latitude',v_lat,'longitude',v_lon,'accuracy',v_accuracy),
    v_now, 'TRAVEL'
  );
  begin
    insert into public.notifications(user_id,title,message,type,event_key)
    values (v_uid,'Checked Out Successfully',
      'You selected Going Home. Your attendance for today is complete.',
      'attendance_checkout', 'attendance-checkout:' || v_attendance.id)
    on conflict(event_key) where event_key is not null do nothing;
  exception when others then
    -- Notifications are optional side effects and never roll back checkout.
    null;
  end;

  v_result := jsonb_build_object(
    'success', true, 'idempotent', false,
    'id', v_attendance.id, 'attendance_id', v_attendance.id,
    'checkin_time', v_attendance.checkin_time,
    'checkout_time', v_attendance.checkout_time,
    'status', v_attendance.status, 'attendance_state', 'CHECKED_OUT',
    'attendance', to_jsonb(v_attendance),
    'message', 'Checked out successfully.'
  );
  update public.attendance_action_requests
    set status='COMMITTED', response=v_result, committed_at=v_now
    where id=v_existing.id;
  return v_result;
exception when others then
  return jsonb_build_object(
    'success', false, 'error', sqlstate,
    'message', case sqlerrm
      when 'NO_ACTIVE_CHECKIN' then 'No active check-in was found.'
      when 'STALE_CHECKOUT_LOCATION' then 'The GPS reading is stale. Capture a new location.'
      when 'CHECKOUT_GPS_ACCURACY_REJECTED' then 'GPS accuracy is too low. Move outdoors and try again.'
      when 'MOCK_LOCATION_REJECTED' then 'Mock location was detected and checkout was blocked.'
      else sqlerrm end
  );
end $$;

revoke all on function public.rpc_attendance_checkout_reconciled(uuid,uuid,jsonb,text,uuid)
  from public, anon;
grant execute on function public.rpc_attendance_checkout_reconciled(uuid,uuid,jsonb,text,uuid)
  to authenticated;

-- -------------------------------------------------------------------------
-- Field-visit destination and state contract
-- -------------------------------------------------------------------------

alter table public.field_visits
  add column if not exists visit_state text not null default 'DRAFT',
  add column if not exists google_place_id text,
  add column if not exists location_source text,
  add column if not exists arrival_radius_m integer,
  add column if not exists employee_notes text,
  add column if not exists evidence_photo_path text,
  add column if not exists evidence_file_hash text,
  add column if not exists idempotency_key uuid,
  add column if not exists arrival_latitude double precision,
  add column if not exists arrival_longitude double precision,
  add column if not exists arrival_accuracy_metres double precision,
  add column if not exists arrival_distance_metres double precision;

update public.field_visits set visit_state = case status
  when 'PENDING' then 'TRAVELLING'
  when 'IN_TRANSIT' then 'TRAVELLING'
  when 'CHECKED_IN' then 'IN_PROGRESS'
  when 'COMPLETED' then 'COMPLETED'
  when 'MISSED' then 'CANCELLED'
  else 'DRAFT' end;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='field_visits_visit_state_ck') then
    alter table public.field_visits add constraint field_visits_visit_state_ck
      check (visit_state in ('DRAFT','TRAVELLING','ARRIVED','IN_PROGRESS','COMPLETED','CANCELLED'));
  end if;
  if not exists (select 1 from pg_constraint where conname='field_visits_location_source_ck') then
    alter table public.field_visits add constraint field_visits_location_source_ck check (
      location_source is null or location_source in
      ('GOOGLE_PLACE','MAP_PIN','CURRENT_LOCATION','PREDEFINED_SITE','MANUAL_COORDINATES'));
  end if;
  if not exists (select 1 from pg_constraint where conname='field_visits_arrival_lat_ck') then
    alter table public.field_visits add constraint field_visits_arrival_lat_ck
      check (arrival_latitude is null or arrival_latitude between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname='field_visits_arrival_lon_ck') then
    alter table public.field_visits add constraint field_visits_arrival_lon_ck
      check (arrival_longitude is null or arrival_longitude between -180 and 180);
  end if;
end $$;
create unique index if not exists field_visits_user_idempotency_uidx
  on public.field_visits(user_id,idempotency_key) where idempotency_key is not null;
create index if not exists field_visits_active_destination_idx
  on public.field_visits(user_id,date,visit_state,created_at desc)
  where visit_state in ('TRAVELLING','ARRIVED','IN_PROGRESS');

create or replace function public.sync_field_visit_state_from_journey()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  new.visit_state:=case
    when new.status='COMPLETED' or new.journey_status='COMPLETED' then 'COMPLETED'
    when new.status='MISSED' or new.journey_status='CANCELLED' then 'CANCELLED'
    when new.journey_status in('ARRIVED','ARRIVAL_PENDING_CONFIRMATION') then
      case when new.journey_status='ARRIVED' then 'ARRIVED' else coalesce(new.visit_state,'TRAVELLING') end
    when new.status='CHECKED_IN' then 'IN_PROGRESS'
    when new.status in('PENDING','IN_TRANSIT') then 'TRAVELLING'
    else coalesce(new.visit_state,'DRAFT') end;
  return new;
end $$;
drop trigger if exists sync_field_visit_state_from_journey on public.field_visits;
create trigger sync_field_visit_state_from_journey before insert or update of status,journey_status
on public.field_visits for each row execute function public.sync_field_visit_state_from_journey();

-- Patch the protected employee RPC: destination is mandatory, zero coordinates
-- remain valid, and visit creation never writes attendance.checkout_time.
create or replace function public.rpc_mutate_own_field_visit(
  p_action text,
  p_visit_id uuid default null,
  p_values jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_action text := upper(btrim(coalesce(p_action,'')));
  v_row public.field_visits%rowtype;
  v_attendance public.attendance_logs%rowtype;
  v_lat double precision := nullif(p_values->>'latitude','')::double precision;
  v_lon double precision := nullif(p_values->>'longitude','')::double precision;
  v_dest_lat double precision := nullif(p_values->'destination_coords'->>'latitude','')::double precision;
  v_dest_lon double precision := nullif(p_values->'destination_coords'->>'longitude','')::double precision;
  v_key uuid := nullif(p_values->>'idempotency_key','')::uuid;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=v_uid and is_active) then
    raise exception 'EMPLOYEE_INACTIVE';
  end if;
  if v_action not in ('CREATE','CHECK_IN','CHECK_OUT','MARK_MISSED') then
    raise exception 'INVALID_FIELD_VISIT_ACTION';
  end if;

  if v_action='CREATE' then
    if nullif(btrim(p_values->>'location_name'),'') is null then raise exception 'LOCATION_NAME_REQUIRED'; end if;
    if coalesce(p_values->>'visit_type','') not in ('site','meeting','office','others') then
      raise exception 'INVALID_VISIT_TYPE';
    end if;
    if v_dest_lat is null or v_dest_lat not between -90 and 90
       or v_dest_lon is null or v_dest_lon not between -180 and 180 then
      raise exception 'VALID_DESTINATION_COORDINATES_REQUIRED';
    end if;
    select * into v_attendance from public.attendance_logs
      where user_id=v_uid and date=v_today and checkin_time is not null
      order by checkin_time limit 1 for update;
    if not found or v_attendance.checkout_time is not null then raise exception 'ACTIVE_ATTENDANCE_REQUIRED'; end if;
    if v_key is not null then
      select * into v_row from public.field_visits where user_id=v_uid and idempotency_key=v_key;
      if found then return jsonb_build_object('success',true,'idempotent',true,'visit',to_jsonb(v_row)); end if;
    end if;

    insert into public.field_visits(
      user_id,visit_type,location_name,status,date,activity_log_id,
      predefined_site_id,location_address,destination_coords,checkin_radius_m,
      meeting_type,contact_name,contact_phone,company_name,project_name,notes,
      origin_lat,origin_lon,origin_name,visit_state,google_place_id,
      location_source,arrival_radius_m,employee_notes,evidence_photo_path,
      evidence_file_hash,idempotency_key,journey_status
    ) values (
      v_uid,p_values->>'visit_type',btrim(p_values->>'location_name'),'PENDING',v_today,
      nullif(p_values->>'activity_log_id','')::uuid,
      nullif(p_values->>'predefined_site_id','')::uuid,
      nullif(btrim(p_values->>'location_address'),''),p_values->'destination_coords',
      greatest(25,least(coalesce(nullif(p_values->>'checkin_radius_m','')::integer,100),1000)),
      nullif(p_values->>'meeting_type',''),nullif(btrim(p_values->>'contact_name'),''),
      nullif(btrim(p_values->>'contact_phone'),''),nullif(btrim(p_values->>'company_name'),''),
      nullif(btrim(p_values->>'project_name'),''),nullif(btrim(p_values->>'notes'),''),
      nullif(p_values->>'origin_lat','')::double precision,nullif(p_values->>'origin_lon','')::double precision,
      nullif(btrim(p_values->>'origin_name'),''),'TRAVELLING',nullif(p_values->>'google_place_id',''),
      coalesce(nullif(p_values->>'location_source',''),case when p_values ? 'predefined_site_id' then 'PREDEFINED_SITE' else 'MAP_PIN' end),
      greatest(25,least(coalesce(nullif(p_values->>'checkin_radius_m','')::integer,100),1000)),
      nullif(btrim(p_values->>'employee_notes'),''),nullif(p_values->>'evidence_photo_path',''),
      nullif(p_values->>'evidence_file_hash',''),v_key,'TRAVELLING'
    ) returning * into v_row;
    update public.attendance_logs set attendance_state='ON_FIELD_VISIT',updated_at=now()
      where id=v_attendance.id;
    insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
      values(v_uid,v_uid,'FIELD_VISIT_STARTED','field_visit',v_row.id,
        jsonb_build_object('visit_state','TRAVELLING','destination',v_row.destination_coords),'APP');
  else
    if p_visit_id is null then raise exception 'VISIT_ID_REQUIRED'; end if;
    select * into v_row from public.field_visits where id=p_visit_id and user_id=v_uid for update;
    if not found then raise exception 'FIELD_VISIT_NOT_FOUND'; end if;
    if v_action in ('CHECK_IN','CHECK_OUT') and (
      v_lat is null or v_lat not between -90 and 90 or
      v_lon is null or v_lon not between -180 and 180
    ) then raise exception 'VALID_LOCATION_REQUIRED'; end if;

    if v_action='CHECK_IN' then
      if v_row.date<>v_today or v_row.status not in ('PENDING','IN_TRANSIT') then raise exception 'FIELD_VISIT_CHECKIN_NOT_ALLOWED'; end if;
      update public.field_visits set checkin_time=now(),
        checkin_location=jsonb_build_object('latitude',v_lat,'longitude',v_lon),
        arrival_latitude=v_lat,arrival_longitude=v_lon,status='CHECKED_IN',
        visit_state='ARRIVED',arrived_at=now(),journey_status='ARRIVED'
      where id=p_visit_id returning * into v_row;
      insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
        values(v_uid,v_uid,'FIELD_VISIT_ARRIVED','field_visit',v_row.id,
          jsonb_build_object('arrived_at',v_row.arrived_at),'APP');
    elsif v_action='CHECK_OUT' then
      if v_row.status<>'CHECKED_IN' or v_row.checkout_time is not null then raise exception 'FIELD_VISIT_CHECKOUT_NOT_ALLOWED'; end if;
      update public.field_visits set checkout_time=now(),
        checkout_location=jsonb_build_object('latitude',v_lat,'longitude',v_lon),
        checkout_notes=nullif(btrim(p_values->>'notes'),''),
        checkout_office_id=nullif(p_values->>'nearest_office_id','')::uuid,
        status='COMPLETED',visit_state='COMPLETED',journey_status='COMPLETED'
      where id=p_visit_id returning * into v_row;
      if not exists(select 1 from public.field_visits where user_id=v_uid and date=v_today
        and id<>p_visit_id and visit_state in ('TRAVELLING','ARRIVED','IN_PROGRESS')) then
        update public.attendance_logs set attendance_state='WORKING',updated_at=now()
          where user_id=v_uid and date=v_today and checkout_time is null;
      end if;
    else
      if v_row.status not in ('PENDING','IN_TRANSIT') then raise exception 'FIELD_VISIT_CANCEL_NOT_ALLOWED'; end if;
      update public.field_visits set status='MISSED',visit_state='CANCELLED',journey_status='CANCELLED'
        where id=p_visit_id returning * into v_row;
    end if;
  end if;
  return jsonb_build_object('success',true,'visit',to_jsonb(v_row));
end $$;

revoke all on function public.rpc_mutate_own_field_visit(text,uuid,jsonb) from public,anon;
grant execute on function public.rpc_mutate_own_field_visit(text,uuid,jsonb) to authenticated;

create or replace function public.check_in_field_visit_at_selected_site(
  p_visit_id uuid,p_latitude double precision,p_longitude double precision,
  p_accuracy_metres double precision,p_captured_at timestamptz,
  p_location_provider text,p_mocked_location boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_visit public.field_visits%rowtype;
  v_site public.predefined_sites%rowtype;v_distance double precision;v_now timestamptz:=now();
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  select * into v_visit from public.field_visits
    where id=p_visit_id and user_id=v_uid and status in('PENDING','IN_TRANSIT') for update;
  if not found or v_visit.predefined_site_id is null then raise exception 'FIELD_VISIT_NOT_FOUND'; end if;
  select * into v_site from public.predefined_sites where id=v_visit.predefined_site_id and is_active;
  if not found then raise exception 'SELECTED_SITE_NOT_ACTIVE'; end if;
  if p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180 then raise exception 'INVALID_COORDINATES'; end if;
  if p_accuracy_metres is null or p_accuracy_metres<0 or p_accuracy_metres>100 then raise exception 'GPS_ACCURACY_NOT_ACCEPTABLE'; end if;
  if p_captured_at<v_now-interval '120 seconds' or p_captured_at>v_now+interval '10 seconds' then raise exception 'STALE_LOCATION_EVIDENCE'; end if;
  if coalesce(p_mocked_location,false) then raise exception 'MOCK_LOCATION_DETECTED'; end if;
  if v_site.checkin_radius_m is null or v_site.checkin_radius_m<10 then raise exception 'SELECTED_SITE_RADIUS_NOT_CONFIGURED'; end if;
  v_distance:=public.field_visit_distance_metres(v_site.latitude,v_site.longitude,p_latitude,p_longitude);
  -- Accuracy is retained for audit; the measured distance alone determines the
  -- geofence result after low-quality readings have already been rejected.
  if v_distance>v_site.checkin_radius_m then raise exception 'OUTSIDE_SELECTED_SITE_RADIUS'; end if;
  update public.field_visits set checkin_time=v_now,
    checkin_location=jsonb_build_object('latitude',p_latitude,'longitude',p_longitude,
      'accuracy',p_accuracy_metres,'captured_at',p_captured_at,'provider',left(coalesce(p_location_provider,'unknown'),80),
      'distance_metres',v_distance),
    status='CHECKED_IN',visit_state='ARRIVED',journey_status='ARRIVED',arrived_at=v_now,
    arrival_latitude=p_latitude,arrival_longitude=p_longitude,
    arrival_accuracy_metres=p_accuracy_metres,arrival_distance_metres=v_distance
  where id=p_visit_id returning * into v_visit;
  insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
    values(v_uid,v_uid,'FIELD_VISIT_ARRIVED','field_visit',p_visit_id,
      jsonb_build_object('arrived_at',v_now,'distance_metres',v_distance,'accuracy_metres',p_accuracy_metres),'APP');
  begin
    insert into public.notifications(user_id,title,message,type,event_key)
    values(v_uid,'Destination reached','You have arrived at '||v_visit.location_name,
      'journey','field-visit-arrived:'||p_visit_id)
    on conflict(event_key) where event_key is not null do nothing;
  exception when others then null;end;
  return jsonb_build_object('success',true,'visit_id',p_visit_id,'status','CHECKED_IN',
    'visit_state','ARRIVED','checkin_time',v_visit.checkin_time,
    'distance_metres',v_distance,'accuracy_metres',p_accuracy_metres);
end $$;
revoke all on function public.check_in_field_visit_at_selected_site(
  uuid,double precision,double precision,double precision,timestamptz,text,boolean
) from public,anon;
grant execute on function public.check_in_field_visit_at_selected_site(
  uuid,double precision,double precision,double precision,timestamptz,text,boolean
) to authenticated;

-- -------------------------------------------------------------------------
-- Dedicated biometric identity and partitioned raw punch storage
-- -------------------------------------------------------------------------

create table if not exists public.employee_biometric_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  device_id text not null,
  biometric_employee_code text not null,
  employee_name_snapshot text,
  is_active boolean not null default true,
  mapped_by uuid references public.profiles(id) on delete restrict,
  mapped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(device_id,biometric_employee_code)
);
create index if not exists employee_biometric_mappings_user_idx
  on public.employee_biometric_mappings(user_id,is_active);

create or replace function public.sync_legacy_profile_biometric_mapping()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_actor uuid:=auth.uid();
begin
  if old.smartoffice_employee_code is not null
     and old.smartoffice_employee_code is distinct from new.smartoffice_employee_code then
    update public.employee_biometric_mappings set is_active=false,updated_at=now()
      where user_id=new.id and device_id='*'
        and biometric_employee_code=old.smartoffice_employee_code;
  end if;
  if nullif(btrim(new.smartoffice_employee_code),'') is not null then
    insert into public.employee_biometric_mappings(
      user_id,device_id,biometric_employee_code,employee_name_snapshot,is_active,mapped_by,mapped_at
    ) values(new.id,'*',btrim(new.smartoffice_employee_code),new.name,new.is_active,v_actor,now())
    on conflict(device_id,biometric_employee_code) do update set
      user_id=excluded.user_id,employee_name_snapshot=excluded.employee_name_snapshot,
      is_active=excluded.is_active,mapped_by=excluded.mapped_by,mapped_at=now(),updated_at=now();
  end if;
  insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,old_values,new_values,source)
  values(v_actor,new.id,'BIOMETRIC_MAPPING_CHANGED','biometric_mapping',new.id,
    jsonb_build_object('employee_code',old.smartoffice_employee_code),
    jsonb_build_object('employee_code',new.smartoffice_employee_code),'ADMIN');
  return new;
end $$;
drop trigger if exists sync_legacy_profile_biometric_mapping on public.profiles;
create trigger sync_legacy_profile_biometric_mapping after update of smartoffice_employee_code
on public.profiles for each row
when(old.smartoffice_employee_code is distinct from new.smartoffice_employee_code)
execute function public.sync_legacy_profile_biometric_mapping();

-- Backfill explicit legacy codes without name matching. Device '*' means a
-- verified organization-wide mapping until the actual device ID is assigned.
insert into public.employee_biometric_mappings(
  user_id,device_id,biometric_employee_code,employee_name_snapshot,is_active,mapped_by
)
select p.id,'*',btrim(p.smartoffice_employee_code),p.name,p.is_active,null
from public.profiles p
where nullif(btrim(p.smartoffice_employee_code),'') is not null
on conflict(device_id,biometric_employee_code) do nothing;

create table if not exists public.biometric_device_punches (
  id uuid not null default gen_random_uuid(),
  device_id text not null,
  biometric_employee_code text not null,
  punch_timestamp timestamptz not null,
  punch_direction text,
  source_event_id text not null default '',
  processing_status text not null default 'RECEIVED'
    check (processing_status in ('RECEIVED','PROCESSED','DUPLICATE','UNMAPPED','RECONCILIATION_REQUIRED','REJECTED','DEAD_LETTER')),
  attendance_date date not null,
  retry_count integer not null default 0 check(retry_count>=0),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key(id,punch_timestamp),
  unique(device_id,biometric_employee_code,punch_timestamp,source_event_id)
) partition by range(punch_timestamp);

create table if not exists public.biometric_device_punches_default
  partition of public.biometric_device_punches default;

create or replace function public.ensure_biometric_month_partition(p_month date)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_start date:=date_trunc('month',p_month)::date;
  v_end date:=(date_trunc('month',p_month)+interval '1 month')::date;
  v_name text:='biometric_device_punches_'||to_char(v_start,'YYYYMM');
begin
  execute format('create table if not exists public.%I partition of public.biometric_device_punches for values from (%L) to (%L)',v_name,v_start::timestamptz,v_end::timestamptz);
  return v_name;
end $$;
revoke all on function public.ensure_biometric_month_partition(date) from public,anon,authenticated;
grant execute on function public.ensure_biometric_month_partition(date) to service_role;
select public.ensure_biometric_month_partition((now() at time zone 'Asia/Kolkata')::date);
select public.ensure_biometric_month_partition(((now() at time zone 'Asia/Kolkata')::date+interval '1 month')::date);
create index if not exists biometric_punches_code_time_idx
  on public.biometric_device_punches(device_id,biometric_employee_code,punch_timestamp desc);
create index if not exists biometric_punches_status_time_idx
  on public.biometric_device_punches(processing_status,punch_timestamp);

create table if not exists public.biometric_reconciliation_queue (
  id uuid primary key default gen_random_uuid(),
  punch_id uuid not null,
  punch_timestamp timestamptz not null,
  device_id text not null,
  biometric_employee_code text not null,
  reason text not null,
  status text not null default 'OPEN' check(status in ('OPEN','RESOLVED','IGNORED')),
  assigned_user_id uuid references public.profiles(id) on delete restrict,
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(punch_id,punch_timestamp)
);
create index if not exists biometric_reconciliation_open_idx
  on public.biometric_reconciliation_queue(created_at desc) where status='OPEN';

-- Biometric punches are never an implicit checkout policy. Replace the legacy
-- rollover closer with a missing-checkout notifier/reconciliation detector.
drop function if exists public.auto_checkout_attendance_end_of_day();
create function public.auto_checkout_attendance_end_of_day()
returns integer language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_count integer:=0;
begin
  insert into public.notifications(user_id,title,message,type,event_key)
  select a.user_id,'Attendance still active',
    'Your previous attendance session is still open. Submit a regularization request or contact HR.',
    'attendance_reminder','attendance-unclosed:'||a.id
  from public.attendance_logs a
  where a.date<(now() at time zone 'Asia/Kolkata')::date
    and a.checkin_time is not null and a.checkout_time is null
  on conflict(event_key) where event_key is not null do nothing;
  get diagnostics v_count=row_count;
  return v_count;
exception when others then
  return 0;
end $$;

do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job
      where jobname in('attendance-auto-checkout-day-rollover','attendance-auto-checkout-2359-ist');
  end if;
exception when insufficient_privilege then null;
end $$;

create or replace function public.process_biometric_punch(
  p_punch_id uuid,p_punch_timestamp timestamptz
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_punch public.biometric_device_punches%rowtype;
  v_mapping public.employee_biometric_mappings%rowtype;
  v_attendance public.attendance_logs%rowtype;
  v_created boolean := false;
  v_day_count integer:=1;
  v_day_first timestamptz;
  v_day_last timestamptz;
begin
  select * into v_punch from public.biometric_device_punches
    where id=p_punch_id and punch_timestamp=p_punch_timestamp for update;
  if not found then raise exception 'PUNCH_NOT_FOUND'; end if;
  if v_punch.processing_status in ('PROCESSED','RECONCILIATION_REQUIRED') then
    return jsonb_build_object('success',true,'idempotent',true,'status',v_punch.processing_status);
  end if;
  select * into v_mapping from public.employee_biometric_mappings
    where is_active and biometric_employee_code=v_punch.biometric_employee_code
      and device_id in (v_punch.device_id,'*')
    order by (device_id=v_punch.device_id) desc limit 1;
  if not found or not exists(select 1 from public.profiles where id=v_mapping.user_id and is_active) then
    update public.biometric_device_punches set processing_status='UNMAPPED',
      last_error='ACTIVE_MAPPING_REQUIRED' where id=p_punch_id and punch_timestamp=p_punch_timestamp;
    insert into public.biometric_reconciliation_queue(
      punch_id,punch_timestamp,device_id,biometric_employee_code,reason
    ) values(p_punch_id,p_punch_timestamp,v_punch.device_id,v_punch.biometric_employee_code,'UNMAPPED_CODE')
    on conflict(punch_id,punch_timestamp) do nothing;
    return jsonb_build_object('success',true,'status','UNMAPPED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_mapping.user_id::text || v_punch.attendance_date::text,0));
  select count(distinct (p.device_id,p.biometric_employee_code,p.punch_timestamp,p.source_event_id)),
    min(p.punch_timestamp),max(p.punch_timestamp)
    into v_day_count,v_day_first,v_day_last
  from public.biometric_device_punches p
  join public.employee_biometric_mappings m
    on m.is_active and m.user_id=v_mapping.user_id
   and m.biometric_employee_code=p.biometric_employee_code
   and m.device_id in(p.device_id,'*')
  where p.attendance_date=v_punch.attendance_date;
  select * into v_attendance from public.attendance_logs
    where user_id=v_mapping.user_id and date=v_punch.attendance_date for update;
  if not found then
    insert into public.attendance_logs(
      user_id,date,checkin_time,checkin_source,status,attendance_state,
      attendance_status,day_status,attendance_type,
      biometric_first_punch,biometric_last_punch,biometric_punch_count,
      smartoffice_imported
    ) values(
      v_mapping.user_id,v_punch.attendance_date,v_punch.punch_timestamp,'BIOMETRIC',
      'CHECKED_IN','WORKING','PRESENT','P','BIOMETRIC',v_day_first,v_day_last,v_day_count,true
    ) returning * into v_attendance;
    v_created := true;
  else
    update public.attendance_logs set
      checkin_time=case when checkin_time is null and checkout_time is null then v_day_first else checkin_time end,
      checkin_source=case when checkin_time is null and checkout_time is null then 'BIOMETRIC' else checkin_source end,
      status=case when checkin_time is null and checkout_time is null then 'CHECKED_IN' else status end,
      attendance_state=case when checkin_time is null and checkout_time is null then 'WORKING' else attendance_state end,
      attendance_status=coalesce(attendance_status,'PRESENT'),
      day_status=coalesce(day_status,'P'),
      attendance_type=coalesce(attendance_type,'BIOMETRIC'),
      biometric_first_punch=least(coalesce(biometric_first_punch,v_day_first),v_day_first),
      biometric_last_punch=greatest(coalesce(biometric_last_punch,v_day_last),v_day_last),
      biometric_punch_count=greatest(biometric_punch_count,v_day_count),
      smartoffice_imported=true,
      updated_at=now()
    where id=v_attendance.id returning * into v_attendance;
  end if;

  update public.biometric_device_punches set
    processing_status=case when v_attendance.checkout_time is null then 'PROCESSED' else 'RECONCILIATION_REQUIRED' end,
    processed_at=now(),last_error=null
  where id=p_punch_id and punch_timestamp=p_punch_timestamp;
  if v_attendance.checkout_time is not null then
    insert into public.biometric_reconciliation_queue(
      punch_id,punch_timestamp,device_id,biometric_employee_code,reason,assigned_user_id
    ) values(p_punch_id,p_punch_timestamp,v_punch.device_id,v_punch.biometric_employee_code,
      'PUNCH_AFTER_GOING_HOME',v_mapping.user_id)
    on conflict(punch_id,punch_timestamp) do nothing;
  end if;
  insert into public.hrms_audit_events(
    target_user_id,action,entity_type,entity_id,new_values,source,device_id
  ) values(v_mapping.user_id,
    case when v_created then 'AUTOMATIC_BIOMETRIC_CHECKIN' else 'BIOMETRIC_PUNCH_PROCESSED' end,
    'attendance',v_attendance.id,
    jsonb_build_object('attendance_date',v_punch.attendance_date,'punch_timestamp',v_punch.punch_timestamp),
    'BIOMETRIC',v_punch.device_id);
  if v_created then
    begin
      insert into public.notifications(user_id,title,message,type,event_key)
      values(v_mapping.user_id,'Biometric check-in recorded',
        'Your first valid biometric punch was recorded as today''s attendance check-in.',
        'biometric_checkin','biometric-checkin:'||v_mapping.user_id||':'||v_punch.attendance_date)
      on conflict(event_key) where event_key is not null do nothing;
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('success',true,'created_attendance',v_created,
    'attendance_id',v_attendance.id,'attendance_state',v_attendance.attendance_state,
    'checkout_preserved',v_attendance.checkout_time is not null);
end $$;

create or replace function public.apply_biometric_daily_punches_v2(
  p_user_id uuid,p_attendance_date date,p_first_punch timestamptz,
  p_last_punch timestamptz,p_punch_count integer,p_checkout_punch timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_attendance public.attendance_logs%rowtype;v_created boolean:=false;
  v_checkin_updated boolean:=false;v_previous_checkin timestamptz;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_user_id is null or p_attendance_date is null or p_first_punch is null
     or p_last_punch is null or coalesce(p_punch_count,0)<1
     or p_last_punch<p_first_punch then raise exception 'INVALID_BIOMETRIC_DAILY_PUNCHES'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and is_active) then
    raise exception 'ACTIVE_MAPPED_EMPLOYEE_REQUIRED';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_attendance_date::text,0));
  select * into v_attendance from public.attendance_logs
    where user_id=p_user_id and date=p_attendance_date for update;
  if not found then
    insert into public.attendance_logs(
      user_id,date,checkin_time,checkin_source,checkout_time,status,
      attendance_state,attendance_status,day_status,attendance_type,
      smartoffice_imported,biometric_first_punch,biometric_last_punch,biometric_punch_count
    ) values(
      p_user_id,p_attendance_date,p_first_punch,'BIOMETRIC',null,'CHECKED_IN',
      'WORKING','PRESENT','P','BIOMETRIC',true,p_first_punch,p_last_punch,p_punch_count
    ) returning * into v_attendance;
    v_created:=true;v_checkin_updated:=true;
  else
    v_previous_checkin:=v_attendance.checkin_time;
    update public.attendance_logs set
      checkin_time=case when checkin_time is null and checkout_time is null then p_first_punch else checkin_time end,
      checkin_source=case when checkin_time is null and checkout_time is null then 'BIOMETRIC' else checkin_source end,
      status=case when checkin_time is null and checkout_time is null then 'CHECKED_IN' else status end,
      attendance_state=case
        when checkout_time is not null then 'CHECKED_OUT'
        when checkin_time is null then 'WORKING' else attendance_state end,
      attendance_status=coalesce(attendance_status,'PRESENT'),day_status=coalesce(day_status,'P'),
      attendance_type=coalesce(attendance_type,'BIOMETRIC'),smartoffice_imported=true,
      biometric_first_punch=least(coalesce(biometric_first_punch,p_first_punch),p_first_punch),
      biometric_last_punch=greatest(coalesce(biometric_last_punch,p_last_punch),p_last_punch),
      biometric_punch_count=greatest(biometric_punch_count,p_punch_count),updated_at=now()
    where id=v_attendance.id returning * into v_attendance;
    v_checkin_updated:=v_previous_checkin is null and v_attendance.checkin_time is not null;
  end if;
  if v_created or v_checkin_updated then
    insert into public.hrms_audit_events(target_user_id,action,entity_type,entity_id,new_values,source)
    values(p_user_id,'AUTOMATIC_BIOMETRIC_CHECKIN','attendance',v_attendance.id,
      jsonb_build_object('attendance_date',p_attendance_date,'checkin_time',v_attendance.checkin_time),'BIOMETRIC');
  end if;
  return jsonb_build_object('success',true,'attendance_id',v_attendance.id,
    'created',v_created,'checkin_updated',v_checkin_updated,
    'checkin_time',v_attendance.checkin_time,'checkout_time',v_attendance.checkout_time,
    'checked_out',false,'checkout_preserved',v_attendance.checkout_time is not null,
    'biometric_first_punch',v_attendance.biometric_first_punch,
    'biometric_last_punch',v_attendance.biometric_last_punch,
    'biometric_punch_count',v_attendance.biometric_punch_count);
end $$;
revoke all on function public.apply_biometric_daily_punches_v2(
  uuid,date,timestamptz,timestamptz,integer,timestamptz
) from public,anon,authenticated;
grant execute on function public.apply_biometric_daily_punches_v2(
  uuid,date,timestamptz,timestamptz,integer,timestamptz
) to service_role;

create or replace function public.ingest_biometric_punches(p_punches jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_item jsonb; v_id uuid; v_ts timestamptz; v_date date;
  v_inserted int:=0; v_duplicates int:=0; v_unmapped int:=0; v_result jsonb;
begin
  if jsonb_typeof(p_punches)<>'array' or jsonb_array_length(p_punches)>1000 then
    raise exception 'PUNCH_ARRAY_REQUIRED_MAX_1000';
  end if;
  for v_item in select value from jsonb_array_elements(p_punches) loop
    v_ts := (v_item->>'punch_timestamp')::timestamptz;
    v_date := (v_ts at time zone 'Asia/Kolkata')::date;
    insert into public.biometric_device_punches(
      device_id,biometric_employee_code,punch_timestamp,punch_direction,
      source_event_id,attendance_date
    ) values(
      btrim(v_item->>'device_id'),btrim(v_item->>'biometric_employee_code'),v_ts,
      nullif(v_item->>'punch_direction',''),coalesce(v_item->>'source_event_id',''),v_date
    ) on conflict(device_id,biometric_employee_code,punch_timestamp,source_event_id) do nothing
    returning id into v_id;
    if v_id is null then v_duplicates:=v_duplicates+1; continue; end if;
    v_inserted:=v_inserted+1;
    v_result:=public.process_biometric_punch(v_id,v_ts);
    if v_result->>'status'='UNMAPPED' then v_unmapped:=v_unmapped+1; end if;
    v_id:=null;
  end loop;
  return jsonb_build_object('success',true,'inserted',v_inserted,'duplicates',v_duplicates,
    'unmapped',v_unmapped,'transaction_status','COMMITTED');
end $$;
revoke all on function public.ingest_biometric_punches(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_biometric_punches(jsonb) to service_role;

create or replace function public.reprocess_unmatched_biometric_punches(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_row record;v_processed int:=0;v_result jsonb;
begin
  if auth.role()<>'service_role' and not public.is_profile_admin() then
    raise exception 'BIOMETRIC_RECONCILIATION_PERMISSION_REQUIRED';
  end if;
  for v_row in select id,punch_timestamp from public.biometric_device_punches
    where processing_status in('UNMAPPED','RECEIVED') order by punch_timestamp limit least(greatest(p_limit,1),1000)
  loop
    v_result:=public.process_biometric_punch(v_row.id,v_row.punch_timestamp);
    if v_result->>'status' is distinct from 'UNMAPPED' then v_processed:=v_processed+1; end if;
  end loop;
  update public.biometric_reconciliation_queue q set status='RESOLVED',resolved_by=auth.uid(),resolved_at=now()
  where status='OPEN' and exists(
    select 1 from public.biometric_device_punches p
    where p.id=q.punch_id and p.punch_timestamp=q.punch_timestamp and p.processing_status='PROCESSED');
  return jsonb_build_object('success',true,'processed',v_processed);
end $$;
revoke all on function public.reprocess_unmatched_biometric_punches(integer) from public,anon;
grant execute on function public.reprocess_unmatched_biometric_punches(integer) to authenticated,service_role;

-- -------------------------------------------------------------------------
-- Device sessions, geocoding cache, route summaries and adaptive storage
-- -------------------------------------------------------------------------

create table if not exists public.user_device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  device_identifier text not null,
  device_name text,
  platform text not null,
  app_version text,
  push_token text,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  is_active boolean not null default true,
  unique(user_id,device_identifier)
);
create index if not exists user_device_sessions_active_idx
  on public.user_device_sessions(user_id,last_active_at desc) where is_active;

create or replace function public.rpc_register_device_session(
  p_device_identifier text,p_device_name text,p_platform text,p_app_version text,p_push_token text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid(); v_row public.user_device_sessions%rowtype;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'EMPLOYEE_INACTIVE'; end if;
  insert into public.user_device_sessions(user_id,device_identifier,device_name,platform,app_version,push_token)
  values(v_uid,left(p_device_identifier,255),left(p_device_name,255),left(p_platform,30),left(p_app_version,40),p_push_token)
  on conflict(user_id,device_identifier) do update set
    device_name=excluded.device_name,platform=excluded.platform,app_version=excluded.app_version,
    push_token=coalesce(excluded.push_token,user_device_sessions.push_token),last_active_at=now(),is_active=true
  where user_device_sessions.revoked_at is null
  returning * into v_row;
  if not found then return jsonb_build_object('success',false,'error','DEVICE_SESSION_REVOKED'); end if;
  return jsonb_build_object('success',true,'session',to_jsonb(v_row)-'push_token');
end $$;
revoke all on function public.rpc_register_device_session(text,text,text,text,text) from public,anon;
grant execute on function public.rpc_register_device_session(text,text,text,text,text) to authenticated;

create or replace function public.rpc_revoke_device_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_target public.user_device_sessions%rowtype;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  select * into v_target from public.user_device_sessions where id=p_session_id for update;
  if not found then raise exception 'DEVICE_SESSION_NOT_FOUND'; end if;
  if v_target.user_id<>v_uid and not public.is_profile_admin() then raise exception 'DEVICE_SESSION_PERMISSION_REQUIRED'; end if;
  update public.user_device_sessions set is_active=false,revoked_at=coalesce(revoked_at,now()) where id=p_session_id;
  insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source,device_id)
  values(v_uid,v_target.user_id,'DEVICE_SESSION_REVOKED','device_session',p_session_id,
    jsonb_build_object('revoked_at',now()),'APP',v_target.device_identifier);
  return jsonb_build_object('success',true,'session_id',p_session_id,'revoked_at',now());
end $$;
revoke all on function public.rpc_revoke_device_session(uuid) from public,anon;
grant execute on function public.rpc_revoke_device_session(uuid) to authenticated;

create or replace function public.rpc_close_device_session(p_device_identifier text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_uid uuid:=auth.uid();v_count int;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  update public.user_device_sessions set is_active=false
  where user_id=v_uid and device_identifier=p_device_identifier and revoked_at is null;
  get diagnostics v_count=row_count;
  return jsonb_build_object('success',true,'closed',v_count);
end $$;
revoke all on function public.rpc_close_device_session(text) from public,anon;
grant execute on function public.rpc_close_device_session(text) to authenticated;

create table if not exists public.geocoding_cache (
  geohash text primary key,
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  formatted_address text not null,
  provider text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists geocoding_cache_expiry_idx on public.geocoding_cache(expires_at);

create table if not exists public.daily_route_summaries (
  user_id uuid not null references public.profiles(id) on delete restrict,
  route_date date not null,
  total_distance_metres double precision not null default 0,
  first_point jsonb,last_point jsonb,visit_transitions jsonb not null default '[]'::jsonb,
  geofence_events jsonb not null default '[]'::jsonb,raw_point_count integer not null default 0,
  generated_at timestamptz not null default now(),primary key(user_id,route_date)
);

do $$ declare v_postgis_schema text; begin
  select namespace.nspname into v_postgis_schema
  from pg_type type join pg_namespace namespace on namespace.oid=type.typnamespace
  where type.typname='geography' order by (namespace.nspname='extensions') desc limit 1;
  if v_postgis_schema is not null then
    execute format('alter table public.location_tracking add column if not exists location_point %I.geography(Point,4326)',v_postgis_schema);
    execute format('update public.location_tracking set location_point=%I.ST_SetSRID(%I.ST_MakePoint(longitude,latitude),4326)::%I.geography where location_point is null and latitude between -90 and 90 and longitude between -180 and 180',v_postgis_schema,v_postgis_schema,v_postgis_schema);
    execute 'create index if not exists location_tracking_point_gix on public.location_tracking using gist(location_point)';
  else
    execute 'alter table public.location_tracking add column if not exists location_point jsonb';
  end if;
exception when undefined_object then
  raise notice 'PostGIS geography column/index skipped.';
end $$;

create or replace function public.adaptive_location_storage_guard()
returns trigger language plpgsql set search_path=public,extensions,pg_temp as $$
declare v_previous public.location_tracking%rowtype; v_moved double precision;
begin
  if new.latitude is null or new.longitude is null or new.latitude not between -90 and 90
     or new.longitude not between -180 and 180 then return null; end if;
  if new.accuracy is null or new.accuracy<0 or new.accuracy>100 then return null; end if;
  select * into v_previous from public.location_tracking where user_id=new.user_id
    order by recorded_at desc limit 1;
  if found then
    if new.recorded_at<=v_previous.recorded_at then return null; end if;
    v_moved:=public.tracking_distance_metres(v_previous.latitude,v_previous.longitude,new.latitude,new.longitude);
    if new.recorded_at-v_previous.recorded_at<interval '30 seconds' and v_moved<50
       and new.field_visit_id is not distinct from v_previous.field_visit_id then return null; end if;
  end if;
  if to_regtype('geography') is not null then
    execute 'select ST_SetSRID(ST_MakePoint($1,$2),4326)::geography'
      into new.location_point using new.longitude,new.latitude;
  else
    new.location_point:=jsonb_build_object('type','Point','coordinates',jsonb_build_array(new.longitude,new.latitude));
  end if;
  return new;
end $$;
drop trigger if exists adaptive_location_storage_guard on public.location_tracking;
create trigger adaptive_location_storage_guard before insert on public.location_tracking
for each row execute function public.adaptive_location_storage_guard();

-- -------------------------------------------------------------------------
-- RLS and bounded maintenance
-- -------------------------------------------------------------------------

alter table public.attendance_action_requests enable row level security;
alter table public.hrms_audit_events enable row level security;
alter table public.employee_biometric_mappings enable row level security;
alter table public.biometric_device_punches enable row level security;
alter table public.biometric_reconciliation_queue enable row level security;
alter table public.user_device_sessions enable row level security;
alter table public.geocoding_cache enable row level security;
alter table public.daily_route_summaries enable row level security;

create policy attendance_action_requests_own_select on public.attendance_action_requests
  for select to authenticated using(user_id=auth.uid());
create policy device_sessions_own_select on public.user_device_sessions
  for select to authenticated using(user_id=auth.uid() or public.is_profile_admin());
create policy route_summaries_authorized_select on public.daily_route_summaries
  for select to authenticated using(user_id=auth.uid() or public.is_profile_admin() or exists(
    select 1 from public.profiles p where p.id=daily_route_summaries.user_id and p.reports_to=auth.uid()));
create policy hrms_audit_authorized_select on public.hrms_audit_events
  for select to authenticated using(target_user_id=auth.uid() or public.is_profile_admin() or exists(
    select 1 from public.profiles p where p.id=hrms_audit_events.target_user_id and p.reports_to=auth.uid()));
create policy biometric_mapping_admin_select on public.employee_biometric_mappings
  for select to authenticated using(public.is_profile_admin());
create policy biometric_punch_admin_select on public.biometric_device_punches
  for select to authenticated using(public.is_profile_admin());
create policy biometric_queue_admin_select on public.biometric_reconciliation_queue
  for select to authenticated using(public.is_profile_admin());

revoke insert,update,delete on public.attendance_action_requests,public.hrms_audit_events,
  public.employee_biometric_mappings,public.biometric_device_punches,
  public.biometric_reconciliation_queue from anon,authenticated;

create table if not exists public.retention_settings (
  setting_key text primary key,retention_days integer not null check(retention_days between 1 and 3650),
  updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id) on delete restrict
);
insert into public.retention_settings(setting_key,retention_days) values
  ('location_raw',90),('biometric_processed',180),('biometric_error_resolved',90),
  ('geocoding_cache',30),('notification_log',90)
on conflict(setting_key) do nothing;

create table if not exists public.maintenance_job_runs (
  id uuid primary key default gen_random_uuid(),job_name text not null,started_at timestamptz not null default now(),
  completed_at timestamptz,status text not null default 'RUNNING',rows_affected integer not null default 0,error_message text
);
create index if not exists maintenance_job_runs_name_time_idx
  on public.maintenance_job_runs(job_name,started_at desc);

create or replace function public.run_hrms_maintenance(
  p_batch_size integer default 5000,p_max_seconds integer default 20
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_started timestamptz:=clock_timestamp();v_run uuid;v_rows int:=0;v_total int:=0;
  v_location_days int;v_biometric_days int;v_error_days int;v_notification_days int;
begin
  insert into public.maintenance_job_runs(job_name) values('hrms_bounded_maintenance') returning id into v_run;
  perform public.ensure_biometric_month_partition(((now() at time zone 'Asia/Kolkata')::date+interval '1 month')::date);
  select retention_days into v_location_days from public.retention_settings where setting_key='location_raw';
  select retention_days into v_biometric_days from public.retention_settings where setting_key='biometric_processed';
  select retention_days into v_error_days from public.retention_settings where setting_key='biometric_error_resolved';
  select retention_days into v_notification_days from public.retention_settings where setting_key='notification_log';

  with target_days as (
    select user_id,date,min(recorded_at) as first_recorded_at
    from public.location_tracking where recorded_at<now()-make_interval(days=>v_location_days)
    group by user_id,date order by min(recorded_at) limit 50
  ), points as (
    select point.*,
      lag(latitude) over(partition by point.user_id,point.date order by recorded_at) as previous_latitude,
      lag(longitude) over(partition by point.user_id,point.date order by recorded_at) as previous_longitude
    from public.location_tracking point join target_days target
      on target.user_id=point.user_id and target.date=point.date
  )
  insert into public.daily_route_summaries(
    user_id,route_date,total_distance_metres,first_point,last_point,raw_point_count,generated_at
  )
  select user_id,date,
    coalesce(sum(case when previous_latitude is null then 0 else
      public.tracking_distance_metres(previous_latitude,previous_longitude,latitude,longitude) end),0),
    (array_agg(jsonb_build_object('latitude',latitude,'longitude',longitude,'recorded_at',recorded_at) order by recorded_at))[1],
    (array_agg(jsonb_build_object('latitude',latitude,'longitude',longitude,'recorded_at',recorded_at) order by recorded_at desc))[1],
    count(*),now()
  from points
  group by user_id,date
  on conflict(user_id,route_date) do update set total_distance_metres=excluded.total_distance_metres,
    first_point=excluded.first_point,last_point=excluded.last_point,
    raw_point_count=excluded.raw_point_count,generated_at=now();

  with doomed as (select point.ctid from public.location_tracking point
    join public.daily_route_summaries summary on summary.user_id=point.user_id and summary.route_date=point.date
    where point.recorded_at<now()-make_interval(days=>v_location_days)
    order by point.recorded_at limit p_batch_size)
  delete from public.location_tracking where ctid in(select ctid from doomed);
  get diagnostics v_rows=row_count;v_total:=v_total+v_rows;

  if extract(epoch from clock_timestamp()-v_started)<p_max_seconds then
    with doomed as (select id,punch_timestamp from public.biometric_device_punches
      where processing_status='PROCESSED' and punch_timestamp<now()-make_interval(days=>v_biometric_days)
      order by punch_timestamp limit p_batch_size)
    delete from public.biometric_device_punches p using doomed d
      where p.id=d.id and p.punch_timestamp=d.punch_timestamp;
    get diagnostics v_rows=row_count;v_total:=v_total+v_rows;
  end if;
  if extract(epoch from clock_timestamp()-v_started)<p_max_seconds then
    with doomed as (select geohash from public.geocoding_cache where expires_at<now() order by expires_at limit p_batch_size)
    delete from public.geocoding_cache where geohash in(select geohash from doomed);
    get diagnostics v_rows=row_count;v_total:=v_total+v_rows;
  end if;
  if extract(epoch from clock_timestamp()-v_started)<p_max_seconds then
    with doomed as (select id from public.biometric_reconciliation_queue
      where status in('RESOLVED','IGNORED') and resolved_at<now()-make_interval(days=>v_error_days)
      order by resolved_at limit p_batch_size)
    delete from public.biometric_reconciliation_queue where id in(select id from doomed);
    get diagnostics v_rows=row_count;v_total:=v_total+v_rows;
  end if;
  if extract(epoch from clock_timestamp()-v_started)<p_max_seconds then
    with doomed as (select id from public.notifications
      where created_at<now()-make_interval(days=>v_notification_days)
      order by created_at limit p_batch_size)
    delete from public.notifications where id in(select id from doomed);
    get diagnostics v_rows=row_count;v_total:=v_total+v_rows;
  end if;
  if extract(epoch from clock_timestamp()-v_started)<p_max_seconds then
    update public.field_visits set visit_state='CANCELLED',status='MISSED',journey_status='CANCELLED'
    where id in(select id from public.field_visits where visit_state in('TRAVELLING','ARRIVED','IN_PROGRESS')
      and date<(now() at time zone 'Asia/Kolkata')::date order by date limit p_batch_size);
    get diagnostics v_rows=row_count;v_total:=v_total+v_rows;
  end if;
  if extract(epoch from clock_timestamp()-v_started)<p_max_seconds then
    perform public.auto_checkout_attendance_end_of_day();
    update public.attendance_logs set attendance_state=case
      when checkout_time is not null then 'CHECKED_OUT'
      when checkin_time is not null and exists(select 1 from public.field_visits visit
        where visit.user_id=attendance_logs.user_id and visit.date=attendance_logs.date
          and visit.visit_state in('TRAVELLING','ARRIVED','IN_PROGRESS')) then 'ON_FIELD_VISIT'
      when checkin_time is not null then 'WORKING' else 'NOT_CHECKED_IN' end,
      updated_at=now()
    where date>=(now() at time zone 'Asia/Kolkata')::date-2
      and attendance_state is distinct from case
        when checkout_time is not null then 'CHECKED_OUT'
        when checkin_time is not null and exists(select 1 from public.field_visits visit
          where visit.user_id=attendance_logs.user_id and visit.date=attendance_logs.date
            and visit.visit_state in('TRAVELLING','ARRIVED','IN_PROGRESS')) then 'ON_FIELD_VISIT'
        when checkin_time is not null then 'WORKING' else 'NOT_CHECKED_IN' end;
    get diagnostics v_rows=row_count;v_total:=v_total+v_rows;
  end if;
  update public.maintenance_job_runs set completed_at=now(),status='SUCCESS',rows_affected=v_total where id=v_run;
  return jsonb_build_object('success',true,'rows_affected',v_total,'elapsed_seconds',extract(epoch from clock_timestamp()-v_started));
exception when others then
  update public.maintenance_job_runs set completed_at=now(),status='FAILED',error_message=left(sqlerrm,1000) where id=v_run;
  return jsonb_build_object('success',false,'error',sqlerrm);
end $$;
revoke all on function public.run_hrms_maintenance(integer,integer) from public,anon,authenticated;
grant execute on function public.run_hrms_maintenance(integer,integer) to service_role;

create or replace function public.run_hrms_statistics_maintenance()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run uuid;
begin
  insert into public.maintenance_job_runs(job_name) values('hrms_statistics_maintenance') returning id into v_run;
  execute 'analyze public.attendance_logs';
  execute 'analyze public.field_visits';
  execute 'analyze public.location_tracking';
  execute 'analyze public.biometric_device_punches';
  update public.maintenance_job_runs set completed_at=now(),status='SUCCESS' where id=v_run;
  return jsonb_build_object('success',true);
exception when others then
  update public.maintenance_job_runs set completed_at=now(),status='FAILED',error_message=left(sqlerrm,1000) where id=v_run;
  return jsonb_build_object('success',false,'error',sqlerrm);
end $$;
revoke all on function public.run_hrms_statistics_maintenance() from public,anon,authenticated;
grant execute on function public.run_hrms_statistics_maintenance() to service_role;

do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='hrms-bounded-maintenance';
    perform cron.unschedule(jobid) from cron.job where jobname='hrms-statistics-maintenance';
    perform cron.schedule('hrms-bounded-maintenance','17 * * * *',
      $job$select public.run_hrms_maintenance(5000,20);$job$);
    perform cron.schedule('hrms-statistics-maintenance','45 19 * * *',
      $job$select public.run_hrms_statistics_maintenance();$job$);
  end if;
exception when insufficient_privilege then
  raise notice 'pg_cron schedule requires project-owner privileges.';
end $$;

create or replace function public.rpc_get_release_contract()
returns jsonb language sql stable security definer set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'success',true,
    'backend_schema_version','20260803040000',
    'minimum_frontend_version','1.1.0',
    'attendance_checkin_rpc','rpc_attendance_checkin_v3',
    'attendance_checkout_rpc','rpc_attendance_checkout_reconciled',
    'attendance_state_contract','NOT_CHECKED_IN|WORKING|ON_FIELD_VISIT|CHECKED_OUT',
    'attendance_checkout_precedence','GOING_HOME_SERVER_CONFIRMED',
    'biometric_checkin_policy','FIRST_VALID_PUNCH_NO_AUTOMATIC_CHECKOUT',
    'biometric_ingest_rpc','ingest_biometric_punches',
    'field_visit_mutation_rpc','rpc_mutate_own_field_visit',
    'device_session_rpc','rpc_register_device_session',
    'edge_function_versions',jsonb_build_object(
      'biometric-attendance-sync','20260803.1',
      'otp-auth','20260731.1',
      'field-visit-evidence-upload','20260731.2',
      'smartoffice-proxy','20260801.1',
      'biometric-punch-webhook','20260803.1'
    )
  );
$$;
revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract() to anon,authenticated,service_role;

notify pgrst,'reload schema';
