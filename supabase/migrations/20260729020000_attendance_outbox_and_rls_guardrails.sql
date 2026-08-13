-- Transactional attendance outbox plus fail-closed security guardrails.

create table if not exists public.app_outbox (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(aggregate_type, aggregate_id, event_type)
);

create index if not exists app_outbox_pending_idx
  on public.app_outbox(available_at, created_at)
  where status in ('PENDING', 'FAILED');

alter table public.app_outbox enable row level security;
revoke all on public.app_outbox from anon, authenticated;

create or replace function public.enqueue_attendance_outbox()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_type text;
begin
  if current_setting('app.suppress_attendance_outbox', true) = 'true' then
    return new;
  end if;

  if new.checkin_time is not null
     and (tg_op = 'INSERT' or old.checkin_time is null) then
    v_event_type := 'ATTENDANCE_CHECKED_IN';
  elsif new.checkout_time is not null
     and (tg_op = 'INSERT' or old.checkout_time is distinct from new.checkout_time) then
    v_event_type := 'ATTENDANCE_CHECKED_OUT';
  else
    return new;
  end if;

  insert into public.app_outbox(
    aggregate_type, aggregate_id, event_type, payload
  ) values (
    'ATTENDANCE', new.id, v_event_type,
    jsonb_build_object(
      'attendance_id', new.id,
      'user_id', new.user_id,
      'date', new.date,
      'checkin_time', new.checkin_time,
      'checkout_time', new.checkout_time,
      'status', new.status
    )
  )
  on conflict (aggregate_type, aggregate_id, event_type)
  do update set
    payload = excluded.payload,
    status = 'PENDING',
    available_at = now(),
    locked_at = null,
    completed_at = null,
    last_error = null;
  return new;
end;
$$;

drop trigger if exists attendance_outbox_trg on public.attendance_logs;
create trigger attendance_outbox_trg
after insert or update of checkin_time, checkout_time
on public.attendance_logs
for each row execute function public.enqueue_attendance_outbox();

create or replace function public.process_app_outbox_batch(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.app_outbox%rowtype;
  v_processed integer := 0;
  v_failed integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  for v_event in
    select *
    from public.app_outbox
    where status in ('PENDING', 'FAILED')
      and available_at <= now()
      and attempt_count < 10
    order by created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update skip locked
  loop
    begin
      update public.app_outbox
      set status = 'PROCESSING', locked_at = now(),
          attempt_count = attempt_count + 1
      where id = v_event.id;

      if v_event.event_type = 'ATTENDANCE_CHECKED_OUT' then
        update public.tracking_sessions
        set status = 'STOPPED',
            stopped_at = coalesce(stopped_at, now()),
            stop_reason = coalesce(stop_reason, 'ATTENDANCE_CHECKOUT'),
            native_task_active = false,
            updated_at = now()
        where attendance_log_id = v_event.aggregate_id
          and status = 'ACTIVE';

        insert into public.journey_events(
          tracking_session_id, attendance_log_id, user_id, event_type,
          occurred_at, metadata
        )
        select
          ts.id, ts.attendance_log_id, ts.user_id, 'COMPLETED',
          coalesce((v_event.payload->>'checkout_time')::timestamptz, now()),
          jsonb_build_object('source', 'ATTENDANCE_OUTBOX')
        from public.tracking_sessions ts
        where ts.attendance_log_id = v_event.aggregate_id
        order by ts.started_at desc
        limit 1
        on conflict do nothing;
      end if;

      update public.app_outbox
      set status = 'COMPLETED', completed_at = now(), last_error = null
      where id = v_event.id;
      v_processed := v_processed + 1;
    exception when others then
      update public.app_outbox
      set status = 'FAILED',
          last_error = left(sqlerrm, 1000),
          available_at = now() + make_interval(
            secs => least(3600, (power(2, attempt_count + 1) * 15)::integer)
          )
      where id = v_event.id;
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'success', true, 'processed', v_processed, 'failed', v_failed
  );
end;
$$;

revoke all on function public.process_app_outbox_batch(integer)
  from public, anon, authenticated;
grant execute on function public.process_app_outbox_batch(integer)
  to service_role;

do $$
begin
  if exists(select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'process-app-outbox-every-minute';
    perform cron.schedule(
      'process-app-outbox-every-minute',
      '* * * * *',
      'select public.process_app_outbox_batch(100)'
    );
  end if;
end
$$;

-- Remove anonymous access and require RLS on every table carrying identity,
-- attendance, location, credential, policy, or biometric information.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'attendance_logs', 'location_tracking',
    'attendance_fraud_events', 'attendance_audit_logs',
    'smartoffice_device_logs', 'leave_balance', 'roles', 'offices',
    'field_visits', 'field_visit_location_audit', 'notifications'
  ]
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('revoke all on table public.%I from anon', v_table);
    end if;
  end loop;
end
$$;

-- The old device-log insert/update policies were effectively public.
drop policy if exists "System can insert device logs"
  on public.smartoffice_device_logs;
drop policy if exists system_insert_device_logs
  on public.smartoffice_device_logs;
drop policy if exists system_update_device_logs
  on public.smartoffice_device_logs;
revoke insert, update, delete on public.smartoffice_device_logs
  from authenticated;

-- Credential records must never be browser-readable, even if the legacy
-- table still exists during deployment.
do $$
begin
  if to_regclass('public.user_credentials') is not null then
    alter table public.user_credentials enable row level security;
    revoke all on table public.user_credentials from anon, authenticated;
  end if;
end
$$;
