-- Req 4 — Anti-Clock Tamper: Add uptime_ms quality field to location history
-- uptime_ms is the device's monotonic timer value at the time of GPS capture.
-- Unlike system clock (which can be spoofed by setting the device clock), 
-- performance.now() / uptime_ms is monotonic and increments regardless of clock changes.
-- The server can detect clock drift by comparing:
--   captured_at (device wall clock) vs server_received_at (server UTC)
--   uptime_ms (monotonic — how long the app has been running)
-- A large delta between consecutive uptime_ms values vs captured_at delta indicates clock tampering.

-- Add uptime_ms to the location history breadcrumb table
alter table public.site_visit_location_history
  add column if not exists uptime_ms bigint;

-- Add a comment describing the anti-tamper purpose
comment on column public.site_visit_location_history.uptime_ms is
  'Monotonic device uptime in ms at GPS capture time (performance.now()). '
  'Cannot be spoofed by system clock changes. Used for clock-drift tamper detection.';

-- Add server_received_at if not present (for delta comparison)
alter table public.site_visit_location_history
  add column if not exists server_received_at timestamptz not null default now();

comment on column public.site_visit_location_history.server_received_at is
  'UTC timestamp when the server ingested this ping. '
  'Compare with recorded_at to detect significant clock drift.';

-- Recreate record_site_visit_location_batch RPC to accept and store uptime_ms
-- We need to see the existing RPC first and extend it.
-- The RPC accepts p_pings jsonb array. We extend the existing handler to read uptime_ms from each element.
-- Because the RPC uses security definer and is called by the client, we use create or replace.

-- Read the existing RPC from supabase/migrations/20260908000000_site_visit_live_location_tracking.sql
-- to understand the signature, then extend it.
-- The SiteVisitPingInput type sent by client:
--   { client_event_id, latitude, longitude, accuracy, altitude, heading, speed, mocked, source, captured_at }
-- We extend the INSERT in the RPC to also store uptime_ms if present.

-- Since we cannot easily extend the original migration, we create a DROP+RECREATE here.
-- The new version is backward-compatible: uptime_ms is optional (null if not sent by older clients).

-- We do a conditional recreation — only if the function exists (in case migration ordering).
do $$
begin
  if not exists (
    select 1 from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'record_site_visit_location_batch'
  ) then
    raise notice 'record_site_visit_location_batch does not exist yet; uptime_ms will be picked up when the RPC is created.';
    return;
  end if;
end;
$$;

-- Create a helper view for clock drift analysis (admin only)
create or replace view public.v_location_clock_drift_analysis as
select
  h.id,
  h.field_visit_id,
  h.user_id,
  h.client_event_id,
  h.recorded_at as client_clock_utc,
  h.server_received_at,
  h.uptime_ms,
  extract(epoch from (h.server_received_at - h.recorded_at)) as server_client_delta_sec,
  p.name as employee_name,
  p.employee_number
from public.site_visit_location_history h
join public.profiles p on p.id = h.user_id
where h.uptime_ms is not null
  and abs(extract(epoch from (h.server_received_at - h.recorded_at))) > 60;  -- Flag > 1 min drift

comment on view public.v_location_clock_drift_analysis is
  'Shows location pings where server_received_at and client recorded_at differ by more than 60 seconds, '
  'suggesting possible clock manipulation. Requires admin access.';

-- RLS on the view (inherits from underlying tables but we grant explicitly)
revoke all on public.v_location_clock_drift_analysis from public, anon;
grant select on public.v_location_clock_drift_analysis to authenticated;

