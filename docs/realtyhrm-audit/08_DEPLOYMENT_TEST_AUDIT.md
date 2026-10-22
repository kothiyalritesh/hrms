# Deployment, Backup, Recovery, Testing and Troubleshooting Audit

## Verified commands and evidence

Commands were run from the repository root on 2026-10-19:

| Command | Result | Interpretation |
|---|---|---|
| `npm test -- --listTests` | PASS (exit 0) | 52 Jest test files were discovered. Discovery is not execution. |
| `npm run typecheck:location` | PASS (exit 0) | Location TypeScript project type-checks. |
| `npm run typecheck` | FAIL (exit 1) | `scratch.tsx` has syntax errors at lines 1 and 407. |
| `npm test` | FAIL (exit 1) | 45 suites passed, 7 failed; 314 tests passed, 25 failed, 339 total. |

The failing tests include production-hardening string-contract checks, OTP security/idempotency expectations and other source-contract tests. These failures are evidence of the current checkout, not proof that production behaves identically. They must be triaged before a release claim.

## Build/deploy surfaces

`package.json` provides `export:web`, `deploy:web`, `deploy:web:eas-preview`, `update:installed`, and `update:production`. `export_web.ps1`, `deploy_bop_web.ps1`, `scripts/serve-web-production.js`, EAS configuration and platform app configuration are deployment inputs. This audit did not execute a deployment and therefore does not certify hosting, EAS channels, environment variables, backend migration application or Edge Function versions.

## Backup and recovery

The repository contains database diagnostic/reset/seed scripts, but no verified production backup schedule or restore run was found in the inspected configuration. Treat backup cadence, retention, PITR, storage-bucket recovery and Edge Function rollback as unresolved operational controls. Before go-live, record a dated restore test and owner.

## Troubleshooting runbook anchors

1. Authentication failures: inspect `otp-auth` logs/rate-limit state, Supabase session expiry, and profile active status; never bypass the OTP boundary.
2. Attendance mismatch: compare RPC-confirmed canonical output, attendance audit logs, regularization/correction status, and biometric import batch; do not edit attendance tables directly.
3. Location gaps: verify Android permission/native bridge, tracking session state, `location_tracking`, outbox/dead-letter state, and server `record_location_ping` errors. Web is foreground-only.
4. Field evidence stuck: verify authenticated session refresh, storage object path/ownership, Edge Function and `field_visit_location_audit`; a pending review is not approval.
5. Notification missing: inspect notification row, outbox row, delivery log, push token and Edge Function retry/error fields. WhatsApp is best-effort.
6. Release mismatch: compare `release.config.json` required schema/function versions with applied migration/function versions before publishing.

## Findings

| ID | Finding | Classification | Evidence |
|---|---|---|---|
| DEP-01 | Full typecheck is currently blocked by `scratch.tsx`. | DEFECTIVE | command output |
| DEP-02 | Jest has 7 failed suites / 25 failed tests in current checkout. | DEFECTIVE | `npm test` output |
| DEP-03 | Location-specific typecheck passes. | VERIFIED | `npm run typecheck:location` |
| DEP-04 | Web/EAS deployment scripts exist but were not executed. | UNVERIFIED | `package.json`, scripts |
| DEP-05 | Production backup/restore evidence was not found. | UNVERIFIED | inspected scripts/configuration |
| DEP-06 | Release metadata lags latest migration filenames. | DEFECTIVE (release-control risk) | `release.config.json`, `supabase/migrations` |


## Update 2026-10-19: release gates re-run after remediation

| Command | Result | Evidence |
|---|---|---|
| `npm run typecheck` | **PASS** (exit 0) after removing `scratch.tsx` | `evidence/2026-10-19_typecheck_after.txt` |
| `npm test` | 3 failed / 334 passed. The 3 are open owner decisions (OTP idempotency ×2, smart report ×1) | `evidence/2026-10-19_jest_after.txt` |
| `supabase/tests/release_2026_10/run.ps1` | **PASS**: 4 scenarios, 111 assertions on a fresh local PostgreSQL 17 | `evidence/2026-10-19_release_scenarios.txt` |

Each failure's root cause and disposition: `10_TEST_FAILURE_DISPOSITION.md`. Deployment order, flags, secret names, pre-flight, smoke tests and rollback: `11_DEPLOYMENT_MANIFEST.md`. Production state: run the read-only `supabase/manual/2026-10-19_readonly_release_evidence.sql` before and after deploying. Until then, production remains **UNVERIFIED**.
