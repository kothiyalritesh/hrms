-- No mutation path may leave an active attendance office without a complete
-- geofence configuration.

create or replace function public.validate_active_office_geofence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_radius double precision;
begin
  if coalesce(new.is_active, true) then
    v_radius := coalesce(new.allowed_radius_meters, new.attendance_radius);
    if new.latitude is null
       or new.longitude is null
       or new.latitude = 0
       or new.longitude = 0
       or new.latitude not between -90 and 90
       or new.longitude not between -180 and 180
       or v_radius is null
       or v_radius not between 10 and 1000 then
      raise exception 'ACTIVE_OFFICE_REQUIRES_VALID_GEOFENCE';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_active_office_geofence_trigger
  on public.offices;
create trigger validate_active_office_geofence_trigger
before insert or update of
  is_active, latitude, longitude, attendance_radius, allowed_radius_meters
on public.offices
for each row execute function public.validate_active_office_geofence();

notify pgrst, 'reload schema';
