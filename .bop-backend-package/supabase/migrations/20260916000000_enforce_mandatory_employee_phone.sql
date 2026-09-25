-- Migration: 20260916000000_enforce_mandatory_employee_phone.sql
-- Description: Consolidated HRMS Requirement 1 — Mandatory Employee Mobile Number, Indian Format Validation, Active Duplicate Check, Grandfathering for Legacy Profiles, and Audit Logging.

create or replace function public.rpc_admin_save_profile(
  p_profile_id uuid,
  p_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text := public.require_profile_admin();
  v_id uuid := p_profile_id;
  v_target_role text := upper(nullif(btrim(p_values->>'role'), ''));
  v_raw_phone text := p_values->>'phone';
  v_phone text := nullif(regexp_replace(coalesce(v_raw_phone, ''), '\D', '', 'g'), '');
  v_existing_phone text;
begin
  -- 1. Name is strictly required
  if nullif(btrim(p_values->>'name'), '') is null then
    raise exception 'PROFILE_NAME_REQUIRED';
  end if;

  -- 2. Privileged role assignment guards
  if v_target_role in ('SYSTEM_ADMIN', 'SUPER_ADMIN')
     and v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
    raise exception 'SYSTEM_ADMIN_PERMISSION_REQUIRED';
  end if;

  -- 3. Normalize 10-digit Indian Mobile Number
  if v_phone is not null then
    if length(v_phone) = 12 and left(v_phone, 2) = '91' then
      v_phone := right(v_phone, 10);
    elsif length(v_phone) = 11 and left(v_phone, 1) = '0' then
      v_phone := right(v_phone, 10);
    end if;
  end if;

  -- 4. INSERT Branch (New Employee Creation)
  if v_id is null then
    -- Mobile Number is mandatory for new employees
    if v_phone is null then
      raise exception 'PHONE_REQUIRED: Mobile number is mandatory when creating an employee.';
    end if;

    -- Validate Indian Mobile Format: exactly 10 digits starting with 6, 7, 8, or 9
    if v_phone !~ '^[6-9][0-9]{9}$' then
      raise exception 'INVALID_INDIAN_MOBILE_NUMBER: Please provide a valid 10-digit Indian mobile number.';
    end if;

    -- Prevent duplicate mobile numbers among active employees
    if exists (
      select 1 from public.profiles
      where is_active = true
        and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_phone
    ) then
      raise exception 'DUPLICATE_MOBILE_NUMBER: An active employee with this mobile number already exists.';
    end if;

    insert into public.profiles(
      name, email, phone, employee_number, role, role_id, office_id, team,
      is_active
    ) values (
      btrim(p_values->>'name'),
      nullif(btrim(p_values->>'email'), ''),
      v_phone,
      nullif(btrim(p_values->>'employee_number'), ''),
      nullif(btrim(p_values->>'role'), ''),
      nullif(p_values->>'role_id', '')::uuid,
      nullif(p_values->>'office_id', '')::uuid,
      nullif(btrim(p_values->>'team'), ''),
      coalesce((p_values->>'is_active')::boolean, true)
    ) returning id into v_id;

    -- Log audit event
    perform public.log_audit_event(
      'EMPLOYEE_CREATED',
      'profiles',
      v_id::text,
      null,
      jsonb_build_object(
        'name', btrim(p_values->>'name'),
        'phone', v_phone,
        'employee_number', p_values->>'employee_number',
        'role', p_values->>'role'
      )
    );

  -- 5. UPDATE Branch (Existing Employee Modification)
  else
    if exists (
      select 1 from public.profiles
      where id = v_id
        and upper(coalesce(role, '')) in ('SYSTEM_ADMIN', 'SUPER_ADMIN')
    ) and v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
      raise exception 'SYSTEM_ADMIN_PERMISSION_REQUIRED';
    end if;

    -- Check existing phone for grandfathering
    select phone into v_existing_phone from public.profiles where id = v_id;
    if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

    if v_phone is not null then
      -- Validate format if provided
      if v_phone !~ '^[6-9][0-9]{9}$' then
        raise exception 'INVALID_INDIAN_MOBILE_NUMBER: Please provide a valid 10-digit Indian mobile number.';
      end if;

      -- Check uniqueness excluding current record
      if exists (
        select 1 from public.profiles
        where id <> v_id
          and is_active = true
          and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_phone
      ) then
        raise exception 'DUPLICATE_MOBILE_NUMBER: An active employee with this mobile number already exists.';
      end if;
    elsif v_existing_phone is not null and btrim(v_existing_phone) <> '' then
      -- Profile already has a phone, prevent removing it
      v_phone := v_existing_phone;
    end if;

    update public.profiles
    set name = btrim(p_values->>'name'),
        email = nullif(btrim(p_values->>'email'), ''),
        phone = v_phone,
        employee_number = nullif(btrim(p_values->>'employee_number'), ''),
        role = nullif(btrim(p_values->>'role'), ''),
        role_id = nullif(p_values->>'role_id', '')::uuid,
        office_id = nullif(p_values->>'office_id', '')::uuid,
        team = nullif(btrim(p_values->>'team'), ''),
        updated_at = now()
    where id = v_id;

    -- Log audit event
    perform public.log_audit_event(
      'EMPLOYEE_UPDATED',
      'profiles',
      v_id::text,
      jsonb_build_object('phone', v_existing_phone),
      jsonb_build_object(
        'name', btrim(p_values->>'name'),
        'phone', v_phone,
        'employee_number', p_values->>'employee_number',
        'role', p_values->>'role'
      )
    );
  end if;

  return jsonb_build_object('success', true, 'profile_id', v_id);
end;
$$;

revoke all on function public.rpc_admin_save_profile(uuid, jsonb) from public, anon;
grant execute on function public.rpc_admin_save_profile(uuid, jsonb) to authenticated;

