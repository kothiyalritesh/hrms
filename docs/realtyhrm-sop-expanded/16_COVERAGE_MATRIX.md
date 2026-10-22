# Repository-to-SOP Coverage Matrix

This is the completion gate. **Covered** means a procedure or explicit technical reference exists. **Partial** means a source path is named but live/deployment or screen-level detail remains. **Excluded** means the artifact is historical/legacy or not an operational feature; the reason is stated. Scope and owner approval decisions are recorded in `19_SCOPE_AND_APPROVAL_REGISTER.md`.

## Application screens and routes

| Repository area | Screens/routes | Coverage | Manual/reference |
|---|---|---|---|
| Authentication | `LoginScreen`, `RootNavigator` | Covered/partial OTP contract | 02, 03, 09, KD-03/04 |
| Home dashboard | `DashboardScreen` | Covered/partial resilience contract | 02, 03, 10 |
| Attendance employee variants | `AttendanceScreen`, `AttendanceScreenNew`, `AttendanceScreenUpdated`, `AttendanceScreenWeb` | Partial; active route uses `AttendanceScreen` through Home stack; variants require route/build verification | 02, 03, 07 |
| Leave | `LeaveScreen` | Covered/partial deployed rules | 02, 04, 15 |
| Notifications | `NotificationsScreen` | Covered/partial provider delivery | 02, 09 |
| Birthdays | `UpcomingBirthdaysScreen`, `EmployeeBirthdayManagementScreen` | Covered at operation level | 02, 04 |
| Activity | `ActivityLoggingScreen`, `MyActivityLogsScreen`, `ActivityAnalysisScreen` | Covered/partial RPC/RLS | 02, 04, 15 |
| Field visits | `FieldVisitScreen`, `FieldVisitAdminScreen`, `SiteVisitObserverScreen`, `SiteVisitApprovalsScreen` | Covered/partial review/deployment | 02, 04, 08 |
| Support | `RaiseTicketScreen`, `HelpSupportScreen`, `TicketManagementScreen` | Covered/partial external delivery | 02, 04 |
| Team | `MyTeamScreen`, `TeamHierarchyScreen` | Covered/partial role/hierarchy scope | 02, 05, 11 |
| Profile/records | `ProfileScreen`; `DocumentsScreen` and `DocumentManagementScreen` are source-only/unrouted | Profile is active; document screens are explicitly excluded until route/runtime activation and storage verification | 02, 04, 09, 19 |
| Tasks/projects | `TasksScreen`, `TaskProjectControlScreen`; `ProjectsScreen` is unrouted | Covered/partial hierarchy and task administration; unrouted project screen excluded | 02, 04, 05, 15, 19 |
| Admin attendance | control, calendar, regularization, backdated, check-in logs, suspicious, compliance, intelligence | Covered with permission and exception procedures | 04, 06, 07 |
| Biometric | device management, SmartOffice sync/import/data/match | Covered with import/sync workflow; provider remains unverified | 06, 07, 09 |
| Location monitoring | live tracking, In Transit, observer | Covered with privacy/freshness procedures | 04, 05, 08 |
| Communication/config | event, notification, tickets, feedback, office/site, birthdays, TV display | Covered at operations level; live RLS/provider verification pending | 04, 06, 09 |
| Reports | attendance, advanced, field visits, leaves, regularization, biometric, activity, tracking, GPS, intelligence, logs, leave balance, hierarchy, audit, downloads, register, late, geofence, leave usage, overtime, download centre | Covered by guarded report procedure and technical matrix; individual query contracts remain partial | 04, 07, 09, 15 |
| Unrouted/legacy candidates | `AttendanceControlScreen.tsx`, `PayrollScreen.tsx`, some project/site approval screens | Explicitly not treated as active workflow until navigation/build evidence confirms | 00 gap analysis |

### Named route screens requiring explicit navigation ownership

