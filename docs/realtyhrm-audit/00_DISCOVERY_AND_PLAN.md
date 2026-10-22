# RealtyHRM Complete Audit — Discovery, Scope, and Analysis Plan

Status: Discovery baseline recorded; detailed workflow audit not yet complete  
Audit date: 19 October 2026  
Source of truth: executable source, route wiring, services, database migrations/functions/policies, tests, and deployment configuration. Existing narrative documents are reference material only and must be cross-checked.

## 1. Repository discovery

The repository contains a large Expo/React Native application with web support, a Supabase database layer, Supabase Edge Functions, deployment scripts, test assets, historical repair scripts, generated bundles, build packages, and prior audit documents.

The first inventory excluded `node_modules`, the generated `dist` directory, and binary assets when counting source-like files. Those artifacts remain in scope as release/evidence artifacts and will be checked for divergence where relevant.

| Area | Inventory result |
|---|---:|
| Source-like files in repository inventory | 1,215 |
| Root-level files | 442 |
| Supabase migration files | 262 |
| Supabase Edge Function directories | 13 |
| Screens (`.ts`/`.tsx`) | 70 |
| Services (`.ts`/`.tsx`) | 80 |
| Reusable components | 68 |
| Navigation files | 10 |
| Contexts | 4, including one `.bak` artifact |
| Hooks | 9 |
| Tests under `__tests__` | 23, plus service/location/native-bridge test directories |
| SQL line occurrences found in migrations | 32 table-creation lines, 5 view-creation lines, 1 materialized-view line, 28 trigger-creation lines, 183 policy lines, 93 RLS-enable lines, 156 grant-execute lines, and 267 revoke lines |
| Client RPC call-site matches | 201 line matches; requires deduplication by RPC name |
| Edge-function invocation matches | 8 line matches |

The SQL counts are line-level discovery counts, not counts of unique database objects. A later phase will extract unique object names and reconcile replacement order.

## 2. Repository structure and responsibility map

### Application shell and configuration

- `App.tsx` — application root, providers, navigation shell, and runtime composition.
- `package.json` — Expo scripts, TypeScript/Jest commands, web export/deploy commands, and dependencies.
- `app.config.js`, `app.json`, `eas.json`, `release.config.json` — runtime/build identity, EAS channels, Android/iOS/web configuration, maps/Firebase integration, OTA update settings, and required backend/Edge Function version metadata.
- `.env.example`, `.env`, `.env.local` — environment configuration surfaces. Secret values are excluded from audit documents.
- `babel.config.js`, `metro.config.js`, `tsconfig*.json`, `eslint.config.js` — build and static-analysis configuration.

### Navigation and route authorization

- `navigation/RootNavigator.tsx` — authenticated/unauthenticated root routing.
- `navigation/MainTabNavigator.tsx` — Home, Tasks, Profile, Admin, Reports, and conditional My Team tabs.
- `navigation/HomeStackNavigator.tsx` — dashboard, leave, notifications, birthdays, activity, field visits, support, team, attendance details, and location setup.
- `navigation/AdminStackNavigator.tsx` — HR Panel and administrative routes.
- `navigation/ReportsStackNavigator.tsx` — report routes and permission guards.
- `navigation/TasksStackNavigator.tsx`, `ProfileStackNavigator.tsx`, `AttendanceStackNavigator.tsx` — secondary workflows.
- `components/PermissionGuard.tsx`, `components/PermissionGate.tsx`, `contexts/PermissionsContext.tsx`, `hooks/usePermissions.ts` — client visibility and guard behavior. Server authorization remains authoritative.

### Employee and HR screens

