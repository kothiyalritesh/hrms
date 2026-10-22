# Audit and Prior-Document Reconciliation

## Documents compared

- `AUDIT_EXECUTIVE_SUMMARY.md`
- `AUDIT_DELIVERABLES_INDEX.md`
- `MIGRATION_AUDIT_REPORT.md`
- `docs/BUG_AUDIT_2026-10-09.md`
- `docs/ENTERPRISE_ATTENDANCE_REPORTING_V4.md`
- `docs/HRMS_IMPLEMENTATION_REVIEW_AND_AUDIT.md`
- `docs/HRMS_PRODUCTION_AUDIT_2026-10-07.md`
- `docs/LOCATION_TRACKING_AUDIT_2026-10-08.md`
- `docs/RELIABILITY_AUDIT_2026-10-12.md`
- `docs/realtyhrm-audit/*`

## Reconciliation result

| Prior-document claim/theme | Current repository evidence | SOP treatment |
|---|---|---|
| “Audit complete / issues fixed / ready for staging” | Current full typecheck fails and Jest has 25 failing tests; live deployment is unavailable | historical claim retained as context, not current release evidence |
| Corrected migration and prerequisite object list | Migrations contain later replacement definitions and unresolved deployment provenance | technical manual requires object/signature/applied-version verification |
| Canonical attendance/reporting v3 | Client uses canonical range RPC/view and historical SQL has multiple definitions | no fixed precedence claim; live RPC is authoritative |
| Biometric auto-checkout/import | Client/Edge/migration paths exist; provider/deployed runtime is not verified | documented as source-implemented, runtime UNVERIFIED |
| Location tracking reliability | source has native/background/web paths and tests; device and provider behavior not verified | web limitation explicit; Android acceptance required |
| Anonymous feedback privacy model | prior report describes confidential/auditable model; source/migration must be checked in target environment | documented as confidential/auditable only where deployed RLS/audit confirms |
| Release/deployment readiness | `release.config.json` required schema/function versions lag latest migration filenames | release blocker KD-06 |

## Prior bug-audit items rechecked against current source

| Prior item | Current source observation | Current SOP status |
|---|---|---|
| BUG-01 notifications Clear All | `NotificationsScreen.clearAll` now checks delete error and clears UI only after success; deployed DELETE policy is still unverified | PARTIALLY IMPLEMENTED |
| BUG-02 duplicate ticket submit | `RaiseTicketScreen` now passes `loading`/`disabled={submitting}`; server/RLS still require staging confirmation | SOURCE FIX PRESENT |
| BUG-04 profile edit | `ProfileScreen` calls `rpc_update_my_profile` for name/avatar/address instead of direct profile update | SOURCE FIX PRESENT; deployment unverified |
| BUG-05 duplicate migration version | migration history still requires applied-version check; do not assume CLI behavior from filename alone | UNVERIFIED |
| BUG-08 event video/photo | current audit treats video as not implemented; existing event-photo behavior must be verified before use | NOT IMPLEMENTED/UNVERIFIED |
| BUG-09 activity analysis scope | catalog contains `activity_analysis.view`; service has scoped RPC plus fallback | PARTIALLY IMPLEMENTED until RLS/live function verified |
| BUG-12/13 download centre | current screen uses `exportWorkbook`/`exportSheets`, month limits, status/error notices and separate report builders; native/browser support still needs execution | SOURCE FIX PRESENT; runtime unverified |
| BUG-10 office settings layout | source/layout was not runtime-tested at device/browser sizes | UNVERIFIED |
| BUG-11 task control visibility | task permissions/menu behavior remains scope-driven; static tests and live route behavior need confirmation | PARTIALLY IMPLEMENTED |
| Location phases 1–5 | repository includes later migrations/app changes and location tests, but production migration/APK rollout is not proven | PARTIALLY IMPLEMENTED/UNVERIFIED |
| Production audit S-1/S-2/S-3 security concerns | current source uses protected RPCs for major writes, but direct table privileges/RLS in target environment are not available | UNVERIFIED, high risk |

## Scope and navigation correction

The repository recheck confirms that `PayrollScreen.tsx` and `ProjectsScreen.tsx` are source artifacts, not active routes in the inspected tab, home, admin or reports navigators. Payroll uses client-side `PayrollStorage` and is outside the active RealtyHRM HRMS scope. The active project administration route is `TaskProjectControlScreen`; the standalone project screen is not documented as an operational route. `AttendanceStackNavigator`/`SiteVisitApprovalsScreen` likewise remain unmounted candidates. These decisions are recorded in `19_SCOPE_AND_APPROVAL_REGISTER.md` and `16_COVERAGE_MATRIX.md`.

The role manuals use the source-verified active entries `MainTabNavigator` → Home/Tasks/Profile/HR Panel/Reports (with conditional My Team), then the corresponding Home, Admin and Reports stack routes. Runtime deep links, deployed bundles and permission-driven visibility remain staging verification items.

## Conflicts requiring owner decision

1. Whether failing static tests represent stale contracts or regressions.
2. Which migration/function version is authoritative in each environment.
3. Whether OTP request/challenge/retry fields are required security UX or obsolete test expectations.
4. Whether saved-site caching/UI changes are intentional or incomplete.
5. Whether network resilience six-state behavior is a required acceptance criterion.

The expanded SOP does not convert prior narrative “fixed” statements into VERIFIED operational claims without current source/test/deployment evidence.

