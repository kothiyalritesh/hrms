# RealtyHRM Audit — Architecture and Module Inventory

Status: Initial route/module inventory; end-to-end evidence classification continues.  
Evidence basis: `App.tsx`, `navigation/*`, `contexts/*`, `hooks/*`, `screens/*`, `services/*`, `components/*`, `constants/*`, and `supabase/*` source.

## 1. Runtime architecture

```text
Expo React Native / Web application
        |
        +-- App.tsx
        |     ErrorBoundary
        |       AuthProvider
        |         LocationTrackingProvider
        |           offline outbox + push + browser/native tracking + updates
        |             NavigationContainer
        |               RootNavigator
        |                 LoginScreen OR MainTabNavigator
        |
        +-- Supabase Auth / PostgREST / RPC / Realtime / Storage
        |     profiles, permissions, scoped grants, attendance, leave, field work,
        |     locations, notifications, tasks, reports, audit and integrations
        |
        +-- Supabase Edge Functions
        |     OTP, biometric, SmartOffice, evidence upload, notifications,
        |     auto-end and auth revocation workers
        |
        +-- External systems
              SMS/OTP, WhatsApp, Mailchimp, SmartOffice/biometric devices,
              Google Maps, Firebase/FCM, EAS/hosting
```

`App.tsx` wires the global error boundary, authentication, location tracking, durable write outbox, push registration, browser/native tracking, notification watchers, update handling, offline evidence retry, and the root navigation container. `RootNavigator.tsx` renders `LoginScreen` while authentication is loading/unauthenticated and `MainTabNavigator` after authentication.

## 2. Route inventory

### Main tabs

`navigation/MainTabNavigator.tsx` defines Home, Tasks, Profile, HR Panel, Reports, and conditional My Team tabs. HR Panel and Reports are hidden unless the current role or permission permits them. My Team is conditional on non-admin/non-HR users having team members or escalation visibility.

### Home / employee routes

`navigation/HomeStackNavigator.tsx` wires:

- Dashboard
- Leave History / Apply Leave
- Notifications
- Upcoming Birthdays
- Log Activity and My Activity Logs
- Field Visits
- Raise Ticket
- My Team
- Attendance & Regularization / Attendance Details
- Location Tracking Setup

### HR Panel routes

`navigation/AdminStackNavigator.tsx` wires permission-guarded routes for:

- User Management
- Attendance Control (loads `screens/admin/AttendanceControlScreenNew.tsx`)
- Leave Management and Leave Balance
- Tasks & Projects
- Duplicate Devices & Sessions
- Notification Management
- Office Settings and Site Settings
- Audit Logs
- Activity Analysis
- Field Visit Admin, Site Visit Observer, Live Tracking, and In Transit
- Team Hierarchy
- Support Tickets, Events, Anonymous Feedback, and TV Display
- Check-In Logs, Suspicious Attendance, Compliance Scores
- Attendance Calendar, Attendance Regularization, Backdated Attendance
- Advanced Attendance Report
- SmartOffice Integration, Employee Import, Imported Data, Biometric User Match
- Permissions Manager and Employee Birthday Management

`screens/admin/AttendanceControlScreen.tsx` exists as a separate legacy/policy candidate, but the active Admin Stack import is `AttendanceControlScreenNew.tsx`. The final SOP must distinguish active route wiring from legacy/orphaned files.

### Reports routes

`navigation/ReportsStackNavigator.tsx` wraps report components with `withPermissionGuard` and `SCREEN_PERMISSIONS`. The route set covers attendance, advanced attendance, field visits, leave, regularization, biometric, activity, tracking, suspicious/GPS, intelligence, check-in logs, leave balance, team hierarchy, audit, downloads, attendance register, late arrival, geofence events, leave usage, overtime/comp-off, and Download Centre.

## 3. Module inventory and current evidence target

