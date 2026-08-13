-- Pull SmartOffice punches on the server so attendance does not depend on an
-- HR/admin keeping the mobile app open.

create table if not exists public.biometric_sync_state (
  singleton boolean primary key default true check (singleton),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_status text not null default 'NEVER_RUN',
  last_error text,
  last_result jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.biometric_sync_state(singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.biometric_sync_state enable row level security;
revoke all on public.biometric_sync_state from anon, authenticated;

create or replace function public.claim_biometric_attendance_sync(
  minimum_interval_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  update public.biometric_sync_state
  set last_started_at = now(),
      last_status = 'RUNNING',
      last_error = null,
      updated_at = now()
  where singleton = true
    and (
      last_started_at is null
      or last_started_at < now() - make_interval(
        secs => greatest(minimum_interval_seconds, 30)
      )
    )
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_biometric_attendance_sync(integer)
  from public, anon, authenticated;
grant execute on function public.claim_biometric_attendance_sync(integer)
  to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'biometric-attendance-sync-every-2-minutes';

  perform cron.schedule(
    'biometric-attendance-sync-every-2-minutes',
    '*/2 * * * *',
    $job$
      select net.http_post(
        url := 'https://jidbrwpzfpbursihtvpg.supabase.co/functions/v1/biometric-attendance-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-biometric-sync-source', 'pg_cron'
        ),
        body := '{"source":"pg_cron"}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$
  );
end;
$$;
