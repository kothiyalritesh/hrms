-- =============================================================================
-- 2026-10-20 Permission Manager v3: READ-ONLY dry run (SELECT only).
-- Run in the Supabase SQL editor BEFORE 20261020100000 and send back the CSV.
-- Changes nothing. Shows who gains or loses what when the migration applies.
-- =============================================================================
WITH
active_direct AS (
  SELECT up.user_id, up.permission, up.scope::text AS scope, up.scope_id, up.expires_at
  FROM public.user_permissions up
  WHERE up.revoked_at IS NULL AND (up.expires_at IS NULL OR up.expires_at > now())
),
managers AS (
  SELECT DISTINCT m.id
  FROM public.profiles m
  JOIN public.profiles r ON r.reports_to = m.id AND r.id <> m.id AND coalesce(r.is_active, true)
  WHERE coalesce(m.is_active, true)
)
SELECT * FROM (
  -- 1. direct grants per key and scope (what the new manager will show)
  SELECT 1 AS section, 'direct grants' AS check_name, permission || ' @ ' || scope AS item,
         count(*)::text AS value
  FROM active_direct GROUP BY permission, scope

  UNION ALL
  -- 2. grants of keys that become part of a merged toggle
  SELECT 2, 'merged-key holders', permission, count(DISTINCT user_id)::text
  FROM active_direct
  WHERE permission IN ('attendance.regularize', 'attendance.backdate_correct', 'regularization.approve',
                       'attendance.backdate_approve', 'live_tracking.view', 'activity_analysis.view',
                       'attendance.edit', 'attendance.approve', 'screen.live_tracking', 'location.view_live')
  GROUP BY permission

  UNION ALL
  -- 3. people who will gain View through "includes View" (no View grant today)
  SELECT 3, 'gain implied view', d.permission || ' -> ' || v.k, count(DISTINCT d.user_id)::text
  FROM active_direct d
  CROSS JOIN LATERAL (VALUES
    ('leave.approve', 'leave.view'), ('leave.balance.manage', 'leave.view'), ('employees.manage', 'employees.view'),
    ('attendance.export', 'attendance.view'), ('checkin_logs.view', 'attendance.view'),
    ('suspicious.view', 'employees.view'), ('tasks.manage', 'tasks.view'), ('biometric.manage', 'attendance.view'),
    ('teams.manage', 'employees.view'), ('regularization.approve', 'regularization.view'),
    ('regularization.approve', 'attendance.view'), ('attendance.regularize', 'attendance.view'),
    ('attendance.approve', 'attendance.view'), ('attendance.edit', 'attendance.view')) v(src, k)
  WHERE d.permission = v.src
    AND NOT EXISTS (SELECT 1 FROM active_direct x WHERE x.user_id = d.user_id AND x.permission = v.k)
  GROUP BY d.permission, v.k

  UNION ALL
  -- 4. managers and their whole-tree size (Manager template applies to these)
  SELECT 4, 'managers', 'people with at least one active report', count(*)::text FROM managers
  UNION ALL
  SELECT 4, 'managers', 'largest reporting tree', coalesce(max(n), 0)::text
  FROM (SELECT m.id, (SELECT count(*) FROM public.hrms_scope_member_ids('REPORTS_TO', NULL, m.id)) AS n FROM managers m) t

  UNION ALL
  -- 5. location: attendance.view holders who see live location today only through attendance.view
  SELECT 5, 'lose location via attendance.view', 'users', count(DISTINCT d.user_id)::text
  FROM active_direct d
  WHERE d.permission = 'attendance.view'
    AND NOT EXISTS (SELECT 1 FROM active_direct x WHERE x.user_id = d.user_id
                    AND x.permission IN ('live_tracking.view', 'screen.live_tracking', 'location.view_live'))
    AND NOT EXISTS (SELECT 1 FROM managers m WHERE m.id = d.user_id)

  UNION ALL
  -- 6. full-access roles (unchanged by default) and existing role templates
  SELECT 6, 'role members', public.normalize_profile_role(role), count(*)::text
  FROM public.profiles WHERE coalesce(is_active, true)
    AND public.normalize_profile_role(role) IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  GROUP BY 3
  UNION ALL
  SELECT 6, 'existing role templates', role || ': ' || permission || ' @ ' || scope, '1'
  FROM public.role_permission_grants WHERE revoked_at IS NULL

  UNION ALL
  -- 7. delegates (non-admins with permission rights): the new ceiling applies to them
  SELECT 7, 'delegates', p.name || ' (' || coalesce(p.role, '') || ')', string_agg(DISTINCT d.permission, ', ')
  FROM active_direct d JOIN public.profiles p ON p.id = d.user_id
  WHERE d.permission LIKE 'permissions.%'
    AND public.normalize_profile_role(p.role) NOT IN ('SYSTEM_ADMIN', 'ADMIN')
  GROUP BY p.name, p.role

  UNION ALL
  -- 8. access rules that will be rewritten, and task insert rules that will be replaced
  SELECT 8, 'rules to rewrite', schemaname || '.' || tablename || ' / ' || policyname, cmd
  FROM pg_policies
  WHERE coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '(current_user_can_review|can_view_tracking_user)\('
  UNION ALL
  SELECT 8, 'task insert rules to replace', policyname, coalesce(with_check, '')
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND cmd = 'INSERT'
  UNION ALL
  SELECT 8, 'direct write rule on user_permissions', policyname, cmd
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_permissions' AND cmd <> 'SELECT'

  UNION ALL
  -- 9. functions the migration converts (missing ones are skipped with a NOTICE)
  SELECT 9, 'function present', f, (to_regproc('public.' || f) IS NOT NULL)::text
  FROM unnest(ARRAY['hrms_install_permission_wrapper', 'rpc_admin_adjust_leave_balance', 'rpc_admin_event_audience_options',
                    'rpc_list_unmapped_biometric_employees', 'rpc_admin_import_employee_profiles_v2',
                    'rpc_admin_reset_all_leave_balances', 'rpc_assign_biometric_employee_code',
                    'rpc_unassign_biometric_employee_code', 'reprocess_unmatched_biometric_punches',
                    'rpc_admin_sync_smartoffice_profiles_batch']) f

  UNION ALL
  -- 10. leave / regularization rows changed in the last 30 days by a non-approval path cannot be told
  --     apart here; this only counts pending requests that the new guard will protect.
  SELECT 10, 'pending requests', 'leave_requests', count(*)::text FROM public.leave_requests WHERE upper(status) = 'PENDING'
  UNION ALL
  SELECT 10, 'pending requests', 'attendance_regularization_requests', count(*)::text
  FROM public.attendance_regularization_requests WHERE upper(status) = 'PENDING'
) r
ORDER BY section, check_name, item;
