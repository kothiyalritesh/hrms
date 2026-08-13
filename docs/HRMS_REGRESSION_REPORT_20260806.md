# HRMS regression report — 6 August 2026

## Automated verification

- TypeScript application check: passed (`tsc --noEmit`).
- Location/background-task TypeScript check: passed (`tsc -p tsconfig.location.json`).
- Jest: 29 suites passed, 158 tests passed, 0 failed.
- New canonical regression coverage verifies IST parsing, midnight business-date boundaries, earliest first-in, checkout precedence, biometric-last-punch evidence isolation, canonical consumer routing, reports navigation, and immutable leave transactions.
- Production web export: passed; Metro generated 40 web bundles from 1,422 modules.
- Linked database migrations: applied and synchronized through `20260806030000`.
- Remote lint: the four new/overridden HRMS functions are clean.

## Attendance and reporting scenarios

| Scenario | Expected result | Result |
| --- | --- | --- |
| App 10:15, biometric 10:05 | Official first-in 10:05, source biometric | Passed by canonical SQL contract test |
| Field visit earlier than app/biometric | Earliest verified field visit is official first-in | Passed by canonical SQL contract test |
| Biometric last punch only | Remains evidence and cannot become official checkout | Passed by canonical SQL contract test |
| Approved regularization checkout | Takes precedence over admin/app/allowed field-visit checkout | Passed by canonical SQL contract test |
| Missing office/policy | Row remains visible as `CONFIG_REQUIRED`; no page-wide failure | Passed by source and type checks |
| Holiday/weekly-off/leave | Shared database calendar resolution supplies attendance and leave-day calculations | Passed by deployed function contract |
| TV display | Uses canonical service, profile visibility flag, active visits, stale GPS, and realtime cleanup | Passed by type/source checks |
| Report navigation | Dedicated Reports stack and permanent `/reports/...` paths | Passed by source contract test |
| Legacy offset-less 10:15 | Displays 10:15 IST, not 15:45 | Passed by Jest |
| UTC date boundary | Business date changes at IST midnight | Passed by Jest |

## Leave and comp-off scenarios

- Monthly casual-leave accrual is exactly one unit per active, non-service employee per month, including HR/Admin roles.
- Accrual is idempotent through the unique employee/type/month ledger key.
- Repeated admin adjustments use a client UUID idempotency key and cannot silently duplicate.
- Negative balances are rejected while the balance row is locked.
- Leave approval creates a debit ledger entry in the same transaction; rejection does not debit.
- Comp-off earnings require an auditable source and approval, consume the oldest unexpired units first, and expire through a compensating ledger entry.
- Direct browser writes to leave balances, transactions, and comp-off earnings are revoked.

## Tracking scenarios

- Attendance check-in starts native tracking even without a field-visit destination.
- Existing adaptive 12/30/60/120-second strategy, foreground service, offline queue, idempotent client event IDs, and retry flow remain active.
- Field visits add destination context but are not required to begin attendance tracking.
- Browser/PWA copy explicitly states that reliable continuous background tracking requires the Android application.
- Diagnostic reasons are normalized for permission, precise-location, GPS, battery-optimization, session-start, offline queue, stale ping, bridge, and server-rejection conditions.

## Release artifacts

- Web output: `dist/` (production export passed).
- Release identity: v1.2.0, build ID `20260806.2`, required schema `20260806030000`.
- Android production build: EAS job `7cc06772-f6f6-4499-af6e-fe514a5bc632` completed successfully, production/store channel, versionCode 8.
- Signed AAB: `builds/Bop-Realty-1.2.0-build-8-production.aab` (75,271,223 bytes).
- AAB SHA-256: `9E1F46BCB47896EDFB184630E6608E6114D163588760040DB3A30D7A26226EF6`.
- EAS artifact: `https://expo.dev/artifacts/eas/B6yl-3Oy1AG2LYTUe4v5FYo_-MTGIy7hNUkEu7UqCGo.aab`.
- All six declared production Edge Functions were redeployed after the schema-contract update. Five public version probes returned `20260806030000`; `notification-dispatch` intentionally rejected the publishable-key probe because its scheduled endpoint requires an exact legacy project-key pair, while its deployed source and contract test contain `20260806030000`.

## Known historical findings outside this repair

Remote lint still reports pre-existing errors in legacy/PostGIS and older unrelated functions (for example `get_deleted_attendance`, legacy transit warnings, and PostGIS helpers). None of the four HRMS functions added or overridden by this repair remain in the lint result. These older findings were not broadened into this attendance/leave repair because doing so would change unrelated production behavior.
