-- =============================================================================
-- 20261006180000_live_tracking_latest_pings.sql
--
-- Live Tracking loaded today's location_tracking rows for the WHOLE company,
-- newest first, capped by PostgREST max-rows (1000). Once the company had sent
-- more than ~1000 pings since a person's last ping, that person dropped out of
-- the result and showed "Last ping: —" / "GPS signal lost" while still sending.
--
-- rpc_latest_location_pings returns exactly ONE row (the latest reliable ping)
-- per employee for an IST business date, limited to the employees the caller
-- may see (admins: all; others: live_tracking.view or attendance.view scope).
-- recorded_at is "timestamp without time zone" (IST wall clock) in production,
-- so it is converted with public.hrms_timestamp(), like the canonical view does.
-- Idempotent.
-- =============================================================================

CREATE INDEX IF NOT EXISTS location_tracking_user_recorded_idx
  ON public.location_tracking (user_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION public.rpc_latest_location_pings(p_business_date date DEFAULT NULL)
RETURNS TABLE (
  user_id      uuid,
  latitude     double precision,
  longitude    double precision,
  recorded_at  timestamptz,
  accuracy     double precision,
  provider     text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_day   date := coalesce(p_business_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_from  timestamptz := (v_day::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_to    timestamptz := ((v_day + 1)::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_all   boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  v_all := public.hrms_is_admin_user(v_uid) OR EXISTS (
    SELECT 1 FROM public.user_permissions up
    WHERE up.user_id = v_uid AND up.revoked_at IS NULL AND up.scope::text = 'GLOBAL'
      AND up.permission IN ('live_tracking.view', 'attendance.view'));

  RETURN QUERY
    SELECT DISTINCT ON (lt.user_id)
           lt.user_id,
           lt.latitude::double precision,
           lt.longitude::double precision,
           public.hrms_timestamp(lt.recorded_at),   -- column is timestamp WITHOUT time zone (IST) in production
           lt.accuracy::double precision,
           lt.provider::text
    FROM public.location_tracking lt
    -- coarse, index-friendly window first (works for either column type),
    -- then the exact IST business day using the project's hrms_timestamp rule
    WHERE lt.recorded_at >= v_from - interval '1 day'
      AND lt.recorded_at <  v_to + interval '1 day'
      AND public.hrms_timestamp(lt.recorded_at) >= v_from
      AND public.hrms_timestamp(lt.recorded_at) <  v_to
      AND lt.latitude IS NOT NULL
      AND lt.longitude IS NOT NULL
      AND coalesce(lt.quality_status, 'RELIABLE') <> 'MOCKED'
      AND (
        v_all
        OR lt.user_id = v_uid
        OR lt.user_id IN (SELECT public.authorized_user_ids('live_tracking.view'))
        OR lt.user_id IN (SELECT public.authorized_user_ids('attendance.view'))
      )
    ORDER BY lt.user_id, lt.recorded_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_latest_location_pings(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_latest_location_pings(date) TO authenticated;

NOTIFY pgrst, 'reload schema';
