-- =============================================================================
-- 20261008160000_location_time_fix.sql
--
-- Bug: Live Tracking shows "Last ping: 5h ago" while the phone pings every
-- minute (Ritesh: tracking session last_location_at 14:12 IST, card 5h ago).
--
-- Root cause: location_tracking.recorded_at is "timestamp WITHOUT time zone"
-- and every reader (hrms_timestamp, rpc_latest_location_pings, dashboard)
-- treats it as IST wall clock. record_location_ping inserts a timestamptz, which
-- PostgreSQL converts with the session time zone — UTC on Supabase — so a
-- 13:40 IST ping is stored as 08:10 and read back as 08:10 IST: 5½ hours old.
--
-- Fix:
--   1. BEFORE INSERT trigger stores recorded_at as IST wall clock, whatever
--      the session time zone (runs before the storage guard).
--   2. Existing rows stored in UTC are corrected (decided per row with
--      received_at, which is a real timestamptz).
--   3. Storage guard: a stationary phone now keeps one stored ping every
--      10 minutes (was 60), so a person sitting still stays LIVE (15-minute
--      window) instead of turning stale.
-- Idempotent.
-- =============================================================================

SET statement_timeout = '15min';

-- 1. Normalise every new ping to IST wall clock.
CREATE OR REPLACE FUNCTION public.hrms_normalize_location_recorded_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_zone text := current_setting('TimeZone');
BEGIN
  IF new.recorded_at IS NOT NULL AND v_zone NOT IN ('Asia/Kolkata', 'Asia/Calcutta') THEN
    -- recorded_at holds the session-zone wall clock of the real instant.
    new.recorded_at := (new.recorded_at AT TIME ZONE v_zone) AT TIME ZONE 'Asia/Kolkata';
  END IF;
  RETURN new;
END;
$$;

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'location_tracking' AND column_name = 'recorded_at')
     = 'timestamp without time zone' THEN
    -- 2. Correct rows written in UTC: the UTC reading matches received_at,
    --    the IST reading is ~5.5 h earlier.
    UPDATE public.location_tracking lt
    SET recorded_at = (lt.recorded_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'
    WHERE lt.received_at IS NOT NULL
      AND abs(extract(epoch FROM ((lt.recorded_at AT TIME ZONE 'UTC') - lt.received_at)))
          < abs(extract(epoch FROM ((lt.recorded_at AT TIME ZONE 'Asia/Kolkata') - lt.received_at)));

    -- Named "a_..." so it runs before adaptive_location_storage_guard.
    DROP TRIGGER IF EXISTS a_hrms_normalize_location_recorded_at ON public.location_tracking;
    CREATE TRIGGER a_hrms_normalize_location_recorded_at
    BEFORE INSERT ON public.location_tracking
    FOR EACH ROW EXECUTE FUNCTION public.hrms_normalize_location_recorded_at();
  END IF;
END $$;

-- 3. Heartbeat: keep a stationary ping every 10 minutes.
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.adaptive_location_storage_guard()') IS NOT NULL THEN
    v_def := pg_get_functiondef('public.adaptive_location_storage_guard()'::regprocedure);
    v_new := replace(v_def, 'interval ''60 minutes''', 'interval ''10 minutes''');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END IF;
END $$;

-- Site-visit live positions written with the wrong time are corrected the
-- same way (they were derived from recorded_at).
DO $$
BEGIN
  IF to_regclass('public.site_visit_live_locations') IS NOT NULL THEN
    UPDATE public.site_visit_live_locations s
    SET recorded_at = s.recorded_at + interval '5 hours 30 minutes',
        last_location_at = s.last_location_at + interval '5 hours 30 minutes'
    WHERE s.recorded_at < s.updated_at - interval '5 hours';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- Check (read-only): newest pings should now be minutes old, not 5½ hours.
-- SELECT public.hrms_timestamp(recorded_at) AS ping_ist, received_at
-- FROM location_tracking ORDER BY received_at DESC LIMIT 5;
