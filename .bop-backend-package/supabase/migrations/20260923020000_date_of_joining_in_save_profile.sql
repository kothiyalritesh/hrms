-- Update rpc_admin_save_profile to handle date_of_joining
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
  v_gender text := coalesce(upper(btrim(p_values->>'gender')), 'MALE');
  v_doj date := nullif(p_values->>'date_of_joining', '')::date;
begin
  if nullif(btrim(p_values->>'name'), '') is null then
    raise exception 'PROFILE_NAME_REQUIRED';
  end if;

  if v_target_role in ('SYSTEM_ADMIN', 'SUPER_ADMIN') and v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then
    raise exception 'UNAUTHORIZED_ROLE_ASSIGNMENT';
  end if;

  if v_phone is null then
    raise exception 'PROFILE_PHONE_REQUIRED';
  end if;

  if length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'INVALID_PHONE_NUMBER_FORMAT';
  end if;

  if v_gender not in ('MALE', 'FEMALE') then
    v_gender := 'MALE';
  end if;

  if v_id is null then
    if exists (select 1 from public.profiles where phone = v_phone) then
      raise exception 'PHONE_NUMBER_ALREADY_EXISTS';
    end if;

    insert into public.profiles (
      name, email, phone, employee_number, role, role_id,
      office_id, team, is_active, gender, date_of_joining
    ) values (
      btrim(p_values->>'name'),
      nullif(btrim(p_values->>'email'), ''),
      v_phone,
      nullif(btrim(p_values->>'employee_number'), ''),
      nullif(btrim(p_values->>'role'), ''),
      nullif(p_values->>'role_id', '')::uuid,
      nullif(p_values->>'office_id', '')::uuid,
      nullif(btrim(p_values->>'team'), ''),
      coalesce((p_values->>'is_active')::boolean, true),
      v_gender,
      v_doj
    ) returning id into v_id;

    perform public.log_audit_event('EMPLOYEE_CREATED', 'profiles', v_id::text, null, p_values);
  else
    select phone into v_existing_phone from public.profiles where id = v_id;
    if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

    if v_existing_phone <> v_phone and exists (
      select 1 from public.profiles where phone = v_phone and id <> v_id
    ) then
      raise exception 'PHONE_NUMBER_ALREADY_EXISTS';
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
        gender = v_gender,
        date_of_joining = coalesce(v_doj, date_of_joining), -- Only update if provided
        updated_at = now()
    where id = v_id;

    perform public.log_audit_event(
      'EMPLOYEE_UPDATED',
      'profiles',
      v_id::text,
      jsonb_build_object('phone', v_existing_phone),
      p_values
    );
  end if;

  return jsonb_build_object('success', true, 'profile_id', v_id, 'phone', v_phone);
end $$;
