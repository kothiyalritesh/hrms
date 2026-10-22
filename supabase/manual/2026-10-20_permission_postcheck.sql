-- =============================================================================
-- 2026-10-20 Permission Manager v3: READ-ONLY post-deploy evidence (SELECT only).
-- Run in the Supabase SQL editor right AFTER 20261020100000 and send back the CSV.
-- "status" is PASS / FAIL / INFO; any FAIL blocks the release.
-- Compares with hrms_access_baseline_20261020 (taken by the migration before it
-- changed anything).
-- =============================================================================
WITH
base AS (SELECT * FROM public.hrms_access_baseline_20261020),
active AS (SELECT id FROM public.profiles WHERE coalesce(is_active, true)),
lost AS (
  SELECT b.user_id, b.permission, b.scope, b.scope_id
  FROM base b JOIN active a ON a.id = b.user_id
  WHERE b.permission IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.hrms_active_grants(b.user_id) n
                    WHERE n.permission = ANY (public.hrms_permission_keys(b.permission))
                      AND n.scope = b.scope AND coalesce(n.scope_id, '') = coalesce(b.scope_id, ''))
),
-- new access for people without full data access, per capability and source
gained AS (
  SELECT coalesce(public.hrms_capability_for(n.permission), n.permission) AS permission, n.source,
         count(DISTINCT a.id) AS people
  FROM active a CROSS JOIN LATERAL public.hrms_active_grants(a.id) n
  WHERE NOT public.hrms_is_admin_user(a.id)
    AND NOT EXISTS (SELECT 1 FROM base b WHERE b.user_id = a.id
                      AND n.permission = ANY (public.hrms_permission_keys(b.permission)))
  GROUP BY 1, 2
)
SELECT * FROM (
  -- 1. parity
  SELECT 1 AS section, 'parity: keys lost by active people' AS check_name,
         coalesce(string_agg(DISTINCT p.name || ': ' || l.permission || '@' || l.scope, '; '), '-') AS detail,
         CASE WHEN count(l.*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
  FROM lost l LEFT JOIN public.profiles p ON p.id = l.user_id
  UNION ALL
  SELECT 1, 'parity: full data access changed', coalesce(string_agg(p.name, ', '), '-'),
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM (SELECT DISTINCT user_id, full_data_access FROM base) b
  JOIN public.profiles p ON p.id = b.user_id
  WHERE b.full_data_access IS DISTINCT FROM public.hrms_is_admin_user(b.user_id)
  UNION ALL
  SELECT 1, 'gained: ' || g.permission || ' via ' || g.source, g.people || ' people', 'INFO' FROM gained g

  UNION ALL
  -- 2. direct writes closed
  SELECT 2, 'no client write privilege on permission tables',
         coalesce(string_agg(r.role || ' ' || a.priv || ' ' || t.n, '; '), '-'),
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM (VALUES ('user_permissions'), ('role_permission_grants'), ('hrms_role_access'), ('permission_capabilities'),
               ('permission_screen_access'), ('user_permission_versions')) t(n)
  CROSS JOIN (VALUES ('authenticated'), ('anon')) r(role)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) a(priv)
  WHERE has_table_privilege(r.role, 'public.' || t.n, a.priv)
  UNION ALL
  SELECT 2, 'no PUBLIC write grant on permission tables', coalesce(string_agg(c.relname || ' ' || x.privilege_type, '; '), '-'),
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
  WHERE c.relname IN ('user_permissions', 'role_permission_grants', 'hrms_role_access', 'permission_capabilities',
                      'permission_screen_access', 'user_permission_versions')
    AND x.grantee = 0 AND x.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  UNION ALL
  SELECT 2, 'no write rules on permission tables', coalesce(string_agg(tablename || '/' || policyname, '; '), '-'),
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM pg_policies WHERE schemaname = 'public' AND cmd <> 'SELECT'
    AND tablename IN ('user_permissions', 'role_permission_grants', 'hrms_role_access', 'permission_capabilities',
                      'permission_screen_access', 'user_permission_versions')

  UNION ALL
  -- 3. hierarchy rules rewritten (storage may keep the helper; it is rewritten too)
  SELECT 3, 'rules still calling per-row helpers', coalesce(string_agg(schemaname || '.' || tablename || '/' || policyname, '; '), '-'),
         CASE WHEN count(*) FILTER (WHERE schemaname <> 'storage') = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM pg_policies
  WHERE coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '(current_user_can_review|can_view_tracking_user)\('
  UNION ALL
  SELECT 3, 'task insert rule', string_agg(policyname || ': ' || coalesce(with_check, ''), '; '),
         CASE WHEN count(*) = 1 AND bool_and(policyname = 'hrms_tasks_insert') THEN 'PASS' ELSE 'FAIL' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND cmd = 'INSERT'

  UNION ALL
  -- 4. triggers
  SELECT 4, 'approval guard on ' || t, '-',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
                           WHERE c.relname = t AND tg.tgname = 'hrms_guard_review_fields_trg')
              THEN 'PASS' WHEN to_regclass('public.' || t) IS NULL THEN 'INFO' ELSE 'FAIL' END
  FROM unnest(ARRAY['leave_requests', 'attendance_regularization_requests', 'leaves', 'on_duty_events']) t
  UNION ALL
  SELECT 4, 'refresh trigger on ' || t, '-',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
                           WHERE c.relname = t AND tg.tgname IN ('hrms_permission_version_trg', 'hrms_permission_catalog_version_trg'))
              THEN 'PASS' ELSE 'FAIL' END
  FROM unnest(ARRAY['user_permissions', 'role_permission_grants', 'hrms_role_access', 'profiles',
                    'permission_capabilities', 'permission_screen_access']) t
  UNION ALL
  SELECT 4, 'user_permission_versions in Realtime', '-',
         CASE WHEN EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                           AND tablename = 'user_permission_versions') THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  -- 5. role-only checks converted
  SELECT 5, 'converted: ' || f, '-',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                           WHERE ns.nspname = 'public' AND p.proname = f
                             AND pg_get_functiondef(p.oid) ~ k) THEN 'PASS' ELSE 'FAIL' END
  FROM (VALUES ('rpc_admin_reset_all_leave_balances', 'leave\.balance\.manage'),
               ('rpc_assign_biometric_employee_code', 'biometric\.manage'),
               ('rpc_unassign_biometric_employee_code', 'biometric\.manage'),
               ('reprocess_unmatched_biometric_punches', 'biometric\.manage'),
               ('rpc_admin_sync_smartoffice_profiles_batch', 'biometric\.manage'),
               ('rpc_admin_adjust_leave_balance', 'HRMS_NO_SELF_LEAVE_ADJUST'),
               ('rpc_admin_event_audience_options', 'events\.manage'),
               ('rpc_list_unmapped_biometric_employees', 'biometric\.manage'),
               ('rpc_admin_import_employee_profiles_v2', 'employees\.manage')) v(f, k)

  UNION ALL
  -- 6. templates
  SELECT 6, 'HR / HRD template complete: ' || r,
         coalesce((SELECT string_agg(c.key, ', ') FROM public.permission_capabilities c
                   WHERE c.is_active AND c.key NOT LIKE 'permissions.%'
                     AND NOT EXISTS (SELECT 1 FROM public.role_permission_grants g
                                     WHERE g.revoked_at IS NULL AND public.normalize_profile_role(g.role) = r
                                       AND g.permission = c.key AND g.scope = 'GLOBAL')), '-'),
         CASE WHEN NOT EXISTS (SELECT 1 FROM public.permission_capabilities c
                               WHERE c.is_active AND c.key NOT LIKE 'permissions.%'
                                 AND NOT EXISTS (SELECT 1 FROM public.role_permission_grants g
                                                 WHERE g.revoked_at IS NULL AND public.normalize_profile_role(g.role) = r
                                                   AND g.permission = c.key AND g.scope = 'GLOBAL'))
              THEN 'PASS' ELSE 'FAIL' END
  FROM unnest(ARRAY['HR', 'HRD']) r
  UNION ALL
  SELECT 6, 'Manager template', string_agg(permission, ', ' ORDER BY permission), 'INFO'
  FROM public.role_permission_grants WHERE role = '@MANAGER' AND revoked_at IS NULL
  UNION ALL
  SELECT 6, 'full data access roles', string_agg(role, ', ' ORDER BY role), 'INFO'
  FROM public.hrms_role_access WHERE full_data_access
) r
ORDER BY section, status DESC, check_name;
