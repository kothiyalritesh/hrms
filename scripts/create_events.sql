-- Events table (created by ADMIN / HRD only)
create table if not exists events (
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
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- Event check-ins (one per user per event)
create table if not exists event_checkins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  checkin_time timestamptz default now(),
  checkin_location jsonb,
  distance_metres integer,
  unique(event_id, user_id)
);
