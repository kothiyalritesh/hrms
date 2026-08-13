-- Attendance-bound native location tracking, journey events, and push tokens.
-- Additive and safe to re-run. No production rows are deleted.

create extension if not exists pgcrypto;

create table if not exists public.tracking_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  attendance_log_id uuid not null references public.attendance_logs(id) on delete cascade,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'STOPPED', 'INTERRUPTED')),
  start_reason text not null default 'HRMS_CHECKIN',
  stop_reason text,
  last_location_at timestamptz,
  last_accuracy_m double precision,
  native_task_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tracking_sessions_one_active_attendance_idx
  on public.tracking_sessions(attendance_log_id) where status = 'ACTIVE';
create index if not exists tracking_sessions_active_user_idx
  on public.tracking_sessions(user_id, started_at desc) where status = 'ACTIVE';

create table if not exists public.journey_events (
  id uuid primary key default gen_random_uuid(),
  tracking_session_id uuid references public.tracking_sessions(id) on delete set null,
  attendance_log_id uuid references public.attendance_logs(id) on delete cascade,
  field_visit_id uuid references public.field_visits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'JOURNEY_STARTED', 'ENTERED_1KM', 'ENTERED_500M', 'ARRIVED',
    'SITE_CHECKED_IN', 'DEPARTED', 'COMPLETED', 'GPS_OFF',
    'PERMISSION_REVOKED', 'LOCATION_STALE'
  )),
  distance_m double precision,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  occurred_at timestamptz not null,
  client_event_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists journey_events_visit_event_idx
  on public.journey_events(field_visit_id, event_type)
  where field_visit_id is not null;
create unique index if not exists journey_events_health_event_idx
  on public.journey_events(attendance_log_id, event_type)
  where field_visit_id is null and attendance_log_id is not null;
create unique index if not exists journey_events_client_event_idx
  on public.journey_events(client_event_id)
  where client_event_id is not null;
create index if not exists journey_events_user_time_idx
  on public.journey_events(user_id, occurred_at desc);

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('android', 'ios')),
  device_id text not null,
  app_version text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique(user_id, token)
);

create index if not exists device_push_tokens_active_user_idx
  on public.device_push_tokens(user_id) where active;

create table if not exists public.push_delivery_log (
  id uuid primary key default gen_random_uuid(),
  journey_event_id uuid not null references public.journey_events(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  push_token_id uuid not null references public.device_push_tokens(id) on delete cascade,
  status text not null check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  provider_ticket_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(journey_event_id, push_token_id)
);

alter table public.push_delivery_log
  drop constraint if exists push_delivery_log_status_check;
alter table public.push_delivery_log
  drop constraint if exists push_delivery_log_status_ck;
alter table public.push_delivery_log
  add constraint push_delivery_log_status_ck
  check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED')) not valid;

alter table public.location_tracking
  add column if not exists tracking_session_id uuid references public.tracking_sessions(id) on delete set null,
  add column if not exists field_visit_id uuid references public.field_visits(id) on delete set null,
  add column if not exists altitude double precision,
  add column if not exists heading double precision,
  add column if not exists speed double precision,
  add column if not exists mocked boolean not null default false,
  add column if not exists provider text,
  add column if not exists client_event_id uuid,
  add column if not exists sync_source text not null default 'NATIVE',
  add column if not exists quality_status text not null default 'RELIABLE',
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists source text;

create unique index if not exists location_tracking_client_event_idx
  on public.location_tracking(client_event_id)
  where client_event_id is not null;
create index if not exists location_tracking_user_recorded_idx
  on public.location_tracking(user_id, recorded_at desc);
create index if not exists location_tracking_session_recorded_idx
  on public.location_tracking(tracking_session_id, recorded_at desc);

alter table public.field_visits
  add column if not exists journey_status text not null default 'NO_DESTINATION',
  add column if not exists tracking_started_at timestamptz,
  add column if not exists approach_1km_notified_at timestamptz,
  add column if not exists approach_500m_notified_at timestamptz,
  add column if not exists arrived_at timestamptz,
  add column if not exists departed_at timestamptz,
  add column if not exists last_distance_m double precision,
  add column if not exists last_distance_at timestamptz,
  add column if not exists arrival_confirmation_count integer not null default 0,
  add column if not exists departure_confirmation_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'field_visits_journey_status_ck'
      and conrelid = 'public.field_visits'::regclass
  ) then
    alter table public.field_visits add constraint field_visits_journey_status_ck
      check (journey_status in (
        'NO_DESTINATION', 'TRAVELLING', 'APPROACHING_1KM',
        'APPROACHING_500M', 'ARRIVAL_PENDING_CONFIRMATION', 'ARRIVED',
        'SITE_CHECKED_IN', 'DEPARTED', 'COMPLETED', 'CANCELLED'
      )) not valid;
  end if;
