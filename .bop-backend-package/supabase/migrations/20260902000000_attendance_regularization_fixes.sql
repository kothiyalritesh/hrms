begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: Create attendance_audit_logs table if it doesn't exist.
--        The review RPC inserts into this table; without it every approval fails.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.attendance_audit_logs (
  id               uuid        primary key default gen_random_uuid(),
  attendance_id    uuid        references public.attendance_logs(id) on delete cascade,
  user_id          uuid        references public.profiles(id) on delete set null,
  action           text        not null,
  old_status       text,
  new_status       text,
  old_checkout_at  timestamptz,
  new_checkout_at  timestamptz,
  reason           text,
  source           text,
  created_at       timestamptz not null default now()
);

create index if not exists attendance_audit_logs_attendance_id_idx
  on public.attendance_audit_logs(attendance_id);

create index if not exists attendance_audit_logs_user_id_idx
  on public.attendance_audit_logs(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: Create rpc_admin_list_attendance_regularization.
--        This RPC is called by the admin screen but never existed in any migration.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.rpc_admin_list_attendance_regularization(
  p_status  text    default 'PENDING',
  p_offset  integer default 0,
  p_limit   integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_records    jsonb;
  v_total      integer;
begin
  select upper(coalesce(role, '')) into v_actor_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if v_actor_role not in ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD') then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;

  select count(*) into v_total
  from public.attendance_regularization_requests
  where status = p_status;

  select jsonb_agg(r order by r.created_at desc) into v_records
  from (
    select
      req.id,
      req.user_id,
      req.attendance_id,
      req.request_type,
      req.requested_checkout,
      req.reason,
      req.status,
      req.reviewed_by,
      req.reviewed_at,
      req.review_notes,
      req.created_at,
      jsonb_build_object(
        'name',            p.name,
        'employee_number', p.employee_number
      ) as profiles,
      jsonb_build_object(
        'date',          al.date,
        'checkin_time',  al.checkin_time,
        'checkout_time', al.checkout_time,
        'is_late',       al.is_late
      ) as attendance_logs,
      p.team                 as team_name,
      o.name                 as office_name,
      al.checkin_time        as official_first_in,
      al.checkout_time       as current_official_last_out,
      'APP'                  as first_in_source,
      'APP'                  as last_out_source,
      req.requested_checkout as final_approved_checkout
    from public.attendance_regularization_requests req
    join public.profiles      p  on p.id  = req.user_id
    join public.attendance_logs al on al.id = req.attendance_id
    left join public.offices   o  on o.id  = p.office_id
    where req.status = p_status
    order by req.created_at desc
    limit  p_limit
    offset p_offset
  ) r;

  return jsonb_build_object(
    'success',  true,
    'records',  coalesce(v_records, '[]'::jsonb),
    'total',    v_total,
    'has_more', (p_offset + p_limit) < v_total
  );
end;
$$;

revoke all on function public.rpc_admin_list_attendance_regularization(text, integer, integer)
  from public, anon;
grant execute on function public.rpc_admin_list_attendance_regularization(text, integer, integer)
  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: Harden rpc_review_attendance_regularization.
--        Old version trusted caller-supplied p_admin_id for the permission check
--        instead of auth.uid(), allowing any user to bypass the admin guard.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.rpc_review_attendance_regularization(
  p_request_id uuid,
  p_admin_id   uuid,
  p_approve    boolean,
  p_notes      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role text;
  v_request    record;
  v_att        record;
  v_new_status text := case when p_approve then 'APPROVED' else 'REJECTED' end;
begin
  select upper(coalesce(role, '')) into v_actor_role
  from public.profiles
  where id = v_actor and coalesce(is_active, true);

  if v_actor_role not in ('ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN', 'HR', 'HRD', 'HR_MANAGER') then
    return jsonb_build_object(
      'success', false,
      'error',   'FORBIDDEN',
      'message', 'Only HR/admin can review regularization.'
    );
  end if;

  if not p_approve and (p_notes is null or length(trim(p_notes)) < 3) then
    return jsonb_build_object(
      'success', false,
      'error',   'REJECTION_REASON_REQUIRED',
      'message', 'Enter a rejection reason.'
    );
  end if;

  select * into v_request
  from public.attendance_regularization_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Request not found.');
  end if;

  if v_request.status <> 'PENDING' then
    return jsonb_build_object(
      'success', false,
      'error',   'ALREADY_REVIEWED',
      'message', 'This request has already been reviewed.'
    );
  end if;

  select * into v_att
  from public.attendance_logs
  where id = v_request.attendance_id and user_id = v_request.user_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error',   'ATTENDANCE_NOT_FOUND',
      'message', 'Linked attendance record no longer exists.'
    );
  end if;

  if p_approve then
    update public.attendance_logs
    set
      checkout_time     = v_request.requested_checkout,
      status            = 'ADMIN_CORRECTED',
      checkout_source   = 'ADMIN',
      corrected_by      = v_actor,
      correction_reason = v_request.reason,
      undo_token        = null,
      undo_expires_at   = null,
      updated_at        = now()
    where id = v_request.attendance_id;

    insert into public.attendance_audit_logs (
      attendance_id, user_id, action,
      old_status, new_status,
      old_checkout_at, new_checkout_at,
      reason, source
    ) values (
      v_request.attendance_id,
      v_request.user_id,
      'REGULARIZATION_APPROVED',
      v_att.status,
      'ADMIN_CORRECTED',
      v_att.checkout_time,
      v_request.requested_checkout,
      v_request.reason ||
        case when nullif(trim(coalesce(p_notes, '')), '') is not null
             then ' | HR: ' || trim(p_notes)
             else ''
        end,
      'ADMIN'
    );
  end if;

  update public.attendance_regularization_requests
  set
    status       = v_new_status,
    reviewed_by  = v_actor,
    reviewed_at  = now(),
    review_notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = v_request.id;

  return jsonb_build_object(
    'success',       true,
    'status',        v_new_status,
    'attendance_id', v_request.attendance_id,
    'message',       'Regularization ' || lower(v_new_status) || '.'
  );

exception when others then
  return jsonb_build_object(
    'success', false,
    'error',   sqlerrm,
    'message', 'Regularization review failed: ' || sqlerrm
  );
end;
$$;

revoke all on function public.rpc_review_attendance_regularization(uuid, uuid, boolean, text)
  from public, anon;
grant execute on function public.rpc_review_attendance_regularization(uuid, uuid, boolean, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
