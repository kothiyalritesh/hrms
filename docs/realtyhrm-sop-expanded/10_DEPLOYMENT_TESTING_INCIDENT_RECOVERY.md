# Deployment, Testing and Incident Recovery Manual

## D-01 Pre-release procedure

1. Freeze the source commit and record `package.json` version, build ID and `release.config.json` metadata.
2. Reconcile required backend schema and Edge Function versions with the applied environment.
3. Run `npm run typecheck`, `npm run typecheck:location`, `npm test`, lint and formatting checks required by the release owner.
4. Execute staging smoke tests for OTP, attendance online/offline, canonical reconciliation, biometric import/sync, location, field evidence, notifications, leave, tasks and exports.
5. Verify backup/PITR and a dated restore rehearsal.
6. Publish web/EAS/OTA only after failed checks have owners and accepted risk; record rollback target.

## D-02 Test evidence currently recorded

| Command | Result | Evidence interpretation |
|---|---|---|
| `npm test -- --listTests` | exit 0 | 52 Jest suites discovered; discovery only |
| `npm run typecheck:location` | exit 0 | location project checks successfully |
| `npm run typecheck` | exit 1 | `scratch.tsx` syntax errors at lines 1 and 407 |
| `npm test` / Jest JSON run | exit 1 | 52 suites; 45 passed, 7 failed; 339 tests; 314 passed, 25 failed |

## D-03 Incident procedure

1. Classify impact: authentication, attendance, payroll/reporting, location/privacy, notification, or release.
2. Preserve safe evidence: time, user/request ID, route, build ID, error code, server row/audit ID and environment.
3. Stop duplicate writes/retries for the affected operation; keep original idempotency key.
4. Apply only documented recovery (retry queue, refresh session, restore permission, rollback release, or route to HR/DB owner).
5. Verify the server record, audit event and user-visible state after recovery.
6. Close with root cause, corrective action, test evidence and follow-up owner.

## D-04 Troubleshooting matrix

| Symptom | Diagnostic evidence | Likely root cause | Corrective action | Verification |
|---|---|---|---|---|
| Full typecheck fails | `npm run typecheck`, `scratch.tsx` lines 1/407 | malformed scratch artifact included by tsconfig | remove/quarantine only with separate authorization; rerun typecheck | exit 0 and clean diff |
| Jest contract failure | failing suite/test and expected-vs-received source string | stale test contract, renamed implementation, or missing feature | inspect test and current source; decide test update vs authorized code fix | targeted Jest test passes with rationale |
| OTP retry/idempotency test fails | `otpSecurityAndIdempotency.test.ts`; expected request/challenge/retry fields | Edge Function has request ID path, but AuthContext/LoginScreen response wiring is absent or changed | reconcile contract in design review; do not claim feature complete | targeted test + controlled Edge Function test |
| Saved sites unavailable | `savedSiteSelectionFix.test.ts`; zero sites/undefined coords/cache markers | predefined-site fixture/service/UI contract drift | inspect `predefined-site.service.ts`, seed/migration and SitePickerModal; stage data/contract test | saved-site flow and geofence test |
| Scoped permission test fails | expected compiled migration/guard strings absent | combined SQL/test fixture is stale or active route guard changed | reconcile migration provenance and active guard; verify server permission | permission scenario SQL + targeted Jest |
| Dashboard resilience test fails | missing six-state strings/scheduler/cache hooks | network-resilience implementation is incomplete or test targets prior design | inspect `DashboardScreen`/`dashboard-summary.service`; define accepted state machine | offline/realtime staging test |
| Advanced report test fails | `parseAttendanceReportQuery` expected but absent | report query parser contract drift | inspect `AdvancedAttendanceReportScreen` and report helper; document actual limits | report query unit/integration test |
| Field origin test fails | expected `maps.DirectionsService()` absent in journey component | route calculation moved to another component/service or browser/native split | trace active map component and platform implementation | web and Android navigation test |
| Location/notification missing | outbox, token, session, worker logs | permission, queue, provider or Edge Function config | inspect each boundary; retry only idempotently | database row + delivery record |

## D-05 Recovery ownership

- HR: employee/leave/attendance decision and evidence.
- Team Lead: team scope/hierarchy and task workflow.
- System Administrator: users, permissions, configuration, releases and auth/device revocation.
- Database/Technical Operations: migrations, RPC/RLS, queues, Edge Functions, backups and provider configuration.
- Security/Privacy owner: location, tokens, exports, anonymous feedback and incident containment.

