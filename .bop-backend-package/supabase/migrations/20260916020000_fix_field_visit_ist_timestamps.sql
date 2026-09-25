-- ==============================================================================
-- MIGRATION: 20260916020000_fix_field_visit_ist_timestamps.sql
-- Description: Ensures all field visit check-in and check-out timestamps are
-- consistently stored and retrieved in Indian Standard Time (IST / Asia/Kolkata).
-- ==============================================================================

begin;

-- 1. Attempt safe column conversion of checkin_time and checkout_time to timestamptz
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'field_visits'
      and column_name = 'checkin_time' and data_type = 'timestamp without time zone'
  ) then
    begin
      alter table public.field_visits
        alter column checkin_time type timestamptz using checkin_time at time zone 'UTC';
    exception when others then
      raise notice 'checkin_time alter column skipped due to dependency: %', sqlerrm;
    end;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'field_visits'
      and column_name = 'checkout_time' and data_type = 'timestamp without time zone'
  ) then
    begin
      alter table public.field_visits
        alter column checkout_time type timestamptz using checkout_time at time zone 'UTC';
    exception when others then
      raise notice 'checkout_time alter column skipped due to dependency: %', sqlerrm;
    end;
  end if;
end $$;

-- 2. Update generate_site_visit_report to strictly format times in Asia/Kolkata (IST)
create or replace function public.generate_site_visit_report(
  p_start_date date,
  p_end_date   date
)
returns table (
  employee_name         text,
  employee_no           text,
  department            text,
  branch                text,
  visit_date            date,
  day_of_week           text,
  check_in_time         text,
  check_out_time        text,
  project_name          text,
  client_name           text,
  client_phone          text,
  visit_type            text,
  visit_status          text,
  duration_minutes      int,
  distance_travelled_km double precision,
  tracking_status       text,
  gps_point_count       int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_is_admin    boolean := false;
  v_record_count int := 0;
begin
  -- 1. Authentication
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  -- 2. Date-Range Limit (Maximum 90 days)
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  if (p_end_date - p_start_date) > 90 then
    raise exception 'Please select a maximum 90-day range.';
  end if;

  -- 3. Permission Gate
  select exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN')
  ) into v_is_admin;

  if not v_is_admin and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'view_location_reports' and revoked_at is null
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  -- 4. Count for audit log
  select count(*) into v_record_count
  from public.field_visits fv
  where fv.date between p_start_date and p_end_date
    and (v_is_admin or public.can_access_user_data(fv.user_id, 'view_location_reports'));

  -- 5. Audit Log Entry
  if to_regprocedure('public.log_audit_event(text,text,uuid,jsonb,jsonb)') is not null then
    perform public.log_audit_event(
      'LOCATION_REPORT_EXPORTED',
      'field_visits',
      null,
      null,
      jsonb_build_object(
        'start_date', p_start_date,
        'end_date', p_end_date,
        'records_count', v_record_count
      )
    );
  end if;

  -- 6. Query and Return Rows with IST times
  return query
  select
    p.name as employee_name,
    p.employee_number as employee_no,
    p.department,
    coalesce(off.name, 'Main Office') as branch,
    fv.date as visit_date,
    to_char(fv.date, 'FMDay') as day_of_week,
    to_char(
      case
        when fv.checkin_time is null then null
        when pg_typeof(fv.checkin_time)::text = 'timestamp without time zone'
          then timezone('Asia/Kolkata', timezone('UTC', fv.checkin_time))
        else (fv.checkin_time at time zone 'Asia/Kolkata')
      end,
      'HH12:MI AM'
    ) as check_in_time,
    to_char(
      case
        when fv.checkout_time is null then null
        when pg_typeof(fv.checkout_time)::text = 'timestamp without time zone'
          then timezone('Asia/Kolkata', timezone('UTC', fv.checkout_time))
        else (fv.checkout_time at time zone 'Asia/Kolkata')
      end,
      'HH12:MI AM'
    ) as check_out_time,
    coalesce(fv.project_name, fv.location_name, 'Site') as project_name,
    coalesce(fv.client_name, fv.contact_name) as client_name,
    coalesce(fv.client_phone, fv.contact_phone) as client_phone,
    fv.visit_type,
    fv.status as visit_status,
    case
      when fv.checkout_time is not null and fv.checkin_time is not null
      then (extract(epoch from (fv.checkout_time - fv.checkin_time))::int / 60)
      else null
    end as duration_minutes,
    coalesce(round((fv.last_distance_m / 1000.0)::numeric, 2)::double precision, 0.0) as distance_travelled_km,
    coalesce(svl.tracking_status, 'COMPLETED') as tracking_status,
    coalesce(pts.cnt, 0)::int as gps_point_count
  from public.field_visits fv
  join public.profiles p on p.id = fv.user_id
  left join public.offices off on off.id = p.office_id
  left join public.site_visit_live_locations svl on svl.field_visit_id = fv.id
  left join lateral (
    select count(*)::int as cnt
    from public.site_visit_location_history hist
    where hist.field_visit_id = fv.id
  ) pts on true
  where fv.date between p_start_date and p_end_date
    and (v_is_admin or public.can_access_user_data(fv.user_id, 'view_location_reports'))
  order by fv.date desc, p.name asc, fv.created_at asc;
end $$;

revoke all on function public.generate_site_visit_report(date, date) from public, anon;
grant execute on function public.generate_site_visit_report(date, date) to authenticated;

-- 3. Update get_site_visit_observer_data to return explicit ISO 8601 IST timestamps
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
  -- 1. Authentication & Permission Gate
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

  -- 2. Build Summary Counts
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

  -- 3. Build Employee & Visit List
  with relevant_visits as (
    select
      fv.id as visit_id,
      fv.user_id,
      fv.status as visit_status,
      fv.location_name,
      fv.project_name,
      case
        when fv.checkin_time is null then null
        when pg_typeof(fv.checkin_time)::text = 'timestamp without time zone'
          then to_char(timezone('Asia/Kolkata', timezone('UTC', fv.checkin_time)), 'YYYY-MM-DD"T"HH24:MI:SS+05:30')
        else to_char(fv.checkin_time at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS+05:30')
      end as checkin_time,
      case
        when fv.checkout_time is null then null
        when pg_typeof(fv.checkout_time)::text = 'timestamp without time zone'
          then to_char(timezone('Asia/Kolkata', timezone('UTC', fv.checkout_time)), 'YYYY-MM-DD"T"HH24:MI:SS+05:30')
        else to_char(fv.checkout_time at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS+05:30')
      end as checkout_time,
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
      svl.latitude,
      svl.longitude,
      svl.accuracy_m,
      svl.battery_level,
      svl.speed_mps,
      svl.source,
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
          'status',        ec.computed_status,
          'signal_status', ec.computed_signal_status,
          'latitude',      ec.latitude,
          'longitude',     ec.longitude,
          'accuracy',      ec.accuracy_m,
          'battery_level', ec.battery_level,
          'speed_mps',     ec.speed_mps,
          'source',        ec.source,
          'updated_at',    ec.ping_updated_at
        ),
        'visits', coalesce(ec.visits_json, '[]'::jsonb)
      )
    ),
    '[]'::jsonb
  ) into v_employees
  from employee_cards ec;

  return jsonb_build_object(
    'summary',   v_summary,
    'employees', coalesce(v_employees, '[]'::jsonb),
    'date',      p_date,
    'is_live',   v_is_live
  );
end $$;

revoke all on function public.get_site_visit_observer_data(date, uuid, uuid) from public, anon;
grant execute on function public.get_site_visit_observer_data(date, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

