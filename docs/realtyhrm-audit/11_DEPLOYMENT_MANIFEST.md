# Deployment Manifest — release 1.3.0 / build 20261019.1

Status: **prepared, not deployed.** Nothing in this file has been applied to production by the engineering session. The release owner runs every step below and keeps the outputs as evidence.

## 1. What this release needs

| Item | Value | Source |
|---|---|---|
| App version | 1.3.0 | `release.config.json` |
| Web build id | `20261019.1` (the export stamps its own release id into `version.json`) | `release.config.json`, `export_web.ps1` |
| Android | APK from EAS (versionCode is managed remotely by EAS; the `androidVersionCode` field is informational) | `eas.json` (`appVersionSource: remote`) |
| Required database schema | `20261015130000` | `release.config.json` → `requiredBackendSchemaVersion` |
| Firebase client config | real `google-services.json` for `com.rehrms.app` (project `realty-bop-hrms`); EAS builds refuse the placeholder | `app.config.js` |

The app does **not** block startup when the database is older. If migrations are missing, the new features fail when used (missing RPCs) rather than showing a clear message. **Apply the migrations before you publish the web build or the APK.**

## 2. Migrations, in order

Paste each file, in this order, into the Supabase SQL Editor. Each one is idempotent and stops with an error, changing nothing, if an expected object is missing.

| # | File | Purpose |
|---|---|---|
| 1 | `20261009100000_bugfix_profile_notifications_tasks.sql` | profile/notification/task fixes |
| 2 | `20261009110000_geofence_report_fixes.sql` | geofence report |
| 3 | `20261009120000_employee_scope_and_activity_permission.sql` | scope + activity permission |
| 4 | `20261009130000_audit_trigger_runs_as_owner.sql` | audit trigger |
| 5 | `20261009140000_security_advisor_fixes.sql` | security advisor fixes |
| 6 | `20261012100000_event_attendance_and_comp_off.sql` | event presence, comp-off |
| 7 | `20261012110000_tracking_lifecycle_guards.sql` | tracking stop after checkout |
| 8 | `20261012120000_notification_reliability.sql` | notification guards, dismissed keys |
| 9 | `20261012130000_device_sessions_and_fraud_signals.sql` | device sessions, mock-GPS signal |
| 10 | `20261012140000_offline_attendance.sql` | offline check-in/out |
| 11 | `20261014100000_suspicious_only_outside_office.sql` | suspicious = outside office area |
| 12 | `20261014110000_push_token_requeue.sql` | send waiting pushes on registration |
| 13 | `20261014120000_backdated_attendance_corrections.sql` | HR corrections + employee regularization requests |
| 14 | `20261015120000_employee_birthday_field.sql` | birthday saved from the employee form |
| 15 | `20261015130000_task_hierarchy_visibility.sql` | tasks shared/forwarded along the reporting line |
| 16 | `20261020100000_permission_capabilities_and_hierarchy.sql` | Permission Manager v3: merged toggles, Manager template (whole reporting tree), HR/HRD full-access switch, delegation ceiling, bulk grants, approval-field and task-insert guards, live refresh. **Run `supabase/manual/2026-10-20_permission_dryrun.sql` first (SELECT only), and take a backup of `user_permissions` and `role_permission_grants`.** Right after it, run `supabase/manual/2026-10-20_permission_postcheck.sql` (SELECT only): every row must be PASS or INFO. The app works without the migration (the old Permission Manager is used) |
| 17 | `20261021100000_birthday_visibility_and_alerts.sql` | Birthdays only for SYSTEM_ADMIN / ADMIN / HR / HRD and holders of the new "View birthdays" permission (no birth year exposed); 09:00 IST birthday notification to the same people |
| 18 | `20261021110000_office_exit_reviews.sql` | HR Panel → Office Exits screen (`live_tracking.view`); manager/HR notifications for office exits and submitted reasons open it |
| 19 | `20261021120000_location_monitor_and_exit_reasons.sql` | Tap on an office alert opens the reason form (`rpc_my_open_geofence_event`, also right after leaving); a second exit on the same day is detected (`returned_at`); HR Panel → Location Monitor (`rpc_location_monitor`: outside / at edge / inside / travelling vs no recent / no location, last location, call); review queue returns phone and return time |

**Do not run** `supabase/deploy_all_20260908_enhancements.sql`. It is a historical bundle that would roll later functions back.