- Employee-facing: `DashboardScreen`, `LoginScreen`, `AttendanceScreen*`, `LeaveScreen`, `FieldVisitScreen`, `TasksScreen`, `ActivityLoggingScreen`, `MyActivityLogsScreen`, `DocumentsScreen`, `ProfileScreen`, `MyTeamScreen`, `NotificationsScreen`, `UpcomingBirthdaysScreen`, `RaiseTicketScreen`, `HelpSupportScreen`, and `LocationTrackingSetupScreen`.
- HR/admin: `UserManagementScreen`, `AdminDashboardScreen`, `AttendanceControlScreenNew`, `AttendanceControlScreen` (legacy/unwired candidate), `AttendanceRegularizationScreen`, `BackdatedAttendanceScreen`, `LeaveManagementScreen`, `LeaveBalanceScreen`, `AttendanceCalendarScreen`, `TaskProjectControlScreen`, `TeamHierarchyScreen`, `OfficeSettingsScreen`, `SiteSettingsScreen`, `PermissionsManagerScreen`, `AuditLogsScreen`, `NotificationManagementScreen`, `TicketManagementScreen`, `EventManagementScreen`, and employee birthday/feedback/document screens.
- Operations/monitoring: `LiveTrackingScreen`, `InTransitScreen`, `FieldVisitAdminScreen`, `SiteVisitObserverScreen`, `ActivityAnalysisScreen`, `CheckInLogsScreen`, `SuspiciousAttendanceScreen`, `ComplianceScoresScreen`, `AdminDeviceSessionsScreen`, TV display, and SmartOffice/biometric screens.
- Reports: attendance register, late arrival, geofence events, leave usage/balance, overtime/comp-off, download centre, advanced attendance, field visits, regularization, biometric, activity, tracking, intelligence, check-in logs, team hierarchy, and audit reports.

### Services, contexts, hooks, and components

- Authentication/security: `contexts/AuthContext.tsx`, `services/otp.service.ts`, `services/sms.service.ts`, `services/PermissionService.ts`, `services/device-session.service.ts`, secure storage and native bridge services.
- Attendance: `services/attendance.service.ts`, `canonical-attendance.service.ts`, `attendance-correction.service.ts`, `attendance-regularization.service.ts`, `attendance-import.service.ts`, `offline-attendance.service.ts`, `business-clock.service.ts`, and attendance intelligence services.
- Location: `contexts/LocationTrackingContext.tsx`, `services/location/*`, `WebForegroundTracker.tsx`, route/timeline/location health components, secure queues, offline sync, and background task code.
- Field and work: `field-visit.service.ts`, `event.service.ts`, `task.service.ts`, `task-sharing.service.ts`, `activity.service.ts`, `activity-analysis.service.ts`, `support-ticket.service.ts`, and `transit-warning.service.ts`.
- Integrations: biometric/SmartOffice services, notification services, Mailchimp, WhatsApp, SMS, Supabase client, map components, and Edge Function clients.

### Supabase database and Edge Functions

- `supabase/migrations/` — 262 sequential and historical migrations; must be reconciled for final object definitions and replacement order.
- `supabase/functions/` — `otp-auth`, biometric sync/import/webhook, `smartoffice-proxy`, evidence upload, notification dispatch/workers, journey/event notifications, daily check-in alert, auto-end-time, and auth revocation.
- `supabase/tests/` — database test scripts and permission tests.
- `supabase/_superseded/`, `supabase/manual/`, `supabase/_temp/` — historical or non-current SQL; not treated as deployed source until proven otherwise.
- Root SQL files and combined migration files — potentially useful evidence but may represent superseded snapshots. They require provenance classification.

### Build, deployment, and operational artifacts

- `export_web.ps1`, `deploy_bop_web.ps1`, `prepare_bop_hosting.ps1`, `build_hrms_*.ps1`, `release_updates.ps1` — web/Android build and release procedures.
- `DEPLOYMENT*.md`, `PRODUCTION_RELEASE_CHECKLIST.md`, `CORRECTED_DEPLOYMENT_GUIDE.md`, `BUILD_HRMS_PACKAGES.md` — procedural references to validate against executable scripts.
- APKs, ZIP packages, `dist`, Android bundles, images, and spreadsheet/PDF/DOCX files — release or evidence artifacts; not assumed to represent current source behavior.

## 3. Actual role and permission surfaces identified

The role union is defined in `contexts/AuthContext.tsx` and normalized by `utils/userRole.ts`. It includes platform roles (`SYSTEM_ADMIN`, `ADMIN`, `HR`, `HRD`), leadership/sales roles, employee/specialist roles, and historical aliases. The complete catalog will be reproduced in the final SOP only after reconciling role use in database functions and user-management UI.

The permission catalog is in `constants/permissionCatalog.ts`. It defines canonical resource/action permissions, legacy aliases, module, scope support, and risk. `SCREEN_PERMISSIONS` controls client route visibility. The database engine in the later permission migrations defines server-side permission checks, scope resolution, grant/revoke RPCs, role templates, simulator behavior, audit logging, and RLS. Client guards cannot be treated as security controls without the corresponding database authorization.

## 4. Analysis plan

The audit will proceed in batches and update the findings register after each batch:

