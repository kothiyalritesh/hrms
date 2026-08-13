-- Add the Sales Manager position and enforce its deliberately bounded direct
-- reports. Existing non-Sales-Manager reporting relationships are unchanged.

insert into public.roles(name)
select 'Sales Manager'
where not exists (
  select 1
  from public.roles existing
  where public.normalize_profile_role(existing.name) = 'SALES_MANAGER'
);

create or replace function public.normalize_sales_hierarchy_role(p_role text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case public.normalize_profile_role(p_role)
    when 'TELE_CALLER' then 'TELECALLER'
    when 'TELI_CALLER' then 'TELECALLER'
    when 'TELICALLER' then 'TELECALLER'
    else public.normalize_profile_role(p_role)
  end;
$$;

revoke all on function public.normalize_sales_hierarchy_role(text)
  from public, anon, authenticated;

create or replace function public.validate_sales_manager_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_role text := public.normalize_sales_hierarchy_role(new.role);
  v_manager_role text;
  v_manager_active boolean;
begin
  if new.reports_to is not null then
    select
      public.normalize_sales_hierarchy_role(manager.role),
      manager.is_active
    into v_manager_role, v_manager_active
    from public.profiles manager
    where manager.id = new.reports_to;

    if not found then
      raise exception 'REPORTING_MANAGER_NOT_FOUND';
    end if;
    if not coalesce(v_manager_active, false) then
      raise exception 'REPORTING_MANAGER_NOT_ACTIVE';
    end if;
    if v_manager_role = 'SALES_MANAGER'
       and v_employee_role not in ('SALES_EXECUTIVE', 'TELECALLER', 'AGENT') then
      raise exception
        'SALES_MANAGER_DIRECT_REPORT_ROLE_REQUIRED: expected SALES_EXECUTIVE, TELECALLER or AGENT; received %',
        coalesce(v_employee_role, 'EMPTY');
    end if;
  end if;

  -- Also protect a role change that would turn a person with incompatible
  -- existing reports into a Sales Manager. Because this is a deferred
  -- constraint trigger, transactional hierarchy imports are checked only
  -- after every row has reached its final state.
  if v_employee_role = 'SALES_MANAGER' and exists (
    select 1
    from public.profiles subordinate
    where subordinate.reports_to = new.id
      and subordinate.is_active = true
      and public.normalize_sales_hierarchy_role(subordinate.role)
        not in ('SALES_EXECUTIVE', 'TELECALLER', 'AGENT')
  ) then
    raise exception
      'SALES_MANAGER_HAS_INCOMPATIBLE_DIRECT_REPORTS';
  end if;

  return null;
end;
$$;

revoke all on function public.validate_sales_manager_hierarchy()
  from public, anon, authenticated;

drop trigger if exists validate_sales_manager_hierarchy_trg
  on public.profiles;
create constraint trigger validate_sales_manager_hierarchy_trg
after insert or update on public.profiles
deferrable initially deferred
for each row execute function public.validate_sales_manager_hierarchy();

comment on function public.validate_sales_manager_hierarchy() is
  'Allows only SALES_EXECUTIVE, TELECALLER and AGENT as direct reports of SALES_MANAGER while preserving all other hierarchy rules.';

notify pgrst, 'reload schema';
