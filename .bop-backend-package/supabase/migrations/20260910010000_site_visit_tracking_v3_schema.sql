-- Migration: 20260910010000_site_visit_tracking_v3_schema.sql
-- Description: Site Visit Tracking v3 — Raw Location Retention, Orthogonal Tracking & GPS Quality, Server-Side Delayed Ingestion, and Visit Summary Intelligence

-- 1. Extend site_visit_live_locations with v3 telemetry columns
alter table if exists public.site_visit_live_locations
  add column if not exists source text default 'foreground' check (source in ('foreground', 'background', 'web')),
  add column if not exists last_location_at timestamptz,
  add column if not exists last_uploaded_at timestamptz default now(),
  add column if not exists pending_ping_count int default 0,
  add column if not exists gps_quality text default 'HIGH' check (gps_quality in ('HIGH', 'ACCEPTABLE', 'WEAK', 'INVALID'));

-- Backfill last_location_at if null
update public.site_visit_live_locations
set last_location_at = coalesce(last_location_at, recorded_at, updated_at)
where last_location_at is null;

-- 2. Extend site_visit_location_history with v3 columns
alter table if exists public.site_visit_location_history
  add column if not exists source text default 'foreground' check (source in ('foreground', 'background', 'web')),
  drop constraint if exists site_visit_location_history_quality_status_check;

alter table if exists public.site_visit_location_history
  add constraint site_visit_location_history_quality_status_check
  check (quality_status in ('RELIABLE', 'LOW_ACCURACY', 'REJECTED', 'MOCKED', 'STALE', 'IMPOSSIBLE_SPEED'));

