-- Phase 1: Database Schema
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS weekly_off_day integer;

-- Update rpc_admin_save_profile to handle weekly_off_day
CREATE OR REPLACE FUNCTION public.rpc_admin_save_profile(
  p_profile_id uuid,
  p_values jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_role text := public.require_profile_admin();
  v_id uuid := p_profile_id;
  v_target_role text := upper(nullif(btrim(p_values->>'role'), ''));
  v_raw_phone text := p_values->>'phone';
  v_phone text := nullif(regexp_replace(coalesce(v_raw_phone, ''), '\D', '', 'g'), '');
  v_existing_phone text;
  v_gender text := coalesce(upper(btrim(p_values->>'gender')), 'MALE');
  v_doj date := nullif(p_values->>'date_of_joining', '')::date;
  v_weekly_off_day integer := nullif(p_values->>'weekly_off_day', '')::integer;
BEGIN
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
  
  -- if weekly_off_day is -1, it means we want to clear it (set to NULL)
  if v_weekly_off_day = -1 then
    v_weekly_off_day := NULL;
  end if;

  if v_id is null then
    if exists (select 1 from public.profiles where phone = v_phone) then
      raise exception 'PHONE_NUMBER_ALREADY_EXISTS';
    end if;

    insert into public.profiles (
      name, email, phone, employee_number, role, role_id,
      office_id, team, is_active, gender, date_of_joining, weekly_off_day
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
      v_doj,
      v_weekly_off_day
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
        date_of_joining = CASE WHEN p_values ? 'date_of_joining' THEN v_doj ELSE date_of_joining END,
        weekly_off_day = CASE WHEN p_values ? 'weekly_off_day' THEN v_weekly_off_day ELSE weekly_off_day END,
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
END $$;


-- Phase 4: Integration with Attendance

CREATE OR REPLACE FUNCTION public.resolve_hrms_calendar_day(p_user_id uuid, p_date date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
WITH person AS (
  SELECT id, office_id, team_id, weekly_off_day FROM public.profiles WHERE id = p_user_id
), candidates AS (
  SELECT 'HOLIDAY'::text AS kind, h.name AS label,
    CASE WHEN h.user_id IS NOT NULL THEN 4 WHEN h.team_id IS NOT NULL THEN 3 WHEN h.office_id IS NOT NULL THEN 2 ELSE 1 END AS specificity,
    h.id AS rule_id
  FROM public.holiday_calendar h CROSS JOIN person p
  WHERE h.is_active AND NOT h.is_optional AND h.holiday_date = p_date
    AND (h.user_id = p.id OR h.team_id = p.team_id OR h.office_id = p.office_id
      OR (h.user_id IS NULL AND h.team_id IS NULL AND h.office_id IS NULL))
  UNION ALL
  SELECT 'WEEKLY_OFF', to_char(p_date, 'FMDay'),
    CASE WHEN w.user_id IS NOT NULL THEN 4 WHEN w.team_id IS NOT NULL THEN 3 WHEN w.office_id IS NOT NULL THEN 2 ELSE 1 END,
    w.id
  FROM public.weekly_off_rules w CROSS JOIN person p
  WHERE w.is_active AND p_date BETWEEN w.valid_from AND coalesce(w.valid_to, 'infinity'::date)
    AND w.weekday = extract(dow from p_date)::integer
    AND (w.week_of_month IS NULL OR w.week_of_month = ((extract(day from p_date)::integer - 1) / 7) + 1)
    AND (w.user_id = p.id OR w.team_id = p.team_id OR w.office_id = p.office_id
      OR (w.user_id IS NULL AND w.team_id IS NULL AND w.office_id IS NULL))
  UNION ALL
  SELECT 'WEEKLY_OFF', to_char(p_date, 'FMDay'), 4 AS specificity, NULL::uuid AS rule_id
  FROM person p
  WHERE p.weekly_off_day IS NOT NULL AND p.weekly_off_day = extract(dow from p_date)::integer
)
SELECT coalesce((
  SELECT jsonb_build_object('kind', kind, 'label', label, 'specificity', specificity, 'rule_id', rule_id)
  FROM candidates ORDER BY specificity DESC, CASE kind WHEN 'HOLIDAY' THEN 0 ELSE 1 END LIMIT 1
), jsonb_build_object('kind', 'WORKING_DAY', 'specificity', 0));
$$;
