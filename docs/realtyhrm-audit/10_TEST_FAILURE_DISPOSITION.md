# Test Failure Disposition Register — 2026-10-19

Basis: commit `bcb28f3` plus the working tree of 2026-10-19. Commands were run from the repository root on Windows (`core.autocrlf=true`). Raw outputs are in `evidence/`.

| Gate | Before | After | Evidence |
|---|---|---|---|
| `npm run typecheck` (`tsc --noEmit`, full `tsconfig.json`) | FAIL: 4 errors, all in `scratch.tsx` | **PASS** (exit 0) | `evidence/2026-10-19_typecheck_before.txt`, `evidence/2026-10-19_typecheck_after.txt` |
| `npm test` (`jest --runInBand`) | 25 failed / 314 passed, 7 suites failing | **3 failed / 334 passed**, 2 suites failing (all 3 await an owner decision) | `evidence/2026-10-19_jest_before.txt`, `evidence/2026-10-19_jest_after.txt` |
| SQL release scenarios (`supabase/tests/release_2026_10/run.ps1`) | not repeatable (ad-hoc scripts) | **PASS**: 4 scenarios, 111 assertions, run on a fresh local PostgreSQL 17 | `evidence/2026-10-19_release_scenarios.txt` |

Correction to earlier statements: before 2026-10-19, "typecheck clean" reports in this project came from a private config that excluded `scratch.tsx`. They described production source only, not the `npm run typecheck` gate. The gate itself failed until `scratch.tsx` was removed.

Classification: **REGRESSION** = the code broke intended behaviour. **STALE** = the test asserts a design that was replaced or never shipped; the test was rewritten to cover the current behaviour, with the reason in a code comment. **PLATFORM** = the test was only wrong on Windows checkouts. **OWNER** = the intent is unclear, so the test is left failing for a decision.

## Typecheck

| Item | Error | Root cause | Decision |
|---|---|---|---|
| `scratch.tsx` | TS1128/TS1005 at 1:62–407:11 | Tracked, unreferenced, syntactically broken paste of a fragment of `AttendanceControlScreenNew.tsx` (committed in d322105). No file imports it. | **Removed** with `git rm` (history keeps it). Not excluded in tsconfig, which would hide it. |

## Jest: 25 original failures

