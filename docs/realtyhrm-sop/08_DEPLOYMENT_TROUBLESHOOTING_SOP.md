# Deployment and Troubleshooting SOP

## Pre-release gate

1. Reconcile `release.config.json` schema/Edge versions with the applied migration and function versions.
2. Run `npm run typecheck`, `npm run typecheck:location`, and `npm test`; attach outputs to the release record.
3. Run controlled staging checks for OTP, attendance, offline replay, biometric sync, field evidence upload/review, notifications and backup restore.
4. Publish only after failed tests and schema drift are resolved.

Current checkout evidence: location typecheck passes; full typecheck fails in `scratch.tsx`; Jest has 7 failing suites/25 failing tests. These are release blockers until triaged.

## Incident triage

Use the anchors in [deployment/test audit](../realtyhrm-audit/08_DEPLOYMENT_TEST_AUDIT.md). Capture function/table/RPC names, UTC/IST business date, request ID/idempotency key and error code, while redacting secrets and employee-sensitive payloads.

## Recovery

No verified production backup schedule or restore evidence was found in this audit. Database owner must document PITR/backup retention, storage recovery, Edge Function rollback and a tested restore before production approval.