1. **Evidence classification and version baseline** — classify current source, legacy/backup files, generated bundles, combined migrations, superseded SQL, and deployment metadata.
2. **Architecture and route graph** — trace `App.tsx` → providers → root/tab/stack routes → screen guards; identify wired versus orphaned/legacy screens.
3. **Authentication and authorization** — trace phone/OTP auth, session persistence, role normalization, permissions context, screen guards, database RPC authorization, RLS, delegated permissions, and audit logging.
4. **Attendance end-to-end** — trace dashboard action → service/RPC → attendance tables/functions/triggers → canonical view/RPC → screen/report state; include offline queue, undo, auto-close, event attendance, regularization, and backdated correction.
5. **Biometric and SmartOffice** — trace imports, sync, webhook, matching, raw logs, reconciliation, device mapping, and scheduled/background operations.
6. **Location/geofence/field visits** — trace capability checks, permission prompts, background/native/browser tracking, secure queues, geofences, site evidence, route/timeline, live tracking, In Transit, and stop conditions.
7. **Leave, work, communication, and approvals** — trace leave balances/requests/approvals, tasks/project hierarchy, events, notifications, tickets, feedback, birthdays, and documents.
8. **Reports, exports, audit, and privacy** — map report source objects, scope enforcement, export paths, anonymous feedback model, audit records, and personal-data handling.
9. **Database and integrations** — extract unique tables/views/functions/triggers/RLS policies, migration replacement order, Edge Function contracts, external providers, secrets/config, and background jobs.
10. **Testing and release evidence** — run only reproducible checks available in the repository, record exact commands/results, compare typecheck/Jest/SQL test coverage, and validate release scripts without deploying.
11. **Deliverables** — write separate operational Markdown SOPs, technical/deployment SOPs, module inventory, architecture/workflow diagrams, permissions matrix, traceability matrix, verification checklist, unresolved questions, and a master index.

## 5. Initial coverage gaps and verification blockers

These are discovery findings, not final defect conclusions:

| ID | Classification | Initial finding | Verification required |
|---|---|---|---|
| D-01 | UNVERIFIED | The repository does not prove which Supabase migrations are applied in production. | Read-only production migration history/schema inspection or an authoritative deployment record. |
| D-02 | PARTIALLY IMPLEMENTED | `release.config.json` declares a required backend schema version older than the newest migration filenames. | Confirm whether the release metadata is intentionally pinned, stale, or out of sync. |
| D-03 | UNVERIFIED | Edge Function source exists, but deployed function versions, secrets, schedules, and provider credentials are not proven by source alone. | Supabase/EAS/hosting deployment inspection without exposing secrets. |
| D-04 | PARTIALLY IMPLEMENTED | Numerous historical, combined, superseded, repair, and generated SQL files create multiple possible definitions of the same database objects. | Build a unique-object replacement map from the migration chain and mark authoritative definitions. |
| D-05 | UNVERIFIED | UI existence does not establish database support or production availability for every screen. | Trace each wired route to its service/RPC/object and execute read-only verification where available. |
| D-06 | UNVERIFIED | Existing audit documents claim prior fixes/tests, but those claims are not evidence of the current checkout, migration, or deployment state. | Re-run the cited tests/checks and record results in the findings register. |
| D-07 | RISK | Runtime configuration includes map/Firebase integration surfaces and fallback values. | Confirm production restrictions and ensure audit deliverables never reproduce key/token values. |
| D-08 | UNVERIFIED | Generated APKs, bundles, ZIPs, and `dist` may not match current TypeScript/SQL source. | Compare build IDs, required schema metadata, route strings, and source hashes where feasible. |
| D-09 | UNVERIFIED | External providers (SMS/OTP, WhatsApp, Mailchimp, SmartOffice, Google Maps, push notifications) require live configuration and response tests. | Perform controlled staging/integration verification; do not use employee data in audit evidence. |
| D-10 | DISCOVERY NOTE | The user-supplied correction note identifies five SOP wording issues; it is treated as a review input, not as code evidence. | Confirm each correction against source during the relevant workflow batch. |

## 6. Discovery-stage exclusions

No application code, database record, production configuration, migration, deployment artifact, or generated release file was modified during discovery. No production credentials, OTPs, tokens, API keys, or employee records will be copied into the audit documents.

## 7. Next audit output

The next batch will produce the architecture/route graph and a verified module inventory with source references, followed by the findings register updates. Drafting of operational SOP procedures begins only after each procedure has an evidence status and traceability target.
