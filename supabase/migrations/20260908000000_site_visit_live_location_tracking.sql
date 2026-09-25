-- Migration: 20260908000000_site_visit_live_location_tracking.sql
-- Description: Live Location Tracking Strictly Scoped to Active Site Visits
-- Tables: site_visit_live_locations, site_visit_location_history
-- RPC: record_site_visit_location_batch
-- Retention: purge_expired_site_visit_location_history

create extension if not exists pgcrypto;

-- 1. Dedicated Live Location Hot-Table (Latest location per active visit)
create table if not exists public.site_visit_live_locations (
  field_visit_id uuid primary key references public.field_visits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  altitude_m double precision,
  heading double precision,
  speed_mps double precision,
  battery_level double precision,
  tracking_status text not null check (tracking_status in ('IN_TRANSIT', 'AT_SITE', 'STOPPED', 'GPS_LOST', 'LOW_ACCURACY')),
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_site_visit_live_user
  on public.site_visit_live_locations(user_id, updated_at desc);

-- 2. Dedicated Historical Breadcrumbs Table
create table if not exists public.site_visit_location_history (
  id uuid primary key default gen_random_uuid(),
  field_visit_id uuid not null references public.field_visits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_event_id uuid not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  altitude_m double precision,
  heading double precision,
  speed_mps double precision,
  mocked boolean not null default false,
  quality_status text not null default 'RELIABLE'
    check (quality_status in ('RELIABLE', 'LOW_ACCURACY', 'MOCKED', 'STALE', 'IMPOSSIBLE_SPEED')),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint site_visit_location_history_client_id_uniq unique(client_event_id)
);

create index if not exists idx_sv_loc_history_visit_time
  on public.site_visit_location_history(field_visit_id, recorded_at asc);
create index if not exists idx_sv_loc_history_user_date
  on public.site_visit_location_history(user_id, recorded_at desc);

-- 3. Row-Level Security
alter table public.site_visit_live_locations enable row level security;
alter table public.site_visit_location_history enable row level security;

-- Read policies: Authorized managers, Admins, HR or the user themselves
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

drop policy if exists sv_live_locations_select on public.site_visit_live_locations;
create policy sv_live_locations_select on public.site_visit_live_locations
  for select to authenticated
  using (public.can_view_tracking_user(user_id));

drop policy if exists sv_loc_history_select on public.site_visit_location_history;
create policy sv_loc_history_select on public.site_visit_location_history
  for select to authenticated
  using (public.can_view_tracking_user(user_id));

-- Direct client inserts/updates disabled; all mutations go through validated SECURITY DEFINER RPC

-- 4. Batched Location Ingestion RPC with Strict Active Visit Lifecycle Validation
create or replace function public.record_site_visit_location_batch(
  p_field_visit_id uuid,
  p_pings jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_visit public.field_visits%rowtype;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_item jsonb;
  v_lat double precision;
  v_lon double precision;
  v_acc double precision;
  v_speed double precision;
  v_heading double precision;
  v_alt double precision;
  v_mocked boolean;
  v_client_id uuid;
  v_recorded_at timestamptz;
  v_quality text;
  v_latest_lat double precision;
  v_latest_lon double precision;
  v_latest_acc double precision;
  v_latest_time timestamptz := '-infinity';
  v_latest_speed double precision;
  v_latest_heading double precision;
  v_latest_alt double precision;
  v_inserted_count int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'should_stop', true);
  end if;

  if p_field_visit_id is null then
    return jsonb_build_object('success', false, 'error', 'VISIT_ID_REQUIRED', 'should_stop', true);
  end if;

  -- Verify active site visit ownership and status
  select * into v_visit from public.field_visits
  where id = p_field_visit_id and user_id = v_uid;

  if not found then
    return jsonb_build_object('success', false, 'error', 'VISIT_NOT_FOUND', 'should_stop', true);
  end if;

  -- STRICT PRIVACY CHECK: Only allow tracking for active visits today
  if v_visit.date <> v_today or v_visit.status not in ('IN_TRANSIT', 'CHECKED_IN') then
    return jsonb_build_object(
      'success', false,
      'error', 'VISIT_NOT_ACTIVE',
      'visit_status', v_visit.status,
      'should_stop', true
    );
  end if;

  -- Process batch of pings
  if p_pings is not null and jsonb_typeof(p_pings) = 'array' then
    for v_item in select * from jsonb_array_elements(p_pings) loop
      v_client_id := coalesce(nullif(v_item->>'client_event_id', '')::uuid, gen_random_uuid());
      v_lat := nullif(v_item->>'latitude', '')::double precision;
      v_lon := nullif(v_item->>'longitude', '')::double precision;
      v_acc := nullif(v_item->>'accuracy', '')::double precision;
      v_alt := nullif(v_item->>'altitude', '')::double precision;
      v_speed := nullif(v_item->>'speed', '')::double precision;
      v_heading := nullif(v_item->>'heading', '')::double precision;
      v_mocked := coalesce((v_item->>'mocked')::boolean, false);
      v_recorded_at := coalesce(nullif(v_item->>'captured_at', '')::timestamptz, now());

      -- Validate coordinate bounds
      if v_lat is null or v_lon is null or v_lat not between -90 and 90 or v_lon not between -180 and 180 or (v_lat = 0 and v_lon = 0) then
        continue;
      end if;

      -- Assess Quality
      v_quality := 'RELIABLE';
      if v_mocked then
        v_quality := 'MOCKED';
      elsif v_acc is null or v_acc > 100 then
        v_quality := 'LOW_ACCURACY';
      elsif v_recorded_at < now() - interval '24 hours' or v_recorded_at > now() + interval '2 minutes' then
        v_quality := 'STALE';
      end if;

      -- Insert into historical breadcrumbs if not duplicate
      begin
        insert into public.site_visit_location_history(
          field_visit_id, user_id, client_event_id, latitude, longitude,
          accuracy_m, altitude_m, heading, speed_mps, mocked, quality_status, recorded_at
        ) values (
          v_visit.id, v_uid, v_client_id, v_lat, v_lon,
          v_acc, v_alt, v_heading, v_speed, v_mocked, v_quality, v_recorded_at
        );
        v_inserted_count := v_inserted_count + 1;
      exception when unique_violation then
        -- Duplicate client_event_id; safely ignore
      end;

      -- Track latest reading for live hot-table
      if v_recorded_at > v_latest_time and v_quality = 'RELIABLE' then
        v_latest_time := v_recorded_at;
        v_latest_lat := v_lat;
        v_latest_lon := v_lon;
        v_latest_acc := v_acc;
        v_latest_alt := v_alt;
        v_latest_speed := v_speed;
        v_latest_heading := v_heading;
      end if;
    end loop;
  end if;

  -- Upsert latest live location
  if v_latest_time > '-infinity' then
    insert into public.site_visit_live_locations (
      field_visit_id, user_id, latitude, longitude, accuracy_m,
      altitude_m, heading, speed_mps, tracking_status, recorded_at, updated_at
    ) values (
      v_visit.id, v_uid, v_latest_lat, v_latest_lon, v_latest_acc,
      v_latest_alt, v_latest_heading, v_latest_speed,
      case when v_visit.status = 'CHECKED_IN' then 'AT_SITE' else 'IN_TRANSIT' end,
      v_latest_time, now()
    )
    on conflict (field_visit_id) do update set
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy_m = excluded.accuracy_m,
      altitude_m = excluded.altitude_m,
      heading = excluded.heading,
      speed_mps = excluded.speed_mps,
      tracking_status = excluded.tracking_status,
      recorded_at = excluded.recorded_at,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'success', true,
    'inserted', v_inserted_count,
    'should_stop', false,
    'visit_status', v_visit.status
  );
end $$;

revoke all on function public.record_site_visit_location_batch(uuid, jsonb) from public, anon;
grant execute on function public.record_site_visit_location_batch(uuid, jsonb) to authenticated;

-- 5. Automatic Stop Trigger: Cleanup live location on visit completion or cancellation
create or replace function public.trg_cleanup_site_visit_live_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('COMPLETED', 'MISSED') and (old.status is null or old.status in ('IN_TRANSIT', 'CHECKED_IN', 'PENDING')) then
    delete from public.site_visit_live_locations where field_visit_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists cleanup_site_visit_live_location_trg on public.field_visits;
create trigger cleanup_site_visit_live_location_trg
after update of status on public.field_visits
for each row execute function public.trg_cleanup_site_visit_live_location();

-- 6. Scheduled Retention Cleanup Function (Retention window: default 60 days)
create or replace function public.purge_expired_site_visit_location_history(
  p_retention_days int default 60
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.site_visit_location_history
  where recorded_at < now() - (greatest(7, least(p_retention_days, 365)) || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.purge_expired_site_visit_location_history(int) from public, anon;
grant execute on function public.purge_expired_site_visit_location_history(int) to authenticated;

notify pgrst, 'reload schema';

