-- =============================================================================
-- 2026-10-23 Joining date check: READ-ONLY (SELECT only).
-- Why does everyone show "1 Sep 2026"? The profile showed joining_date, the
-- attendance-reporting start (2026-09-01 for most people), as the joining
-- date. The real joining date is date_of_joining (HR form). This shows how
-- many real joining dates are saved.
-- Run in the Supabase SQL editor and send back the CSV.
-- =============================================================================
SELECT * FROM (
  SELECT 1 AS section, 'active employees' AS check_name, count(*)::text AS value, NULL::text AS detail
  FROM public.profiles WHERE coalesce(is_active, true)
  UNION ALL
  (SELECT 1, 'accounts created per day (top 3)', to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
          count(*)::text || ' accounts'
   FROM public.profiles WHERE coalesce(is_active, true)
   GROUP BY 3 ORDER BY count(*) DESC LIMIT 3)
) a
UNION ALL
SELECT * FROM (
  SELECT 2, 'no joining date at all (shows "Not set")', count(*)::text,
         left(string_agg(name, ', ' ORDER BY name), 300)
  FROM public.profiles
  WHERE coalesce(is_active, true) AND date_of_joining IS NULL AND joining_date IS NULL
  UNION ALL
  SELECT 2, 'both dates saved and equal', count(*)::text, NULL
  FROM public.profiles
  WHERE coalesce(is_active, true) AND date_of_joining = joining_date
  UNION ALL
  SELECT 2, 'real joining date saved (HR form), no report start', count(*)::text,
         left(string_agg(name || ' ' || date_of_joining::text, ', ' ORDER BY name), 300)
  FROM public.profiles
  WHERE date_of_joining IS NOT NULL AND joining_date IS NULL
  UNION ALL
  SELECT 2, 'no real joining date, only the report start (shows "Not set")', count(*)::text,
         left(string_agg(name || ' ' || joining_date::text, ', ' ORDER BY name), 300)
  FROM public.profiles
  WHERE joining_date IS NOT NULL AND date_of_joining IS NULL
  UNION ALL
  SELECT 2, 'real joining date + a different report start', count(*)::text,
         left(string_agg(name || ' form ' || date_of_joining::text || ' / report ' || joining_date::text, ', ' ORDER BY name), 300)
  FROM public.profiles
  WHERE date_of_joining IS NOT NULL AND joining_date IS NOT NULL AND date_of_joining <> joining_date
  UNION ALL
  SELECT 2, 'report start = 2026-09-01', count(*)::text,
         left(string_agg(name, ', ' ORDER BY name), 300)
  FROM public.profiles
  WHERE coalesce(date_of_joining, joining_date) = DATE '2026-09-01'
) b
UNION ALL
SELECT * FROM (
  -- Does the bulk import save joining dates? It calls rpc_admin_save_employee.
  SELECT 3, 'function rpc_admin_save_employee', CASE WHEN count(*) > 0 THEN 'exists' ELSE 'MISSING' END,
         CASE WHEN bool_or(pg_get_functiondef(p.oid) ILIKE '%joining%') THEN 'handles joining date'
              WHEN count(*) > 0 THEN 'does NOT save joining date' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_admin_save_employee'
  UNION ALL
  SELECT 3, 'joining date copy trigger (must be removed by 20261023110000)',
         CASE WHEN count(*) > 0 THEN 'STILL INSTALLED' ELSE 'removed' END, NULL
  FROM pg_trigger WHERE tgname = 'hrms_profiles_sync_joining_date_trg'
  UNION ALL
  -- Does the live employee bulk import save the joining date column?
  SELECT 3, 'bulk import rpc_admin_import_employee_profiles_v2',
         CASE WHEN count(*) = 0 THEN 'MISSING'
              WHEN bool_or(pg_get_functiondef(p.oid) ILIKE '%rpc_admin_save_employee%') THEN 'calls rpc_admin_save_employee (missing: import fails)'
              WHEN bool_or(pg_get_functiondef(p.oid) ILIKE '%joining%') THEN 'saves joining date'
              ELSE 'ignores joining date' END, NULL
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('rpc_admin_import_employee_profiles_v2', 'hrms_impl_rpc_admin_import_employee_profiles_v2')
) c
ORDER BY 1, 2;
