# RealtyHRM Audit — Findings Register

This register is maintained throughout the audit. A finding is not marked VERIFIED merely because a screen, migration, or prior document exists. Each conclusion must point to executable source or a recorded test/inspection result.

| ID | Status | Area | Finding / question | Evidence to inspect | Owner / follow-up |
|---|---|---|---|---|---|
| D-01 | UNVERIFIED | Database deployment | Production-applied migration set is not proven by repository files. | Supabase migration history and schema snapshot. | Database administrator verification. |
| D-02 | SOURCE FIXED 2026-10-19; production UNVERIFIED | Release metadata | `release.config.json` now requires schema `20261015130000` and `notification-dispatch` `20261014.1`; the test checks each function reports the version the release expects. | `release.config.json`, `11_DEPLOYMENT_MANIFEST.md`. | Owner applies migrations, then runs the evidence SQL. |
| D-03 | UNVERIFIED | Edge Functions | Source and required versions exist, but deployed versions, schedules, and secrets are unknown. | `supabase/functions/*`, `release.config.json`, Supabase deployment metadata. | Staging/live deployment inspection. |
| D-04 | PARTIALLY IMPLEMENTED | Migration integrity | Historical/combined/superseded SQL contains multiple definitions and may conflict with current migration order. | `supabase/migrations`, `supabase/_superseded`, combined SQL files. | Unique-object replacement map. |
| D-05 | UNVERIFIED | Route/module support | A screen being wired does not prove its RPC, table, Edge Function, or RLS path is deployed and usable. | Navigation, screen, service, RPC, migration, policy chain per route. | Module-by-module trace. |
| D-06 | TEST VERIFIED (source) 2026-10-19 | Test evidence | `npm run typecheck` PASS. `npm test`: 334 pass, 3 fail (owner decisions). SQL release scenarios: 4/4 pass, 111 assertions. | `10_TEST_FAILURE_DISPOSITION.md`, `evidence/2026-10-19_*`. | Owner decisions on OTP idempotency and smart report; staging/production still unverified. |
| D-07 | RISK | Configuration security | Map/Firebase configuration surfaces need production restriction review; values must not be reproduced in audit docs. | `app.config.js`, `eas.json`, hosting/Cloud Console settings. | Security/configuration review. |
| D-08 | UNVERIFIED | Build parity | APKs, bundles, ZIPs, and `dist` may be older than source. | Build IDs, `release.config.json`, extracted bundle route/version strings. | Build provenance comparison. |
| D-09 | UNVERIFIED | External integrations | SMS/OTP, WhatsApp, Mailchimp, SmartOffice, Maps, and push delivery depend on external configuration. | Service clients, Edge Functions, environment names, controlled staging tests. | Integration test plan. |
| D-10 | DISCOVERY NOTE | SOP review | User-supplied note names five wording corrections; none is accepted without source verification. | `Pasted text.txt` attachment plus relevant source. | Resolve in each workflow batch. |
| A-01 | VERIFIED | Authentication | Active login flow is Indian phone number + six-digit OTP, followed by an internal magic-link Supabase session. | `screens/LoginScreen.tsx`, `contexts/AuthContext.tsx`, `supabase/functions/otp-auth/index.ts`. | Include in operational SOP. |
| A-02 | PARTIALLY IMPLEMENTED / RISK | Authentication | UI restricts numbers to 6–9 prefix, while `otp-auth` validates only ten digits. | `LoginScreen.handleSendOTP`, `otp-auth` phone validation. | Decide and enforce the intended server rule. |
| A-03 | PARTIALLY IMPLEMENTED | Authentication | TOTP/backup-code service exists but is not the active LoginScreen path. | `services/otp.service.ts` versus `AuthContext`/`otp-auth`. | Classify as legacy or document its actual admin use. |
| A-04 | UNVERIFIED | Authorization | Client permission contexts are parallel/partly legacy; active imports and final server behavior need reconciliation. | `contexts/PermissionsContext.tsx`, `hooks/usePermissions.ts`, permission migrations. | Complete route-to-RPC/RLS matrix. |
| AT-01 | VERIFIED | Attendance | Online check-in/out use protected RPCs and validate committed responses. | `services/attendance.service.ts`, `DashboardScreen.tsx`, `AttendanceScreen.tsx`. | Include in attendance SOP. |
| AT-02 | VERIFIED | Attendance | Offline actions use durable outbox, original capture timestamps, idempotency, and dedicated sync RPCs. | `offline-attendance.service.ts`, `DurableWriteOutbox`, `offlineAttendanceFlow`, `20261012140000_offline_attendance.sql`. | Test retry/conflict paths. |
| AT-03 | VERIFIED | Attendance | Employee regularization types are EARLY_CHECKOUT and MISSED_CHECKOUT only. | `attendance-regularization.service.ts`, regularization screen/RPCs. | Keep absent-day guidance in Backdated workflow. |
| AT-04 | VERIFIED | Attendance Control | Active Admin route loads `AttendanceControlScreenNew`, including direct audited correction and biometric reconciliation. | `AdminStackNavigator.tsx`, `AttendanceControlScreenNew.tsx`, `rpc_admin_correct_attendance`. | Clarify legacy screen status. |
| AT-05 | VERIFIED | Events | Event attendance is a separate geofenced workflow with dedicated event check-in/out RPCs. | `event.service.ts`, `DashboardScreen.tsx`, event migrations. | Add event SOP section. |
| AT-06 | UNVERIFIED | Canonical attendance | Final precedence/evidence-combination rule depends on the deployed canonical RPC/view; repository has historical replacements. | `canonical-attendance.service.ts`, canonical migrations. | Resolve migration chain and live schema. |
| AT-07 | PARTIALLY IMPLEMENTED / RISK | Attendance schema | Multiple historical/combined SQL definitions may diverge from current production objects. | `supabase/migrations`, combined/superseded SQL. | Build authoritative replacement map. |
| AT-08 | UNVERIFIED | Biometric | Provider, scheduled sync, webhook, mapping, and Edge Function runtime behavior are not proven live. | biometric services/functions/migrations. | Controlled staging integration test. |
| LT-01 | VERIFIED | Location | Native Android tracking and web foreground tracking are distinct; web has no reliable locked-screen tracking. | `LocationTrackingContext.tsx`, `backgroundLocationTask.ts`. | State platform limitation in SOP. |
| LT-02 | VERIFIED | Location | Location writes are server-mediated through `record_location_ping`; direct insert is not provided in the inspected migration. | `20260723000000_attendance_background_location.sql`. | Validate deployed RPC. |
| LT-03 | VERIFIED | Field visits | Field visit state mutations require server-confirmed id/status/timestamp. | `services/field-visit.service.ts`. | Include operational checks. |
| LT-04 | VERIFIED | Field evidence | Current-location fallback creates an auditable child/review row and is collapsed only in employee display. | `current-location-visit.service.ts`, field-visit migrations. | Train reviewers. |
| LT-05 | PARTIALLY IMPLEMENTED | Field evidence | Storage/upload/review depends on deployed bucket policies and Edge Function configuration. | `field-visit-evidence-upload`, storage migrations. | Perform staging upload/review test. |
| LT-06 | VERIFIED | Notifications | Geofence/push/journey notification delivery is asynchronous and queue-based. | notification Edge Functions and outbox tables. | Monitor queue/delivery logs. |
| LT-07 | UNVERIFIED | Location | Real Android background behavior and battery/permission outcomes need device verification. | native bridge/tests. | Execute Android acceptance test. |
| WF-01 | VERIFIED | Leave | Employee submit/cancel/review wiring uses leave RPCs. | `services/leave.service.ts`. | Include SOP. |
| WF-02 | UNVERIFIED | Leave | Latest deployed balance, overlap, date-window and approval rules were not live-verified. | leave migrations/RPCs. | DBA/staging verification. |
| WF-03 | VERIFIED | Tasks | Hierarchical task visibility and forwarding are RPC-based. | `services/task-sharing.service.ts`, task hierarchy migration. | Include hierarchy guidance. |
| WF-04 | VERIFIED | Notifications | Notification delivery uses asynchronous outbox/retry paths. | notification Edge Functions. | Include troubleshooting. |
| WF-05 | VERIFIED | Events | Event attendance is separate from ordinary attendance. | `services/event.service.ts`. | Do not substitute workflows. |
| WF-06 | VERIFIED | Support | Tickets persist before WhatsApp best-effort notifications. | `services/support-ticket.service.ts`. | Use ticket row as source of truth. |
| DB-01 | VERIFIED | Database | Supabase/Postgres is system of record; critical writes are RPC-mediated. | `lib/supabase.ts`, services/migrations. | Include technical SOP. |
| DB-02 | UNVERIFIED | Database | Applied production migration set is not established from repository files. | migration directory/deployment metadata. | Obtain schema snapshot. |
| DB-03 | DEFECTIVE (risk) | Release | Required schema/Edge versions in `release.config.json` lag latest migration filenames. | `release.config.json`, migrations. | Reconcile release manifest. |
| DB-04 | DEFECTIVE | OTP | Client Indian-prefix validation and server ten-digit-only validation disagree. | `LoginScreen.tsx`, `otp-auth/index.ts`. | Enforce one server contract. |
| DB-05 | VERIFIED | Integrations | Webhook/service-role boundaries exist without exposing secret values here. | Edge Functions. | Verify environment configuration. |
| DB-06 | PARTIALLY IMPLEMENTED | Configuration | Maps fallback configuration needs production restriction/secret review. | `app.config.js`. | Security review. |
| DEP-01 | DEFECTIVE | Build | Full TypeScript check fails in `scratch.tsx` (lines 1 and 407). | `npm run typecheck` output. | Remove/quarantine scratch file before release. |
| DEP-02 | DEFECTIVE | Tests | Current Jest run: 45 suites pass, 7 fail; 314 tests pass, 25 fail. | `npm test` output. | Triage failures and rerun. |
| DEP-03 | VERIFIED | Build | Location TypeScript project check passes. | `npm run typecheck:location`. | Keep in CI. |
| DEP-04 | UNVERIFIED | Deployment | Web/EAS deployment scripts exist but were not executed in this audit. | `package.json`, scripts. | Controlled staging deployment. |
| DEP-05 | UNVERIFIED | Recovery | Production backup/restore schedule and restore evidence were not found. | scripts/configuration. | Obtain owner-backed recovery evidence. |
| DEP-06 | DEFECTIVE (risk) | Release | Release metadata/version gate is inconsistent with repository migration chronology. | `release.config.json`. | Release-control remediation. |

