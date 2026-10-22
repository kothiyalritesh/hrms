# Scope, Baseline and Approval Register

**Baseline:** Expanded repository-audited SOP, reviewed 19 October 2026.  
**Document status:** Current documentation baseline; not a production-readiness certification.

## Product scope decision

The active RealtyHRM operating scope is HR, attendance, leave, field activity, location, tasks, support, reporting and administration. Payroll processing, salary calculation, payslip generation and other financial functionality are **outside the active product scope** unless the product owner formally changes that decision.

### Payroll and project screen disposition

Repository evidence shows:

- `screens/PayrollScreen.tsx` exists, but reads `PayrollStorage` from `utils/storage.ts` (local client storage) and is not registered in `navigation/MainTabNavigator.tsx`, `navigation/HomeStackNavigator.tsx`, `navigation/AdminStackNavigator.tsx` or `navigation/ReportsStackNavigator.tsx`.
- `screens/ProjectsScreen.tsx` is also present as a source artifact but is not an active route in the inspected navigators; project administration is represented by the active `TaskProjectControlScreen` route.
- `navigation/AttendanceStackNavigator.tsx` and `SiteVisitApprovalsScreen` exist, but the attendance navigator is not mounted by `MainTabNavigator.tsx`.

Therefore `PayrollScreen`, the local payroll storage helpers and the unrouted project screen are classified as **legacy/unmounted and excluded from active operational SOP procedures**. They must not be used as evidence that payroll or financial functionality is supported. Any future activation requires a product-owner scope decision, a security/data review, a route registration review and separate acceptance testing.

## Navigation verification register

| Verified entry | Source evidence | SOP treatment |
|---|---|---|
| Home, Tasks, Profile, HR Panel, Reports and conditional My Team tabs | `navigation/MainTabNavigator.tsx` (`Tab.Screen` declarations) | Active navigation used by the role manuals |
| Employee Home routes | `navigation/HomeStackNavigator.tsx` | Active employee navigation; availability remains permission/device dependent |
| HR/admin routes | `navigation/AdminStackNavigator.tsx` | Active guarded HR/admin navigation |
| Reports routes | `navigation/ReportsStackNavigator.tsx` | Active guarded reports navigation |
| Attendance stack and site-visit approvals | `navigation/AttendanceStackNavigator.tsx`; no mount in `MainTabNavigator.tsx` | Legacy/deep-link candidate; not documented as a standard active route |
| Payroll and unrouted project screens | `screens/PayrollScreen.tsx`, `screens/ProjectsScreen.tsx`; no active route registration found | Explicitly excluded from active SOP |

The navigation statements in the role manuals describe source-verified route ownership. Runtime deep links, remote feature flags, deployed bundles and permission-driven visibility still require staging/device verification.

## Owner approval and release gate

The following approvals are required before the system is described as production-ready:

| Decision/verification | Owner | Evidence required | Status |
|---|---|---|---|
| Confirm product scope excludes payroll/financial processing | Product owner | Written scope decision or signed change request | OPEN |
| Confirm deployed migrations, RPCs, RLS policies and Edge Function versions | Database/platform owner | Production schema/object/version export with secrets redacted | OPEN |
| Confirm attendance source precedence and biometric provider contract | HR + platform owner | Approved reconciliation policy and successful staging import/replay | OPEN |
| Confirm backup, PITR, restore and Edge Function rollback procedure | Platform/operations owner | Restore drill record and rollback evidence | OPEN |
| Resolve TypeScript and Jest release blockers | Engineering owner | Clean typecheck and approved test report, or risk acceptance | OPEN |
| Verify Android background location, battery and permission-revocation behavior | Mobile QA owner | Device test evidence for supported OS versions | OPEN |
| Accept or remediate known defects KD-01 through KD-18 | Product/security/engineering owners | Signed risk acceptance or linked remediation tickets | OPEN |

Until each applicable item has evidence or an explicit risk acceptance, retain the status **UNVERIFIED/PARTIALLY IMPLEMENTED** in the SOP and release records.

## Change-control rule

Documentation updates may describe observed source behavior, but may not silently convert a legacy screen, an unmounted route or a source-only integration into an approved operational feature. Changes to product scope, route activation, permissions, attendance authority or production controls require a new audit entry and regeneration of the consolidated SOP files.
