# RealtyHRM SOP Completeness Review — Gap Analysis

> **Historical gap snapshot:** This file records the gaps found in the original baseline. The expanded manuals and control documents in this directory address those documentation gaps where source evidence exists. Current scope decisions, navigation verification and owner approvals are maintained in `19_SCOPE_AND_APPROVAL_REGISTER.md`.

**Review date:** 19 October 2026  
**Compared:** `docs/realtyhrm-sop/*`, `docs/realtyhrm-audit/*`, route/service/source inventory, migrations, Edge Functions and executable tests.

## Result

The existing SOP is a reliable baseline for the core flows, but it is not complete. It describes the main employee attendance, leave, field-visit, permission, notification and deployment concepts; it does not yet provide the requested navigation-level operating instructions or full coverage of the repository.

## Coverage gaps

| Area | Existing baseline | Gap requiring expansion | Classification |
|---|---|---|---|
| Employee mobile | Core sign-in, attendance, leave, field visit and support guidance | Missing exact screens, prerequisites, offline state recovery, activity logs, documents, birthdays, profile, team and notification actions | PARTIALLY DOCUMENTED |
| Employee web | General employee guidance | Missing web-specific routes, PWA/service-worker behavior, foreground-only location, refresh/update recovery and browser permissions | PARTIALLY DOCUMENTED |
| HR panel | High-level review guidance | Missing screen-by-screen navigation, required permission keys, scopes, expected results and escalation for each administrative route | PARTIALLY DOCUMENTED |
| Team Lead | Brief review/task guidance | Missing My Team, hierarchy, task forwarding, team-scoped attendance/leave/field review and escalation operations | PARTIALLY DOCUMENTED |
| System Administrator | Permission and attendance control notes | Missing user lifecycle, device sessions, office/site policies, notification/event configuration, audit, TV display and release controls | PARTIALLY DOCUMENTED |
| Attendance | Online/offline and correction concepts | Missing canonical source reconciliation procedure, policy settings, auto-end, undo, blocked check-in, attempt evidence and reporting | PARTIALLY DOCUMENTED |
| Biometric | High-level import/sync notes | Missing secure sync lifecycle, manual import validation, employee-code matching, duplicate/unmatched handling, webhook and batch recovery | PARTIALLY DOCUMENTED |
| Location/field visits | Core lifecycle and evidence | Missing tracking setup, device health, route/timeline, location-ping requests, In Transit, observer, evidence upload/review, web/native differences | PARTIALLY DOCUMENTED |
| Leave/tasks/events | Basic RPC references | Missing calendars, balance management, task project administration, events/audience/comp-off and approval recovery | PARTIALLY DOCUMENTED |
| Activity/support/feedback | Brief support note | Missing activity classification, analysis, anonymous feedback, ticket status lifecycle and notification failure handling | PARTIALLY DOCUMENTED |
| Reports/exports | Privacy statement only | The baseline lacked report-by-report navigation, date/scope constraints, export verification and download-centre recovery; see the expanded reports manual | BASELINE GAP — EXPANDED |
| Compliance/fraud | Not covered | Suspicious attendance, compliance scores, duplicate devices/sessions and intelligence/exception center | BASELINE GAP — EXPANDED |
| Employee records | Not covered | User management, profile, documents, birthdays, imports and auth revocation | BASELINE GAP — EXPANDED |
| Configuration | Not covered | Office/site policies, predefined sites, weekly offs/holidays, team hierarchy and notification configuration | BASELINE GAP — EXPANDED |
| Technical operations | High-level integration notes | Missing RPC/object map, RLS boundaries, Edge Function contracts, idempotency, queue states and database replacement risks | PARTIALLY DOCUMENTED |
| Testing/release | Pass/fail summary | Missing per-failure error, affected module, likely root cause, verification command and acceptance criterion | PARTIALLY DOCUMENTED |

## Repository modules not sufficiently covered by the baseline

The original baseline inventory identified `DashboardScreen`, `ActivityLoggingScreen`, `MyActivityLogsScreen`, `DocumentsScreen`, `ProfileScreen`, `UpcomingBirthdaysScreen`, `MyTeamScreen`, `HelpSupportScreen`, `ProjectsScreen`, `PayrollScreen`, `SiteVisitApprovalsScreen`, `AdminDashboardScreen`, `AdminDeviceSessionsScreen`, `AttendanceCalendarScreen`, `AttendanceImportScreen`, `BiometricDeviceManagementScreen`, `AttendanceIntelligenceScreen`, `ComplianceScoresScreen`, `DocumentManagementScreen`, `EmployeeBirthdayManagementScreen`, `NotificationManagementScreen`, `OfficeSettingsScreen`, `SiteSettingsScreen`, `SmartOfficeSecureSyncScreen`, `SmartOfficeEmployeeImport`, `SmartOfficeImportedData`, `SuspiciousAttendanceScreen`, `TeamHierarchyScreen`, `TVDisplayScreen`, all dedicated report screens, `services/attendanceIntelligence/*`, `tracking-admin.service.ts`, `transit-warning.service.ts`, `tv-occupancy.ts`, `mailchimp.service.ts`, native bridge/capability/device-health modules and the PWA update path as requiring procedures or an exclusion decision. The expanded set now covers these areas or records an explicit legacy/unmounted exclusion; payroll scope is governed by `19_SCOPE_AND_APPROVAL_REGISTER.md`.

## Evidence gaps that cannot be closed from source alone

1. The applied production migration/function version is not available in the repository.
2. Provider credentials, schedules and live responses for SMS, WhatsApp, SmartOffice, push and Maps are not verified.
3. Android background location, battery, permission revocation and locked-screen behavior require a device test.
4. Backup/PITR, storage recovery and Edge Function rollback evidence is absent.
5. Several historical SQL snapshots define the same RPCs; the live canonical definition must be confirmed before a precedence rule is documented.

## Expansion plan

The expanded manuals in this directory use a consistent procedure template: **navigation → prerequisites → permission → steps → expected result → failure/recovery → escalation → evidence**. The coverage matrix at `16_COVERAGE_MATRIX.md` is the completion gate.

