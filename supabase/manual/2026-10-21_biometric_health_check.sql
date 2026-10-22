-- =============================================================================
-- 2026-10-21 Biometric health check: READ-ONLY (SELECT only).
-- Where does the chain stop?
--   cron (every minute) → Edge Function biometric-attendance-sync
--   → smartoffice-proxy → your SmartOffice server (GetDeviceLogs)
--   → smartoffice_device_logs → attendance
-- Shows the SmartOffice server host only (never the API key).
-- Run in the Supabase SQL editor and send back the CSV.
-- =============================================================================
SELECT * FROM (
  -- 1. Last sync run (written by the Edge Function)
  SELECT 1 AS section, 'sync state: last status' AS check_name,
         coalesce(s.last_status, '-') AS value,
         left(coalesce(s.last_error, s.last_result::text, ''), 300) AS detail
  FROM public.biometric_sync_state s
  UNION ALL
  SELECT 1, 'sync state: last started / completed (IST)',
         coalesce(to_char(s.last_started_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), 'never')
           || ' / ' || coalesce(to_char(s.last_completed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), 'never'),
         NULL
  FROM public.biometric_sync_state s

  UNION ALL
  -- 2. Last sync requests (cron + manual)
  SELECT * FROM (
    SELECT 2, 'request ' || to_char(r.created_at AT TIME ZONE 'Asia/Kolkata', 'MM-DD HH24:MI') || ' ' || r.source,
           r.status,
           left(coalesce(r.error_message, r.response::text, ''), 300)
    FROM public.biometric_sync_requests r
    ORDER BY r.created_at DESC LIMIT 8
  ) last_requests
  UNION ALL
  SELECT 2, 'requests in the last hour by status: ' || r.status, count(*)::text, NULL
  FROM public.biometric_sync_requests r WHERE r.created_at > now() - interval '1 hour'
  GROUP BY r.status

  UNION ALL
  -- 3. Are punches arriving?
  SELECT 3, 'newest punch stored (device time / stored at, IST)',
         coalesce(max(l.log_datetime), 'none'),
         coalesce(to_char(max(l.synced_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), 'none')
  FROM public.smartoffice_device_logs l
  UNION ALL
  SELECT 3, 'punches per day: ' || d::date::text,
         (SELECT count(*) FROM public.smartoffice_device_logs l WHERE l.log_date_only = d)::text,
         'unmatched (no employee): ' ||
         (SELECT count(*) FROM public.smartoffice_device_logs l WHERE l.log_date_only = d AND l.user_id IS NULL)::text
  FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 3, (now() AT TIME ZONE 'Asia/Kolkata')::date, '1 day') d

  UNION ALL
  -- 4. Employee code mapping
  SELECT 4, 'active employees with a biometric code', count(*)::text, NULL
  FROM public.profiles p WHERE coalesce(p.is_active, true) AND nullif(btrim(p.smartoffice_employee_code), '') IS NOT NULL
  UNION ALL
  SELECT 4, 'device codes without an employee (7 days)', count(DISTINCT l.employee_code)::text,
         left(string_agg(DISTINCT l.employee_code, ', '), 300)
  FROM public.smartoffice_device_logs l
  WHERE l.user_id IS NULL AND l.log_date_only >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 7

  UNION ALL
  -- 5. Is the every-minute job scheduled and succeeding?
  SELECT 5, 'cron job: ' || j.jobname, j.schedule || CASE WHEN j.active THEN '' ELSE ' (INACTIVE)' END,
         CASE WHEN j.command ILIKE '%x-biometric-sync-source%' THEN 'sends pg_cron source header' ELSE 'NO source header' END
  FROM cron.job j WHERE j.command ILIKE '%biometric%'
  UNION ALL
  SELECT 5, 'cron runs (last hour): ' || d.status, count(*)::text, left(max(d.return_message), 200)
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
  WHERE j.command ILIKE '%biometric%' AND d.start_time > now() - interval '1 hour'
  GROUP BY d.status

  UNION ALL
  -- 6. What the Edge Functions answered (pg_net keeps a few hours)
  SELECT 6, 'function answers (last 2 h): HTTP ' || coalesce(r.status_code::text, 'none')
              || CASE WHEN r.timed_out THEN ' timed out' ELSE '' END,
         count(*)::text,
         left(max(coalesce(r.error_msg, r.content::text)), 300)
  FROM net._http_response r
  WHERE r.created > now() - interval '2 hours'
    AND (r.content::text ILIKE '%biometric%' OR r.content::text ILIKE '%smartoffice%' OR r.content::text ILIKE '%SYNC%'
         OR r.content::text ILIKE '%UNAUTHORIZED%' OR r.status_code IS DISTINCT FROM 200)
  GROUP BY r.status_code, r.timed_out

  UNION ALL
  -- 7. SmartOffice server settings (host only; the key is never shown)
  SELECT 7, 'vault: ' || s.name,
         CASE WHEN s.name = 'SMARTOFFICE_URL' THEN substring(s.decrypted_secret FROM '^(https?://[^/?#]+)')
              WHEN nullif(btrim(s.decrypted_secret), '') IS NULL THEN 'EMPTY'
              ELSE 'set (' || length(s.decrypted_secret) || ' chars)' END,
         NULL
  FROM vault.decrypted_secrets s
  WHERE s.name IN ('SMARTOFFICE_URL', 'SMARTOFFICE_API_KEY', 'SMARTOFFICE_API_ACCOUNT_NAME')

  UNION ALL
  -- 8. Who may read the punches
  SELECT 8, 'read policy: ' || p.policyname, array_to_string(p.roles, ','), left(p.qual, 300)
  FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'smartoffice_device_logs' AND p.cmd = 'SELECT'

  UNION ALL
  -- 9. Today's attendance with a biometric punch
  SELECT 9, 'attendance today: with biometric punch / total',
         count(*) FILTER (WHERE a.biometric_first_punch IS NOT NULL)::text || ' / ' || count(*)::text, NULL
  FROM public.attendance_logs a WHERE a.date = (now() AT TIME ZONE 'Asia/Kolkata')::date
) r
ORDER BY section, check_name;
