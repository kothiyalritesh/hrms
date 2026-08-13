-- Auditable leave ledger, idempotent monthly casual leave and comp-off earnings.

create table if not exists public.leave_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  leave_type text not null check(leave_type in ('SICK','CASUAL','EARNED','COMP_OFF')),
  transaction_type text not null check(transaction_type in (
    'OPENING_BALANCE','MONTHLY_ACCRUAL','LEAVE_DEBIT','LEAVE_REVERSAL',
    'MANUAL_CREDIT','MANUAL_DEBIT','COMP_OFF_EARNING','COMP_OFF_EXPIRY')),
  quantity numeric(8,2) not null check(quantity<>0),
  balance_before numeric(8,2) not null check(balance_before>=0),
  balance_after numeric(8,2) not null check(balance_after>=0),
  effective_date date not null,
  accrual_month date,
  source_type text not null,
  source_id uuid,
  reason text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  idempotency_key text not null unique,
  check(accrual_month is null or extract(day from accrual_month)=1)
);
create unique index if not exists leave_transactions_monthly_accrual_uq
  on public.leave_transactions(user_id,leave_type,accrual_month)
  where transaction_type='MONTHLY_ACCRUAL';
create index if not exists leave_transactions_user_effective_idx
  on public.leave_transactions(user_id,effective_date desc,created_at desc);