## Status definitions

- **VERIFIED** — supported by inspected executable source and, where runtime behavior matters, a recorded reproducible test or read-only deployment inspection.
- **PARTIALLY IMPLEMENTED** — meaningful source path exists, but a dependency, route, deployment, error path, or end-to-end confirmation is missing.
- **NOT IMPLEMENTED** — no current executable path was found after a scoped search.
- **DEFECTIVE** — executable behavior contradicts its contract, creates an unsafe result, or fails a reproducible test.
- **UNVERIFIED** — evidence exists but cannot establish current runtime/deployment behavior.

## Update 2026-10-19: evidence closure

Status is now tracked in separate dimensions: **Documented / Source / Test / Staging / Production**. Staging and production stay UNVERIFIED until the owner runs `supabase/manual/2026-10-19_readonly_release_evidence.sql` before and after deploying.

| ID | Documented | Source | Test | Staging | Production | Finding |
|---|---|---|---|---|---|---|
| E-01 | yes | fixed | PASS | — | — | `npm run typecheck` failed only because of `scratch.tsx` (an unreferenced broken fragment). Removed. |
| E-02 | yes | fixed | PASS | — | — | Web live-journey route used the Routes API, which this key cannot use (403), so no road route drew. Restored `DirectionsService`. |
| E-03 | yes | marked | n/a | — | — | `supabase/deploy_all_20260908_enhancements.sql` is historical. Running it rolls newer functions back. Header "DO NOT RUN" added; its generator script has a syntax error. |
| E-04 | yes | partial | FAIL (owner) | — | — | OTP request idempotency (request_id / challenge_id / retry_after) was prepared in the DB but never implemented in `otp-auth` or the app. |
| E-05 | yes | built | PASS | — | — | Smart report query is wired into Advanced Attendance (2026-10-19). |
| E-06 | yes | n/a | n/a | — | — | `lib/network/RefreshScheduler.ts` and `ResourceCache.ts` are unused library code. |
| E-07 | yes | fixed | PASS (SQL) | UNVERIFIED | UNVERIFIED | Suspicious attendance, regularization/corrections, task hierarchy and push requeue are covered by `supabase/tests/release_2026_10` (fresh-DB, self-asserting, including negative authorization cases). |