end $$;

alter table public.location_alerts
  drop constraint if exists location_alerts_alert_type_check;
alter table public.location_alerts
  add constraint location_alerts_alert_type_check check (alert_type in (
    'GPS_OFF', 'OUT_OF_RANGE', 'NO_DATA', 'BACK_IN_RANGE', 'GPS_RESTORED',
    'PERMISSION_REVOKED', 'PRECISE_LOCATION_DISABLED', 'TASK_STOPPED'
  )) not valid;
create index if not exists location_alerts_unresolved_idx
  on public.location_alerts(user_id, alert_type, created_at desc)
  where resolved = false;
create index if not exists attendance_logs_open_user_idx
  on public.attendance_logs(user_id, checkin_time desc)
  where checkin_time is not null and checkout_time is null;

create or replace function public.can_view_tracking_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id = auth.uid()
    or exists (
      select 1
      from public.profiles employee
      where employee.id = p_user_id
        and employee.reports_to = auth.uid()
        and employee.is_active = true
    )
    or exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.is_active = true
        and upper(actor.role) in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    );
$$;

revoke all on function public.can_view_tracking_user(uuid) from public;
grant execute on function public.can_view_tracking_user(uuid) to authenticated;

alter table public.tracking_sessions enable row level security;
alter table public.journey_events enable row level security;
alter table public.device_push_tokens enable row level security;
alter table public.push_delivery_log enable row level security;
alter table public.location_tracking enable row level security;

drop policy if exists tracking_sessions_authorized_select on public.tracking_sessions;
create policy tracking_sessions_authorized_select
  on public.tracking_sessions for select to authenticated
  using (public.can_view_tracking_user(user_id));

drop policy if exists journey_events_authorized_select on public.journey_events;
create policy journey_events_authorized_select
  on public.journey_events for select to authenticated
  using (public.can_view_tracking_user(user_id));

drop policy if exists device_push_tokens_owner_select on public.device_push_tokens;
create policy device_push_tokens_owner_select
  on public.device_push_tokens for select to authenticated
  using (user_id = auth.uid());
drop policy if exists device_push_tokens_owner_insert on public.device_push_tokens;
create policy device_push_tokens_owner_insert
  on public.device_push_tokens for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists device_push_tokens_owner_update on public.device_push_tokens;
create policy device_push_tokens_owner_update
  on public.device_push_tokens for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists location_tracking_authorized_select on public.location_tracking;
create policy location_tracking_authorized_select
  on public.location_tracking for select to authenticated
  using (public.can_view_tracking_user(user_id));

-- No direct INSERT policy exists for location_tracking or journey_events.
-- Authenticated devices submit through the validated SECURITY DEFINER RPC.

