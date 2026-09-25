-- A single trigger function previously served field_visits and
-- location_tracking. Its CASE expression referenced NEW.recorded_at as well as
-- NEW.checkin_time, but those columns do not coexist on either table. PostgreSQL
-- resolves NEW fields for the trigger row type before evaluating the selected
-- CASE branch, causing field-visit writes to fail with:
--   record "new" has no field "recorded_at"
--
-- Keep each trigger row type isolated so visit creation/check-in and location
-- tracking cannot invalidate one another.

create or replace function public.set_field_visit_business_date()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_event timestamptz;
begin
  v_event := coalesce(
    public.hrms_timestamp(new.checkin_time),
    public.hrms_timestamp(new.created_at),
    now()
  );
  new.date := (v_event at time zone 'Asia/Kolkata')::date;
  return new;
end
$$;

create or replace function public.set_location_tracking_business_date()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.date := (
    coalesce(public.hrms_timestamp(new.recorded_at), now())
    at time zone 'Asia/Kolkata'
  )::date;
  return new;
end
$$;

drop trigger if exists field_visits_business_date_trg
  on public.field_visits;
create trigger field_visits_business_date_trg
before insert or update of checkin_time on public.field_visits
for each row execute function public.set_field_visit_business_date();

drop trigger if exists location_tracking_business_date_trg
  on public.location_tracking;
create trigger location_tracking_business_date_trg
before insert or update of recorded_at on public.location_tracking
for each row execute function public.set_location_tracking_business_date();

-- The shared function has no callers after the trigger replacement. Removing it
-- prevents a future trigger from accidentally reintroducing the cross-table bug.
drop function if exists public.set_hrms_business_date();

comment on function public.set_field_visit_business_date() is
  'Assigns the field visit business date from check-in/creation time in Asia/Kolkata.';
comment on function public.set_location_tracking_business_date() is
  'Assigns the location tracking business date from recorded_at in Asia/Kolkata.';

