-- Retry-safe biometric sync requests, atomic SmartOffice profile refresh,
-- centralized redacted client diagnostics, and the matching release contract.

create table if not exists public.biometric_sync_requests (
  request_id uuid primary key,
  requested_by uuid references public.profiles(id) on delete set null,
  source text not null,
  from_date date not null,
  to_date date not null,
  status text not null check (status in ('PENDING', 'COMMITTED', 'FAILED')),
  response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_date <= to_date)
);

create index if not exists biometric_sync_requests_requested_idx
  on public.biometric_sync_requests(requested_by, created_at desc);

alter table public.biometric_sync_requests enable row level security;
revoke all on table public.biometric_sync_requests
  from public, anon, authenticated;
grant all on table public.biometric_sync_requests to service_role;

create table if not exists public.smartoffice_profile_sync_batches (
  batch_id uuid primary key,
  requested_by uuid not null references public.profiles(id),
  payload_hash text not null,
  submitted_count integer not null,
  updated_count integer not null default 0,
  status text not null check (status in ('COMMITTED')),
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists smartoffice_profile_sync_requester_idx
  on public.smartoffice_profile_sync_batches(requested_by, created_at desc);

alter table public.smartoffice_profile_sync_batches enable row level security;
revoke all on table public.smartoffice_profile_sync_batches
  from public, anon, authenticated;
grant all on table public.smartoffice_profile_sync_batches to service_role;

create or replace function public.rpc_admin_sync_smartoffice_profiles_batch(
  p_batch_id uuid,
  p_payload_hash text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.smartoffice_profile_sync_batches%rowtype;
  v_submitted integer;
  v_updated integer;
  v_result jsonb;
begin
  if v_actor is null or not public.is_hrms_admin(v_actor) then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;
  if p_batch_id is null
     or p_payload_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_SMARTOFFICE_SYNC_BATCH';
  end if;

  select * into v_existing
  from public.smartoffice_profile_sync_batches
  where batch_id = p_batch_id;
  if found then
    if v_existing.requested_by <> v_actor
       or v_existing.payload_hash <> p_payload_hash then
      raise exception 'SMARTOFFICE_SYNC_BATCH_CONFLICT';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_submitted := jsonb_array_length(p_rows);
  if v_submitted < 1 or v_submitted > 5000 then
    raise exception 'SMARTOFFICE_SYNC_ROW_LIMIT';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) row_value
    where nullif(btrim(row_value->>'employee_code'), '') is null
  ) or exists (
    select 1
    from jsonb_array_elements(p_rows) row_value
    group by lower(btrim(row_value->>'employee_code'))
    having count(*) > 1
  ) then
    raise exception 'SMARTOFFICE_SYNC_DUPLICATE_OR_BLANK_CODE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) row_value
    where (
      select count(*)
      from public.profiles p
      where p.is_active
        and lower(btrim(coalesce(p.smartoffice_employee_code, ''))) =
          lower(btrim(row_value->>'employee_code'))
    ) <> 1
  ) then
    raise exception 'SMARTOFFICE_SYNC_PROFILE_MAPPING_NOT_UNIQUE';
  end if;

  with input_rows as (
    select
      btrim(value->>'employee_code') as employee_code,
      nullif(btrim(value->>'name'), '') as name,
      nullif(lower(btrim(value->>'email')), '') as email,
      nullif(regexp_replace(value->>'phone', '\D', '', 'g'), '') as phone,
      nullif(btrim(value->>'smartoffice_department'), '') as department,
      nullif(btrim(value->>'smartoffice_designation'), '') as designation,
      nullif(btrim(value->>'smartoffice_grade'), '') as grade,
      nullif(btrim(value->>'smartoffice_location'), '') as location,
      nullif(btrim(value->>'smartoffice_company'), '') as company,
      nullif(btrim(value->>'smartoffice_team'), '') as team
    from jsonb_array_elements(p_rows)
  ),
  updated as (
    update public.profiles p
    set
      name = coalesce(i.name, p.name),
      email = coalesce(i.email, p.email),
      phone = coalesce(i.phone, p.phone),
      smartoffice_department = i.department,
      smartoffice_designation = i.designation,
      smartoffice_grade = i.grade,
      smartoffice_location = i.location,
      smartoffice_company = i.company,
      smartoffice_team = i.team,
      smartoffice_synced_at = now(),
      updated_at = now()
    from input_rows i
    where p.is_active
      and lower(btrim(p.smartoffice_employee_code)) =
        lower(btrim(i.employee_code))
    returning p.id
  )
  select count(*) into v_updated from updated;

  if v_updated <> v_submitted then
    raise exception 'SMARTOFFICE_SYNC_COUNT_MISMATCH';
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'transaction_status', 'COMMITTED',
    'batch_id', p_batch_id,
    'payload_hash', p_payload_hash,
    'submitted_count', v_submitted,
    'updated_count', v_updated,
    'rejected_count', 0,
    'idempotent_replay', false
  );
  insert into public.smartoffice_profile_sync_batches(
    batch_id, requested_by, payload_hash, submitted_count,
    updated_count, status, result
  ) values (
    p_batch_id, v_actor, p_payload_hash, v_submitted,
    v_updated, 'COMMITTED', v_result
  );
  return v_result;
