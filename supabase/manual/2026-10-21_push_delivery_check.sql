-- =============================================================================
-- 2026-10-21 Push delivery check: READ-ONLY (SELECT only).
-- Why an in-app notification appears but the phone does not ring/vibrate.
-- Run in the Supabase SQL editor and send back the CSV.
-- =============================================================================
SELECT * FROM (
  -- 1. Phones that can receive pushes at all
  SELECT 1 AS section, 'active push tokens (phones registered)' AS check_name,
         count(*)::text AS value, string_agg(DISTINCT platform, ', ') AS detail
  FROM public.device_push_tokens WHERE active
  UNION ALL
  SELECT 1, 'active employees WITHOUT a registered phone',
         count(*)::text, NULL
  FROM public.profiles p
  WHERE coalesce(p.is_active, true)
    AND NOT EXISTS (SELECT 1 FROM public.device_push_tokens t WHERE t.user_id = p.id AND t.active)

  UNION ALL
  -- 2. Office-exit pushes in the last 7 days, by status
  SELECT 2, 'office-exit pushes (7 days): ' || o.status, count(*)::text,
         string_agg(DISTINCT left(coalesce(o.last_error, ''), 120), ' | ')
  FROM public.notification_push_outbox o
  WHERE o.event_type IN ('geofence_reason_required', 'geofence_exit')
    AND o.created_at > now() - interval '7 days'
  GROUP BY o.status

  UNION ALL
  -- 3. All pushes in the last 24 hours, by status and error
  SELECT 3, 'all pushes (24 h): ' || o.status, count(*)::text,
         string_agg(DISTINCT left(coalesce(o.last_error, ''), 120), ' | ')
  FROM public.notification_push_outbox o
  WHERE o.created_at > now() - interval '24 hours'
  GROUP BY o.status

  UNION ALL
  -- 4. Is the dispatcher running? (newest send attempt)
  SELECT 4, 'last push sent at', coalesce(max(sent_at)::text, 'never'), NULL
  FROM public.notification_push_outbox
  UNION ALL
  SELECT 4, 'dispatcher cron job', coalesce(string_agg(jobname || ' ' || schedule || CASE WHEN active THEN '' ELSE ' (INACTIVE)' END, '; '), 'none'), NULL
  FROM cron.job WHERE command ILIKE '%notification-dispatch%' OR jobname ILIKE '%push%' OR jobname ILIKE '%dispatch%'
) r
ORDER BY section, check_name;
