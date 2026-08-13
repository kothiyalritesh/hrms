-- Hierarchy changes must be confirmed by the server. Spreadsheet imports are
-- one idempotent transaction and never resolve employees by display name.

create table if not exists public.hierarchy_import_batches (
  batch_id uuid primary key,
  actor_id uuid not null,
  payload_hash text not null,
  status text not null check (status in ('PROCESSING', 'COMPLETED')),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.hierarchy_import_batches enable row level security;
revoke all on public.hierarchy_import_batches from public, anon, authenticated;

create or replace function public.rpc_admin_update_hierarchy_v2(p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  v_updated := public.rpc_admin_update_hierarchy(p_updates);
  if v_updated <> jsonb_array_length(p_updates) then
    raise exception 'HIERARCHY_UPDATE_COUNT_MISMATCH';
  end if;
  return jsonb_build_object(
    'success', true,
    'updated', v_updated
  );
end;
$$;

revoke all on function public.rpc_admin_update_hierarchy_v2(jsonb)
  from public, anon;
grant execute on function public.rpc_admin_update_hierarchy_v2(jsonb)
  to authenticated;

create or replace function public.rpc_admin_apply_hierarchy_import(
  p_batch_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_existing public.hierarchy_import_batches%rowtype;
  v_item jsonb;
  v_profile_id uuid;
  v_by_number uuid;
  v_by_email uuid;
  v_manager_id uuid;
  v_manager_by_number uuid;
  v_manager_by_email uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_processed integer;
  v_result jsonb;
begin
  perform public.require_profile_admin();
  if p_batch_id is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > 5000 then
    raise exception 'INVALID_HIERARCHY_IMPORT';
  end if;

  v_payload_hash := encode(
    digest(convert_to(p_rows::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.hierarchy_import_batches(
    batch_id, actor_id, payload_hash, status
  ) values (
    p_batch_id, v_actor, v_payload_hash, 'PROCESSING'
  )
  on conflict (batch_id) do nothing;

  select * into v_existing
  from public.hierarchy_import_batches
  where batch_id = p_batch_id
  for update;

  if v_existing.actor_id <> v_actor
     or v_existing.payload_hash <> v_payload_hash then
    raise exception 'HIERARCHY_BATCH_ID_CONFLICT';
  end if;
  if v_existing.status = 'COMPLETED' then
    return v_existing.result;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as row_data(
      name text,
      employee_number text,
      email text,
      manager_employee_number text,
      manager_email text
    )
    where nullif(btrim(name), '') is null
       or (
         nullif(btrim(employee_number), '') is null
         and nullif(lower(btrim(email)), '') is null
       )
  ) then
    raise exception 'HIERARCHY_EMPLOYEE_IDENTITY_REQUIRED';
  end if;

  if exists (
    select 1
    from (
      select lower(btrim(employee_number)) identity
      from jsonb_to_recordset(p_rows) as rows(employee_number text)
      where nullif(btrim(employee_number), '') is not null
      union all
      select lower(btrim(email))
      from jsonb_to_recordset(p_rows) as rows(email text)
      where nullif(btrim(email), '') is not null
    ) identities
    group by identity
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_HIERARCHY_IDENTITY';
  end if;

  -- Pass 1: resolve or create every employee. Both identifiers, when supplied,
  -- must resolve to the same profile.
  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_by_number := null;
    v_by_email := null;
    if nullif(btrim(v_item->>'employee_number'), '') is not null then
      select id into v_by_number
      from public.profiles
      where lower(btrim(employee_number)) =
        lower(btrim(v_item->>'employee_number'))
      limit 1;
    end if;
    if nullif(btrim(v_item->>'email'), '') is not null then
      select id into v_by_email
      from public.profiles
      where lower(btrim(email)) = lower(btrim(v_item->>'email'))
      limit 1;
    end if;
    if v_by_number is not null and v_by_email is not null
       and v_by_number <> v_by_email then
      raise exception 'HIERARCHY_IDENTITY_CONFLICT';
    end if;
    v_profile_id := coalesce(v_by_number, v_by_email);
    if v_profile_id is null then
      insert into public.profiles(
        name, employee_number, email, phone, role, team, is_active
      ) values (
        btrim(v_item->>'name'),
        nullif(btrim(v_item->>'employee_number'), ''),
        nullif(lower(btrim(v_item->>'email')), ''),
        nullif(regexp_replace(v_item->>'phone', '\D', '', 'g'), ''),
        coalesce(nullif(btrim(v_item->>'role'), ''), 'Agent'),
        nullif(btrim(v_item->>'team'), ''),
        true
      )
      returning id into v_profile_id;
      v_created := v_created + 1;
    elsif not exists (
      select 1 from public.profiles
      where id = v_profile_id and is_active = true
    ) then
      raise exception 'HIERARCHY_PROFILE_NOT_ACTIVE';
    end if;
  end loop;

  -- Pass 2: resolve manager identities only after every new profile exists.
  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_by_number := null;
    v_by_email := null;
    if nullif(btrim(v_item->>'employee_number'), '') is not null then
      select id into v_by_number from public.profiles
      where lower(btrim(employee_number)) =
        lower(btrim(v_item->>'employee_number')) limit 1;
    end if;
    if nullif(btrim(v_item->>'email'), '') is not null then
      select id into v_by_email from public.profiles
      where lower(btrim(email)) = lower(btrim(v_item->>'email')) limit 1;
    end if;
    v_profile_id := coalesce(v_by_number, v_by_email);

    v_manager_by_number := null;
    v_manager_by_email := null;
    if nullif(btrim(v_item->>'manager_employee_number'), '') is not null then
      select id into v_manager_by_number from public.profiles
      where lower(btrim(employee_number)) =
        lower(btrim(v_item->>'manager_employee_number')) limit 1;
      if v_manager_by_number is null then
        raise exception 'HIERARCHY_MANAGER_EMPLOYEE_NUMBER_NOT_FOUND';
      end if;
    end if;
    if nullif(btrim(v_item->>'manager_email'), '') is not null then
      select id into v_manager_by_email from public.profiles
      where lower(btrim(email)) =
        lower(btrim(v_item->>'manager_email')) limit 1;
      if v_manager_by_email is null then
        raise exception 'HIERARCHY_MANAGER_EMAIL_NOT_FOUND';
      end if;
    end if;
    if v_manager_by_number is not null and v_manager_by_email is not null
       and v_manager_by_number <> v_manager_by_email then
      raise exception 'HIERARCHY_MANAGER_IDENTITY_CONFLICT';
    end if;
    v_manager_id := coalesce(v_manager_by_number, v_manager_by_email);
    if v_manager_id = v_profile_id then
      raise exception 'HIERARCHY_SELF_REFERENCE';
    end if;

    update public.profiles
    set reports_to = v_manager_id,
        team = nullif(btrim(v_item->>'team'), ''),
        phone = coalesce(
          nullif(regexp_replace(v_item->>'phone', '\D', '', 'g'), ''),
          phone
        ),
        updated_at = now()
    where id = v_profile_id and is_active = true;
    if not found then raise exception 'ACTIVE_PROFILE_NOT_FOUND'; end if;
    v_updated := v_updated + 1;
  end loop;

  if exists (
    with recursive hierarchy as (
      select id, reports_to, array[id] path, reports_to = id cycle
      from public.profiles where reports_to is not null
      union all
      select h.id, p.reports_to, h.path || h.reports_to,
        h.reports_to = any(h.path)
      from hierarchy h
      join public.profiles p on p.id = h.reports_to
      where h.reports_to is not null and not h.cycle
    )
    select 1 from hierarchy where cycle
  ) then
    raise exception 'REPORTING_HIERARCHY_CYCLE';
  end if;

  v_processed := jsonb_array_length(p_rows);
  if v_updated <> v_processed then
    raise exception 'HIERARCHY_IMPORT_COUNT_MISMATCH';
  end if;
  v_result := jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'processed', v_processed,
    'created', v_created,
    'updated', v_updated
  );
  update public.hierarchy_import_batches
  set status = 'COMPLETED', result = v_result, completed_at = now()
  where batch_id = p_batch_id;
  return v_result;
end;
$$;

revoke all on function public.rpc_admin_apply_hierarchy_import(uuid, jsonb)
  from public, anon;
grant execute on function public.rpc_admin_apply_hierarchy_import(uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
