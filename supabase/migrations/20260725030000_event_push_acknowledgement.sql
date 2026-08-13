-- Event announcements are actionable application notifications:
--   * link each inbox row back to its event
--   * record an explicit "Got it" acknowledgement
--   * keep native push delivery idempotent per device
--   * invoke the event push function after future events are created

alter table public.event_announcements
  add column if not exists acknowledged_at timestamptz;

alter table public.notifications
  add column if not exists event_id uuid references public.events(id) on delete cascade,
  add column if not exists acknowledged_at timestamptz;

create index if not exists notifications_user_event_idx
  on public.notifications(user_id, event_id)
  where event_id is not null;

create table if not exists public.event_push_delivery_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  push_token_id uuid not null references public.device_push_tokens(id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  provider_ticket_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, push_token_id)
);

create index if not exists event_push_delivery_status_idx
  on public.event_push_delivery_log(status, updated_at);

alter table public.event_push_delivery_log enable row level security;

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
  insert into public.notifications(
    user_id,
    title,
    message,
    type,
    event_id,
    read
  )
  select
    r.user_id,
    'New HRMS Event: ' || v_event.title,
    to_char(v_event.event_date, 'DD Mon YYYY') || ' | ' ||
      to_char(v_event.start_time, 'HH12:MI AM') || ' - ' ||
      to_char(v_event.end_time, 'HH12:MI AM') || ' | ' ||
      v_event.address,
    'event_announcement',
    v_event.id,
    false
  from recipients r;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Link announcements created before this migration to their event.
update public.notifications n
set event_id = ea.event_id
from public.event_announcements ea
join public.events e on e.id = ea.event_id
where n.user_id = ea.user_id
  and n.event_id is null
  and n.type = 'event_announcement'
  and n.title = 'New HRMS Event: ' || e.title;

create or replace function public.rpc_acknowledge_event(
  p_event_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acknowledged_at timestamptz := now();
begin
  update public.event_announcements
  set acknowledged_at = coalesce(acknowledged_at, v_acknowledged_at)
  where event_id = p_event_id
    and user_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'Event announcement was not found for this employee.'
    );
  end if;

  update public.notifications
  set read = true,
      acknowledged_at = coalesce(acknowledged_at, v_acknowledged_at)
  where event_id = p_event_id
    and user_id = p_user_id;

  return jsonb_build_object(
    'success', true,
    'acknowledged_at', v_acknowledged_at
  );
end $$;

revoke all on function public.rpc_acknowledge_event(uuid, uuid) from public;
grant execute on function public.rpc_acknowledge_event(uuid, uuid)
  to anon, authenticated;

create extension if not exists pg_net with schema extensions;

create or replace function public.request_event_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://jidbrwpzfpbursihtvpg.supabase.co/functions/v1/send-event-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('eventId', new.id)
  );
  return new;
exception when others then
  -- An event must still be created even if the push provider is unavailable.
  raise warning 'Unable to enqueue event push for %: %', new.id, sqlerrm;
  return new;
end $$;

drop trigger if exists request_event_push_trg on public.events;
create trigger request_event_push_trg
after insert on public.events
for each row execute function public.request_event_push();

