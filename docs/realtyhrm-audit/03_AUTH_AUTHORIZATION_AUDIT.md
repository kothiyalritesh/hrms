# RealtyHRM Audit — Authentication and Authorization Trace

Status: Static trace completed; live provider and deployed-schema verification remains pending.  
Primary evidence: `screens/LoginScreen.tsx`, `contexts/AuthContext.tsx`, `supabase/functions/otp-auth/index.ts`, `constants/permissionCatalog.ts`, `hooks/usePermissions.ts`, `contexts/PermissionsContext.tsx`, `components/PermissionGuard.tsx`, and permission migrations from `20261006120000` through `20261007130000`.

## 1. Authentication flow

```text
LoginScreen
  -> validates 10 digits and first digit 6–9 in the UI
  -> AuthContext.requestOTP(phone)
  -> Supabase Edge Function otp-auth { action: request }
  -> active profile lookup + rate limit + hashed OTP challenge
  -> SMS provider for ordinary users / configured system-admin path
  -> six-digit OTP entry and resend timer
  -> AuthContext.verifyOTP(phone, otp)
  -> otp-auth { action: verify }
  -> challenge expiry/attempt checks + hash comparison
  -> Edge Function creates/reuses internal Supabase Auth user
  -> returns magic-link token hash
  -> supabase.auth.verifyOtp({ type: "magiclink" })
  -> AuthContext.applyUser + secure session metadata
  -> RootNavigator renders MainTabNavigator
```

### Verified implementation details

- `LoginScreen.handleSendOTP` accepts only a 10-digit value matching `/^[6-9]\d{9}$/`; the user-visible error explicitly describes an Indian mobile number.
- `LoginScreen.handleVerify` requires six digits and automatically attempts verification when all six input cells are filled.
- `AuthContext.requestOTP` and `verifyOTP` invoke the `otp-auth` Edge Function and normalize digits to the final ten digits before the call.
- `supabase/functions/otp-auth/index.ts` hashes OTP values with a per-challenge salt, stores expiry/attempt data, rate-limits requests to three in ten minutes, rejects expired/locked challenges, and increments failed attempts.
- The Edge Function uses a service-role Supabase client and creates a synthetic internal auth email/magic-link session. The internal email is not a user-facing login mechanism.
- `AuthContext` persists the user profile and session metadata, listens for auth changes, auto-refreshes sessions, and on logout closes device session state, deactivates push token, stops tracking, clears offline queues, removes channels, and signs out locally.
- `App.tsx` and `RootNavigator.tsx` control authenticated versus unauthenticated navigation.

## 2. Authentication findings

| ID | Status | Finding | Evidence / impact |
|---|---|---|---|
| A-01 | VERIFIED | The current user-facing login is phone + six-digit OTP. | `LoginScreen.handleSendOTP`, `handleVerify`, `AuthContext.requestOTP/verifyOTP`, `otp-auth` Edge Function. |
| A-02 | PARTIALLY IMPLEMENTED / RISK | UI and Edge Function phone validation differ. | UI requires first digit 6–9; `otp-auth` only checks ten digits. Direct Edge Function invocation could accept a non-Indian ten-digit value if a profile exists. Confirm whether India-only validation belongs server-side. |
| A-03 | PARTIALLY IMPLEMENTED | `services/otp.service.ts` contains a TOTP/backup-code implementation, but the active LoginScreen uses `otp-auth` SMS/magic-link flow. | TOTP code may be legacy/admin credential support; it must not be described as the standard employee login without route/call-site evidence. |
| A-04 | UNVERIFIED | SMS delivery, system-admin credential path, challenge table/RLS, and Edge Function deployment version are not proven live by source alone. | Requires controlled staging/live provider check without exposing secrets. |
| A-05 | VERIFIED | Logout performs broad local cleanup and local Supabase sign-out. | `AuthContext.logout`; external revocation behavior still needs live verification. |

## 3. Authorization layers

### Client layer

