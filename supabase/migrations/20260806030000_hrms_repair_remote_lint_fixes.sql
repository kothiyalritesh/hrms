-- Repair deploy-time function contracts reported by plpgsql_check on the
-- linked production schema. All return expressions are cast to the public RPC
-- contract, and office creation uses the columns that actually exist.

create or replace function public.rpc_admin_tracking_diagnostics(
  p_user_id uuid default null,
  p_limit integer default 100
)
returns table(
  id uuid,user_id uuid,employee_name text,attendance_log_id uuid,
  tracking_session_id uuid,reason text,detail jsonb,occurred_at timestamptz,
  resolved_at timestamptz
)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.require_profile_admin();
  return query
  select e.id,e.user_id,p.name::text,e.attendance_log_id,
    e.tracking_session_id,e.reason::text,e.detail,e.occurred_at,e.resolved_at
  from public.tracking_health_events e
  join public.profiles p on p.id=e.user_id
  where p_user_id is null or e.user_id=p_user_id
  order by e.occurred_at desc
  limit greatest(1,least(p_limit,500));
end $$;

create or replace function public.rpc_admin_attendance_configuration_issues()
returns table(
  issue_type text,office_id uuid,office_name text,role text,user_id uuid,
  employee_name text,detail text
)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.require_profile_admin();
  return query
  select 'OFFICE_WITHOUT_POLICY'::text,o.id,o.name::text,null::text,
    null::uuid,null::text,'Add an ALL policy or complete role policies'::text
  from public.offices o
  where o.is_active and not exists(
    select 1 from public.attendance_policies policy
    where policy.office_id=o.id and policy.is_active
  )
  union all
  select 'EMPLOYEE_WITHOUT_OFFICE'::text,null::uuid,null::text,p.role::text,
    p.id,p.name::text,'Assign an active office'::text
  from public.profiles p where p.is_active and p.office_id is null
  union all
  select 'EMPLOYEE_WITHOUT_TEAM'::text,p.office_id,o.name::text,p.role::text,
    p.id,p.name::text,'Assign a team'::text
  from public.profiles p left join public.offices o on o.id=p.office_id
  where p.is_active and p.team_id is null
  union all
  select 'INVALID_LATE_TIME'::text,policy.office_id,o.name::text,
    policy.role::text,null::uuid,null::text,'Late check-in time is missing'::text
  from public.attendance_policies policy
  left join public.offices o on o.id=policy.office_id
  where policy.is_active and policy.late_checkin_time is null;
end $$;

create or replace function public.rpc_admin_leave_balance_summary()
returns table(
  user_id uuid,employee_name text,role text,balance_id uuid,
  sick numeric,casual numeric,earned numeric,comp_off numeric,
  opening_balance numeric,monthly_credited numeric,manually_adjusted numeric,
  used numeric,reversed numeric
)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.require_profile_admin();
  return query
  select p.id,p.name::text,p.role::text,b.id,
    coalesce(b.sick,0)::numeric,coalesce(b.casual,0)::numeric,
    coalesce(b.earned,0)::numeric,coalesce(b.comp_off,0)::numeric,
    coalesce(sum(t.quantity) filter(where t.leave_type='CASUAL' and t.transaction_type='OPENING_BALANCE'),0)::numeric,
    coalesce(sum(t.quantity) filter(where t.leave_type='CASUAL' and t.transaction_type='MONTHLY_ACCRUAL'),0)::numeric,
    coalesce(sum(t.quantity) filter(where t.leave_type='CASUAL' and t.transaction_type in ('MANUAL_CREDIT','MANUAL_DEBIT')),0)::numeric,
    abs(coalesce(sum(t.quantity) filter(where t.leave_type='CASUAL' and t.transaction_type='LEAVE_DEBIT'),0))::numeric,
    coalesce(sum(t.quantity) filter(where t.leave_type='CASUAL' and t.transaction_type='LEAVE_REVERSAL'),0)::numeric
  from public.profiles p
  left join public.leave_balance b on b.user_id=p.id
  left join public.leave_transactions t on t.user_id=p.id
  where p.is_active and not p.is_service_account
  group by p.id,p.name,p.role,b.id,b.sick,b.casual,b.earned,b.comp_off
  order by p.name;
end $$;

