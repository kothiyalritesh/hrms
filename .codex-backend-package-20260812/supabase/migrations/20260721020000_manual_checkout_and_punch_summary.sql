-- HRMS checkout is authoritative. Biometric data is retained only as the
-- first and last machine punch for reporting and never ends a live session.

alter table public.attendance_logs
  add column if not exists biometric_first_punch timestamptz,
  add column if not exists biometric_last_punch timestamptz,
  add column if not exists biometric_punch_count integer not null default 0;

do $$ begin
  alter table public.attendance_logs
    add constraint attendance_biometric_punch_count_ck
    check (biometric_punch_count >= 0);
exception when duplicate_object then null; end $$;

-- Preserve useful historical meaning before compacting raw punch rows.
with daily as (
  select
    user_id,
    log_date_only::date as punch_date,
    min((log_date_only::text || ' ' || log_time::text)::timestamp
      at time zone 'Asia/Kolkata') as first_punch,
    max((log_date_only::text || ' ' || log_time::text)::timestamp
      at time zone 'Asia/Kolkata') as last_punch,
    count(*)::integer as punch_count
  from public.smartoffice_device_logs
  where user_id is not null and log_date_only is not null and log_time is not null
  group by user_id, log_date_only::date
)
update public.attendance_logs a
set biometric_first_punch = d.first_punch,
    biometric_last_punch = d.last_punch,
    biometric_punch_count = d.punch_count
from daily d
where a.user_id=d.user_id and a.date=d.punch_date;

-- Keep only the first and last raw punch for each employee/day. Intermediate
-- break punches are intentionally discarded as requested.
with ranked as (
  select id,
    row_number() over (
      partition by employee_code, log_date_only
      order by log_time asc, id asc
    ) as first_rank,
    row_number() over (
      partition by employee_code, log_date_only
      order by log_time desc, id desc
    ) as last_rank
  from public.smartoffice_device_logs
  where employee_code is not null and log_date_only is not null
)
delete from public.smartoffice_device_logs d
using ranked r
where d.id=r.id and r.first_rank>1 and r.last_rank>1;

create or replace function public.compact_smartoffice_daily_punches()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_day record;
begin
  for v_day in
    select distinct employee_code,log_date_only
    from inserted_smartoffice_punches
    where employee_code is not null and log_date_only is not null
  loop
    with ranked as (
      select id,
        row_number() over (order by log_time asc, id asc) as first_rank,
        row_number() over (order by log_time desc, id desc) as last_rank
      from smartoffice_device_logs
      where employee_code=v_day.employee_code
        and log_date_only=v_day.log_date_only
    )
    delete from smartoffice_device_logs d using ranked r
    where d.id=r.id and r.first_rank>1 and r.last_rank>1;
  end loop;
  return null;
end $$;

drop trigger if exists compact_smartoffice_daily_punches_trigger
  on public.smartoffice_device_logs;
create trigger compact_smartoffice_daily_punches_trigger
after insert on public.smartoffice_device_logs
referencing new table as inserted_smartoffice_punches
for each statement execute function public.compact_smartoffice_daily_punches();

-- The only automatic checkout is the protected 23:59 IST day-end action.
create or replace function public.auto_checkout_attendance_end_of_day()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_checkout_time timestamptz :=
    (v_today::text || ' 23:59:00+05:30')::timestamptz;
  v_updated integer := 0;
  v_row record;
begin
  perform set_config('app.authorized_attendance_checkout','DAY_END',true);
  for v_row in
    update attendance_logs
    set checkout_time=v_checkout_time,
        checkout_source='SYSTEM',
        status='AUTO_CHECKED_OUT',
        auto_checkout=true,
        auto_checkout_reason='Authorized day-end checkout at 23:59 IST',
        undo_token=null,
        undo_expires_at=null,
        updated_at=now()
    where date=v_today
      and checkin_time is not null
      and checkout_time is null
    returning id,user_id
  loop
    v_updated := v_updated + 1;
    insert into attendance_audit_logs(
      attendance_id,user_id,action,old_status,new_status,
      old_checkout_at,new_checkout_at,reason,source
    ) values (
      v_row.id,v_row.user_id,'CHECKOUT_AUTO','CHECKED_IN','AUTO_CHECKED_OUT',
      null,v_checkout_time,'Authorized day-end checkout at 23:59 IST','SYSTEM'
    );
  end loop;
  return jsonb_build_object(
    'success', true,
    'updated', v_updated,
    'checkout_time', v_checkout_time,
    'message', 'Authorized day-end checkout completed.'
  );
end $$;

do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in (
      'attendance-auto-checkout-2359-ist',
      'auto-close-stale-attendance'
    );
    perform cron.schedule(
      'attendance-auto-checkout-2359-ist',
      '29 18 * * *',
      $job$select public.auto_checkout_attendance_end_of_day()$job$
    );
  end if;
end $$;

-- Undo only today's clearly automatic checkouts. Manual/app/admin checkouts are
-- preserved. Dynamic SQL keeps this migration compatible with older schemas.
do $$
declare
  has_auto_checkout boolean;
