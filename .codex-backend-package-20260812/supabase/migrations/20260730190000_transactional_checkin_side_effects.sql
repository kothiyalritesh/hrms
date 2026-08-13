-- Keep automatic site creation and manager distance warnings in the same
-- database transaction as attendance check-in.
alter table public.field_visits
  add column if not exists auto_attendance_id uuid
    references public.attendance_logs(id) on delete restrict;

create unique index if not exists field_visits_auto_attendance_unique_idx
  on public.field_visits(auto_attendance_id)
  where auto_attendance_id is not null;

create or replace function public.rpc_attendance_checkin_v3(
  p_office_id uuid,
  p_location jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_attendance public.attendance_logs%rowtype;
  v_profile public.profiles%rowtype;
  v_office public.offices%rowtype;
  v_site public.predefined_sites%rowtype;
  v_site_distance double precision;
  v_office_distance double precision;
  v_lat double precision;
  v_lon double precision;
  v_accuracy double precision;
  v_visit_id uuid;
begin
  v_result := public.rpc_attendance_checkin_v2(p_office_id, p_location);
  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  v_lat := (p_location->>'latitude')::double precision;
  v_lon := (p_location->>'longitude')::double precision;
  v_accuracy := greatest(
    0, coalesce((p_location->>'accuracy')::double precision, 0)
  );

  select * into strict v_attendance
  from public.attendance_logs
  where user_id = v_uid
    and date = (now() at time zone 'Asia/Kolkata')::date
    and checkin_time is not null
  order by checkin_time
  limit 1;
  select * into strict v_profile from public.profiles where id = v_uid;
  select * into strict v_office from public.offices where id = p_office_id;
  v_office_distance := public.field_visit_distance_metres(
    v_office.latitude, v_office.longitude, v_lat, v_lon
  );

  if v_profile.reports_to is not null and v_office_distance > 50 then
    insert into public.notifications(user_id, title, message, type)
    select
      v_profile.reports_to,
      'Attendance Warning',
      format(
        '%s checked in %s m away from %s',
        v_profile.name, round(v_office_distance), v_office.name
      ),
      'attendance_warning'
    where not exists (
      select 1 from public.notifications notification
      where notification.user_id = v_profile.reports_to
        and notification.type = 'attendance_warning'
        and notification.message = format(
          '%s checked in %s m away from %s',
          v_profile.name, round(v_office_distance), v_office.name
        )
        and notification.created_at >= (
          date_trunc('day', now() at time zone 'Asia/Kolkata')
          at time zone 'Asia/Kolkata'
        )
    );
  end if;

  -- Resolve overlapping sites deterministically by selecting only the nearest.
  select site.* into v_site
  from public.predefined_sites site
  where site.is_active
    and site.latitude is not null
    and site.longitude is not null
    and site.checkin_radius_m is not null
    and public.field_visit_distance_metres(
      site.latitude, site.longitude, v_lat, v_lon
    ) + v_accuracy <= site.checkin_radius_m
  order by public.field_visit_distance_metres(
    site.latitude, site.longitude, v_lat, v_lon
  ), site.id
  limit 1;

  if found then
    v_site_distance := public.field_visit_distance_metres(
      v_site.latitude, v_site.longitude, v_lat, v_lon
    );
    insert into public.field_visits(
      user_id, predefined_site_id, visit_type, location_name,
      location_address, destination_coords, checkin_radius_m, project_name,
      notes, checkin_time, checkin_location, status, date, journey_status,
      auto_attendance_id
    ) values (
      v_uid, v_site.id, 'site', v_site.site_label,
      v_site.address,
      jsonb_build_object(
        'latitude', v_site.latitude, 'longitude', v_site.longitude
      ),
      v_site.checkin_radius_m, v_site.project_name,
      format(
        'Auto-detected during attendance check-in · %s m from site',
        round(v_site_distance)
      ),
      v_attendance.checkin_time,
      jsonb_build_object(
        'latitude', v_lat,
        'longitude', v_lon,
        'accuracy', v_accuracy,
        'captured_at', coalesce(
          p_location->>'capturedAt', p_location->>'captured_at'
        ),
        'provider', 'attendance-checkin'
      ),
      'CHECKED_IN', v_attendance.date, 'SITE_CHECKED_IN', v_attendance.id
    )
    on conflict (auto_attendance_id) where auto_attendance_id is not null
    do update set auto_attendance_id = excluded.auto_attendance_id
    returning id into v_visit_id;
  end if;

  return v_result || jsonb_build_object(
    'attendance_id', v_attendance.id,
    'automatic_site_visit_id', v_visit_id,
    'automatic_site_name',
      case when v_visit_id is null then null else v_site.site_label end,
    'automatic_site_distance_metres', v_site_distance,
    'side_effects_committed', true
  );
end;
$$;

revoke all on function public.rpc_attendance_checkin_v3(uuid, jsonb)
  from public, anon;
grant execute on function public.rpc_attendance_checkin_v3(uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
