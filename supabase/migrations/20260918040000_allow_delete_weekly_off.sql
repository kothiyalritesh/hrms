-- Migration to allow deleting weekly off rules

create or replace function public.rpc_admin_mutate_configuration(p_entity text,p_action text,p_id uuid default null,p_values jsonb default '{}'::jsonb)
  returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
  declare v_entity text:=upper(btrim(coalesce(p_entity,'')));v_action text:=upper(btrim(coalesce(p_action,'')));v_id uuid:=p_id;v_radius integer;
  begin
   perform public.require_profile_admin();
   if v_entity='ATTENDANCE_POLICY' and v_action='UPDATE' then
    update public.attendance_policies set min_work_duration_minutes=(p_values->>'min_work_duration_minutes')::integer,
     earliest_checkout_time=p_values->>'earliest_checkout_time',auto_close_time=p_values->>'auto_close_time',
     allow_night_shift=(p_values->>'allow_night_shift')::boolean,require_early_checkout_reason=(p_values->>'require_early_checkout_reason')::boolean,
     undo_checkout_minutes=(p_values->>'undo_checkout_minutes')::integer,
     allow_field_visit_checkout=coalesce((p_values->>'allow_field_visit_checkout')::boolean,allow_field_visit_checkout),updated_at=now() where id=p_id;
   elsif v_entity='OFFICE' and v_action='CREATE' then
    v_radius:=coalesce((p_values->>'attendance_radius')::integer,100);
    insert into public.offices(name,address,latitude,longitude,attendance_radius,is_active) values(btrim(p_values->>'name'),btrim(p_values->>'address'),
     nullif(p_values->>'latitude','')::double precision,nullif(p_values->>'longitude','')::double precision,v_radius,true) returning id into v_id;
   elsif v_entity='OFFICE' and v_action='SET_ACTIVE' then
    if (p_values->>'is_active')::boolean and not exists(select 1 from public.attendance_policies p where p.office_id=p_id and p.is_active) then raise exception 'ACTIVE_OFFICE_REQUIRES_ATTENDANCE_POLICY'; end if;
    update public.offices set is_active=(p_values->>'is_active')::boolean where id=p_id;
   elsif v_entity='OFFICE' and v_action='SET_RADIUS' then update public.offices set attendance_radius=(p_values->>'attendance_radius')::integer where id=p_id;
   elsif v_entity='HOLIDAY' and v_action='CREATE' then
    if num_nonnulls(nullif(p_values->>'office_id',''),nullif(p_values->>'team_id',''),nullif(p_values->>'user_id',''))>1 then raise exception 'CONFLICTING_CALENDAR_SCOPE'; end if;
    insert into public.holiday_calendar(holiday_date,name,office_id,team_id,user_id,is_optional,created_by)
    values((p_values->>'holiday_date')::date,btrim(p_values->>'name'),nullif(p_values->>'office_id','')::uuid,
     nullif(p_values->>'team_id','')::uuid,nullif(p_values->>'user_id','')::uuid,coalesce((p_values->>'is_optional')::boolean,false),auth.uid()) returning id into v_id;
   elsif v_entity='HOLIDAY' and v_action='DELETE' then delete from public.holiday_calendar where id=p_id;
   elsif v_entity='WEEKLY_OFF' and v_action='CREATE' then
    if num_nonnulls(nullif(p_values->>'office_id',''),nullif(p_values->>'team_id',''),nullif(p_values->>'user_id',''))>1 then raise exception 'CONFLICTING_CALENDAR_SCOPE'; end if;
    insert into public.weekly_off_rules(office_id,team_id,user_id,weekday,week_of_month,valid_from,valid_to,is_active,created_by)
    values(nullif(p_values->>'office_id','')::uuid,nullif(p_values->>'team_id','')::uuid,nullif(p_values->>'user_id','')::uuid,
     (p_values->>'weekday')::integer,nullif(p_values->>'week_of_month','')::integer,coalesce(nullif(p_values->>'valid_from','')::date,(now() at time zone 'Asia/Kolkata')::date),
     nullif(p_values->>'valid_to','')::date,true,auth.uid()) returning id into v_id;
   elsif v_entity='WEEKLY_OFF' and v_action='DEACTIVATE' then update public.weekly_off_rules set is_active=false where id=p_id;
   elsif v_entity='WEEKLY_OFF' and v_action='DELETE' then delete from public.weekly_off_rules where id=p_id;
   else raise exception 'UNSUPPORTED_CONFIGURATION_ACTION'; end if;
   if v_id is null or not found then raise exception 'CONFIGURATION_ROW_NOT_FOUND'; end if;
   insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
   values(auth.uid(),null,'CONFIGURATION_'||v_action,lower(v_entity),v_id,jsonb_build_object('values',p_values),'HRMS_ADMIN');
   return jsonb_build_object('success',true,'id',v_id);
  end $$;
  
  notify pgrst, 'reload schema';

