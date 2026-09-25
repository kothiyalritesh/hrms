-- Migration: 20260908050000_leave_admin_tools.sql
-- Admin tools for manual leave balance adjustments and audit logging.

create table if not exists public.leave_balance_audit_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  leave_type     text not null,
  delta_days     double precision not null,
  reason         text not null,
  adjusted_by    uuid references public.profiles(id) on delete set null,
  adjusted_at    timestamptz not null default now()
);

create index if not exists idx_leave_balance_audit_user on public.leave_balance_audit_log(user_id);

alter table public.leave_balance_audit_log enable row level security;

create policy leave_balance_audit_select on public.leave_balance_audit_log
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    )
  );

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

  -- Record audit log entry
  insert into public.leave_balance_audit_log (
    user_id, leave_type, delta_days, reason, adjusted_by
  ) values (
    p_user_id, p_leave_type, p_days, p_reason, v_uid
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'leave_type', p_leave_type,
    'delta_days', p_days
  );
end $$;

revoke all on function public.admin_adjust_leave_balance(uuid, text, double precision, text) from public, anon;
grant execute on function public.admin_adjust_leave_balance(uuid, text, double precision, text) to authenticated;
