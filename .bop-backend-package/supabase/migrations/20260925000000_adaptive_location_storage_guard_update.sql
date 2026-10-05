-- Migration: Update adaptive location storage guard to deduplicate 15-minute pings
-- As per requirement: "Do not unnecessarily save the same location repeatedly in the database."

CREATE OR REPLACE FUNCTION public.adaptive_location_storage_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_previous public.location_tracking%rowtype;
  v_moved double precision;
BEGIN
  if new.latitude is null or new.longitude is null or new.latitude not between -90 and 90
     or new.longitude not between -180 and 180 then return null; end if;
  if new.accuracy is null or new.accuracy < 0 or new.accuracy > 100 then return null; end if;

  select * into v_previous from public.location_tracking where user_id = new.user_id
    order by recorded_at desc limit 1;

  if found then
    if new.recorded_at <= v_previous.recorded_at then return null; end if;
    v_moved := public.tracking_distance_metres(v_previous.latitude, v_previous.longitude, new.latitude, new.longitude);

    -- If moved less than 50m and it's been less than 60 minutes, do not save this ping.
    -- (The frontend sends pings every 15 minutes, this skips 3 duplicates and saves an hourly heartbeat)
    if new.recorded_at - v_previous.recorded_at < interval '60 minutes' and v_moved < 50
       and new.field_visit_id is not distinct from v_previous.field_visit_id then
      return null;
    end if;
  end if;

  if to_regtype('geography') is not null then
    execute 'select ST_SetSRID(ST_MakePoint(,),4326)::geography'
      into new.location_point using new.longitude, new.latitude;
  else
    new.location_point := jsonb_build_object('type','Point','coordinates',jsonb_build_array(new.longitude,new.latitude));
  end if;

  return new;
END
$$;
