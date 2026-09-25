-- Migration: 20260908060000_employee_exit_archive.sql
-- Employee archive and exit procedure.

create or replace function public.archive_exited_employee(
  p_user_id   uuid,
  p_exit_date date,
  p_reason    text default null
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
    where user_id = v_uid and permission = 'manage_employee_details'
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  -- 1. Mark profile as inactive and set last working date
  update public.profiles
  set
    is_active = false,
    last_working_date = coalesce(p_exit_date, (now() at time zone 'Asia/Kolkata')::date),
    updated_at = now()
  where id = p_user_id;

  -- 2. Revoke all fine-grained permissions
  delete from public.user_permissions
  where user_id = p_user_id;

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'exit_date', p_exit_date
  );
end $$;

revoke all on function public.archive_exited_employee(uuid, date, text) from public, anon;
grant execute on function public.archive_exited_employee(uuid, date, text) to authenticated;
