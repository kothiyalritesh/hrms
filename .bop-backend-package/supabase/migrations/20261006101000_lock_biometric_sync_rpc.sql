-- =============================================================================
-- 20261006101000_lock_biometric_sync_rpc.sql   (audit SEC-04)
--
-- rpc_sync_biometric_punches writes attendance for any employee and was
-- executable by anon (public key), so anyone could forge biometric punches.
--
-- BEFORE APPLYING: switch scripts/biometric_auto_sync_daemon.js to the
-- service-role key (SUPABASE_SERVICE_ROLE_KEY env var). The app's "Sync Now"
-- button goes through an Edge Function and is not affected.
-- =============================================================================

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rpc_sync_biometric_punches'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (emergency only, re-opens the hole):
--   GRANT EXECUTE ON FUNCTION public.rpc_sync_biometric_punches(jsonb) TO anon;
