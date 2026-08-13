-- Reusable event attendance:
--   * announces new events to every active employee
--   * permits event check-in only on the event's IST calendar date
--   * validates the venue geofence on the server
--   * credits Sunday Marketing attendees exactly once

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date date not null,
  start_time time not null,
  end_time time not null,
  address text not null,
  latitude double precision not null,
  longitude double precision not null,
  photo_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.event_checkins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  checkin_time timestamptz default now(),
  checkin_location jsonb,
  distance_metres integer,
  unique(event_id, user_id)
);

alter table public.events
  add column if not exists checkin_radius_m integer not null default 150,
  add column if not exists comp_off_enabled boolean not null default false,
  add column if not exists comp_off_team text not null default 'MARKETING',
  add column if not exists comp_off_days numeric(6,2) not null default 1;

alter table public.events drop constraint if exists events_checkin_radius_m_check;
alter table public.events add constraint events_checkin_radius_m_check
  check (checkin_radius_m between 25 and 1000);

alter table public.events drop constraint if exists events_comp_off_days_check;
alter table public.events add constraint events_comp_off_days_check
  check (comp_off_days > 0 and comp_off_days <= 5);

create index if not exists events_date_start_idx
  on public.events(event_date, start_time);

create table if not exists public.event_announcements (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  announced_at timestamptz not null default now(),
  primary key(event_id, user_id)
);

create table if not exists public.event_comp_off_credits (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  days numeric(6,2) not null,
  credited_at timestamptz not null default now(),
  primary key(event_id, user_id)
);

alter table public.events disable row level security;
alter table public.event_checkins disable row level security;
alter table public.event_announcements disable row level security;
alter table public.event_comp_off_credits disable row level security;

create or replace function public.announce_event_to_active_employees(
  p_event_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_count integer := 0;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then return 0; end if;

  with recipients as (
    insert into public.event_announcements(event_id, user_id)
    select v_event.id, p.id
    from public.profiles p
    where coalesce(p.is_active, true) = true
    on conflict(event_id, user_id) do nothing
    returning user_id
  )
  insert into public.notifications(user_id, title, message, type)
  select
    r.user_id,
    'New HRMS Event: ' || v_event.title,
    to_char(v_event.event_date, 'DD Mon YYYY') || ' | ' ||
      to_char(v_event.start_time, 'HH12:MI AM') || ' - ' ||
      to_char(v_event.end_time, 'HH12:MI AM') || ' | ' ||
      v_event.address,
    'event_announcement'
  from recipients r;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.announce_new_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.announce_event_to_active_employees(new.id);
  return new;
end $$;

drop trigger if exists announce_new_event_trg on public.events;
create trigger announce_new_event_trg
after insert on public.events
for each row execute function public.announce_new_event();

create or replace function public.event_distance_metres(
  p_latitude_1 double precision,
  p_longitude_1 double precision,
  p_latitude_2 double precision,
  p_longitude_2 double precision
) returns double precision
language sql
immutable
strict
as $$
  select 6371000 * 2 * asin(
    least(
      1,
      sqrt(
        power(sin(radians(p_latitude_2 - p_latitude_1) / 2), 2) +
        cos(radians(p_latitude_1)) * cos(radians(p_latitude_2)) *
        power(sin(radians(p_longitude_2 - p_longitude_1) / 2), 2)
      )
    )
  )
$$;

create or replace function public.rpc_event_check_in(
  p_event_id uuid,
  p_user_id uuid,
  p_latitude double precision,
  p_longitude double precision
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_distance integer;
  v_checked_now boolean := false;
  v_comp_off_credited boolean := false;
  v_rows integer := 0;
begin
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180
     or (p_latitude = 0 and p_longitude = 0) then
    return jsonb_build_object(
      'success', false,
      'message', 'A valid GPS location is required for event check-in.'
    );
  end if;

  select * into v_event
  from public.events
  where id = p_event_id;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Event not found.');
  end if;

  select * into v_profile
  from public.profiles
  where id = p_user_id and coalesce(is_active, true) = true;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Active employee profile not found.');
  end if;

  if v_event.event_date <> v_today then
    return jsonb_build_object(
      'success', false,
      'message', case
        when v_event.event_date > v_today
          then 'Event check-in will open on ' || to_char(v_event.event_date, 'DD Mon YYYY') || '.'
        else 'This event has already ended.'
      end
    );
  end if;

  v_distance := round(public.event_distance_metres(
    v_event.latitude,
    v_event.longitude,
    p_latitude,
    p_longitude
  ));

  if v_distance > v_event.checkin_radius_m then
    return jsonb_build_object(
      'success', false,
      'distance_metres', v_distance,
      'message', 'You are ' || v_distance || 'm from the event. Move within ' ||
        v_event.checkin_radius_m || 'm of the venue and try again.'
    );
  end if;

  insert into public.event_checkins(
    event_id,
    user_id,
    checkin_location,
    distance_metres
  ) values (
    v_event.id,
    v_profile.id,
    jsonb_build_object('latitude', p_latitude, 'longitude', p_longitude),
    v_distance
  )
  on conflict(event_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  v_checked_now := v_rows > 0;

  if v_event.comp_off_enabled
     and extract(isodow from v_event.event_date) = 7
     and (
       position(upper(v_event.comp_off_team) in upper(coalesce(v_profile.department, ''))) > 0
       or position(upper(v_event.comp_off_team) in upper(coalesce(v_profile.team, ''))) > 0
       or position(upper(v_event.comp_off_team) in upper(coalesce(v_profile.role, ''))) > 0
     ) then
    insert into public.event_comp_off_credits(event_id, user_id, days)
    values(v_event.id, v_profile.id, v_event.comp_off_days)
    on conflict(event_id, user_id) do nothing;
    get diagnostics v_rows = row_count;
    v_comp_off_credited := v_rows > 0;

    if v_comp_off_credited then
      insert into public.leave_balance(user_id, comp_off)
      values(v_profile.id, v_event.comp_off_days)
      on conflict(user_id) do update
      set comp_off = public.leave_balance.comp_off + excluded.comp_off,
          updated_at = now();

      if to_regclass('public.leave_application_audit') is not null then
        execute
          'insert into public.leave_application_audit(user_id, actor_id, action, days, notes)
           values($1, $2, $3, $4, $5)'
        using
          v_profile.id,
          v_event.created_by,
          'EVENT_COMP_OFF_GRANTED',
          v_event.comp_off_days,
          'Sunday event attendance: ' || v_event.title;
      end if;

      insert into public.notifications(user_id, title, message, type)
      values(
        v_profile.id,
        'Comp-Off Credited',
        v_event.comp_off_days || ' comp-off credited for attending ' || v_event.title || '.',
        'comp_off_credited'
      );
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'already_checked_in', not v_checked_now,
    'distance_metres', v_distance,
    'comp_off_credited', v_comp_off_credited,
    'message', case
      when not v_checked_now then 'You are already checked in to this event.'
      when v_comp_off_credited then 'Event check-in completed and comp-off credited.'
      else 'Event check-in completed.'
    end
  );
exception when others then
  return jsonb_build_object(
    'success', false,
    'message', 'Event check-in failed: ' || sqlerrm
  );
end $$;

revoke all on function public.rpc_event_check_in(
  uuid, uuid, double precision, double precision
) from public;
grant execute on function public.rpc_event_check_in(
  uuid, uuid, double precision, double precision
) to anon, authenticated;