`constants/permissionCatalog.ts` defines canonical permissions, aliases, modules, scope support, and risk. `hooks/usePermissions.ts` fetches `get_my_permissions`, canonicalizes aliases, grants data-admin behavior for `SYSTEM_ADMIN`, `SUPER_ADMIN`, `ADMIN`, `HR`, and `HRD` as configured, and maps `SCREEN_PERMISSIONS` to route visibility. `PermissionsContext.tsx` is an older/parallel context with legacy permission constants and client scope checks; it must be reconciled against the active `usePermissions` imports before finalizing the technical SOP.

`PermissionGuard.tsx` and the guarded Reports/Admin route factories prevent an unauthorized client from opening a route. This is a UX gate, not a substitute for server authorization.

### Database layer

The permission-engine migrations define or replace the following important functions and controls:

- `hrms_active_grants` — active user and role-template grants.
- `hrms_has_permission` — capability check, with permission-management checks delegated to `hrms_is_permission_admin`.
- `hrms_require_permission` — raises an authorization error for protected operations.
- `hrms_is_permission_admin` — permission-grant/revoke role or delegated-grant check.
- `authorized_user_ids` — resolves scope membership for list/RLS/report queries.
- `can_access_user_data` — target-user data check; self and data-admin paths are handled in the function.
- `get_my_permissions`, `get_permission_catalog`, `get_user_permission_grants` — client/admin read APIs.
- `admin_grant_permission`, `admin_revoke_permission` — server-side grant/revoke RPCs, with scope and actor checks, and a later signature supporting expiry.
- role-template grant/revoke RPCs — restricted to System Admin/Admin in `20261007100000_permission_engine_v2.sql`.

The database also revokes public/anonymous execution for sensitive functions and grants selected execution to `authenticated`. User-permission tables and other data tables use RLS/policies; the final audit must extract the current policy text after migration replacement order is resolved.

## 4. Permission administration policy derived from code

- Permission-admin roles are normalized as `SYSTEM_ADMIN`, `SUPER_ADMIN` alias, and `ADMIN` in `hrms_is_permission_admin`.
- A non-admin may be allowed to grant or revoke based on an active delegated `permissions.assign` or `permissions.revoke` grant.
- A delegated user cannot grant to themselves and cannot grant/revoke `permissions.*` rights; the database enforces separation of duties.
- Data-admin roles include `SYSTEM_ADMIN`, `SUPER_ADMIN`, `ADMIN`, `HR`, and `HRD` in the canonical catalog comments/functions, but the permission-management exception remains important.
- A grant may be scoped to `GLOBAL`, `OFFICE`, `OFFICE_TREE`, `TEAM`, `TEAM_TREE`, `REPORTS_TO`, `DEPARTMENT`, `ASSIGNED`, or `SELF`, subject to the active migration schema. Scope targets may be offices, teams, profiles/reporting lines, or departments.
- The Permission Manager supports People, Role templates, Simulator, and History tabs. The screen requires a reason of at least five characters for high-risk grants; this is client behavior and must be checked against the final server function as well.

## 5. Authorization trace to a protected report

```text
MainTabNavigator / ReportsStackNavigator
  -> SCREEN_PERMISSIONS[route]
  -> usePermissions.hasPermission / PermissionGuard
  -> screen loads a service or RPC
  -> database RPC calls hrms_require_permission or authorized_user_ids
  -> RLS/policy and function authorization apply data scope
  -> response is rendered only for authorized rows
```

This pattern must be traced separately for each report because some screens use direct table reads, some use admin RPCs, and some depend on canonical attendance or specialized views. The audit will not infer uniform security from the shared route guard.

## 6. Pending authorization verification

1. Deduplicate the two client permission contexts and identify every import in active routes/screens.
2. Extract unique permission keys and aliases from `permissionCatalog` and database seed migrations.
3. Build a route → permission → RPC/table/view → RLS/policy matrix.
4. Resolve the final migration definition and signature of all permission RPCs, especially `admin_grant_permission` and `admin_revoke_permission`.
5. Execute permission tests only in the intended local/staging database; record exact commands/results and no employee data.
6. Verify direct API/RPC denial paths, not only client-hidden screens.
