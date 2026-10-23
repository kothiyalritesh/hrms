-- =============================================================================
-- 2026-10-22 READ-ONLY evidence: why does an employee still show "on site visit"
-- after returning to the office? (Viral Kumar; Bhavya Nandrajog for comparison)
-- Change the date below if needed. Run in the Supabase SQL editor, send the CSV.
-- =============================================================================
WITH p AS (
  SELECT id, name, office_id, smartoffice_employee_code
  FROM public.profiles
  WHERE name ILIKE '%viral%kumar%' OR name ILIKE '%bhavya%'
),
d AS (SELECT DATE '2026-10-22' AS day)
SELECT * FROM (
  SELECT p.name, 1 AS part, 'attendance_logs' AS source,
         (to_jsonb(a) - 'checkin_location' - 'checkout_location' - 'fraud_reasons')::text AS record
  FROM p JOIN public.attendance_logs a ON a.user_id = p.id, d WHERE a.date = d.day
  UNION ALL
  SELECT p.name, 2, 'field_visits',
         (to_jsonb(v) - 'destination_coords' - 'notes' - 'photo_url' - 'evidence')::text
  FROM p JOIN public.field_visits v ON v.user_id = p.id, d WHERE v.date = d.day
  UNION ALL
  SELECT p.name, 3, 'device punches',
         string_agg(l.log_time || coalesce(' ' || l.punch_direction, '') || ' @' || coalesce(l.serial_number, '?')
                    || coalesce(' office=' || l.office_id::text, ''), ', ' ORDER BY l.log_time)
  FROM p JOIN public.smartoffice_device_logs l ON l.user_id = p.id, d WHERE l.log_date_only = d.day
  GROUP BY p.name
  UNION ALL
  SELECT p.name, 4, 'tracking_sessions',
         jsonb_build_object('status', s.status, 'attendance_log_id', s.attendance_log_id, 'field_visit_id', s.field_visit_id,
                            'office_state', s.office_state, 'site_state', s.site_state,
                            'last_fix_at', s.last_fix_at, 'started_at', s.started_at, 'stop_reason', s.stop_reason)::text
  FROM p JOIN public.tracking_sessions s ON s.user_id = p.id, d
  WHERE s.started_at >= (d.day::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Kolkata' - interval '1 day'
  UNION ALL
  SELECT p.name, 5, 'profile office', coalesce(o.name, '-') || ' (' || p.office_id::text || ')'
  FROM p LEFT JOIN public.offices o ON o.id = p.office_id
) r
ORDER BY name, part;
