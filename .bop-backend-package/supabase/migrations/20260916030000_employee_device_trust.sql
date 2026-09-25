-- Req 17 — Device Trust: Employee Device Binding Registry
-- Creates employee_device_bindings table and associated RPCs:
--   rpc_register_device_binding  — called on first login from new device
--   rpc_verify_device_trust      — called on attendance/check-in to verify device is trusted
--   rpc_admin_list_device_bindings — admin view of all registered devices
--   rpc_admin_revoke_device       — admin can revoke a device binding

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Create employee_device_bindings table
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.employee_device_bindings (
  binding_id          uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  device_fingerprint  text not null,           -- SHA-256 hash of device-stable identifiers
  device_name         text,                    -- human-readable (e.g. "Ritesh's Redmi Note 12")
  platform            text,                    -- "android" | "ios" | "web"
  app_version         text,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  is_trusted          boolean not null default true,
  revoked_at          timestamptz,
  revoked_by          uuid references public.profiles(id),
  revoke_reason       text,
  -- Quality flags observed from this device
  mock_location_count integer not null default 0,
  clock_drift_count   integer not null default 0,
  metadata            jsonb default '{}'::jsonb
);

-- Each user can only have one active binding per device fingerprint
create unique index if not exists employee_device_bindings_user_device_uniq
  on public.employee_device_bindings (user_id, device_fingerprint)
  where revoked_at is null;

create index if not exists employee_device_bindings_user_idx
  on public.employee_device_bindings (user_id);

create index if not exists employee_device_bindings_fingerprint_idx
  on public.employee_device_bindings (device_fingerprint);

-- RLS
alter table public.employee_device_bindings enable row level security;

-- Users can view their own device bindings
create policy device_bindings_self_read
  on public.employee_device_bindings for select
  to authenticated
  using (user_id = auth.uid());

-- Admins can view all bindings
create policy device_bindings_admin_read
  on public.employee_device_bindings for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and is_active = true
        and upper(coalesce(role, '')) in ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
    )
  );

-- No direct client writes — all mutations via security definer RPCs
revoke insert, update, delete on public.employee_device_bindings from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. rpc_register_device_binding — upsert device on login
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.rpc_register_device_binding(
  p_device_fingerprint text,
  p_device_name        text default null,
  p_platform           text default null,
  p_app_version        text default null,
  p_metadata           jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_binding_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  if nullif(btrim(p_device_fingerprint), '') is null then
    raise exception 'DEVICE_FINGERPRINT_REQUIRED';
  end if;

  -- Upsert: update last_seen_at and metadata if exists; insert if new
  insert into public.employee_device_bindings (
    user_id, device_fingerprint, device_name, platform, app_version, metadata
  ) values (
    v_user_id,
    btrim(p_device_fingerprint),
    nullif(btrim(coalesce(p_device_name, '')), ''),
    nullif(btrim(coalesce(p_platform, '')), ''),
    nullif(btrim(coalesce(p_app_version, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (user_id, device_fingerprint)
  where revoked_at is null
  do update set
    last_seen_at = now(),
    device_name  = coalesce(excluded.device_name, employee_device_bindings.device_name),
    app_version  = coalesce(excluded.app_version, employee_device_bindings.app_version),
    metadata     = employee_device_bindings.metadata || excluded.metadata
  returning binding_id into v_binding_id;

  if v_binding_id is null then
    -- Conflicted with a revoked binding — insert new active one
    insert into public.employee_device_bindings (
      user_id, device_fingerprint, device_name, platform, app_version, metadata
    ) values (
      v_user_id,
      btrim(p_device_fingerprint),
      nullif(btrim(coalesce(p_device_name, '')), ''),
      nullif(btrim(coalesce(p_platform, '')), ''),
      nullif(btrim(coalesce(p_app_version, '')), ''),
      coalesce(p_metadata, '{}'::jsonb)
    ) returning binding_id into v_binding_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'binding_id', v_binding_id,
    'is_trusted', true
  );
end;
$$;

revoke all on function public.rpc_register_device_binding(text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.rpc_register_device_binding(text, text, text, text, jsonb)
  to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. rpc_verify_device_trust — call before attendance mutation to check trust
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.rpc_verify_device_trust(
  p_device_fingerprint text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_binding record;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  select *
  into v_binding
  from public.employee_device_bindings
  where user_id = v_user_id
    and device_fingerprint = btrim(p_device_fingerprint)
    and revoked_at is null
  order by first_seen_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'is_trusted', false,
      'reason', 'DEVICE_NOT_REGISTERED'
    );
  end if;

  if not v_binding.is_trusted then
    return jsonb_build_object(
      'is_trusted', false,
      'reason', 'DEVICE_FLAGGED',
      'binding_id', v_binding.binding_id
    );
  end if;

  -- Update last_seen_at
  update public.employee_device_bindings
  set last_seen_at = now()
  where binding_id = v_binding.binding_id;

  return jsonb_build_object(
    'is_trusted', true,
    'binding_id', v_binding.binding_id,
    'first_seen_at', v_binding.first_seen_at,
    'mock_location_count', v_binding.mock_location_count,
    'clock_drift_count', v_binding.clock_drift_count
  );
end;
$$;

revoke all on function public.rpc_verify_device_trust(text) from public, anon;
grant execute on function public.rpc_verify_device_trust(text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. rpc_admin_revoke_device — admin revokes a specific device binding
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.rpc_admin_revoke_device(
  p_binding_id  uuid,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_actor_role text := public.require_profile_admin();
begin
  update public.employee_device_bindings
  set revoked_at  = now(),
      revoked_by  = auth.uid(),
      revoke_reason = p_reason,
      is_trusted  = false
  where binding_id = p_binding_id;

  if not found then raise exception 'DEVICE_BINDING_NOT_FOUND'; end if;

  return jsonb_build_object('success', true, 'binding_id', p_binding_id);
end;
$$;

revoke all on function public.rpc_admin_revoke_device(uuid, text) from public, anon;
grant execute on function public.rpc_admin_revoke_device(uuid, text) to authenticated;

