-- =============================================================================
-- 20261021100000_birthday_visibility_and_alerts.sql
--
-- Birthdays were visible to every employee: upcoming_birthdays_30_days runs
-- with the owner's rights and returned every active employee's name and full
-- date of birth to any signed-in user.
--
--  1. New capability "View birthdays" (birthdays.view), grantable to anyone
--     with a scope (company, office, team, reporting tree, department).
--     "Birthdays" (birthdays.manage) includes it. Full-data-access roles
--     (SYSTEM_ADMIN, ADMIN, HR, HRD) see all, as for every data permission.
--  2. The view only returns people the caller may see, and no birth year.
--  3. Daily at 09:00 IST: one notification per recipient listing today's
--     birthdays, to full-data-access roles and to everyone whose
--     birthdays.view covers the person (never to the person themselves).
-- Run after 20261020100000. Idempotent.
-- =============================================================================

-- ─── 1. Capability ──────────────────────────────────────────────────────────

INSERT INTO public.permissions (permission_key, module, action, label, description, scoped, risk_level, sort_order, is_active)
VALUES ('birthdays.view', 'Employees', 'view', 'View birthdays',
        'See upcoming birthdays and get the birthday-day notification for employees in scope', true, 'MEDIUM', 13, true)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, label = EXCLUDED.label, description = EXCLUDED.description,
  scoped = EXCLUDED.scoped, risk_level = EXCLUDED.risk_level, sort_order = EXCLUDED.sort_order, is_active = true;

INSERT INTO public.permission_capabilities (key, module, label, description, level, risk_level, scoped, grants, implies, sort_order)
VALUES ('birthdays.view', 'Employees', 'View birthdays',
        'Upcoming birthdays and the birthday-day notification for employees in scope',
        'VIEW', 'MEDIUM', true, ARRAY['birthdays.view'], '{}', 13)
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module, label = EXCLUDED.label, description = EXCLUDED.description, level = EXCLUDED.level,
  risk_level = EXCLUDED.risk_level, scoped = EXCLUDED.scoped, grants = EXCLUDED.grants, implies = EXCLUDED.implies,
  sort_order = EXCLUDED.sort_order, is_active = true;

UPDATE public.permission_capabilities
SET implies = ARRAY(SELECT DISTINCT k FROM unnest(implies || ARRAY['birthdays.view']) k),
    sort_order = 14,
    description = 'Set birthdays, import them, and see them company-wide'
WHERE key = 'birthdays.manage' AND NOT ('birthdays.view' = ANY (implies));

INSERT INTO public.permission_screen_access (route, keys) VALUES
  ('UpcomingBirthdays', ARRAY['birthdays.view', 'birthdays.manage'])
ON CONFLICT (route) DO UPDATE SET keys = EXCLUDED.keys;

-- HR / HRD templates stay a complete copy of full data access.
INSERT INTO public.role_permission_grants (role, permission, scope, scope_id, reason)
SELECT r, 'birthdays.view', 'GLOBAL', NULL, 'Same access as full data access (2026-10-20)'
FROM unnest(ARRAY['HR', 'HRD']) r
WHERE EXISTS (SELECT 1 FROM public.role_permission_grants g
              WHERE public.normalize_profile_role(g.role) = r AND g.reason = 'Same access as full data access (2026-10-20)')
  AND NOT EXISTS (SELECT 1 FROM public.role_permission_grants g
                  WHERE g.revoked_at IS NULL AND public.normalize_profile_role(g.role) = r
                    AND g.permission = 'birthdays.view' AND g.scope = 'GLOBAL');

-- ─── 2. The view: only people the caller may see, no birth year ─────────────

