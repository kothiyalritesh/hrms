-- =============================================================================
-- 20261023120000_employee_import_all_columns.sql
--
-- Employee bulk import saved only name, phone, role, office and team. The
-- template's email, employee_number, date_of_birth, gender, joining_date and
-- weekly_off columns were dropped (2026-10-23 check: "ignores joining date"),
-- and because rpc_admin_save_profile sets gender to MALE when none is given,
-- re-importing an existing employee reset their gender to MALE.
--
-- Now every template column is saved. For an existing employee a blank cell
-- keeps what is stored (email, employee number, gender, birth date, joining
-- date, weekly off); only filled cells change. joining_date in the file is the
-- real joining date (profiles.date_of_joining), never the reporting start.
-- An unreadable date or gender stops the import with the row number; nothing
-- is saved (the import is one transaction).
--
-- Replaces the body of the live function (rpc_admin_import_employee_profiles_v2,
-- or its __core behind the permission wrapper). Everything else is unchanged.
-- =============================================================================
BEGIN;

DO $mig$
DECLARE
  v_name text := CASE
    WHEN to_regprocedure('public.rpc_admin_import_employee_profiles_v2__core(uuid, jsonb)') IS NOT NULL
      THEN 'rpc_admin_import_employee_profiles_v2__core'
    ELSE 'rpc_admin_import_employee_profiles_v2' END;
