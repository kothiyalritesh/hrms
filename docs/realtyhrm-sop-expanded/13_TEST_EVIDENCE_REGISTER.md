# Test Evidence Register

**Execution date:** 19 October 2026  
**Repository state:** current checkout; no application fixes applied.

## Command evidence

| ID | Command | Exit | Result | Interpretation |
|---|---|---:|---|---|
| TE-01 | `npm test -- --listTests` | 0 | 52 suites discovered | discovery only; no assertions executed |
| TE-02 | `npm run typecheck:location` | 0 | passed | location project typechecks |
| TE-03 | `npm run typecheck` | 1 | failed | `scratch.tsx` syntax errors: lines 1 (TS1128 at columns 62/63/65) and 407 (TS1005 missing `}`) |
| TE-04 | `npm test -- --json --outputFile=<temp>` | 1 | 45 suites passed, 7 failed; 314/339 tests passed, 25 failed | release blocker; failures are recorded below |

## Jest failure register

| Suite | Failed assertions | Affected source | Evidence-based interpretation |
|---|---|---|---|
| `__tests__/productionHardening.test.ts` | 3 | `components/NativeShellConnector.tsx`, `screens/admin/AttendanceRegularizationScreen.tsx`, `services/canonical-attendance.service.ts` | Static source-contract expectations do not match current formatting/implementation; tests expect a specific `nativeBridge.on` layout, direct regularization RPC text and `rpc_admin_attendance_daily_v3`, while current code uses a wrapped call/service/canonical RPC path. Requires contract decision, not automatic code change. |
| `__tests__/savedSiteSelectionFix.test.ts` | 7 | `services/predefined-site.service.ts`, `components/SitePickerModal.tsx` | Tests find zero saved-site fixtures and cannot find expected cache/tab/selection marker strings. This may be stale test expectations, missing seed data, or a real UI/service regression; staging data and active component behavior must be checked. |
| `__tests__/scopedPermissionsMatrix.test.ts` | 3 | combined SQL fixture, `screens/admin/AdminDashboardScreen.tsx`, `navigation/AdminStackNavigator.tsx` | Tests expect an older compiled migration name and exact guard syntax (`isAdmin ?`, `{isAdmin && (`); active code uses permission hooks/guards and the canonical migration chain. Reconcile fixture provenance and server permission behavior. |
| `__tests__/networkResilience.test.ts` | 8 | `screens/DashboardScreen.tsx`, `services/dashboard-summary.service.ts`, `lib/network/RefreshScheduler.ts` | Expected six-state strings, scheduler debounce, cache helpers and web-refresh marker are absent from current source. This is either an incomplete resilience implementation or a stale contract; offline/realtime acceptance testing is required. |
| `__tests__/enterpriseAttendanceReporting.test.ts` | 1 | `screens/admin/AdvancedAttendanceReportScreen.tsx` | Expected `parseAttendanceReportQuery` is absent. Report query validation/limits may have moved or may be missing; verify the active report behavior and date/scope constraints. |
| `__tests__/fieldVisitOriginRepair.test.ts` | 1 | active journey/map component(s), `components/VisitDetailModal.tsx`, `services/location/route.service.ts` | Test expects a literal `maps.DirectionsService()` in a different source path; current component uses `google.maps.DirectionsService()`/platform-specific code. Verify web and Android navigation rather than relying on string presence. |
| `__tests__/otpSecurityAndIdempotency.test.ts` | 2 | `supabase/functions/otp-auth/index.ts`, `contexts/AuthContext.tsx`, `screens/LoginScreen.tsx` | Edge Function has request-id code in biometric paths, but OTP test expects `requestId`, `challenge_id` and `retry_after` response wiring not present in current AuthContext/LoginScreen. This is a contract gap requiring security review. |

## Root-cause status

The test suite is predominantly static source-contract testing (`toContain`, regex and fixture assertions), not a live Supabase/device integration suite. Therefore the failures prove repository/test mismatch, not by themselves a production runtime outage. Each failed assertion still requires a disposition:

1. **Keep implementation, update stale test contract** only after code and deployed behavior are verified.
2. **Implement missing behavior** only under separate authorization and change control.
3. **Add integration test/data fixture** where a static test cannot establish the behavior.

## Verification commands after authorized remediation

Run the targeted suite first, then `npm run typecheck`, `npm run typecheck:location`, full `npm test`, lint and staging smoke/integration tests. Record commit, command, exit code and changed failure count.