begin
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='attendance_logs'
      and column_name='auto_checkout'
  ) into has_auto_checkout;

  if has_auto_checkout then
    execute $sql$
      update public.attendance_logs
      set checkout_time=null,
          checkout_source=null,
          status='CHECKED_IN',
          auto_checkout=false,
          auto_checkout_reason=null,
          undo_token=null,
          undo_expires_at=null,
          updated_at=now()
      where date=(now() at time zone 'Asia/Kolkata')::date
        and checkout_time is not null
        and (
          checkout_source in ('BIOMETRIC','SMARTOFFICE','PUNCH_MACHINE')
          or (
            (checkout_source='SYSTEM' or auto_checkout=true)
            and (checkout_time at time zone 'Asia/Kolkata')::time < time '23:55'
          )
          or (coalesce(smartoffice_imported,false)=true and checkout_source is null)
        )
    $sql$;
  else
    update public.attendance_logs
    set checkout_time=null, checkout_source=null, status='CHECKED_IN', updated_at=now()
    where date=(now() at time zone 'Asia/Kolkata')::date
      and checkout_time is not null
      and (
        checkout_source in ('BIOMETRIC','SMARTOFFICE','PUNCH_MACHINE')
        or (
          checkout_source='SYSTEM'
          and (checkout_time at time zone 'Asia/Kolkata')::time < time '23:55'
        )
        or (coalesce(smartoffice_imported,false)=true and checkout_source is null)
      );
  end if;
end $$;

-- Repair every checkout today that was not produced by either of the two
-- authorized flows: protected HRMS checkout or protected day-end checkout.
update public.attendance_logs a
set checkout_time=null,
    checkout_source=null,
    status='CHECKED_IN',
    updated_at=now()
where a.date=(now() at time zone 'Asia/Kolkata')::date
  and a.checkout_time is not null
  and not exists (
    select 1 from public.attendance_audit_logs audit
    where audit.attendance_id=a.id
      and audit.new_checkout_at=a.checkout_time
      and (
        (audit.action in ('CHECKOUT_MANUAL','CHECKOUT_EARLY') and audit.source='APP')
        or (audit.action='CHECKOUT_AUTO' and audit.source='SYSTEM')
      )
  );

create or replace function public.prevent_machine_attendance_checkout()
returns trigger language plpgsql as $$
declare
  v_is_new_checkout boolean;
  v_machine_source boolean;
  v_authorized_day_end boolean;
begin
  if tg_op='INSERT' then
    v_is_new_checkout := new.checkout_time is not null;
  else
    v_is_new_checkout := new.checkout_time is not null and
      (old.checkout_time is null or
       new.checkout_time is distinct from old.checkout_time);
  end if;
  if tg_op='INSERT'
     and new.date=(now() at time zone 'Asia/Kolkata')::date
     and new.checkout_time is not null then
    new.checkout_time := null;
    new.checkout_source := null;
    if new.status in ('CHECKED_OUT','AUTO_CHECKED_OUT') then
      new.status := 'CHECKED_IN';
    end if;
    return new;
  end if;
  v_authorized_day_end :=
    current_setting('app.authorized_attendance_checkout',true)='DAY_END';
  v_machine_source := upper(coalesce(new.checkout_source,'')) in
    ('BIOMETRIC','SMARTOFFICE','PUNCH_MACHINE') or
    (upper(coalesce(new.checkout_source,''))='SYSTEM' and not v_authorized_day_end) or
    (coalesce(new.smartoffice_imported,false)=true and new.checkout_source is null);

  if v_is_new_checkout and v_machine_source then
    if tg_op='UPDATE' then
      new.checkout_time := old.checkout_time;
      new.checkout_source := old.checkout_source;
      new.status := old.status;
    else
      new.checkout_time := null;
      new.checkout_source := null;
      if new.status in ('CHECKED_OUT','AUTO_CHECKED_OUT') then
        new.status := 'CHECKED_IN';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists prevent_machine_attendance_checkout_trigger
  on public.attendance_logs;
create trigger prevent_machine_attendance_checkout_trigger
before insert or update of checkout_time,checkout_source,status
on public.attendance_logs
for each row execute function public.prevent_machine_attendance_checkout();

-- A stale client can retain checkout_source='APP' while directly writing a
-- machine punch. At transaction end, require the matching audit row produced by
-- rpc_attendance_checkout; otherwise the entire unauthorized update rolls back.
create or replace function public.require_protected_checkout_audit()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.date=(now() at time zone 'Asia/Kolkata')::date
     and new.checkout_time is not null
     and new.checkout_time is distinct from old.checkout_time
     and not exists (
      select 1 from attendance_audit_logs audit
      where audit.attendance_id=new.id
        and audit.new_checkout_at=new.checkout_time
        and (
          (audit.action in ('CHECKOUT_MANUAL','CHECKOUT_EARLY') and audit.source='APP')
          or (audit.action='CHECKOUT_AUTO' and audit.source='SYSTEM')
        )
     ) then
    raise exception 'CHECKOUT_REQUIRES_HRMS_OR_DAY_END_ACTION';
  end if;
  return null;
end $$;

drop trigger if exists require_protected_checkout_audit_trigger
  on public.attendance_logs;
create constraint trigger require_protected_checkout_audit_trigger
after update of checkout_time on public.attendance_logs
deferrable initially deferred
for each row execute function public.require_protected_checkout_audit();

-- Make the new summary columns immediately visible to Supabase REST clients.
notify pgrst, 'reload schema';