DROP VIEW IF EXISTS public.upcoming_birthdays_30_days;
CREATE VIEW public.upcoming_birthdays_30_days AS
WITH today AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d
),
this_year AS (
  SELECT p.id AS user_id, p.name, p.office_id,
         -- 29 Feb is celebrated on 28 Feb in other years
         make_date(extract(year FROM t.d)::int, extract(month FROM p.date_of_birth)::int,
                   least(extract(day FROM p.date_of_birth)::int,
                         CASE WHEN extract(month FROM p.date_of_birth) = 2
                                   AND NOT (extract(year FROM t.d)::int % 4 = 0
                                            AND (extract(year FROM t.d)::int % 100 <> 0 OR extract(year FROM t.d)::int % 400 = 0))
                              THEN 28 ELSE 31 END)) AS b, t.d
  FROM public.profiles p CROSS JOIN today t
  WHERE p.date_of_birth IS NOT NULL AND coalesce(p.is_active, true)
    AND p.id IN (SELECT public.authorized_user_ids('birthdays.view'))
)
SELECT user_id, name, office_id,
       CASE WHEN b >= d THEN b ELSE (b + interval '1 year')::date END AS next_birthday
FROM this_year
WHERE CASE WHEN b >= d THEN b ELSE (b + interval '1 year')::date END <= d + 30
ORDER BY next_birthday;

REVOKE ALL ON public.upcoming_birthdays_30_days FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.upcoming_birthdays_30_days TO authenticated;

-- ─── 3. Birthday-day notification ───────────────────────────────────────────

-- Who is told about p_person's birthday: full data access, or birthdays.view
-- (direct, role template) whose scope covers them. Never the person.
CREATE OR REPLACE FUNCTION public.hrms_birthday_recipients(p_person uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id
  FROM public.profiles r
  WHERE r.id <> p_person AND r.is_active = true
    AND (public.hrms_is_admin_user(r.id)
         OR EXISTS (SELECT 1 FROM public.hrms_active_grants(r.id) g
                    WHERE g.permission = 'birthdays.view'
                      AND (g.scope = 'GLOBAL'
                           OR p_person IN (SELECT public.hrms_scope_member_ids(g.scope, g.scope_id, r.id)))));
$$;
REVOKE ALL ON FUNCTION public.hrms_birthday_recipients(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_birthday_recipients(uuid) TO service_role;

-- One notification per recipient for the day (all of today's birthdays they
-- may see). Safe to run more than once a day: the event key deduplicates.
CREATE OR REPLACE FUNCTION public.hrms_send_birthday_notifications(p_day date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day   date := coalesce(p_day, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_leap  boolean := (extract(year FROM v_day)::int % 4 = 0
                      AND (extract(year FROM v_day)::int % 100 <> 0 OR extract(year FROM v_day)::int % 400 = 0));
  r       record;
  v_sent  integer := 0;
BEGIN
  FOR r IN
    WITH today AS (
      SELECT p.id, p.name
      FROM public.profiles p
      WHERE p.date_of_birth IS NOT NULL AND coalesce(p.is_active, true)
        AND (to_char(p.date_of_birth, 'MM-DD') = to_char(v_day, 'MM-DD')
             OR (NOT v_leap AND to_char(p.date_of_birth, 'MM-DD') = '02-29' AND to_char(v_day, 'MM-DD') = '02-28'))
    )
    SELECT rc AS recipient, array_agg(t.name ORDER BY t.name) AS names
    FROM today t CROSS JOIN LATERAL public.hrms_birthday_recipients(t.id) rc
    GROUP BY rc
  LOOP
    PERFORM public.enqueue_hrms_notification(
      r.recipient,
      CASE WHEN cardinality(r.names) = 1 THEN '🎂 Birthday today' ELSE format('🎂 %s birthdays today', cardinality(r.names)) END,
      CASE WHEN cardinality(r.names) = 1 THEN format('%s has a birthday today.', r.names[1])
           ELSE format('Birthdays today: %s.', array_to_string(r.names, ', ')) END,
      'birthday',
      format('birthday:%s:%s', v_day, r.recipient),
      '/HRMS/birthdays');
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_send_birthday_notifications(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_send_birthday_notifications(date) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hrms-birthday-notifications';
    -- 09:00 IST daily
    PERFORM cron.schedule('hrms-birthday-notifications', '30 3 * * *',
      $job$ select public.hrms_send_birthday_notifications(null); $job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed: run public.hrms_send_birthday_notifications() daily at 09:00 IST.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