| Module | Primary UI | Application/service layer | Database/integration evidence to trace | Initial status |
|---|---|---|---|---|
| Authentication and session | `LoginScreen`, `RootNavigator` | `AuthContext`, OTP/SMS services, secure storage | Supabase Auth, `otp-auth` Edge Function, session/device functions | PARTIALLY IMPLEMENTED until live OTP/provider and session behavior are tested |
| Role/permission access | guarded tabs/routes, Permissions Manager | `permissionCatalog`, `PermissionsContext`, `usePermissions`, `PermissionService` | `get_my_permissions`, `hrms_has_permission`, grant/revoke RPCs, role templates, RLS, audit triggers | PARTIALLY IMPLEMENTED until server object/deployment parity is verified |
| Dashboard | `DashboardScreen` | `dashboard-summary.service`, `attendance.service`, event/task/notification services | attendance, leave, tasks, events, notifications, location/tracking functions | UNVERIFIED end-to-end |
| Attendance | `AttendanceScreen*`, Dashboard | `attendance.service`, canonical service, business clock, offline attendance | attendance RPCs, canonical view/RPC, policy functions, triggers, offline RPCs | PARTIALLY IMPLEMENTED; source is extensive, runtime parity unknown |
| Attendance correction | Attendance Control, Attendance Regularization, Backdated Attendance | `attendance-correction.service`, `attendance-regularization.service` | correction/regularization/backdated RPCs and audit tables/triggers | PARTIALLY IMPLEMENTED |
| Biometric | biometric tabs/import/match/admin screens | secure sync, import, SmartOffice services | device logs, mapping/audit, biometric sync/import RPCs and Edge Functions | UNVERIFIED provider and deployment behavior |
| Location tracking | tracking setup, Dashboard banners, Live Tracking, In Transit | `LocationTrackingContext`, `services/location/*`, web tracker, secure queues | tracking tables, latest pings, timeline, stop/start functions, RLS | PARTIALLY IMPLEMENTED; platform behavior requires controlled tests |
| Geofence and sites | Site Settings, field visit UI, map components | geo/site/predefined-site services and components | offices, predefined sites, geofence RPCs, evidence tables, policies | UNVERIFIED end-to-end |
| Field visits | Field Visits, Field Visit Admin, Observer | `field-visit.service`, location/current visit, evidence components | field visits, site evidence/live locations, observer RPCs, upload Edge Function | PARTIALLY IMPLEMENTED |
| Events | Event Management, dashboard event cards, Tasks deep links | `event.service` and notification services | event tables, attendance linkage, event notification functions | UNVERIFIED end-to-end |
| Leave | Leave History, Leave Management, Leave Balance | `leave.service`, regularization/request services | leave requests/balances, approval/reset RPCs, notifications, RLS | PARTIALLY IMPLEMENTED |
| Tasks/projects | Tasks, Task Project Control, My Team | task/task-sharing services | tasks, assignments, hierarchy visibility, notifications, RLS | UNVERIFIED |
| Notifications | Notifications, admin notification management, banners | notification services, push registration, outbox | notifications, push tokens, dispatch/requeue workers | PARTIALLY IMPLEMENTED |
| Support | Raise Ticket, Help & Support, Ticket Management | `support-ticket.service` | ticket tables/RPCs, RLS, notifications | UNVERIFIED |
| Activity | Activity Logging, My Activity Logs, Activity Analysis | activity and activity-analysis services | activity log tables/RPCs, report queries | UNVERIFIED |
| Compliance/fraud | Suspicious Attendance, Compliance Scores, Duplicate Devices | fraud, device session, intelligence services | fraud/compliance tables, device sessions, scores, audit/RLS | UNVERIFIED |
| Reports and exports | Reports Stack, Download Centre, TV Display | canonical/report query services, XLSX/browser download utilities | report RPCs/views, scope filters, exports | PARTIALLY IMPLEMENTED |
| Audit/privacy | Audit Logs, Anonymous Feedback | audit/report services | audit tables/triggers, feedback and feedback-audit tables/RLS | UNVERIFIED privacy/runtime behavior |
| Employee records | User Management, Profile, Documents, Birthdays | credential/profile/document services | profiles, roles, offices, documents, birthdays, auth revocation | PARTIALLY IMPLEMENTED |
| Configuration | Office/Site settings, Calendar, Team Hierarchy | office/site/predefined-site services | office/site/calendar/team tables and admin RPCs | UNVERIFIED deployment parity |

## 4. Cross-cutting runtime behaviors

### Offline and retry behavior

`App.tsx` starts `DurableWriteOutbox`, drains it on startup, network reconnection, app activation, auth sign-in/token refresh, and a one-minute interval. The offline banner states that check-in/out is saved on the phone and synced later. `OfflineAttendanceStatus`, offline attendance services, location secure queues, and current-location visit retry queues need an end-to-end test to confirm idempotency, conflict handling, and user-visible final status.

### Web service worker and updates

The web shell registers `sw.js` in production, handles build IDs and release manifests, can run online-only if service-worker registration fails, and prompts for reload when an update is ready. The Android shell removes app service-worker registrations/caches to avoid stale WebView bundles. `export_web.ps1` embeds build/schema metadata and validates bundle content before creating hosting output.

### Error handling

The app has module/error boundaries, non-fatal error reporting, retry banners, RPC response normalization, outbox backoff, and several screen-specific error states. The audit must distinguish handled user errors from silent logging, swallowed retries, and unverified server failures.

## 5. Architecture verification tasks

The next architecture batch will:

1. extract the complete route → `SCREEN_PERMISSIONS` → canonical permission map;
2. identify every screen imported by a route versus legacy/unwired screens;
3. extract unique RPC names from client, services, Edge Functions, and SQL;
4. map each RPC to its final migration definition, execution grants, authorization, and tables/views/triggers;
5. record source line references and status in the traceability matrix;
6. test the static build/typecheck only after the source inventory is recorded.
