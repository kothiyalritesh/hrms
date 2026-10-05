-- ─── Phase 3: Enforce captured_at ───
-- Fixes ATT-09: Enforce captured_at for check-ins (dropping reliance on mock location flags)

create or replace function public.rpc_attendance_checkin_v2(
  p_office_id uuid,
  p_location jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();

revoke all on function public.rpc_attendance_checkin_v2(uuid, jsonb)
  from public, anon;
grant execute on function public.rpc_attendance_checkin_v2(uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
