-- Restore only verified privileged assignments that were replaced by an
-- employee-level role. Historical assignment rows are the recovery source;
-- names, designations, and fuzzy matching are never used for authorization.

create table if not exists public.profile_role_repair_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  previous_role text,
  previous_role_id uuid,
  restored_role text not null,
  restored_role_id uuid not null,
  source_history_id uuid not null references public.employee_assignment_history(id),
  repaired_at timestamptz not null default now(),
  unique(profile_id, source_history_id)
);

alter table public.profile_role_repair_audit enable row level security;
revoke all on public.profile_role_repair_audit from public, anon, authenticated;

insert into public.roles(name)
select desired.name
from (values ('SYSTEM_ADMIN'), ('ADMIN'), ('HRD')) as desired(name)
where not exists (
  select 1
  from public.roles existing
  where case
    when regexp_replace(upper(btrim(existing.name)), '[^A-Z0-9]+', '_', 'g')
      = 'SUPER_ADMIN' then 'SYSTEM_ADMIN'
    else regexp_replace(upper(btrim(existing.name)), '[^A-Z0-9]+', '_', 'g')
  end = desired.name
);

do $$
declare
  v_candidate record;
  v_role_id uuid;
  v_updated integer;
begin
  for v_candidate in
    with privileged_history as (
      select distinct on (history.profile_id)
        history.id as history_id,
        history.profile_id,
        case
          when regexp_replace(
            upper(btrim(history.role)), '[^A-Z0-9]+', '_', 'g'
          ) in ('SYSTEM_ADMIN', 'SUPER_ADMIN') then 'SYSTEM_ADMIN'
          else regexp_replace(
            upper(btrim(history.role)), '[^A-Z0-9]+', '_', 'g'
          )
        end as restored_role
      from public.employee_assignment_history history
      where history.verified
        and regexp_replace(
          upper(btrim(history.role)), '[^A-Z0-9]+', '_', 'g'
        ) in ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD')
      order by
        history.profile_id,
        history.effective_from desc,
        history.recorded_at desc,
        history.id desc
    )
    select
      profile.id as profile_id,
      profile.role as previous_role,
      profile.role_id as previous_role_id,
      history.history_id,
      history.restored_role
    from public.profiles profile
    join privileged_history history on history.profile_id = profile.id
    where regexp_replace(
      upper(btrim(coalesce(profile.role, ''))), '[^A-Z0-9]+', '_', 'g'
    ) not in ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD')
      and not exists (
        select 1
        from public.profile_role_repair_audit audit
        where audit.profile_id = profile.id
          and audit.source_history_id = history.history_id
      )
  loop
    select role.id
    into v_role_id
    from public.roles role
    where case
      when regexp_replace(upper(btrim(role.name)), '[^A-Z0-9]+', '_', 'g')
        = 'SUPER_ADMIN' then 'SYSTEM_ADMIN'
      else regexp_replace(upper(btrim(role.name)), '[^A-Z0-9]+', '_', 'g')
    end = v_candidate.restored_role
    order by case
      when upper(btrim(role.name)) = v_candidate.restored_role then 0
      else 1
    end, role.id
    limit 1;

    if v_role_id is null then
      raise exception 'RESTORE_ROLE_LOOKUP_FAILED_%', v_candidate.restored_role;
    end if;

    insert into public.profile_role_repair_audit(
      profile_id, previous_role, previous_role_id,
      restored_role, restored_role_id, source_history_id
    ) values (
      v_candidate.profile_id, v_candidate.previous_role,
      v_candidate.previous_role_id, v_candidate.restored_role,
      v_role_id, v_candidate.history_id
    );

    update public.profiles
    set
      role = v_candidate.restored_role,
      role_id = v_role_id,
      updated_at = now()
    where id = v_candidate.profile_id;
    get diagnostics v_updated = row_count;

    if v_updated <> 1 then
      raise exception 'PRIVILEGED_ROLE_RESTORE_NOT_CONFIRMED';
    end if;
  end loop;
end;
$$;

-- Synchronize role_id for every profile whose authoritative text role already
-- names a unique role. This repairs display/edit metadata without changing
-- anyone's permission role.
with matched_roles as (
  select
    profile.id as profile_id,
    (
      select role.id
      from public.roles role
      where case
        when regexp_replace(upper(btrim(role.name)), '[^A-Z0-9]+', '_', 'g')
          = 'SUPER_ADMIN' then 'SYSTEM_ADMIN'
        else regexp_replace(upper(btrim(role.name)), '[^A-Z0-9]+', '_', 'g')
      end = case
        when regexp_replace(
          upper(btrim(coalesce(profile.role, ''))), '[^A-Z0-9]+', '_', 'g'
        ) = 'SUPER_ADMIN' then 'SYSTEM_ADMIN'
        else regexp_replace(
          upper(btrim(coalesce(profile.role, ''))), '[^A-Z0-9]+', '_', 'g'
        )
      end
      order by role.id
      limit 1
    ) as role_id
  from public.profiles profile
)
update public.profiles profile
set
  role_id = matched.role_id,
  updated_at = now()
from matched_roles matched
where matched.profile_id = profile.id
  and matched.role_id is not null
  and profile.role_id is distinct from matched.role_id;
