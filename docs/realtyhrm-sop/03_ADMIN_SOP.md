# Admin and Permission SOP

## Permission administration

1. Open Permission Manager and verify the target person and current role.
2. Select canonical permission, scope and optional expiry. Enter a meaningful reason for high-risk grants.
3. Confirm the server result and audit history. Never grant permissions to yourself as a delegated administrator.
4. Use role templates only where the server presents them; the code distinguishes system/admin permission roles from ordinary data-admin roles.

Evidence: `hooks/usePermissions.ts`, `constants/permissionCatalog.ts`, permission-engine migrations, `screens/admin/PermissionManagerScreen.tsx`.

## Attendance Control

The active route is `AttendanceControlScreenNew`. It combines policy controls, app/biometric comparison, raw device logs and audited direct correction. Direct correction requires an existing attendance record; if none exists, use Backdated Attendance. The server RPC is the authority—this SOP does not prescribe a fixed precedence between app, biometric, regularization or admin sources.

## User and configuration administration

Use User Management, office/site settings, leave balance, notification, event, ticket and audit screens only within granted scope. Confirm every mutation response and retain reason/audit metadata.