create or replace function public.rpc_admin_mutate_configuration(
  p_entity text,p_action text,p_id uuid default null,
  p_values jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_entity text:=upper(btrim(coalesce(p_entity,'')));
  v_action text:=upper(btrim(coalesce(p_action,'')));
  v_id uuid:=p_id;
  v_radius integer;
begin
  perform public.require_profile_admin();
  if v_entity='ATTENDANCE_POLICY' and v_action='UPDATE' then
    if p_id is null then raise exception 'POLICY_ID_REQUIRED'; end if;
    if (p_values->>'min_work_duration_minutes')::integer not between 0 and 1440
      or (p_values->>'undo_checkout_minutes')::integer not between 0 and 60
      or p_values->>'earliest_checkout_time' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
      or p_values->>'auto_close_time' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    then raise exception 'INVALID_ATTENDANCE_POLICY'; end if;
    update public.attendance_policies set
      min_work_duration_minutes=(p_values->>'min_work_duration_minutes')::integer,
      earliest_checkout_time=p_values->>'earliest_checkout_time',
      auto_close_time=p_values->>'auto_close_time',
      allow_night_shift=(p_values->>'allow_night_shift')::boolean,
      require_early_checkout_reason=(p_values->>'require_early_checkout_reason')::boolean,
      undo_checkout_minutes=(p_values->>'undo_checkout_minutes')::integer,
      allow_field_visit_checkout=coalesce(
        (p_values->>'allow_field_visit_checkout')::boolean,
        allow_field_visit_checkout
      ),updated_at=now()
    where id=p_id;
  elsif v_entity='OFFICE' and v_action='CREATE' then
    v_radius:=coalesce((p_values->>'attendance_radius')::integer,100);
    if nullif(btrim(p_values->>'name'),'') is null
      or v_radius not between 10 and 1000
    then raise exception 'INVALID_OFFICE'; end if;
    insert into public.offices(name,latitude,longitude,attendance_radius,is_active)
    values(
      btrim(p_values->>'name'),
      nullif(p_values->>'latitude','')::double precision,
      nullif(p_values->>'longitude','')::double precision,
      v_radius,true
    ) returning id into v_id;
  elsif v_entity='OFFICE' and v_action='SET_ACTIVE' then
    if (p_values->>'is_active')::boolean and not exists(
      select 1 from public.attendance_policies policy
      where policy.office_id=p_id and policy.is_active
    ) then raise exception 'ACTIVE_OFFICE_REQUIRES_ATTENDANCE_POLICY'; end if;
    update public.offices set is_active=(p_values->>'is_active')::boolean where id=p_id;
  elsif v_entity='OFFICE' and v_action='SET_RADIUS' then
    v_radius:=(p_values->>'attendance_radius')::integer;
    if v_radius not between 10 and 1000 then raise exception 'INVALID_RADIUS'; end if;
    update public.offices set attendance_radius=v_radius where id=p_id;
  elsif v_entity='HOLIDAY' and v_action='CREATE' then
    if num_nonnulls(
      nullif(p_values->>'office_id',''),nullif(p_values->>'team_id',''),
      nullif(p_values->>'user_id','')
    )>1 then raise exception 'CONFLICTING_CALENDAR_SCOPE'; end if;
    insert into public.holiday_calendar(
      holiday_date,name,office_id,team_id,user_id,is_optional,created_by
    ) values(
      (p_values->>'holiday_date')::date,btrim(p_values->>'name'),
      nullif(p_values->>'office_id','')::uuid,
      nullif(p_values->>'team_id','')::uuid,
      nullif(p_values->>'user_id','')::uuid,
      coalesce((p_values->>'is_optional')::boolean,false),auth.uid()
    ) returning id into v_id;
  elsif v_entity='HOLIDAY' and v_action='DELETE' then
    delete from public.holiday_calendar where id=p_id;
  elsif v_entity='WEEKLY_OFF' and v_action='CREATE' then
    if num_nonnulls(
      nullif(p_values->>'office_id',''),nullif(p_values->>'team_id',''),
      nullif(p_values->>'user_id','')
    )>1 then raise exception 'CONFLICTING_CALENDAR_SCOPE'; end if;
    insert into public.weekly_off_rules(
      office_id,team_id,user_id,weekday,week_of_month,valid_from,valid_to,
      is_active,created_by
    ) values(
      nullif(p_values->>'office_id','')::uuid,
      nullif(p_values->>'team_id','')::uuid,
      nullif(p_values->>'user_id','')::uuid,
      (p_values->>'weekday')::integer,
      nullif(p_values->>'week_of_month','')::integer,
      coalesce(nullif(p_values->>'valid_from','')::date,(now() at time zone 'Asia/Kolkata')::date),
      nullif(p_values->>'valid_to','')::date,true,auth.uid()
    ) returning id into v_id;
  elsif v_entity='WEEKLY_OFF' and v_action='DEACTIVATE' then
    update public.weekly_off_rules set is_active=false where id=p_id;
  else raise exception 'UNSUPPORTED_CONFIGURATION_ACTION'; end if;

  if v_id is null or not found then raise exception 'CONFIGURATION_ROW_NOT_FOUND'; end if;
  insert into public.hrms_audit_events(
    actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source
  ) values(
    auth.uid(),null,'CONFIGURATION_'||v_action,lower(v_entity),v_id,
    jsonb_build_object('values',p_values),'HRMS_ADMIN'
  );
  return jsonb_build_object('success',true,'id',v_id);
end $$;

revoke all on function public.rpc_admin_tracking_diagnostics(uuid,integer) from public,anon;
revoke all on function public.rpc_admin_attendance_configuration_issues() from public,anon;
revoke all on function public.rpc_admin_leave_balance_summary() from public,anon;
revoke all on function public.rpc_admin_mutate_configuration(text,text,uuid,jsonb) from public,anon;
grant execute on function public.rpc_admin_tracking_diagnostics(uuid,integer) to authenticated;
grant execute on function public.rpc_admin_attendance_configuration_issues() to authenticated;
grant execute on function public.rpc_admin_leave_balance_summary() to authenticated;
grant execute on function public.rpc_admin_mutate_configuration(text,text,uuid,jsonb) to authenticated;

notify pgrst,'reload schema';
