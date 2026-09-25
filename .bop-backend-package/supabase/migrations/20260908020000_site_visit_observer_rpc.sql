-- Migration: 20260908020000_site_visit_observer_rpc.sql
-- Read-optimized RPC for the Site Visit Observer panel.
-- Returns all employees who had field visits on a given date, with their
-- current live location (if today) or historical summary (if past date).

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
  v_uid     uuid    := auth.uid();
  v_is_live boolean := (p_date = (now() at time zone 'Asia/Kolkata')::date);
begin
  -- Permission gate
  if not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'view_site_visit_observer'
  ) then
    return jsonb_build_object('error', 'PERMISSION_DENIED');
  end if;

  return jsonb_build_object(
    'is_live', v_is_live,
    'date',    p_date::text,
    'employees', (
      select jsonb_agg(emp_obj)
      from (
        select jsonb_build_object(
          'employee_id',     p.id,
          'name',            p.name,
          'employee_no',     p.employee_number,
          'role',            p.role,
          'latest_lat',      case when v_is_live then svl.latitude  end,
          'latest_lon',      case when v_is_live then svl.longitude end,
          'tracking_status', case when v_is_live then svl.tracking_status end,
          'updated_at',      case when v_is_live then svl.updated_at end,
          'visits', (
            select jsonb_agg(
              jsonb_build_object(
                'visit_id',       fv.id,
                'status',         fv.status,
                'location_name',  fv.location_name,
                'project_name',   fv.project_name,
                'checkin_time',   fv.checkin_time,
                'checkout_time',  fv.checkout_time,
                'visit_type',     fv.visit_type,
                'destination_lat', (fv.destination_coords->>'latitude')::float,
                'destination_lon', (fv.destination_coords->>'longitude')::float,
                'client_name',    fv.client_name
              ) order by fv.created_at
            )
            from public.field_visits fv
            where fv.user_id = p.id
              and fv.date = p_date
              and (p_visit_id is null or fv.id = p_visit_id)
              and coalesce(fv.verification_status, 'PENDING') <> 'REJECTED'
          )
        ) emp_obj
        from public.profiles p
        left join public.site_visit_live_locations svl on svl.user_id = p.id
        where p.is_active = true
          and (p_employee_id is null or p.id = p_employee_id)
          and exists (
            select 1 from public.field_visits fv2
            where fv2.user_id = p.id
              and fv2.date = p_date
              and coalesce(fv2.verification_status, 'PENDING') <> 'REJECTED'
          )
        order by p.name
      ) sub
    )
  );
end $$;

revoke all on function public.get_site_visit_observer_data(date, uuid, uuid) from public, anon;
grant execute on function public.get_site_visit_observer_data(date, uuid, uuid) to authenticated;
