begin;

-- Supabase installs pgcrypto in the extensions schema. The reconciled
-- checkout RPC intentionally uses a restricted SECURITY DEFINER search path,
-- but its original path omitted that schema, so digest(text, 'sha256') could
-- not be resolved at runtime.
alter function public.rpc_attendance_checkout_reconciled(
  uuid, uuid, jsonb, text, uuid
) set search_path = public, extensions, pg_temp;

notify pgrst, 'reload schema';

commit;
