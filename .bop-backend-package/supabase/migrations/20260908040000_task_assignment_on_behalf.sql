-- Migration: 20260908040000_task_assignment_on_behalf.sql
-- Enables BH/HR to assign tasks on behalf of Sales roles.

alter table public.tasks
  add column if not exists assigned_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_on_behalf_of uuid references public.profiles(id) on delete set null;

create index if not exists idx_tasks_assigned_by on public.tasks(assigned_by);
create index if not exists idx_tasks_created_on_behalf_of on public.tasks(created_on_behalf_of);

create or replace function public.create_task_on_behalf(
  p_title               text,
  p_description         text,
  p_assigned_to         uuid,
  p_on_behalf_of        uuid default null,
  p_deadline            timestamptz default null,
  p_priority            text default 'medium'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_task_id uuid;
begin
  -- Check permission: caller must be ADMIN/HR or have manage_tasks permission
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD', 'BUSINESS_HEAD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_tasks'
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  insert into public.tasks (
    title,
    description,
    assigned_to,
    assigned_by,
    created_on_behalf_of,
    deadline,
    priority,
    status
  ) values (
    p_title,
    p_description,
    p_assigned_to,
    v_uid,
    p_on_behalf_of,
    p_deadline,
    coalesce(p_priority, 'medium'),
    'pending'
  )
  returning id into v_task_id;

  return jsonb_build_object(
    'success', true,
    'task_id', v_task_id,
    'assigned_by', v_uid,
    'created_on_behalf_of', p_on_behalf_of
  );
end $$;

revoke all on function public.create_task_on_behalf(text, text, uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.create_task_on_behalf(text, text, uuid, uuid, timestamptz, text) to authenticated;