create or replace function public.tracking_distance_metres(
  p_latitude_1 double precision,
  p_longitude_1 double precision,
  p_latitude_2 double precision,
  p_longitude_2 double precision
) returns double precision
language sql
immutable
strict
set search_path = public
as $$
  select 6371000 * 2 * asin(
    least(1, sqrt(
      power(sin(radians(p_latitude_2 - p_latitude_1) / 2), 2)
      + cos(radians(p_latitude_1))
      * cos(radians(p_latitude_2))
      * power(sin(radians(p_longitude_2 - p_longitude_1) / 2), 2)
    ))
  );
$$;

create or replace function public.ensure_tracking_session(
  p_attendance_log_id uuid,
  p_native_task_active boolean default false
) returns table(tracking_session_id uuid, tracking_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.tracking_sessions%rowtype;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not exists (
    select 1 from public.attendance_logs a
    where a.id = p_attendance_log_id
      and a.user_id = v_uid
      and a.checkin_time is not null
      and a.checkout_time is null
  ) then
    raise exception 'NO_OPEN_ATTENDANCE';
  end if;

  select * into v_session
  from public.tracking_sessions
  where attendance_log_id = p_attendance_log_id and status = 'ACTIVE'
  order by started_at desc limit 1 for update;

  if not found then
    begin
      insert into public.tracking_sessions(
        user_id, attendance_log_id, status, start_reason, native_task_active
      ) values (
        v_uid, p_attendance_log_id, 'ACTIVE', 'HRMS_CHECKIN',
        coalesce(p_native_task_active, false)
      ) returning * into v_session;
    exception when unique_violation then
      select * into v_session from public.tracking_sessions
      where attendance_log_id = p_attendance_log_id and status = 'ACTIVE'
      order by started_at desc limit 1;
    end;
  else
    update public.tracking_sessions
    set native_task_active = coalesce(p_native_task_active, native_task_active),
        updated_at = now()
    where id = v_session.id
    returning * into v_session;
  end if;

  return query select v_session.id, v_session.status;
end $$;

revoke all on function public.ensure_tracking_session(uuid, boolean) from public;
grant execute on function public.ensure_tracking_session(uuid, boolean) to authenticated;

create or replace function public.stop_tracking_session(
  p_attendance_log_id uuid,
  p_stop_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_stopped integer;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not exists (
    select 1 from public.attendance_logs
    where id = p_attendance_log_id and user_id = v_uid
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if exists (
    select 1 from public.attendance_logs
    where id = p_attendance_log_id and checkout_time is null
  ) then
    raise exception 'ATTENDANCE_STILL_OPEN';
  end if;

  update public.tracking_sessions
  set status = 'STOPPED', stopped_at = now(),
      stop_reason = left(coalesce(p_stop_reason, 'HRMS_CHECKOUT'), 120),
      native_task_active = false, updated_at = now()
  where attendance_log_id = p_attendance_log_id and status = 'ACTIVE';
  get diagnostics v_stopped = row_count;
  return v_stopped > 0;
end $$;

revoke all on function public.stop_tracking_session(uuid, text) from public;
grant execute on function public.stop_tracking_session(uuid, text) to authenticated;

create or replace function public.stop_tracking_after_authoritative_checkout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.checkout_time is null
     and new.checkout_time is not null
     and upper(coalesce(new.checkout_source, 'APP')) in ('APP', 'APP_EARLY', 'ADMIN') then
    update public.tracking_sessions
    set status = 'STOPPED', stopped_at = coalesce(new.checkout_time, now()),
        stop_reason = 'AUTHORITATIVE_' || upper(coalesce(new.checkout_source, 'APP')) || '_CHECKOUT',
        native_task_active = false, updated_at = now()
    where attendance_log_id = new.id and status = 'ACTIVE';
  end if;
  return new;
end $$;

drop trigger if exists stop_tracking_after_authoritative_checkout_trg
  on public.attendance_logs;
create trigger stop_tracking_after_authoritative_checkout_trg
after update of checkout_time on public.attendance_logs
for each row execute function public.stop_tracking_after_authoritative_checkout();

create or replace function public.record_location_ping(
  p_attendance_log_id uuid default null,
  p_tracking_session_id uuid default null,
  p_field_visit_id uuid default null,
  p_client_event_id uuid default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null,
  p_altitude_m double precision default null,
  p_heading double precision default null,
  p_speed_mps double precision default null,
  p_mocked boolean default false,
  p_recorded_at timestamptz default now(),
  p_provider text default 'expo-location',
  p_client_quality_status text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attendance public.attendance_logs%rowtype;
  v_session public.tracking_sessions%rowtype;
  v_visit public.field_visits%rowtype;
  v_previous_ping public.location_tracking%rowtype;
  v_latitude double precision;
  v_longitude double precision;
  v_distance double precision;
  v_previous_distance double precision;
  v_elapsed_seconds double precision;
  v_jump_distance double precision;
  v_quality text := 'RELIABLE';
  v_event text;
  v_should_notify boolean := false;
  v_arrival_radius double precision;
  v_rows integer;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_client_event_id is null then raise exception 'CLIENT_EVENT_ID_REQUIRED'; end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180
     or (p_latitude = 0 and p_longitude = 0) then
    raise exception 'INVALID_COORDINATES';
  end if;
  if p_recorded_at > now() + interval '1 minute'
     or p_recorded_at < now() - interval '24 hours' then
    raise exception 'INVALID_TIMESTAMP_SKEW';
  end if;

  if p_attendance_log_id is not null then
    select * into v_attendance from public.attendance_logs
    where id = p_attendance_log_id and user_id = v_uid
    for update;
  else
    select * into v_attendance from public.attendance_logs
    where user_id = v_uid
      and checkin_time is not null
      and checkout_time is null
    order by checkin_time desc limit 1 for update;
  end if;
  if not found or v_attendance.checkout_time is not null then
    return jsonb_build_object(
      'tracking_session_status', 'STOPPED',
      'health_warning', 'NO_OPEN_ATTENDANCE'
    );
  end if;

  select * into v_session from public.tracking_sessions
  where attendance_log_id = v_attendance.id and status = 'ACTIVE'
  order by started_at desc limit 1 for update;
  if not found then
    insert into public.tracking_sessions(
      user_id, attendance_log_id, status, start_reason, native_task_active
    ) values (
      v_uid, v_attendance.id, 'ACTIVE', 'FIRST_VALIDATED_PING', true
    ) returning * into v_session;
  end if;
  if p_tracking_session_id is not null and p_tracking_session_id <> v_session.id then
    raise exception 'TRACKING_SESSION_MISMATCH';
  end if;

  if exists (
    select 1 from public.location_tracking
    where client_event_id = p_client_event_id
  ) then
    return jsonb_build_object(
      'tracking_session_status', v_session.status,
      'journey_status', null,
      'event_generated', null,
      'should_notify_local', false,
      'duplicate', true
    );
  end if;

  select * into v_previous_ping
  from public.location_tracking
  where tracking_session_id = v_session.id
    and quality_status = 'RELIABLE'
  order by recorded_at desc limit 1;

  if coalesce(p_mocked, false) then
    v_quality := 'MOCKED';
  elsif p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > 100 then
    v_quality := 'LOW_ACCURACY';
  elsif p_recorded_at < now() - interval '5 minutes' then
    v_quality := 'STALE';
  elsif p_latitude not between 6.5 and 37.6 or p_longitude not between 68 and 97.5 then
    v_quality := 'OUTSIDE_ALLOWED_REGION';
  elsif v_previous_ping.id is not null then
    v_elapsed_seconds := extract(epoch from (p_recorded_at - v_previous_ping.recorded_at));
    if v_elapsed_seconds >= 5 then
      v_jump_distance := public.tracking_distance_metres(
        v_previous_ping.latitude, v_previous_ping.longitude,
        p_latitude, p_longitude
      );
      if v_jump_distance / v_elapsed_seconds > 70 then
        v_quality := 'IMPOSSIBLE_SPEED';
      end if;
    end if;
  end if;

  insert into public.location_tracking(
    user_id, tracking_session_id, field_visit_id, latitude, longitude,
    accuracy, altitude, heading, speed, mocked, provider, client_event_id,
    sync_source, quality_status, gps_available, status, recorded_at, date,
    source, received_at
  ) values (
    v_uid, v_session.id, p_field_visit_id, p_latitude, p_longitude,
    p_accuracy_m, p_altitude_m, p_heading, p_speed_mps, coalesce(p_mocked, false),
    left(p_provider, 80), p_client_event_id,
    case when p_provider ilike '%offline%' then 'OFFLINE_SYNC' else 'NATIVE' end,
    v_quality, true, 'GREEN', p_recorded_at,
    (p_recorded_at at time zone 'Asia/Kolkata')::date, 'app', now()
  );

  update public.tracking_sessions
  set last_location_at = greatest(coalesce(last_location_at, p_recorded_at), p_recorded_at),
      last_accuracy_m = case when p_recorded_at >= coalesce(last_location_at, '-infinity')
        then p_accuracy_m else last_accuracy_m end,
      native_task_active = true, updated_at = now()
  where id = v_session.id;

  if p_field_visit_id is not null then
    select * into v_visit from public.field_visits
    where id = p_field_visit_id and user_id = v_uid
      and status in ('PENDING', 'IN_TRANSIT', 'CHECKED_IN')
    for update;
  else
    select * into v_visit from public.field_visits
    where user_id = v_uid
      and status in ('PENDING', 'IN_TRANSIT', 'CHECKED_IN')
      and destination_coords is not null
    order by created_at desc limit 1 for update;
  end if;

  if v_visit.id is not null then
    begin
      v_latitude := coalesce(
        (v_visit.destination_coords->>'latitude')::double precision,
        (v_visit.destination_coords->>'lat')::double precision
      );
      v_longitude := coalesce(
        (v_visit.destination_coords->>'longitude')::double precision,
        (v_visit.destination_coords->>'lng')::double precision,
        (v_visit.destination_coords->>'lon')::double precision
      );
    exception when others then
      v_latitude := null;
      v_longitude := null;
    end;
  end if;

  if v_visit.id is not null and v_latitude is not null and v_longitude is not null then
    v_distance := public.tracking_distance_metres(
      p_latitude, p_longitude, v_latitude, v_longitude
    );
    v_previous_distance := v_visit.last_distance_m;
    v_arrival_radius := greatest(25, least(coalesce(v_visit.checkin_radius_m, 100), 1000));

    if v_quality = 'RELIABLE'
       and p_recorded_at >= coalesce(v_visit.last_distance_at, '-infinity') then
      if v_visit.last_distance_m is null then
        update public.field_visits set
          tracking_started_at = coalesce(tracking_started_at, p_recorded_at),
          journey_status = case
            when v_distance <= v_arrival_radius then 'ARRIVAL_PENDING_CONFIRMATION'
            when v_distance <= 500 then 'APPROACHING_500M'
            when v_distance <= 1000 then 'APPROACHING_1KM'
            else 'TRAVELLING' end,
          approach_1km_notified_at = case when v_distance <= 500
            then coalesce(approach_1km_notified_at, p_recorded_at)
            else approach_1km_notified_at end,
          approach_500m_notified_at = case when v_distance <= 500
            then coalesce(approach_500m_notified_at, p_recorded_at)
            else approach_500m_notified_at end
        where id = v_visit.id;
        if v_distance <= 500 and v_distance > v_arrival_radius then
          v_event := 'ENTERED_500M';
        elsif v_distance <= 1000 and v_distance > 500 then
          v_event := 'ENTERED_1KM';
        end if;
      elsif v_visit.approach_500m_notified_at is null
            and v_previous_distance > 600 and v_distance <= 500 then
        update public.field_visits set
          approach_1km_notified_at = coalesce(approach_1km_notified_at, p_recorded_at),
          approach_500m_notified_at = p_recorded_at,
          journey_status = 'APPROACHING_500M'
        where id = v_visit.id;
        v_event := 'ENTERED_500M';
      elsif v_visit.approach_1km_notified_at is null
            and v_previous_distance > 1100 and v_distance <= 1000 then
        update public.field_visits set
          approach_1km_notified_at = p_recorded_at,
          journey_status = 'APPROACHING_1KM'
        where id = v_visit.id;
        v_event := 'ENTERED_1KM';
      end if;

      if v_visit.arrived_at is null and v_distance <= v_arrival_radius
         and p_accuracy_m <= greatest(50, least(v_arrival_radius, 100)) then
        update public.field_visits set
          arrival_confirmation_count = arrival_confirmation_count + 1,
          departure_confirmation_count = 0,
          journey_status = 'ARRIVAL_PENDING_CONFIRMATION',
          approach_1km_notified_at = coalesce(approach_1km_notified_at, p_recorded_at),
          approach_500m_notified_at = coalesce(approach_500m_notified_at, p_recorded_at)
        where id = v_visit.id
        returning arrival_confirmation_count into v_rows;
        if v_rows >= 2 then
          update public.field_visits set
            arrived_at = p_recorded_at, journey_status = 'ARRIVED'
          where id = v_visit.id and arrived_at is null;
          v_event := 'ARRIVED';
        end if;
      elsif v_visit.arrived_at is null then
        update public.field_visits set arrival_confirmation_count = 0
        where id = v_visit.id;
      end if;

      if v_visit.arrived_at is not null and v_visit.departed_at is null
         and v_distance > v_arrival_radius + 100 then
        update public.field_visits set
          departure_confirmation_count = departure_confirmation_count + 1
        where id = v_visit.id
        returning departure_confirmation_count into v_rows;
        if v_rows >= 2 then
          update public.field_visits set
            departed_at = p_recorded_at, journey_status = 'DEPARTED'
          where id = v_visit.id and departed_at is null;
          v_event := 'DEPARTED';
        end if;
      elsif v_visit.arrived_at is not null and v_visit.departed_at is null then
        update public.field_visits set departure_confirmation_count = 0
        where id = v_visit.id;
      end if;

      update public.field_visits set
        last_distance_m = v_distance, last_distance_at = p_recorded_at
      where id = v_visit.id
        and p_recorded_at >= coalesce(last_distance_at, '-infinity');
    end if;

    if v_event is not null then
      insert into public.journey_events(
        tracking_session_id, attendance_log_id, field_visit_id, user_id,
        event_type, distance_m, latitude, longitude, accuracy_m,
        occurred_at, client_event_id, metadata
      ) values (
        v_session.id, v_attendance.id, v_visit.id, v_uid, v_event,
        v_distance, p_latitude, p_longitude, p_accuracy_m,
        p_recorded_at, p_client_event_id,
        jsonb_build_object('quality_status', v_quality)
      ) on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_should_notify := v_rows > 0 and v_event in ('ENTERED_1KM', 'ENTERED_500M', 'ARRIVED');
    end if;
  end if;

  return jsonb_build_object(
    'tracking_session_id', v_session.id,
    'tracking_session_status', v_session.status,
    'journey_status', case when v_visit.id is null then 'NO_DESTINATION'
      else (select journey_status from public.field_visits where id = v_visit.id) end,
    'distance_m', v_distance,
    'quality_status', v_quality,
    'event_generated', v_event,
    'should_notify_local', v_should_notify,
    'health_warning', case when v_quality = 'RELIABLE' then null else v_quality end,
    'duplicate', false
  );
end $$;

revoke all on function public.record_location_ping(
  uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision,
  boolean, timestamptz, text, text
) from public;
grant execute on function public.record_location_ping(
  uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision,
  boolean, timestamptz, text, text
) to authenticated;

create or replace function public.record_tracking_health_event(
  p_attendance_log_id uuid,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_alert_type text;
  v_inserted integer;
begin
  if v_uid is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_event_type not in ('GPS_OFF', 'PERMISSION_REVOKED', 'LOCATION_STALE') then
    raise exception 'INVALID_HEALTH_EVENT';
  end if;
  if not exists (
    select 1 from public.attendance_logs
    where id = p_attendance_log_id and user_id = v_uid
      and checkin_time is not null and checkout_time is null
  ) then
    return false;
  end if;
  select name into v_name from public.profiles where id = v_uid;
  insert into public.journey_events(
    attendance_log_id, user_id, event_type, occurred_at, metadata
  ) values (
    p_attendance_log_id, v_uid, p_event_type, now(), coalesce(p_metadata, '{}'::jsonb)
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;

  v_alert_type := case p_event_type
    when 'GPS_OFF' then 'GPS_OFF'
    when 'PERMISSION_REVOKED' then 'PERMISSION_REVOKED'
    else 'NO_DATA' end;
  if not exists (
    select 1 from public.location_alerts
    where user_id = v_uid and alert_type = v_alert_type and resolved = false
  ) then
    insert into public.location_alerts(user_id, alert_type, message)
    values (
      v_uid, v_alert_type,
      coalesce(v_name, 'Employee') || ' has an active-attendance location problem: ' || p_event_type
    );
  end if;
  insert into public.notifications(user_id, title, message, type)
  select distinct recipient_id,
    'Employee location needs attention',
    coalesce(v_name, 'Employee') || ' reported ' || replace(p_event_type, '_', ' ') ||
      ' during active attendance.',
    'location_alert'
  from (
    select reports_to as recipient_id from public.profiles where id = v_uid
    union
    select user_id from public.escalation_matrix
    where (p_event_type = 'GPS_OFF' and notify_gps_off)
       or (p_event_type = 'LOCATION_STALE' and notify_no_data)
  ) recipients
  where recipient_id is not null;
  return true;
end $$;

revoke all on function public.record_tracking_health_event(uuid, text, jsonb) from public;
grant execute on function public.record_tracking_health_event(uuid, text, jsonb) to authenticated;

create or replace function public.notify_manager_from_journey_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_name text;
  v_destination_name text;
  v_title text;
  v_message text;
begin
  if new.field_visit_id is null
     or new.event_type not in ('ENTERED_1KM', 'ENTERED_500M', 'ARRIVED') then
    return new;
  end if;
  select name into v_employee_name from public.profiles where id = new.user_id;
  select coalesce(project_name, location_name, 'the destination')
    into v_destination_name
  from public.field_visits where id = new.field_visit_id;
  v_title := case new.event_type
    when 'ARRIVED' then 'Employee arrived'
    else 'Employee approaching destination' end;
  v_message := coalesce(v_employee_name, 'Employee') ||
    case new.event_type
      when 'ENTERED_1KM' then ' is approximately 1 km from '
      when 'ENTERED_500M' then ' is approximately 500 m from '
      else ' arrived at ' end ||
    coalesce(v_destination_name, 'the destination') || '.';
  insert into public.notifications(user_id, title, message, type)
  select distinct recipient_id, v_title, v_message, 'journey_update'
  from (
    select reports_to as recipient_id from public.profiles where id = new.user_id
    union
    select user_id from public.escalation_matrix
  ) recipients
  where recipient_id is not null;
  return new;
end $$;

drop trigger if exists notify_manager_from_journey_event_trg
  on public.journey_events;
create trigger notify_manager_from_journey_event_trg
after insert on public.journey_events
for each row execute function public.notify_manager_from_journey_event();

grant select on public.tracking_sessions, public.journey_events,
  public.device_push_tokens, public.location_tracking to authenticated;
grant insert, update on public.device_push_tokens to authenticated;
