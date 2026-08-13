-- Follow-up for databases that already ran 20260721020000 before the
-- organization-wide unaudited-checkout repair was strengthened.

update public.attendance_logs a
set checkout_time=null,
    checkout_source=null,
    status='CHECKED_IN',
    auto_checkout=false,
    auto_checkout_reason=null,
    undo_token=null,
    undo_expires_at=null,
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

  -- A current-day row is always created as checked in. Checkout is a separate,
  -- protected HRMS/day-end action and is never accepted during import/insert.
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

notify pgrst, 'reload schema';

