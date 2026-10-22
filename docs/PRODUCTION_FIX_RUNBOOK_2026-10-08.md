# Production fixes — runbook (8 Oct 2026)

Implements the audit in `HRMS_PRODUCTION_AUDIT_2026-10-07.md` and the business decisions of 7 Oct 2026:

| Decision | Implemented as |
|---|---|
| Biometric punch after 20:00 is the checkout | Yes (e.g. 21:10). Stored row repaired by the 23:58 job |
| Late from 10:33 | `late_checkin_time` 10:33:00; 10:32:xx is on time |
| Working on a weekly off | Shown as Present (also holidays) + one comp-off, automatically |
| Tracking | Movement-only (no forced 15-minute heartbeat); "no signal" after 30 min |
| Site visit evidence | Photo mandatory at every visit check-out |

## 1. Run in Supabase SQL editor, in this order

| # | File | What it fixes |
|---|---|---|
| 1 | `20261007130000_legacy_permission_aliases.sql` | (if not run yet) |
| 2 | `20261007143002_fix_anonymous_feedback_privacy.sql` | Feedback sender no longer stored |
| 3 | `20261008100000_production_integrity_phase_a.sql` | Self-approval holes, leave-as-absent, late 10:33, weekly-off present + comp-off, view = screens, 30-day day-end repair, biometric import trigger, office staff tracking, observer feed, office-exit detection + reason + review, alert types, expired grants |
| 4 | `20261008110000_site_visit_evidence_review.sql` | Photo + GPS rules at check-out, risk flags, review (approve/flag/reject/needs info), nightly close, Observer counts |
| 5 | `20261008120000_fraud_compliance_notifications.sql` | Fake GPS / shared phone events, fraud review, compliance score + screens, duplicate notifications, remaining security items |

Each file is idempotent (safe to re-run). All three new files were applied in order, twice, on a local
copy of the schema, with 46 scenario tests passing (attendance 12, location/geofence 15, site visit 19).

## 2. Check after running (read-only)

```sql
SELECT
  has_table_privilege('authenticated','public.attendance_logs','UPDATE')                    AS emp_update_attendance,   -- false
  has_table_privilege('authenticated','public.leave_requests','UPDATE')                     AS emp_update_leave,        -- false
  has_table_privilege('authenticated','public.attendance_regularization_requests','UPDATE') AS emp_update_reg,          -- false
  (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) FROM pg_proc p
    WHERE p.proname = 'grant_weekly_off_comp_off')                                          AS anon_comp_off,           -- false
  (SELECT min(late_checkin_time) FROM attendance_policies)                                  AS late_from,               -- 10:33:00
  position('lower(r.status)' IN pg_get_viewdef('public.v_attendance_daily_canonical'::regclass)) > 0 AS leave_fixed,   -- true
  (SELECT count(*) FROM cron.job WHERE jobname IN ('hrms-geofence-sweep-5min','hrms-close-stale-field-visits',
     'hrms-compliance-open-month','hrms-compliance-attendance-daily'))                      AS new_jobs,                -- 4
  to_regprocedure('public.rpc_mutate_own_field_visit__core(text, uuid, jsonb)') IS NOT NULL AS visit_wrapper,           -- true
  (SELECT count(*) FROM employee_compliance_scores WHERE score_month = date_trunc('month', now())::date) AS score_rows;  -- = active employees
```

Next day: `SELECT count(DISTINCT user_id) FROM location_tracking WHERE received_at > now() - interval '1 day';`
should be close to the number of employees who checked in with the app (was 4 per week).

## 3. Upload / deploy

1. Upload `bop-hrms-deploy.zip` to `public_html` (web release 20261007.173716).
2. Deploy the changed Edge Function:

   ```bash
   npx supabase@latest functions deploy daily-checkin-alert --project-ref fuchvtzbgwzdpzfaizbj --use-api
   ```

3. Android: upload the FCM V1 key at expo.dev and build:

   ```bash
   npx eas-cli build --platform android --profile production
   ```

## 4. What changed in the app

- Dashboard asks for a reason after a confirmed office exit (> 10 min, > radius + 150 m).
- Live Tracking → Alerts tab: "Left the office" review list (Accept / Reject −5 / Waive).
- Field visit check-out: take a site photo (required), optional notes; GPS checked by the server.
- Site Visit Observer: counts visits, Flagged / No-signal cards, site radius on the map, photo, risk flags and
  Approve / Ask info / Flag / Reject (−5) on each completed visit; refreshes every minute.
- Suspicious Attendance: Confirm (−10) / Dismiss with a note; "To review" filter.
- Compliance Scores screen (HR panel) and a score card on each employee's Profile.
- Notification taps open the related screen.
- Late shown from 10:33.

## 5. Settings HR can change later

```sql
-- points per late arrival / unapproved absent day (0 = not counted; currently 0)
UPDATE compliance_score_config SET default_deduction_amount = 1 WHERE violation_type = 'LATE_ARRIVAL';
UPDATE compliance_score_config SET default_deduction_amount = 2 WHERE violation_type = 'UNAPPROVED_ABSENCE';
```

## 6. Still to verify on real phones

Background tracking with screen locked, app swiped away, battery saver, no network, reboot; and that the
Android app registers a push token after the FCM build (`SELECT count(*) FROM device_push_tokens`).