-- 3. Dedicated Visit Summary Table (Derives enterprise analytics per visit)
create table if not exists public.site_visit_summaries (
  field_visit_id uuid primary key references public.field_visits(id) on delete cascade,
  duration_minutes int not null default 0,
  travel_distance_km numeric(8,2) not null default 0,
  onsite_distance_km numeric(8,2) not null default 0,
  first_arrival_at timestamptz,
  last_location_at timestamptz,
  gps_gaps_count int not null default 0,
  gps_quality_pct numeric(5,2) not null default 100,
  tracking_uptime_pct numeric(5,2) not null default 100,
  offline_minutes int not null default 0,
  total_breadcrumbs int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_site_visit_summaries_visit on public.site_visit_summaries(field_visit_id);

alter table public.site_visit_summaries enable row level security;

drop policy if exists sv_summaries_select on public.site_visit_summaries;
create policy sv_summaries_select on public.site_visit_summaries
  for select to authenticated
  using (
    exists (
      select 1 from public.field_visits fv
      where fv.id = site_visit_summaries.field_visit_id
        and (fv.user_id = auth.uid() or public.can_view_tracking_user(fv.user_id))
    )
  );

-- 4. Server-Side Validated Batch Ingestion RPC (v3)
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
  v_source text;
  v_client_id uuid;
  v_recorded_at timestamptz;
  v_quality text;
  v_gps_quality text;
  v_latest_lat double precision;
  v_latest_lon double precision;
  v_latest_acc double precision;
  v_latest_time timestamptz := '-infinity';
  v_latest_speed double precision;
  v_latest_heading double precision;
  v_latest_alt double precision;
  v_latest_source text := 'foreground';
  v_latest_gps_quality text := 'HIGH';
  v_inserted_count int := 0;
  v_is_delayed_sync boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'should_stop', true);
  end if;

  if p_field_visit_id is null then
    return jsonb_build_object('success', false, 'error', 'VISIT_ID_REQUIRED', 'should_stop', true);
  end if;

  -- 1. Verify visit ownership and existence
  select * into v_visit from public.field_visits
  where id = p_field_visit_id and user_id = v_uid;

  if not found then
    return jsonb_build_object('success', false, 'error', 'VISIT_NOT_FOUND', 'should_stop', true);
  end if;

  -- 2. Validate visit lifecycle
  -- If active today: normal live tracking
  -- If completed/missed: allow delayed offline sync only if pings were captured prior to checkout (+5m grace)
  if v_visit.status in ('COMPLETED', 'MISSED') then
    v_is_delayed_sync := true;
    -- Reject if sync occurs > 24 hours after completion
    if v_visit.updated_at < now() - interval '24 hours' then
      return jsonb_build_object('success', false, 'error', 'VISIT_SYNC_WINDOW_EXPIRED', 'should_stop', true);
    end if;
  elsif v_visit.date <> v_today or v_visit.status not in ('IN_TRANSIT', 'CHECKED_IN') then
    return jsonb_build_object(
      'success', false,
      'error', 'VISIT_NOT_ACTIVE',
      'visit_status', v_visit.status,
      'should_stop', true
    );
  end if;

  -- 3. Ingest Batch of Pings with Raw Retention & Quality Classification
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
      v_source := coalesce(nullif(v_item->>'source', ''), 'foreground');
      if v_source not in ('foreground', 'background', 'web') then
        v_source := 'foreground';
      end if;
      v_recorded_at := coalesce(nullif(v_item->>'captured_at', '')::timestamptz, now());

      -- For delayed offline sync on completed visit, reject points captured after checkout + 5min
      if v_is_delayed_sync and v_visit.checkout_time is not null and v_recorded_at > v_visit.checkout_time + interval '5 minutes' then
        continue;
      end if;

      -- Validate basic coordinate bounds
      if v_lat is null or v_lon is null or v_lat not between -90 and 90 or v_lon not between -180 and 180 or (v_lat = 0 and v_lon = 0) then
        continue;
      end if;

      -- Quality Classification (Raw Retention Principle: even REJECTED points are stored in history)
      v_quality := 'RELIABLE';
      v_gps_quality := 'HIGH';

      if v_mocked then
        v_quality := 'MOCKED';
        v_gps_quality := 'INVALID';
      elsif v_acc is null or v_acc > 100 then
        v_quality := 'REJECTED';
        v_gps_quality := 'INVALID';
      elsif v_acc > 50 then
        v_quality := 'LOW_ACCURACY';
        v_gps_quality := 'WEAK';
      elsif v_acc > 20 then
        v_quality := 'RELIABLE';
        v_gps_quality := 'ACCEPTABLE';
      else
        v_quality := 'RELIABLE';
        v_gps_quality := 'HIGH';
      end if;

      if v_recorded_at < now() - interval '24 hours' or v_recorded_at > now() + interval '5 minutes' then
        v_quality := 'STALE';
      end if;

      -- Insert into history (deduplicated by client_event_id)
      begin
        insert into public.site_visit_location_history(
          field_visit_id, user_id, client_event_id, latitude, longitude,
          accuracy_m, altitude_m, heading, speed_mps, mocked, source, quality_status, recorded_at
        ) values (
          v_visit.id, v_uid, v_client_id, v_lat, v_lon,
          v_acc, v_alt, v_heading, v_speed, v_mocked, v_source, v_quality, v_recorded_at
        );
        v_inserted_count := v_inserted_count + 1;
      exception when unique_violation then
        -- Idempotent deduplication: client_event_id already processed
      end;

      -- Track latest valid reading for live hot-table (skip mocked or invalid fixes)
      if not v_is_delayed_sync and v_recorded_at > v_latest_time and v_quality in ('RELIABLE', 'LOW_ACCURACY') then
        v_latest_time := v_recorded_at;
        v_latest_lat := v_lat;
        v_latest_lon := v_lon;
        v_latest_acc := v_acc;
        v_latest_alt := v_alt;
        v_latest_speed := v_speed;
        v_latest_heading := v_heading;
        v_latest_source := v_source;
        v_latest_gps_quality := v_gps_quality;
      end if;
    end loop;
  end if;

  -- 4. Upsert Live Hot-Table (Only if visit is currently active)
  if not v_is_delayed_sync and v_latest_time > '-infinity' then
    insert into public.site_visit_live_locations (
      field_visit_id, user_id, latitude, longitude, accuracy_m,
      altitude_m, heading, speed_mps, source, tracking_status,
      gps_quality, last_location_at, last_uploaded_at, recorded_at, updated_at
    ) values (
      v_visit.id, v_uid, v_latest_lat, v_latest_lon, v_latest_acc,
      v_latest_alt, v_latest_heading, v_latest_speed, v_latest_source,
      case when v_visit.status = 'CHECKED_IN' then 'AT_SITE' else 'IN_TRANSIT' end,
      v_latest_gps_quality, v_latest_time, now(), v_latest_time, now()
    )
    on conflict (field_visit_id) do update set
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy_m = excluded.accuracy_m,
      altitude_m = excluded.altitude_m,
      heading = excluded.heading,
      speed_mps = excluded.speed_mps,
      source = excluded.source,
      tracking_status = excluded.tracking_status,
      gps_quality = excluded.gps_quality,
      last_location_at = excluded.last_location_at,
      last_uploaded_at = now(),
      recorded_at = excluded.recorded_at,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'success', true,
    'inserted', v_inserted_count,
    'should_stop', v_is_delayed_sync,
    'visit_status', v_visit.status
  );