BEGIN
  EXECUTE format($fn$
CREATE OR REPLACE FUNCTION public.%I(p_batch_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
declare
  v_actor uuid := auth.uid();
  v_actor_role text := public.require_profile_admin();
  v_payload_hash text := md5(p_rows::text);
  v_existing public.employee_import_batches%%rowtype;
  v_row jsonb;
  v_values jsonb;
  v_profile_id uuid;
  v_role_id uuid;
  v_office_id uuid;
  v_role_name text;
  v_phone text;
  v_gender text;
  v_date text;
  v_off integer;
  v_save_result jsonb;
  v_result jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_processed integer := 0;
begin
  if p_batch_id is null then
    raise exception 'IMPORT_BATCH_ID_REQUIRED';
  end if;
  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0
     or jsonb_array_length(p_rows) > 500 then
    raise exception 'INVALID_EMPLOYEE_IMPORT_BATCH';
  end if;

  insert into public.employee_import_batches(batch_id, actor_id, payload_hash, status)
  values (p_batch_id, v_actor, v_payload_hash, 'PROCESSING')
  on conflict (batch_id) do nothing;

  select * into v_existing
  from public.employee_import_batches
  where batch_id = p_batch_id
  for update;

  if v_existing.actor_id <> v_actor then
    raise exception 'IMPORT_BATCH_OWNER_MISMATCH';
  end if;
  if v_existing.payload_hash <> v_payload_hash then
    raise exception 'IMPORT_BATCH_PAYLOAD_MISMATCH';
  end if;
  if v_existing.status = 'COMPLETED' and v_existing.result is not null then
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  if exists (
    select 1
    from (select nullif(regexp_replace(value->>'phone', '\D', '', 'g'), '') phone
          from jsonb_array_elements(p_rows)) input
    where input.phone is not null
    group by input.phone
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_PHONE_IN_IMPORT';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if nullif(btrim(v_row->>'name'), '') is null then
      raise exception 'ROW_%%_NAME_REQUIRED', coalesce(v_row->>'row_number', '?');
    end if;

    v_phone := nullif(regexp_replace(v_row->>'phone', '\D', '', 'g'), '');
    if v_phone is null or length(v_phone) <> 10 then
      raise exception 'ROW_%%_VALID_PHONE_REQUIRED', coalesce(v_row->>'row_number', '?');
    end if;

    begin
      v_role_id := (v_row->>'role_id')::uuid;
      v_office_id := (v_row->>'office_id')::uuid;
    exception when others then
      raise exception 'ROW_%%_ROLE_AND_OFFICE_REQUIRED', coalesce(v_row->>'row_number', '?');
    end;

    select name into v_role_name from public.roles where id = v_role_id;
    if v_role_name is null then
      raise exception 'ROW_%%_INVALID_ROLE', coalesce(v_row->>'row_number', '?');
    end if;
    if upper(v_role_name) in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
      raise exception 'SYSTEM_ADMIN_BULK_IMPORT_PROHIBITED';
    end if;
    if not exists (select 1 from public.offices where id = v_office_id and coalesce(is_active, true)) then
      raise exception 'ROW_%%_INVALID_OR_INACTIVE_OFFICE', coalesce(v_row->>'row_number', '?');
    end if;

    -- Optional columns: blank = keep what is stored.
    v_gender := upper(nullif(btrim(v_row->>'gender'), ''));
    v_gender := case when v_gender in ('M', 'MALE') then 'MALE'
                     when v_gender in ('F', 'FEMALE') then 'FEMALE'
                     when v_gender is null then null
                     else 'INVALID' end;
    if v_gender = 'INVALID' then
      raise exception 'ROW_%%_INVALID_GENDER', coalesce(v_row->>'row_number', '?');
    end if;
    foreach v_date in array array['date_of_joining', 'date_of_birth'] loop
      begin
        perform (nullif(btrim(v_row->>v_date), ''))::date;
      exception when others then
        raise exception 'ROW_%%_INVALID_%%', coalesce(v_row->>'row_number', '?'), upper(v_date);
      end;
    end loop;
    v_off := null;
    if nullif(btrim(v_row->>'weekly_off_day'), '') is not null then
      begin
        v_off := (v_row->>'weekly_off_day')::integer;
      exception when others then
        v_off := -1;
      end;
      if v_off not between 0 and 6 then
        raise exception 'ROW_%%_INVALID_WEEKLY_OFF', coalesce(v_row->>'row_number', '?');
      end if;
    end if;

    select id into v_profile_id
    from public.profiles
    where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone
    order by created_at
    limit 1;

    if v_profile_id is not null
       and exists (select 1 from public.profiles
                   where id = v_profile_id
                     and upper(coalesce(role, '')) in ('SYSTEM_ADMIN', 'SUPER_ADMIN'))
       and v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
      raise exception 'SYSTEM_ADMIN_PERMISSION_REQUIRED';
    end if;

    v_values := jsonb_build_object(
      'name', btrim(v_row->>'name'),
      'phone', v_phone,
      'role', v_role_name,
      'role_id', v_role_id,
      'office_id', v_office_id,
      'team', nullif(btrim(v_row->>'team'), ''),
      'is_active', true
    );
    if v_profile_id is not null then
      -- save_profile overwrites these; keep the stored values unless the file has one.
      select v_values || jsonb_build_object('email', email, 'employee_number', employee_number, 'gender', gender)
      into v_values
      from public.profiles where id = v_profile_id;
    end if;
    v_values := v_values || jsonb_strip_nulls(jsonb_build_object(
      'email', nullif(btrim(v_row->>'email'), ''),
      'employee_number', nullif(btrim(v_row->>'employee_number'), ''),
      'gender', v_gender,
      'date_of_joining', nullif(btrim(v_row->>'date_of_joining'), ''),
      'date_of_birth', nullif(btrim(v_row->>'date_of_birth'), '')));

    v_save_result := public.rpc_admin_save_profile(v_profile_id, v_values);
    if coalesce((v_save_result->>'success')::boolean, false) is not true
       or nullif(v_save_result->>'profile_id', '') is null then
      raise exception 'ROW_%%_PROFILE_SAVE_NOT_CONFIRMED', coalesce(v_row->>'row_number', '?');
    end if;

    if v_off is not null then
      update public.profiles set weekly_off_day = v_off
      where id = (v_save_result->>'profile_id')::uuid and weekly_off_day is distinct from v_off;
    end if;

    if v_profile_id is null then
      v_inserted := v_inserted + 1;
    else
      v_updated := v_updated + 1;
    end if;
    v_processed := v_processed + 1;
  end loop;

  if v_processed <> jsonb_array_length(p_rows) then
    raise exception 'EMPLOYEE_IMPORT_COUNT_MISMATCH';
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'processed', v_processed,
    'inserted', v_inserted,
    'updated', v_updated,
    'replayed', false
  );

  update public.employee_import_batches
  set status = 'COMPLETED', result = v_result, updated_at = now()
  where batch_id = p_batch_id;

  return v_result;
end;
$body$;
$fn$, v_name);
END
$mig$;

NOTIFY pgrst, 'reload schema';

COMMIT;
