-- Migration: 20260908080000_rebuild_observer_rpc.sql
-- Restructured Site Visit Observer Query Architecture
-- field_visits -> profiles -> latest location -> visit summary
-- Incorporates 4-tier signal status, summary metrics, and scoped access control.

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
  v_mode        text := case when v_is_live then 'LIVE' else 'HISTORICAL' end;
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
      fv.checkin_time,
      fv.checkout_time,
      fv.visit_type,
      (fv.destination_coords->>'latitude')::double precision as dest_lat,
      (fv.destination_coords->>'longitude')::double precision as dest_lon,
      fv.client_name,
      fv.client_phone,
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
      -- Tracking determination
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
      svl.updated_at as ping_updated_at,
      -- Nested visits
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
          'updated_at',    ec.ping_updated_at
        ),
        'visits',          coalesce(ec.visits_json, '[]'::jsonb),
        -- Compatibility aliases
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
    'mode',      v_mode,
    'is_live',   v_is_live,
    'summary',   coalesce(v_summary, '{"total_visits": 0, "in_transit": 0, "at_site": 0, "completed": 0, "signal_lost": 0}'::jsonb),
    'employees', coalesce(v_employees, '[]'::jsonb)
  );
end $$;

revoke all on function public.get_site_visit_observer_data(date, uuid, uuid) from public, anon;
grant execute on function public.get_site_visit_observer_data(date, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

