-- =============================================================================
-- Migration: 20260917070000_cache_manager_team_hierarchy.sql
-- P1/High Fix: Replace recursive CTE evaluated on every RLS row access with a
--              materialized view lookup. Refreshed automatically on reports_to
--              changes via a trigger on the profiles table.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Materialized view: flattens the entire manager → subordinate hierarchy
--    Each row means: (manager_id) can review (subordinate_id)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.manager_team_cache AS
  WITH RECURSIVE hierarchy(manager_id, subordinate_id, depth) AS (
    -- Base: direct reports
    SELECT
      p.reports_to  AS manager_id,
      p.id          AS subordinate_id,
      1             AS depth
    FROM public.profiles p
    WHERE p.reports_to IS NOT NULL
      AND p.is_active = true

    UNION ALL

    -- Recurse: indirect reports (up to depth 10 to prevent infinite loops)
    SELECT
      h.manager_id,
      p.id          AS subordinate_id,
      h.depth + 1   AS depth
    FROM public.profiles p
    JOIN hierarchy h ON p.reports_to = h.subordinate_id
    WHERE p.is_active = true
      AND h.depth < 10
  )
  SELECT DISTINCT manager_id, subordinate_id
  FROM hierarchy
  WHERE manager_id IS NOT NULL;

-- Unique index so REFRESH CONCURRENTLY works and lookups are O(1)
CREATE UNIQUE INDEX IF NOT EXISTS manager_team_cache_pk
  ON public.manager_team_cache (manager_id, subordinate_id);

-- Lookup index: given a manager, get their whole team instantly
CREATE INDEX IF NOT EXISTS manager_team_cache_manager_idx
  ON public.manager_team_cache (manager_id);

-- Lookup index: given a subordinate, find all their managers
CREATE INDEX IF NOT EXISTS manager_team_cache_subordinate_idx
  ON public.manager_team_cache (subordinate_id);

-- ---------------------------------------------------------------------------
-- 2. Refresh function (called by trigger and optionally by pg_cron)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_manager_team_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.manager_team_cache;
END $$;

REVOKE ALL ON FUNCTION public.refresh_manager_team_cache() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.refresh_manager_team_cache() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Trigger: refresh the cache when reports_to (or is_active) changes
--    Uses a statement-level trigger so one bulk update = one refresh, not N.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_refresh_manager_team_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Refresh asynchronously by scheduling via pg_notify so the INSERT/UPDATE
  -- transaction doesn't stall. If pg_notify is not wired up, fall back to
  -- a direct synchronous refresh (still correct, just slightly slower).
  PERFORM pg_notify('manager_team_cache_refresh', '1');

  -- Synchronous fallback: always refresh to guarantee correctness even
  -- without an external listener.
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.manager_team_cache;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_team_cache ON public.profiles;
CREATE TRIGGER trg_profiles_team_cache
  AFTER INSERT OR UPDATE OF reports_to, is_active OR DELETE
  ON public.profiles
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_refresh_manager_team_cache();

-- ---------------------------------------------------------------------------
-- 4. Replace current_user_can_review — use materialized view instead of CTE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_can_review(employee_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    -- 1. Caller is a system/hr admin → can review anyone
    EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()
        AND me.is_active = true
        AND me.role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    )
    OR
    -- 2. Called without a specific employee → "can I review anyone?" check
    (employee_id IS NULL AND EXISTS (
      SELECT 1 FROM public.manager_team_cache
      WHERE manager_id = auth.uid()
      LIMIT 1
    ))
    OR
    -- 3. Called for a specific employee → O(1) index lookup
    (employee_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.manager_team_cache
      WHERE manager_id    = auth.uid()
        AND subordinate_id = employee_id
    ));
$$;

REVOKE ALL ON FUNCTION public.current_user_can_review(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_review(uuid) TO authenticated, service_role;

-- Grant SELECT on the materialized view to authenticated so RLS functions work
GRANT SELECT ON public.manager_team_cache TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Do an initial population of the cache
-- ---------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW public.manager_team_cache;

