-- Reconcile the first app/biometric punch and perform checkout while the same
-- database transaction holds the attendance-row lock. A reconciliation error
-- must never be ignored by a checkout client.

create or replace function public.rpc_attendance_checkout_reconciled(
  p_user_id uuid,
  p_checkout_location jsonb default null,
  p_reason text default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sync jsonb;
  v_checkout jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'success', false,
      'error', 'AUTHENTICATION_REQUIRED',
      'message', 'Your session has expired. Sign in again before checkout.'
    );
  end if;

  v_sync := public.rpc_sync_first_daily_checkin(p_user_id);
  if not coalesce((v_sync->>'success')::boolean, false) then
    return jsonb_build_object(
      'success', false,
      'error', 'BIOMETRIC_RECONCILIATION_FAILED',
      'message', 'Checkout was blocked because the first daily punch could not be reconciled.',
      'reconciliation', v_sync
    );
  end if;

  v_checkout := public.rpc_attendance_checkout(
    p_user_id,
    p_checkout_location,
    p_reason,
    p_force
  );
  return v_checkout;
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'error', 'BIOMETRIC_RECONCILIATION_FAILED',
      'message', 'Checkout was blocked because biometric reconciliation failed.',
      'detail', sqlerrm
    );
end;
$$;

revoke all on function public.rpc_attendance_checkout_reconciled(
  uuid, jsonb, text, boolean
) from public, anon;
grant execute on function public.rpc_attendance_checkout_reconciled(
  uuid, jsonb, text, boolean
) to authenticated;

notify pgrst, 'reload schema';