create table if not exists public.comp_off_earnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  eligible_work_date date not null,
  units numeric(8,2) not null check(units>0),
  remaining_units numeric(8,2) not null check(remaining_units>=0 and remaining_units<=units),
  source_type text not null check(source_type in ('HOLIDAY_ATTENDANCE','WEEKLY_OFF_ATTENDANCE','EVENT_ATTENDANCE','HR_MANUAL')),
  source_id uuid,
  reason text not null,
  status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED','EXPIRED','USED')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  credited_transaction_id uuid references public.leave_transactions(id) on delete set null,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists comp_off_earning_source_uq on public.comp_off_earnings(
  user_id,eligible_work_date,source_type,coalesce(source_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists comp_off_earnings_user_date_status_idx
  on public.comp_off_earnings(user_id,eligible_work_date,status);

-- Internal transaction primitive. The balance row and idempotency key are
-- locked in the same PostgreSQL transaction as the immutable ledger insert.
create or replace function public.apply_leave_transaction(
  p_user_id uuid,p_leave_type text,p_transaction_type text,p_quantity numeric,
  p_effective_date date,p_accrual_month date,p_source_type text,p_source_id uuid,
  p_reason text,p_created_by uuid,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_column text:=lower(p_leave_type);v_before numeric;v_after numeric;v_id uuid;
begin
 if p_idempotency_key is null or btrim(p_idempotency_key)='' then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
 select id into v_id from public.leave_transactions where idempotency_key=p_idempotency_key;
 if found then return v_id; end if;
 if upper(p_leave_type) not in ('SICK','CASUAL','EARNED','COMP_OFF') then raise exception 'INVALID_LEAVE_TYPE'; end if;
 if p_quantity=0 then raise exception 'ZERO_LEAVE_TRANSACTION'; end if;
 insert into public.leave_balance(user_id,sick,casual,earned,comp_off) values(p_user_id,0,0,0,0) on conflict(user_id) do nothing;
 execute format('select coalesce(%I,0) from public.leave_balance where user_id=$1 for update',v_column) into v_before using p_user_id;
 v_after:=v_before+p_quantity;
 if v_after<0 then raise exception 'INSUFFICIENT_LEAVE_BALANCE'; end if;
 perform set_config('app.leave_ledger_write','true',true);
 execute format('update public.leave_balance set %I=$1,updated_at=now() where user_id=$2',v_column) using v_after,p_user_id;
 perform set_config('app.leave_ledger_write','false',true);
 insert into public.leave_transactions(user_id,leave_type,transaction_type,quantity,balance_before,balance_after,
   effective_date,accrual_month,source_type,source_id,reason,created_by,idempotency_key)
 values(p_user_id,upper(p_leave_type),p_transaction_type,p_quantity,v_before,v_after,p_effective_date,p_accrual_month,
   p_source_type,p_source_id,p_reason,p_created_by,p_idempotency_key) returning id into v_id;
 return v_id;
exception when unique_violation then select id into v_id from public.leave_transactions where idempotency_key=p_idempotency_key;return v_id;
end $$;
revoke all on function public.apply_leave_transaction(uuid,text,text,numeric,date,date,text,uuid,text,uuid,text) from public,anon,authenticated;

-- Legacy security-definer event functions may still update leave_balance.
-- Record those changes in the same immutable ledger while all browser roles
-- lose direct mutation rights. New protected functions mark their own writes
-- with app.leave_ledger_write to avoid duplicate ledger rows.
create or replace function public.audit_legacy_leave_balance_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v record;v_before numeric;v_after numeric;v_delta numeric;v_key text;
begin
 if current_setting('app.leave_ledger_write',true)='true' then return new; end if;
 for v in select * from (values
  ('SICK'::text,coalesce(old.sick,0)::numeric,coalesce(new.sick,0)::numeric),
  ('CASUAL',coalesce(old.casual,0)::numeric,coalesce(new.casual,0)::numeric),
  ('EARNED',coalesce(old.earned,0)::numeric,coalesce(new.earned,0)::numeric),
  ('COMP_OFF',coalesce(old.comp_off,0)::numeric,coalesce(new.comp_off,0)::numeric)) x(leave_type,before_value,after_value)
 loop
  v_before:=v.before_value;v_after:=v.after_value;v_delta:=v_after-v_before;
  if v_delta<>0 then
   v_key:='legacy-direct:'||txid_current()||':'||new.user_id||':'||v.leave_type;
   insert into public.leave_transactions(user_id,leave_type,transaction_type,quantity,balance_before,balance_after,
    effective_date,source_type,reason,created_by,idempotency_key)
   values(new.user_id,v.leave_type,case when v.leave_type='COMP_OFF' and v_delta>0 then 'COMP_OFF_EARNING'
     when v_delta>0 then 'MANUAL_CREDIT' else 'MANUAL_DEBIT' end,v_delta,v_before,v_after,
     (now() at time zone 'Asia/Kolkata')::date,'LEGACY_PROTECTED_FUNCTION',
     'Compatibility ledger entry for protected legacy balance mutation',auth.uid(),v_key)
   on conflict(idempotency_key) do nothing;
  end if;
 end loop;return new;
end $$;
drop trigger if exists leave_balance_legacy_ledger_trg on public.leave_balance;
create trigger leave_balance_legacy_ledger_trg after update of sick,casual,earned,comp_off
on public.leave_balance for each row execute function public.audit_legacy_leave_balance_change();

-- Capture current balances once as the auditable opening state. This does not
-- change balances and therefore is safe on an already-live leave system.
insert into public.leave_transactions(user_id,leave_type,transaction_type,quantity,balance_before,balance_after,
 effective_date,source_type,reason,idempotency_key)
select b.user_id,v.leave_type,'OPENING_BALANCE',v.amount,0,v.amount,
 (now() at time zone 'Asia/Kolkata')::date,'MIGRATION','Opening balance imported from leave_balance',
 'opening:20260806:'||b.user_id||':'||v.leave_type
from public.leave_balance b cross join lateral(values
 ('SICK'::text,coalesce(b.sick,0)::numeric),('CASUAL',coalesce(b.casual,0)::numeric),
 ('EARNED',coalesce(b.earned,0)::numeric),('COMP_OFF',coalesce(b.comp_off,0)::numeric)) v(leave_type,amount)
where v.amount>0 on conflict(idempotency_key) do nothing;

create or replace function public.accrue_monthly_casual_leave(
 p_month_start date default date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date,p_days numeric default 1)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p record;v_count integer:=0;v_id uuid;
begin
 if p_month_start<>date_trunc('month',p_month_start)::date or p_days<>1 then raise exception 'INVALID_MONTHLY_ACCRUAL'; end if;
 for p in select id from public.profiles where is_active and not is_service_account loop
  if not exists(select 1 from public.leave_transactions t where t.user_id=p.id and t.leave_type='CASUAL'
    and t.transaction_type='MONTHLY_ACCRUAL' and t.accrual_month=p_month_start) then
   v_id:=public.apply_leave_transaction(p.id,'CASUAL','MONTHLY_ACCRUAL',1,p_month_start,p_month_start,
    'SCHEDULED_JOB',null,'One Casual Leave for calendar month',null,'monthly-casual:'||p.id||':'||to_char(p_month_start,'YYYY-MM'));
   v_count:=v_count+1;
  end if;
 end loop;
 return jsonb_build_object('success',true,'month',p_month_start,'credited',v_count);
end $$;
revoke all on function public.accrue_monthly_casual_leave(date,numeric) from public,anon,authenticated;
grant execute on function public.accrue_monthly_casual_leave(date,numeric) to service_role;

-- Apply the current month once during deployment; the unique ledger index
-- makes this safe to rerun and covers employees active before the cron existed.
select public.accrue_monthly_casual_leave(
  date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date,1);

create or replace function public.ensure_activation_month_casual_leave()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_month date:=date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date;
begin
 if new.is_active and not new.is_service_account and (tg_op='INSERT' or not coalesce(old.is_active,false) or old.is_service_account) then
  perform public.apply_leave_transaction(new.id,'CASUAL','MONTHLY_ACCRUAL',1,v_month,v_month,'PROFILE_ACTIVATION',new.id,
   'Current-month Casual Leave on employee activation',null,'monthly-casual:'||new.id||':'||to_char(v_month,'YYYY-MM'));
 end if;
 return new;
end $$;
drop trigger if exists profiles_activation_casual_leave_trg on public.profiles;
create trigger profiles_activation_casual_leave_trg after insert or update of is_active,is_service_account
on public.profiles for each row execute function public.ensure_activation_month_casual_leave();

do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.unschedule(jobid) from cron.job where jobname='monthly-casual-leave-accrual';
  perform cron.schedule('monthly-casual-leave-accrual','31 18 28-31 * *',
   $job$select public.accrue_monthly_casual_leave(date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date,1)
    where extract(day from (now() at time zone 'Asia/Kolkata'))=1$job$);
 end if;
end $$;

create or replace function public.rpc_admin_adjust_leave_balance(
 p_user_id uuid,p_leave_type text,p_quantity numeric,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tx uuid;v_after numeric;
begin
 perform public.require_profile_admin();
 if p_quantity=0 or abs(p_quantity)>31 then raise exception 'INVALID_ADJUSTMENT_QUANTITY'; end if;
 if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'ADJUSTMENT_REASON_REQUIRED'; end if;
 v_tx:=public.apply_leave_transaction(p_user_id,upper(p_leave_type),case when p_quantity>0 then 'MANUAL_CREDIT' else 'MANUAL_DEBIT' end,
  p_quantity,(now() at time zone 'Asia/Kolkata')::date,null,'HR_MANUAL',null,btrim(p_reason),auth.uid(),p_idempotency_key::text);
 select balance_after into v_after from public.leave_transactions where id=v_tx;
 insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
 values(auth.uid(),p_user_id,'LEAVE_BALANCE_ADJUSTED','leave_transaction',v_tx,
  jsonb_build_object('leave_type',upper(p_leave_type),'quantity',p_quantity,'balance_after',v_after,'reason',p_reason),'HRMS_ADMIN');
 return jsonb_build_object('success',true,'transaction_id',v_tx,'balance_after',v_after);
end $$;
revoke all on function public.rpc_admin_adjust_leave_balance(uuid,text,numeric,text,uuid) from public,anon;
grant execute on function public.rpc_admin_adjust_leave_balance(uuid,text,numeric,text,uuid) to authenticated;

create or replace function public.rpc_admin_create_comp_off_earning(
 p_user_id uuid,p_eligible_work_date date,p_units numeric,p_source_type text,p_source_id uuid,p_reason text,p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 perform public.require_profile_admin();
 if p_units<=0 or p_units>5 or p_source_type not in ('HOLIDAY_ATTENDANCE','WEEKLY_OFF_ATTENDANCE','EVENT_ATTENDANCE','HR_MANUAL') then raise exception 'INVALID_COMP_OFF_EARNING'; end if;
 insert into public.comp_off_earnings(user_id,eligible_work_date,units,remaining_units,source_type,source_id,reason,expires_at,created_by)
 values(p_user_id,p_eligible_work_date,p_units,p_units,p_source_type,p_source_id,btrim(p_reason),p_expires_at,auth.uid())
 returning id into v_id;
 return jsonb_build_object('success',true,'earning_id',v_id,'status','PENDING');
exception when unique_violation then raise exception 'DUPLICATE_COMP_OFF_EARNING';
end $$;

create or replace function public.rpc_admin_review_comp_off_earning(p_earning_id uuid,p_approve boolean,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.comp_off_earnings%rowtype;v_tx uuid;
begin
 perform public.require_profile_admin();
 select * into e from public.comp_off_earnings where id=p_earning_id for update;
 if not found then raise exception 'COMP_OFF_EARNING_NOT_FOUND'; end if;
 if e.status<>'PENDING' then
  return jsonb_build_object('success',true,'earning_id',e.id,'status',e.status,'credited_transaction_id',e.credited_transaction_id,'idempotent',true);
 end if;
 if p_approve then
  v_tx:=public.apply_leave_transaction(e.user_id,'COMP_OFF','COMP_OFF_EARNING',e.units,e.eligible_work_date,null,
   e.source_type,e.source_id,e.reason,auth.uid(),'comp-off-earning:'||e.id);
  update public.comp_off_earnings set status='APPROVED',approved_by=auth.uid(),approved_at=now(),credited_transaction_id=v_tx,updated_at=now() where id=e.id;
 else
  if length(btrim(coalesce(p_notes,'')))<3 then raise exception 'REJECTION_REASON_REQUIRED'; end if;
  update public.comp_off_earnings set status='REJECTED',approved_by=auth.uid(),approved_at=now(),updated_at=now() where id=e.id;
 end if;
 insert into public.hrms_audit_events(actor_user_id,target_user_id,action,entity_type,entity_id,new_values,source)
 values(auth.uid(),e.user_id,case when p_approve then 'COMP_OFF_APPROVED' else 'COMP_OFF_REJECTED' end,
  'comp_off_earning',e.id,jsonb_build_object('units',e.units,'notes',p_notes,'transaction_id',v_tx),'HRMS_ADMIN');
 return jsonb_build_object('success',true,'earning_id',e.id,'status',case when p_approve then 'APPROVED' else 'REJECTED' end,'credited_transaction_id',v_tx);
end $$;

-- Backward-compatible protected endpoint now uses the same earning and ledger.
create or replace function public.rpc_grant_comp_off_credit(p_user_id uuid,p_admin_id uuid,p_days numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_date date:=(now() at time zone 'Asia/Kolkata')::date;v_id uuid;v_tx uuid;
begin
 perform public.require_profile_admin();
 if auth.uid()<>p_admin_id then raise exception 'ADMIN_IDENTITY_MISMATCH'; end if;
 insert into public.comp_off_earnings(user_id,eligible_work_date,units,remaining_units,source_type,reason,status,approved_by,approved_at,created_by)
 values(p_user_id,v_date,p_days,p_days,'HR_MANUAL',btrim(p_reason),'APPROVED',auth.uid(),now(),auth.uid())
 on conflict do nothing returning id into v_id;
 if v_id is null then select id,credited_transaction_id into v_id,v_tx from public.comp_off_earnings
  where user_id=p_user_id and eligible_work_date=v_date and source_type='HR_MANUAL' and source_id is null;
 else
  v_tx:=public.apply_leave_transaction(p_user_id,'COMP_OFF','COMP_OFF_EARNING',p_days,v_date,null,'HR_MANUAL',v_id,p_reason,auth.uid(),'comp-off-earning:'||v_id);
  update public.comp_off_earnings set credited_transaction_id=v_tx where id=v_id;
 end if;
 return jsonb_build_object('success',true,'earning_id',v_id,'transaction_id',v_tx,'idempotent',v_tx is null);
end $$;

-- Leave approval debits exclusively through the ledger and consumes the oldest
-- expiring comp-off units first.
create or replace function public.rpc_review_leave_request(p_request_id uuid,p_admin_id uuid,p_approve boolean,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.leave_requests%rowtype;v_type text;v_tx uuid;v_remaining numeric;e record;v_take numeric;
begin
 perform public.require_profile_admin();
 if auth.uid()<>p_admin_id then raise exception 'ADMIN_IDENTITY_MISMATCH'; end if;
 select * into r from public.leave_requests where id=p_request_id for update;
 if not found then raise exception 'LEAVE_REQUEST_NOT_FOUND'; end if;
 if lower(r.status)<>'pending' then return jsonb_build_object('success',true,'status',lower(r.status),'idempotent',true); end if;
 if not p_approve and length(btrim(coalesce(p_notes,'')))<3 then raise exception 'REJECTION_REASON_REQUIRED'; end if;
 v_type:=upper(r.leave_type);
 if p_approve and v_type<>'WFH' then
  v_tx:=public.apply_leave_transaction(r.user_id,v_type,'LEAVE_DEBIT',-r.requested_days,r.start_date,null,
    'LEAVE_REQUEST',r.id,'Approved leave request',auth.uid(),'leave-debit:'||r.id);
  if v_type='COMP_OFF' then
   v_remaining:=r.requested_days;
   for e in select id,remaining_units from public.comp_off_earnings where user_id=r.user_id and status='APPROVED'
    and remaining_units>0 and (expires_at is null or expires_at>now()) order by expires_at asc nulls last,eligible_work_date,id for update loop
    exit when v_remaining<=0;v_take:=least(v_remaining,e.remaining_units);
    update public.comp_off_earnings set remaining_units=remaining_units-v_take,
      status=case when remaining_units-v_take=0 then 'USED' else status end,updated_at=now() where id=e.id;
    v_remaining:=v_remaining-v_take;
   end loop;
   if v_remaining>0 then raise exception 'COMP_OFF_EARNING_ALLOCATION_MISMATCH'; end if;
  end if;
 end if;
 update public.leave_requests set status=case when p_approve then 'approved' else 'rejected' end,
  reviewed_by=auth.uid(),reviewed_at=now(),review_notes=nullif(btrim(p_notes),''),
  rejection_reason=case when p_approve then null else btrim(p_notes) end where id=r.id;
 insert into public.leave_application_audit(leave_request_id,user_id,actor_id,action,old_status,new_status,days,notes)
 values(r.id,r.user_id,auth.uid(),case when p_approve then 'APPROVED' else 'REJECTED' end,r.status,
  case when p_approve then 'approved' else 'rejected' end,r.requested_days,p_notes);
 return jsonb_build_object('success',true,'status',case when p_approve then 'approved' else 'rejected' end,'transaction_id',v_tx);
end $$;

create or replace function public.rpc_admin_leave_balance_summary()
returns table(user_id uuid,employee_name text,role text,balance_id uuid,sick numeric,casual numeric,earned numeric,comp_off numeric,
 opening_balance numeric,monthly_credited numeric,manually_adjusted numeric,used numeric,reversed numeric)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.require_profile_admin();
 return query select p.id,p.name,p.role,b.id,coalesce(b.sick,0),coalesce(b.casual,0),coalesce(b.earned,0),coalesce(b.comp_off,0),
  coalesce(sum(t.quantity) filter(where t.leave_type='CASUAL' and t.transaction_type='OPENING_BALANCE'),0),
  coalesce(sum(t.quantity) filter(where t.leave_type='CASUAL' and t.transaction_type='MONTHLY_ACCRUAL'),0),
  coalesce(sum(t.quantity) filter(where t.leave_type='CASUAL' and t.transaction_type in ('MANUAL_CREDIT','MANUAL_DEBIT')),0),
  abs(coalesce(sum(t.quantity) filter(where t.leave_type='CASUAL' and t.transaction_type='LEAVE_DEBIT'),0)),
  coalesce(sum(t.quantity) filter(where t.leave_type='CASUAL' and t.transaction_type='LEAVE_REVERSAL'),0)
 from public.profiles p left join public.leave_balance b on b.user_id=p.id left join public.leave_transactions t on t.user_id=p.id
 where p.is_active and not p.is_service_account group by p.id,p.name,p.role,b.id,b.sick,b.casual,b.earned,b.comp_off order by p.name;
end $$;

-- Expiry is a server mutation and always creates a compensating ledger row.
create or replace function public.expire_comp_off_earnings()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare e record;v_count integer:=0;
begin
 for e in select * from public.comp_off_earnings where status='APPROVED' and remaining_units>0 and expires_at<=now() for update loop
  perform public.apply_leave_transaction(e.user_id,'COMP_OFF','COMP_OFF_EXPIRY',-e.remaining_units,
   (now() at time zone 'Asia/Kolkata')::date,null,'COMP_OFF_EXPIRY',e.id,'Expired comp-off units',null,'comp-off-expiry:'||e.id);
  update public.comp_off_earnings set status='EXPIRED',remaining_units=0,updated_at=now() where id=e.id;v_count:=v_count+1;
 end loop;return v_count;
end $$;
revoke all on function public.expire_comp_off_earnings() from public,anon,authenticated;
grant execute on function public.expire_comp_off_earnings() to service_role;

do $$ begin if exists(select 1 from pg_extension where extname='pg_cron') then
 perform cron.unschedule(jobid) from cron.job where jobname='expire-comp-off-earnings';
 perform cron.schedule('expire-comp-off-earnings','15 19 * * *',$job$select public.expire_comp_off_earnings()$job$);
end if;end $$;

alter table public.leave_transactions enable row level security;
alter table public.comp_off_earnings enable row level security;
drop policy if exists leave_transactions_self_or_admin_read on public.leave_transactions;
create policy leave_transactions_self_or_admin_read on public.leave_transactions for select to authenticated using(user_id=auth.uid() or public.is_profile_admin());
drop policy if exists comp_off_earnings_self_or_admin_read on public.comp_off_earnings;
create policy comp_off_earnings_self_or_admin_read on public.comp_off_earnings for select to authenticated using(user_id=auth.uid() or public.is_profile_admin());
revoke insert,update,delete on public.leave_transactions,public.comp_off_earnings from anon,authenticated;
revoke insert,update,delete on public.leave_balance from anon,authenticated;
grant select on public.leave_transactions,public.comp_off_earnings to authenticated;
revoke all on function public.rpc_admin_create_comp_off_earning(uuid,date,numeric,text,uuid,text,timestamptz) from public,anon;
revoke all on function public.rpc_admin_review_comp_off_earning(uuid,boolean,text) from public,anon;
revoke all on function public.rpc_admin_leave_balance_summary() from public,anon;
grant execute on function public.rpc_admin_create_comp_off_earning(uuid,date,numeric,text,uuid,text,timestamptz) to authenticated;
grant execute on function public.rpc_admin_review_comp_off_earning(uuid,boolean,text) to authenticated;
grant execute on function public.rpc_admin_leave_balance_summary() to authenticated;

notify pgrst,'reload schema';