| # | Suite › test | Actual error | Class | Root cause / decision |
|---|---|---|---|---|
| 1 | savedSiteSelectionFix › exports default predefined sites | `([] as any[]).length >= 8` | STALE | The test had been edited to assert a literal empty array, so it could never pass. Saved sites come only from `predefined_sites` (no built-in list, so nothing is invented). Rewritten to cover `getAll()`, including the error path returning `[]`. |
| 2 | › checkGeoFence | `undefined.latitude` | STALE | Same gutting. Rewritten with a fixture site. |
| 3 | › persistent caching key | `AsyncStorage.setItem` missing | STALE | The service has no local cache (deliberate: DB is the source of truth). Replaced by the nearest-in-range test. |
| 4–7 | › tabs / search / selected styling / inline card | `activeTab === "saved"`, `siteSearch`, `st.siteCardSelected`, `st.inlineDestinationCard` missing | STALE | The picker uses a collapsible "Saved Sites" list plus a destination card. Rewritten to assert that flow. **UX note:** there is no search inside saved sites; add it if the list grows. |
| 8 | networkResilience › 6 attendance states | `setAttendanceState("SUBMITTING")` missing | STALE | A named six-state machine never existed in any committed `DashboardScreen` (`git log -S` finds none). The shipped design has a busy flag, an offline "waiting to sync" state from the durable outbox, and server idempotency. Rewritten to assert those. |
| 9 | › idempotencyKey into check-in | `idempotencyKey: operationId` missing | STALE | Idempotency is generated in the service (`params.idempotencyKey ?? Crypto.randomUUID()` → `p_idempotency_key`). Offline actions use `operation_id`. Rewritten. |
| 10 | › PENDING_SYNC / UNKNOWN badges | Text missing | STALE | Actual text: "… waiting to sync (not confirmed yet)" and "Check-out saved offline". Rewritten. |
| 11 | › 500 ms debounce via RefreshScheduler | Missing | STALE | The dashboard coalesces with an in-flight request ref and a 15 s summary cache. `RefreshScheduler`/`ResourceCache` in `lib/network` are **unused library code** (candidate for removal). |
| 12 | › no read-after-write reloads | `updateEmployeeAttendance` missing | STALE (design choice) | The dashboard deliberately re-reads after an attendance change so the card shows the server-confirmed record. Rewritten. |
| 13 | › cached first paint | `getCachedEmployee` missing | STALE | Equivalent: a fresh 15 s cache in `DashboardSummaryService.getEmployee`. Rewritten. |
| 14 | › web refresh button | `webRefreshBtn`, `getLastUpdatedText` missing | STALE | Renamed: `formatUpdatedAge`, "Updated just now". Rewritten. |
| 15 | › secondary failures non-destructive | Exact string missing | STALE | The behaviour exists: event failures set `eventsLoadError` only. Rewritten to check that `setDashboardLoadError` is not called there. |
| 16 | scopedPermissionsMatrix › deploy SQL contains migration | Missing in `deploy_all_20260908_enhancements.sql` | STALE + **hazard** | The 2026-09-08 bundle is a historical snapshot. Its generator (`scripts/compile_master_sql.js`) has a syntax error (missing comma), so it was never regenerated, and **running it today would roll newer functions back**. It now carries a "HISTORICAL BUNDLE - DO NOT RUN" header. The test checks that the migration ships in `supabase/migrations`, the real deployment source. |
| 17 | › Dashboard gates Permissions Manager behind isAdmin | `isAdmin ? (` missing | STALE | Since permission engine v2 (20261007100000), the screen is gated by `permissions.view`/`permissions.assign`. Admins hold these; others only by explicit grant. Enforced by the route guard and the server. Rewritten. |
| 18 | › stack registers route only for isAdmin | `{isAdmin && (` missing | STALE | Same. The route is wrapped in `withPermissionGuard(…, SCREEN_PERMISSIONS.PermissionsManager)`. Rewritten. |
| 19 | productionHardening › cold-start notification bridge | Multi-line string not found | PLATFORM | The index stores LF and the Windows checkout converts to CRLF. The `read()` helper now normalises line endings. |
| 20 | › regularization classified server-side | Multi-line string not found | PLATFORM | Same fix. |
| 21 | › today's report via `rpc_admin_attendance_daily_v3` | Missing | STALE | The service now reads the single canonical RPC `rpc_attendance_canonical_range`. Assertion updated. |
| 22 | fieldVisitOriginRepair › web journey route | `maps.DirectionsService()` missing | **REGRESSION (fixed)** | `ActiveJourneyCard.web.tsx` had been switched to the Routes API, which this project's Google key cannot use (403 `API_KEY_SERVICE_BLOCKED`, checked 2026-10-14). So **the road route never drew on the web**. Restored Maps JS `DirectionsService`, with a straight-line fallback. |
| 23 | enterpriseAttendanceReporting › smart queries in the report screen | `parseAttendanceReportQuery` not used by `AdvancedAttendanceReportScreen` | **BUILT 2026-10-19** | Owner chose to build it. A "Smart report" panel parses the request, loads that period, matches team/office/manager/role names against values present in the data (warning instead of guessing when none match) and applies the filters and section. The test now passes. Also added absent/present/leave/holiday/weekly-off matching to the status filter, and renamed the "Mismatch" metric to "Source mismatch". |
| 24 | otpSecurityAndIdempotency › request_id / challenge_id / retry_after in the Edge Function | Missing | **OWNER** | Migration `20260911010000` prepared the columns, but `otp-auth` never used them (not in git history). Today's protections still hold: phone and IP rate limits, attempt cap, hashed OTP. Not covered: a repeated tap can send a second SMS, and verify is not bound to a challenge id. Building this changes the login flow and needs an Edge deploy plus an SMS test. |
| 25 | › wired through AuthContext / LoginScreen | Missing | **OWNER** | Same decision as #24. |

## Tests changed because of the release-config update (not failures before)

| Test | Change | Reason |
|---|---|---|
| enterpriseAttendanceReporting › pins the release contract | Exact `"20260810000000"` → `>= 20260810000000` | The release now requires `20261015130000`. |
| productionHardening › declares every Edge Function | "Function contains the app's schema version" → "function reports the version in `release.config.json`, and its own minimum schema is ≤ the release's" | Stricter, so a deploy is verifiable, and unchanged functions need no redeploy just to change a label. |
| salesManagerPosition › hierarchy UI | "Sales Manager Positions" → "role not allowed under Sales Manager" | 2026-10-15 Team Hierarchy redesign. The rule is still enforced (`canAssignReportingManager` / `canReportToSalesManager`). |
| salesManagerPosition › Sales Manager not hidden | `SALES_ROLES` list → "My Team follows the reporting line, not role names" | 2026-10-20 Permission Manager v3: tabs follow access (`get_my_access`). My Team shows for anyone with reports, so no role list can hide a Sales Manager. |
| permissionsGrantFix › PermissionsContext sanitizes input | → "usePermissions never caches a failed load and refreshes live" | The unused `contexts/PermissionsContext.tsx` was removed; validation lives in the server RPCs. |

## Open owner decisions

1. **OTP idempotency (#24–25):** implement it, or formally accept the current flow and retire the two assertions.
2. ~~Smart report query (#23)~~: built on 2026-10-19.
3. **Unused `lib/network/RefreshScheduler.ts` and `ResourceCache.ts`:** remove them or adopt them.
4. **Historical SQL bundle and its broken generator:** consider deleting both so nobody runs them.
