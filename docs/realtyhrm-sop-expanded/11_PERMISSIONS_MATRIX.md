# Actual Permission Matrix

## Role behavior implemented

The `UserRole` union in `contexts/AuthContext.tsx` includes: `SYSTEM_ADMIN`, `ADMIN`, `HR`, `HRD`, `BUSINESS_HEAD`, `TEAM_HEAD`, `TEAM_LEADER`, `VP_SALES`, `SALES_MANAGER`, `GM_SALES`, `AGM_SALES`, `HEAD_BUSINESS_DEVELOPMENT`, `BDM`, `BDM_SALES`, `SENIOR_BDE`, `BDE`, `SALES_EXECUTIVE`, `ASSOCIATE_BUSINESS_HEAD`, `ASSOCIATE_TEAM_HEAD`, `ASSOCIATE_SENIOR_BDM`, `ASSOCIATE_BDM`, `ASSOCIATE_BDE`, `ASSOCIATE_SALES_EXECUTIVE`, `ASSOCIATE_MANAGER`, `ASSOCIATE_SR_MANAGER`, `ASSOCIATE_GM_SALES`, `ASSOCIATE_AGM_SALES`, `AGENT`, `CO-ORDINATOR`, `TELECALLER`, `SALES`, `DEPUTY_GENERAL_MANAGER`, `SENIOR_ASSOCIATE_BDM`, `VIDEO_EDITOR`, `WEB_DEVELOPER`, `DIGITAL_MARKETING_MANAGER` and `ASSOCIATE_PARTNER`. `utils/userRole.ts` normalizes aliases such as `SUPER_ADMIN`, `ADMINISTRATOR`, `HR_MANAGER` and telecaller spellings. These labels do not themselves grant permissions.

| Role/condition | Effective behavior in client implementation | Server caveat |
|---|---|---|
| `SYSTEM_ADMIN`, `SUPER_ADMIN` alias | permission-admin and data-admin; all catalog capabilities except permission-management semantics are separately checked | confirm live `hrms_is_permission_admin` and role normalization |
| `ADMIN` | permission-admin and data-admin | server grant/revoke and RLS remain authoritative |
| `HR`, `HRD` | data-admin for non-permission capabilities in client catalog | not automatically permission-admin |
| Other normalized roles | only active grants returned by `get_my_permissions` and aliases | scope/RLS can further restrict data |
| Delegated permission administrator | can grant/revoke only if server delegation permits; no self-grant | validate `permissions.assign/revoke` and audit reason |

## Canonical permission matrix

| Key | Module/scope | Main routes/procedures |
|---|---|---|
| `employees.view` | Employees / scoped | User Management, employee reports |
| `employees.manage` | Employees / scoped | User Management, employee import/lifecycle |
| `teams.manage` | Employees / global | Team Hierarchy |
| `birthdays.manage` | Employees / global | Birthday management |
| `attendance.view` | Attendance / scoped | Attendance Control, attendance reports, TV Display |
| `attendance.export` | Attendance / scoped | exports/download centre |
| `attendance.regularize` | Attendance / scoped | direct correction |
| `attendance.backdate_correct` | Attendance / scoped | Backdated new/correction |
| `attendance.backdate_approve` | Attendance / scoped | Backdated review |
| `regularization.view` | Attendance / scoped | regularization queue/report |
| `regularization.approve` | Attendance / scoped | regularization decision |
| `attendance.calendar.manage` | Attendance / global | holidays/weekly offs |
| `checkin_logs.view` | Attendance / scoped | check-in logs/report |
| `suspicious.view` | Attendance / scoped | suspicious/GPS/compliance |
| `devices.manage` | Attendance / global | duplicate devices/sessions |
| `biometric.manage` | Attendance / global | SmartOffice, import, match, biometric report |
| `leave.view` | Leave / scoped | leave management/reports |
| `leave.approve` | Leave / scoped | approve/reject leave |
| `leave.balance.manage` | Leave / scoped | balance adjustments |
| `live_tracking.view` | Field/tracking / scoped | live tracking, In Transit, tracking reports |
| `activity_analysis.view` | Field/tracking / scoped | activity analysis |
| `field_visits.view` | Field/tracking / scoped | field admin/observer/reports |
| `sites.manage` | Field/tracking / global | sites/geofences |
| `offices.manage` | Field/tracking / global | offices/policies |
| `tasks.view` | Work / scoped | task control |
| `tasks.manage` | Work / scoped | task assignment/project control |
| `events.manage` | Work / global | event management |
| `notifications.send` | Communication / global | notification management |
| `tickets.manage` | Communication / global | ticket management |
| `feedback.view` | Communication / global | anonymous feedback |
| `reports.view` | Reports/audit / scoped | reports tab |
| `audit.view` | Reports/audit / global | audit logs |
| `permissions.view` | Permissions / global | permission manager/simulator |
| `permissions.assign` | Permissions / global | grant/role template |
| `permissions.revoke` | Permissions / global | revoke/history |

## Scope semantics

`GLOBAL`, `OFFICE`, `OFFICE_TREE`, `TEAM`, `TEAM_TREE`, `REPORTS_TO`, `ASSIGNED`, `SELF` and `DEPARTMENT` are represented in `usePermissions` and permission migrations. A route may open with one permission while a mutation requires another; test the actual RPC/RLS path.

## Matrix maintenance rule

When adding a route, update `SCREEN_PERMISSIONS`, server permission wrappers/RLS, this matrix, the coverage matrix and the source traceability row. A UI-only guard change is incomplete.