## 3. Edge Functions

Deploy with `supabase functions deploy <name>`. Only functions whose code changed in this release **must** be redeployed:

| Function | Version reported (`{"action":"version"}`) | Redeploy now? | Flags | Secrets it reads (names only) |
|---|---|---|---|---|
| `notification-dispatch` | `20261014.1` | **Yes** (prioritised, parallel sending; publishable-key auth) | `--no-verify-jwt` (pg_cron calls it with the publishable key, not a user JWT) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and `SUPABASE_PUBLISHABLE_KEYS` or `PUSH_DISPATCH_ACCEPTED_KEYS` |
| `otp-auth` | `20260731.1` | no | — | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SMS_OTP_API_KEY` |
| `biometric-attendance-sync` | `20260803.1` | no | — | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` |
| `biometric-punch-webhook` | `20260803.1` | no | — | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SMARTOFFICE_WEBHOOK_SECRET` |
| `field-visit-evidence-upload` | `20260805.1` | no | — | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `smartoffice-proxy` | `20260801.1` | no | — | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SMARTOFFICE_URL`, `SMARTOFFICE_API_KEY` |
| `send-journey-notifications` | — | if not deployed since 2026-10-12 | `--no-verify-jwt` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JOURNEY_PUSH_WEBHOOK_SECRET` |

Other functions in `supabase/functions/` are unchanged in this release: `auto-end-time`, `biometric-manual-import`, `daily-checkin-alert`, `geofence-notification-worker`, `revoke-user-auth`, `send-event-notifications`.

**Push prerequisite (outside Supabase):** upload the Firebase **FCM V1 service-account key** in expo.dev → re-hrms → Credentials → Android. Without it, Expo cannot deliver pushes even after phones register.

## 4. Pre-flight (before deploying)

1. Back up the database, or confirm point-in-time recovery is on and record the restore point time.
2. Confirm the release owner has the real `google-services.json` in the build and the FCM V1 key uploaded.
3. Run `supabase/manual/2026-10-19_readonly_release_evidence.sql`. It is SELECT-only. Save the CSV as the **before** snapshot.

## 5. Deploy

1. Migrations 1–15 (section 2).
2. `supabase functions deploy notification-dispatch --no-verify-jwt`.
3. Upload `bop-hrms-deploy.zip` to `public_html` and extract it so `/HRMS/` is replaced.
4. Distribute the APK built from this commit.

## 6. Post-deploy checks (keep the outputs)

1. Re-run the evidence SQL. Expect:
   - `rpc`: no `MISSING` rows.
   - `patch`: all `OK`.
   - `table`: no `MISSING`/`OFF`.
   - `push`: the outbox shows `SENT` rows after the first broadcast.
2. Dispatcher version check, with the project's publishable key in both headers (`apikey` and `Authorization: Bearer`):
   `POST https://<project>.supabase.co/functions/v1/notification-dispatch` with body `{"action":"version"}` → `functionVersion` = `20261014.1`.
3. Web: `GET https://<site>/HRMS/version.json` shows the new release id.
4. Smoke tests on one Android phone and one browser:
   - sign in;
   - check in inside the office, which must not be listed as suspicious;
   - check in from more than 100 m away, which is blocked and listed;
   - send a broadcast, which must arrive with sound;
   - an employee regularization request, end to end;
   - task forward from a team lead;
   - the field-visit map route on web and phone.

## 7. Rollback

| Situation | Action |
|---|---|
| A migration fails | It raised before changing anything. Stop, fix the cause, re-run that file. Do not skip ahead. |
| Wrong behaviour after the migrations | Migrations are forward-only (no down scripts). Restore from the pre-flight backup/PITR point, or apply a forward fix. |
| `notification-dispatch` misbehaves | Redeploy the previous version from git (`git show <prev>:supabase/functions/notification-dispatch/index.ts`). |
| Web build broken | Re-upload the previous `bop-hrms-deploy.zip` (kept from the last release). |
| APK broken | Reinstall the previous APK (build 41/42). New data written by build 43 stays valid. |

## 8. Evidence to attach to the release record

- The evidence SQL CSV, before and after.
- The dispatcher version response.
- The `version.json` response.
- The smoke-test notes.
- `evidence/2026-10-19_typecheck_after.txt`, `evidence/2026-10-19_jest_after.txt` and `evidence/2026-10-19_release_scenarios.txt`.
