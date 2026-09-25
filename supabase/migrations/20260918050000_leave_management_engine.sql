-- Migration: Leave Management Engine (Gender-based accrual, Comp-Off expiry)

-- 1. Add gender to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender TEXT CHECK(gender IN ('MALE', 'FEMALE')) DEFAULT 'MALE';

-- 2. Update monthly casual leave accrual to respect gender
create or replace function public.accrue_monthly_casual_leave(
 p_month_start date default date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p record;v_count integer:=0;v_id uuid; v_days numeric;
begin
 if p_month_start<>date_trunc('month',p_month_start)::date then raise exception 'INVALID_MONTHLY_ACCRUAL'; end if;
 for p in select id, gender from public.profiles where is_active and not is_service_account loop
  if not exists(select 1 from public.leave_transactions t where t.user_id=p.id and t.leave_type='CASUAL'
    and t.transaction_type='MONTHLY_ACCRUAL' and t.accrual_month=p_month_start) then
   
   v_days := case when upper(p.gender) = 'FEMALE' then 2 else 1 end;

   v_id:=public.apply_leave_transaction(p.id,'CASUAL','MONTHLY_ACCRUAL',v_days,p_month_start,p_month_start,
    'SCHEDULED_JOB',null,'Monthly Casual Leave Accrual',null,'monthly-casual:'||p.id||':'||to_char(p_month_start,'YYYY-MM'));
   v_count:=v_count+1;
  end if;
 end loop;
 return jsonb_build_object('success',true,'month',p_month_start,'credited',v_count);
end $$;

revoke all on function public.accrue_monthly_casual_leave(date) from public,anon,authenticated;
grant execute on function public.accrue_monthly_casual_leave(date) to service_role;

-- 3. Automatically set expires_at for comp_off_earnings
create or replace function public.trg_set_comp_off_expiry()
returns trigger language plpgsql as $$
begin
  if NEW.expires_at is null then
    NEW.expires_at := (date_trunc('month', NEW.eligible_work_date) + interval '1 month' - interval '1 second')::timestamptz;
  end if;
  return NEW;
end $$;

drop trigger if exists set_comp_off_expiry_trg on public.comp_off_earnings;
create trigger set_comp_off_expiry_trg
before insert on public.comp_off_earnings
for each row execute function public.trg_set_comp_off_expiry();

-- Update existing un-expired ones to have an expiry date
update public.comp_off_earnings 
set expires_at = (date_trunc('month', eligible_work_date) + interval '1 month' - interval '1 second')::timestamptz
where expires_at is null and status = 'APPROVED';

-- 4. Admin adjustment to ensure it properly registers in transactions
-- The existing admin_adjust_leave_balance from 20260908050000 already inserts to leave_balance_audit_log,
-- but it didn't call apply_leave_transaction! Let's rewrite it.
create or replace function public.admin_adjust_leave_balance(
  p_user_id      uuid,
  p_leave_type   text,
  p_days         double precision,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tx uuid;
  v_tx_type text;
begin
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_leave'
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  if p_days = 0 then
    return jsonb_build_object('success', false, 'error', 'INVALID_DAYS');
  end if;

  v_tx_type := case when p_days > 0 then 'MANUAL_CREDIT' else 'MANUAL_DEBIT' end;

  v_tx := public.apply_leave_transaction(
    p_user_id,
    p_leave_type,
    v_tx_type,
    p_days::numeric,
    (now() at time zone 'Asia/Kolkata')::date,
    null,
    'WEB_ADMIN',
    v_uid,
    p_reason,
    v_uid,
    'admin-adj:' || p_user_id || ':' || extract(epoch from now())::text
  );

  insert into public.leave_balance_audit_log (
    user_id, leave_type, delta_days, reason, adjusted_by
  ) values (
    p_user_id, p_leave_type, p_days, p_reason, v_uid
  );

  return jsonb_build_object('success', true, 'transaction_id', v_tx);
end $$;
-- 5. Notifications for Leave Applications
create or replace function public.notify_on_leave_request()
returns trigger language plpgsql security definer as $$
declare
  v_emp record;
  v_balance jsonb;
  v_hr record;
  v_team_head uuid;
  v_msg text;
begin
  if TG_OP = 'INSERT' then
    -- Get employee details
    select p.name, p.office_id, p.reports_to into v_emp
    from public.profiles p where p.id = NEW.user_id;

    -- Generate message
    v_msg := 'Leave Application from ' || coalesce(v_emp.name, 'Employee') || ' for ' || NEW.number_of_days || ' day(s) of ' || NEW.leave_type || 
             ' from ' || NEW.start_date || ' to ' || NEW.end_date || '. Reason: ' || coalesce(NEW.reason, 'None');

    -- Notify Team Head
    if v_emp.reports_to is not null then
      insert into public.notifications (user_id, title, message, type, reference_id)
      values (v_emp.reports_to, 'Leave Request: ' || coalesce(v_emp.name, 'Employee'), v_msg, 'LEAVE_REQUEST', NEW.id);
    end if;

    -- Notify HR of the specific office (or globally)
    for v_hr in 
      select p.id from public.profiles p 
      where p.role in ('HR', 'HRD', 'ADMIN') and (p.office_id = v_emp.office_id or p.office_id is null)
    loop
      -- Prevent duplicate if HR is also the team head
      if v_emp.reports_to is null or v_hr.id <> v_emp.reports_to then
        insert into public.notifications (user_id, title, message, type, reference_id)
        values (v_hr.id, 'Leave Request: ' || coalesce(v_emp.name, 'Employee'), v_msg, 'LEAVE_REQUEST', NEW.id);
      end if;
    end loop;
  end if;
  return NEW;
end $$;

drop trigger if exists notify_leave_request_trg on public.leave_requests;
create trigger notify_leave_request_trg
after insert on public.leave_requests
for each row execute function public.notify_on_leave_request();

-- Update rpc_admin_save_profile to handle gender
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
      office_id, team, is_active, gender
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
      v_gender
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

revoke all on function public.rpc_admin_save_profile(uuid, jsonb) from public, anon;
grant execute on function public.rpc_admin_save_profile(uuid, jsonb) to authenticated;