end;
$$;

revoke all on function public.rpc_admin_sync_smartoffice_profiles_batch(
  uuid, text, jsonb
) from public, anon;
grant execute on function public.rpc_admin_sync_smartoffice_profiles_batch(
  uuid, text, jsonb
) to authenticated;

create table if not exists public.client_operational_errors (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  code text not null,
  build_id text not null,
  correlation_id uuid not null,
  client_platform text not null,
  created_at timestamptz not null default now()
);

create index if not exists client_operational_errors_support_idx
  on public.client_operational_errors(created_at desc, category);

alter table public.client_operational_errors enable row level security;
revoke all on table public.client_operational_errors
  from public, anon, authenticated;
grant all on table public.client_operational_errors to service_role;

create or replace function public.rpc_record_client_operational_error(
  p_category text,
  p_code text,
  p_build_id text,
  p_correlation_id uuid,
  p_client_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles where id = v_actor and is_active
  ) then
    raise exception 'AUTHENTICATED_ACTIVE_PROFILE_REQUIRED';
  end if;
  if p_correlation_id is null then
    raise exception 'CORRELATION_ID_REQUIRED';
  end if;
  insert into public.client_operational_errors(
    user_id, category, code, build_id, correlation_id, client_platform
  ) values (
    v_actor,
    left(coalesce(nullif(btrim(p_category), ''), 'UNKNOWN'), 80),
    left(coalesce(nullif(btrim(p_code), ''), 'UNKNOWN'), 80),
    left(coalesce(nullif(btrim(p_build_id), ''), 'UNKNOWN'), 80),
    p_correlation_id,
    left(coalesce(nullif(btrim(p_client_platform), ''), 'unknown'), 20)
  );
  return jsonb_build_object(
    'success', true,
    'correlation_id', p_correlation_id
  );
end;
$$;

revoke all on function public.rpc_record_client_operational_error(
  text, text, text, uuid, text
) from public, anon;
grant execute on function public.rpc_record_client_operational_error(
  text, text, text, uuid, text
) to authenticated;

create or replace function public.rpc_admin_recent_client_operational_errors(
  p_limit integer default 200
)
returns table (
  user_id uuid,
  employee_name text,
  category text,
  code text,
  build_id text,
  correlation_id uuid,
  client_platform text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_hrms_admin(auth.uid()) then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;
  return query
  select
    e.user_id, p.name, e.category, e.code, e.build_id,
    e.correlation_id, e.client_platform, e.created_at
  from public.client_operational_errors e
  join public.profiles p on p.id = e.user_id
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

revoke all on function public.rpc_admin_recent_client_operational_errors(integer)
  from public, anon;
grant execute on function public.rpc_admin_recent_client_operational_errors(integer)
  to authenticated;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260730230000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260731.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