end $$;

revoke all on function public.record_site_visit_location_batch(uuid, jsonb) from public, anon;
grant execute on function public.record_site_visit_location_batch(uuid, jsonb) to authenticated;

-- 5. Enhanced get_site_visit_observer_data RPC (v3 with Orthogonal Health & GPS Quality)
create or replace function public.get_site_visit_observer_data(
  p_date        date,
  p_employee_id uuid default null,
  p_visit_id    uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_today       date := (now() at time zone 'Asia/Kolkata')::date;
  v_is_live     boolean := (p_date = v_today);
  v_is_admin    boolean := false;
  v_summary     jsonb;
  v_employees   jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'AUTHENTICATION_REQUIRED');
  end if;

  select exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) into v_is_admin;

  if not v_is_admin and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'view_site_visit_observer' and revoked_at is null
  ) then
    return jsonb_build_object('error', 'PERMISSION_DENIED');
  end if;

  -- Build Summary Counts
  with visits_universe as (
    select
      fv.id as visit_id,
      fv.user_id,
      fv.status as visit_status,
      svl.updated_at as last_ping_at
    from public.field_visits fv
    join public.profiles p on p.id = fv.user_id
    left join public.site_visit_live_locations svl on svl.user_id = fv.user_id
    where fv.date = p_date
      and coalesce(fv.verification_status, 'PENDING') <> 'REJECTED'
      and (p_employee_id is null or fv.user_id = p_employee_id)
      and (p_visit_id is null or fv.id = p_visit_id)
      and (v_is_admin or public.can_access_user_data(fv.user_id, 'view_site_visit_observer'))
  ),
  counts as (
    select
      count(*)::int as total_visits,
      count(*) filter (where visit_status = 'IN_TRANSIT')::int as in_transit,
      count(*) filter (where visit_status = 'CHECKED_IN')::int as at_site,
      count(*) filter (where visit_status in ('COMPLETED', 'MISSED'))::int as completed,
      count(distinct user_id) filter (
        where v_is_live
          and visit_status in ('IN_TRANSIT', 'CHECKED_IN')
          and (last_ping_at is null or last_ping_at < now() - interval '5 minutes')
      )::int as signal_lost
    from visits_universe
  )
  select jsonb_build_object(
    'total_visits', coalesce(c.total_visits, 0),
    'in_transit',   coalesce(c.in_transit, 0),
    'at_site',      coalesce(c.at_site, 0),
    'completed',    coalesce(c.completed, 0),
    'signal_lost',  coalesce(c.signal_lost, 0)
  ) into v_summary
  from counts c;

  -- Build Employee Cards with Orthogonal Health & GPS Quality
  with relevant_visits as (
    select
      fv.id as visit_id,
      fv.user_id,
      fv.status as visit_status,
      fv.location_name,
      fv.project_name,
      fv.checkin_time,
      fv.checkout_time,
      fv.visit_type,
      (fv.destination_coords->>'latitude')::double precision as dest_lat,
      (fv.destination_coords->>'longitude')::double precision as dest_lon,
      coalesce(fv.client_name, fv.contact_name) as client_name,
      coalesce(fv.client_phone, fv.contact_phone) as client_phone,
      fv.created_at
    from public.field_visits fv
    where fv.date = p_date
      and coalesce(fv.verification_status, 'PENDING') <> 'REJECTED'
      and (p_employee_id is null or fv.user_id = p_employee_id)
      and (p_visit_id is null or fv.id = p_visit_id)
      and (v_is_admin or public.can_access_user_data(fv.user_id, 'view_site_visit_observer'))
  ),
  distinct_employees as (
    select distinct user_id from relevant_visits
  ),
  employee_cards as (
    select
      p.id as employee_id,
      p.name,
      p.employee_number as employee_no,
      p.role,
      p.department,
      off.name as office_name,
      case
        when not v_is_live then 'COMPLETED'
        when has_active.val and (svl.updated_at is null or svl.updated_at < now() - interval '5 minutes') then 'SIGNAL_LOST'
        when svl.tracking_status = 'AT_SITE' then 'AT_SITE'
        when svl.tracking_status = 'IN_TRANSIT' then 'IN_TRANSIT'
        when has_active.val then 'IN_TRANSIT'
        else 'COMPLETED'
      end as computed_status,
      case
        when not v_is_live then 'COMPLETED'
        when svl.updated_at is null or svl.updated_at < now() - interval '5 minutes' then 'SIGNAL_LOST'
        when svl.updated_at < now() - interval '2 minutes' then 'DELAYED'
        else 'LIVE'
      end as computed_signal_status,
      -- Orthogonal Tracking Health Status
      case
        when not v_is_live then 'STALE'
        when svl.last_uploaded_at is null or svl.last_uploaded_at < now() - interval '60 seconds' then 'STALE'
        when svl.last_uploaded_at < now() - interval '15 seconds' then 'DELAYED'
        else 'ACTIVE'
      end as computed_tracking_health,
      -- Orthogonal GPS Quality
      coalesce(svl.gps_quality, 'HIGH') as computed_gps_quality,
      svl.latitude,
      svl.longitude,
      svl.accuracy_m,
      svl.battery_level,
      svl.speed_mps,
      svl.source,
      svl.last_location_at,
      svl.last_uploaded_at,
      coalesce(svl.pending_ping_count, 0) as pending_ping_count,
      svl.updated_at as ping_updated_at,
      (
        select jsonb_agg(
          jsonb_build_object(
            'visit_id',        rv.visit_id,
            'status',          rv.visit_status,
            'location_name',   rv.location_name,
            'project_name',    rv.project_name,
            'checkin_time',    rv.checkin_time,
            'checkout_time',   rv.checkout_time,
            'visit_type',      rv.visit_type,
            'destination_lat', rv.dest_lat,
            'destination_lon', rv.dest_lon,
            'client_name',     rv.client_name,
            'client_phone',    rv.client_phone
          ) order by rv.created_at asc
        )
        from relevant_visits rv
        where rv.user_id = p.id
      ) as visits_json
    from distinct_employees de
    join public.profiles p on p.id = de.user_id
    left join public.offices off on off.id = p.office_id
    left join public.site_visit_live_locations svl on svl.user_id = p.id and v_is_live
    cross join lateral (
      select exists (
        select 1 from relevant_visits v
        where v.user_id = p.id and v.visit_status in ('IN_TRANSIT', 'CHECKED_IN')
      ) as val
    ) has_active
    order by p.name asc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_id',     ec.employee_id,
        'name',            ec.name,
        'employee_no',     ec.employee_no,
        'role',            ec.role,
        'department',      ec.department,
        'office_name',     ec.office_name,
        'tracking', jsonb_build_object(
          'status',             ec.computed_status,
          'signal_status',      ec.computed_signal_status,
          'tracking_health',    ec.computed_tracking_health,
          'gps_quality',        ec.computed_gps_quality,
          'latitude',           ec.latitude,
          'longitude',          ec.longitude,
          'accuracy',           ec.accuracy_m,
          'battery_level',      ec.battery_level,
          'speed_mps',          ec.speed_mps,
          'source',             ec.source,
          'last_location_at',   ec.last_location_at,
          'last_uploaded_at',   ec.last_uploaded_at,
          'pending_ping_count', ec.pending_ping_count,
          'updated_at',         ec.ping_updated_at
        ),
        'visits',          coalesce(ec.visits_json, '[]'::jsonb),
        'latest_lat',      ec.latitude,
        'latest_lon',      ec.longitude,
        'tracking_status', ec.computed_status,
        'updated_at',      ec.ping_updated_at
      )
    ),
    '[]'::jsonb
  ) into v_employees
  from employee_cards ec;

  return jsonb_build_object(
    'date',      p_date::text,
    'mode',      case when v_is_live then 'LIVE' else 'HISTORICAL' end,
    'is_live',   v_is_live,
    'summary',   coalesce(v_summary, '{}'::jsonb),
    'employees', coalesce(v_employees, '[]'::jsonb)
  );
end $$;

revoke all on function public.get_site_visit_observer_data(date, uuid, uuid) from public, anon;
grant execute on function public.get_site_visit_observer_data(date, uuid, uuid) to authenticated;