| Screen | Active/legacy decision | Manual |
|---|---|---|
| `LocationTrackingSetupScreen` | active Home route | 02, 03, 08 |
| `AdminDashboardScreen` / `ReportsHubScreen` | active entry hubs | 04, 17 |
| `UserManagementScreen` / `PermissionsManagerScreen` | active guarded admin routes | 04, 06, 11 |
| `AttendanceControlScreenNew` / `BackdatedAttendanceScreen` | active admin routes | 04, 07 |
| `LeaveManagementScreen` / `LeaveBalanceScreen` | active guarded routes | 04, 17 |
| `LiveTrackingScreen` / `InTransitScreen` / `SiteVisitObserverScreen` | active guarded monitoring routes | 04, 08 |
| `EventManagementScreen` / `AnonymousFeedbackScreen` / `AuditLogsScreen` | active guarded routes | 04, 06, 17 |
| `BiometricUserMatchScreen` / SmartOffice screens | active guarded/import routes | 04, 07 |
| `CheckInLogsScreen` / Suspicious/Compliance/Intelligence screens | active admin/report routes | 04, 07, 17 |
| Dedicated report screens (`AttendanceRegister`, `LateArrival`, `GeofenceEvents`, `LeaveUsage`, `Overtime`, `DownloadCentre`, `LeaveBalanceSummary`) | active Reports routes | 17 |
| `AttendanceStackNavigator` / `SiteVisitApprovalsScreen` | navigator exists but is not mounted by `MainTabNavigator`; treat as legacy/deep-link candidate until runtime route inspection | 00 gap analysis |
| `PayrollScreen`, `ProjectsScreen` | source files found but no active route in inspected navigators | explicitly excluded from active SOP; verify product decision before documenting |
| `DocumentsScreen`, `DocumentManagementScreen` | source files found but no active route registration in the inspected profile/admin navigators | explicitly excluded from active SOP; storage and product decision remain open |
| `AttendanceImportScreen`, `SmartOfficeIntegrationScreenNew` | source files found but no active route registration; active import/sync uses the routed SmartOffice screens | legacy/source-only candidates; do not use as navigation instructions |
| `AdminDeviceSessionsScreen`, `NotificationManagementScreen`, `OfficeSettingsScreen`, `SiteSettingsScreen`, `AttendanceCalendarScreen`, `AttendanceRegularizationScreen`, `ComplianceScoresScreen`, `SuspiciousAttendanceScreen`, `BiometricDeviceManagementScreen`, `SmartOfficeSecureSyncScreen`, `SmartOfficeEmployeeImport`, `SmartOfficeImportedData`, `TVDisplayScreen` | registered in `AdminStackNavigator.tsx` | active guarded admin routes; runtime permission/RLS verification remains partial |
| `AttendanceIntelligenceScreen`, `AdvancedAttendanceReportScreen`, `AttendanceRegisterReportScreen`, `LateArrivalReportScreen`, `GeofenceEventsReportScreen`, `LeaveUsageReportScreen`, `OvertimeReportScreen`, `DownloadCentreScreen`, `LeaveBalanceSummaryReportScreen` | registered directly or through guarded/deferred `ReportsStackNavigator.tsx` routes | active guarded report routes; query/provider/runtime verification remains partial |

## Services/contexts/integrations

| Module | Coverage | Notes |
|---|---|---|
| auth/OTP/session/device/native bridge | Covered/partial | provider/deployment and OTP contract unresolved |
| attendance/canonical/correction/regularization/import/fraud/intelligence | Covered/partial | canonical/deployment and biometric provider unresolved |
| location/*, outbox, offline, route, device health | Covered/partial | Android acceptance and queue integration needed |
| field visit/current location/event/task/leave/support/activity | Covered/partial | service wiring documented; deployed RLS not proven |
| office/predefined sites/dashboard summary | Covered/partial | saved-site tests/fixtures and policy deployment unresolved |
| notification/location notification/TV occupancy/transit warning/tracking admin | Covered/partial | queue/provider/live behavior unresolved |
| Mailchimp/WhatsApp/SMS/SmartOffice/Maps | Referenced, live integration unverified | no credentials or provider claims made |

### Explicit shared-service and helper coverage

| Source family | Coverage/decision |
|---|---|
| `attendance-control.classification.ts`, `attendance-fraud.service.ts` | Covered by Attendance Control, Suspicious Attendance and Compliance procedures; live scoring remains unverified. |
| `business-clock.service.ts`, `trackingDate.ts` | Covered by IST/business-date rules; timezone tests recorded. |
| `device-session.service.ts`, `PermissionService.ts` | Covered by System Administrator/device and permission procedures. |
| `otp.service.ts`, `sms.service.ts` | OTP/SMS boundary documented; TOTP/backup implementation is not the active LoginScreen path. |
| `regularization-request.service.ts` | Covered by Backdated/regularization review; request/response workflow remains deployment-dependent. |
| `smartoffice.service.ts`, `whatsapp.service.ts` | Covered by integration manual; providers unverified. |
| `attendanceIntelligence/*` | Covered by Attendance Intelligence/report procedures; analytical outputs are not attendance authority. |
| `attendanceLifecycle.ts`, `attendanceTrackingLifecycle.ts`, `LocationTrackingCoordinator.ts` | Covered by tracking lifecycle; native device behavior unverified. |
| `deviceHealth.ts`, `secureQueue.ts`, `notification.service.web.ts` | Covered by location health/queue/web limitations. |
| `nativeBridge/protocol.ts`, `outbox/initOutbox.ts` | Covered by web/native bridge and durable outbox procedures. |
| location/outbox/native-bridge tests | Listed in test evidence scope; passing/failing status must be rerun after remediation. |

## Backend and deployment artifacts

| Artifact | Coverage | Exclusion/next verification |
|---|---|---|
| 262 migrations and replacement SQL | Technical procedure/object map | applied production sequence unavailable |
| 13 Edge Function directories | Function contract table | deployed versions/schedules/secrets unavailable |
| RLS/policies/triggers/grants | permission/DB procedure | live schema and policy tests required |
| Jest/utility/location tests | test evidence register | current failures recorded |
| web/EAS/deploy/release scripts | deployment manual | scripts not executed in this review |
| APK/dist/ZIP/generated artifacts | excluded as source-of-truth | compare build IDs/hashes before release |
| prior audit reports | reconciled as reference only | narrative claims do not override executable evidence |

## Completion status

The significant operational screens, routes, services, backend artifacts and integrations are represented in this matrix. Presentational components, generic utility types and low-level helper files are grouped by service family rather than listed one-by-one; the full file inventory remains in `docs/realtyhrm-audit/02_ARCHITECTURE_AND_MODULE_INVENTORY.md`. Remaining operational gaps are not silently skipped: they are marked partial/unverified/legacy and linked to the required verification or owner.

