# Known Defects, Limitations and Risks

| ID | Classification | Defect/limitation | Evidence | Operational impact | Required disposition |
|---|---|---|---|---|---|
| KD-01 | DEFECTIVE | Full TypeScript check fails because `scratch.tsx` is syntactically malformed. | `npm run typecheck` output | release cannot claim clean typecheck | quarantine/fix only with separate authorization, then rerun |
| KD-02 | DEFECTIVE | Seven Jest suites / 25 tests fail in current checkout. | `13_TEST_EVIDENCE_REGISTER.md` | release confidence reduced | triage each contract and add integration coverage |
| KD-03 | DEFECTIVE/RISK | OTP UI enforces Indian 6–9 prefix; `otp-auth` server normalization only requires ten digits. | `LoginScreen.tsx`, `otp-auth/index.ts` | direct function path may accept an unintended number format | enforce one server-side contract |
| KD-04 | PARTIALLY IMPLEMENTED | OTP idempotency/challenge/retry response fields expected by tests are not wired through AuthContext/LoginScreen. | OTP static test and source | retry UX/security contract unclear | security design review and controlled test |
| KD-05 | UNVERIFIED | Production canonical attendance RPC/view and source reconciliation precedence are not proven. | migration replacement chain, `canonical-attendance.service.ts` | report/correction decisions may differ by environment | live schema verification |
| KD-06 | UNVERIFIED | Production migration and Edge Function versions are not established; release metadata lags migration filenames. | `release.config.json`, migrations | deployment drift risk | reconcile manifest/environment |
| KD-07 | PARTIALLY IMPLEMENTED | Web tracking is foreground-only; native background tracking/device behavior is not device-verified. | `LocationTrackingContext.tsx`, background task | locked-screen arrival/ping gaps | Android acceptance test |
| KD-08 | PARTIALLY IMPLEMENTED | Saved-site tests find no expected fixture/site data and UI contract markers differ. | `savedSiteSelectionFix.test.ts`, predefined site/UI source | saved-site selection/geofence may be unavailable or changed | verify seed, service and active modal |
| KD-09 | PARTIALLY IMPLEMENTED | Network resilience test expects a six-state dashboard/cache/scheduler contract absent from current source. | `networkResilience.test.ts` | user-visible offline/realtime state may be less explicit | define and test accepted state machine |
| KD-10 | PARTIALLY IMPLEMENTED | Advanced attendance report query parser expectation is absent. | `enterpriseAttendanceReporting.test.ts` | malformed/oversized report queries may not be handled as designed | inspect active parser/limits |
| KD-11 | UNVERIFIED | Biometric provider, schedules, webhook secrets, mapping and deployed sync behavior are not live-verified. | Edge Functions/services/migrations | attendance import may fail or duplicate if misconfigured | staging provider test |
| KD-12 | UNVERIFIED | Backup/PITR, storage recovery and Edge Function rollback evidence was not found. | deployment/config audit | recovery time/data-loss risk | owner-backed restore rehearsal |
| KD-13 | RISK | Map configuration fallback requires production key restriction review. | `app.config.js` (value intentionally omitted) | unauthorized map usage/config leakage risk | restrict/manage environment key |
| KD-14 | PARTIALLY IMPLEMENTED | Support/notification external delivery is best-effort after persistence. | support/notification services | users may not receive WhatsApp/push despite saved row | monitor outbox and delivery logs |
| KD-15 | UNVERIFIED | Historical/combined SQL contains multiple definitions of critical RPCs/policies. | `supabase/migrations`, `_superseded`, root scripts | wrong definition could be applied | build authoritative object map |
| KD-16 | UNVERIFIED/HIGH | Prior production audit reported direct employee table privileges for attendance/leave/regularization and self-approval risks. | `docs/HRMS_PRODUCTION_AUDIT_2026-10-07.md` | authorization bypass if still deployed | run read-only privilege/RLS queries before relying on controls |
| KD-17 | PARTIALLY IMPLEMENTED | Prior bug audit reported location tracking/storage/geofence and observer issues; later phase migrations/source claim fixes but rollout is not proven. | `docs/LOCATION_TRACKING_AUDIT_2026-10-08.md`, current location services | unreliable location enforcement if migrations/APK absent | verify migration order, APK, pings, heartbeat and geofence sweep |
| KD-18 | UNVERIFIED | Prior audit reported report/export defects (overtime/geofence/leave usage); current screens contain dedicated builders/fixes but no executed report integration test. | report screens and `docs/BUG_AUDIT_2026-10-09.md` | incorrect attendance/operational exports; payroll exports are outside active scope | run scoped report fixtures and compare canonical rows |

## Not implemented or excluded after review

- No evidence was found that the TOTP/backup-code service is the active employee login path; it is documented as parallel/legacy, not as standard login.
- No repository evidence establishes a production backup schedule or restore execution.
- No source-only evidence can certify provider credentials, scheduled Edge Function execution or Android battery behavior.

