# UI Architecture Map

## Screens

### ActivityLoggingScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\ActivityLoggingScreen.tsx
- **Services**: import { ActivityService } from "@/services/activity.service";, import { AttendanceService } from "@/services/attendance.service";, import { FieldVisitService } from "@/services/field-visit.service";, import { OfficeService } from "@/services/office.service";, import { ActivityAnalysis } from "@/services/activity-analysis.service";
- **Data Fetched**: None
- **Navigation**: HomeTab, HomeTab
- **State**: complete

### AttendanceScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\AttendanceScreen.tsx
- **Services**: import { AttendanceFraudService } from "@/services/attendance-fraud.service";, import { AttendanceRegularizationService } from "@/services/attendance-regularization.service";, import { BusinessClockService } from "@/services/business-clock.service";, import { nativeBridge } from "@/services/nativeBridge/client";
- **Data Fetched**: fetch
- **Navigation**: LocationTrackingSetup, FieldVisits
- **State**: complete

### AttendanceScreenNew.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\AttendanceScreenNew.tsx
- **Services**: import { AttendanceService } from "@/services/attendance.service";, import { OfficeService } from "@/services/office.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### AttendanceScreenUpdated.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\AttendanceScreenUpdated.tsx
- **Services**: import { AttendanceService } from "@/services/attendance.service";, import { OfficeService } from "@/services/office.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### AttendanceScreenWeb.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\AttendanceScreenWeb.tsx
- **Services**: import { OfficeService } from "@/services/office.service";
- **Data Fetched**: None
- **Navigation**: FieldVisits
- **State**: complete

### DashboardScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\DashboardScreen.tsx
- **Services**: import { AttendanceService } from "@/services/attendance.service";, import { OfficeService } from "@/services/office.service";, import { AttendanceFraudService } from "@/services/attendance-fraud.service";, import { DashboardSummaryService } from "@/services/dashboard-summary.service";
- **Data Fetched**: None
- **Navigation**: LocationTrackingSetup, Notifications, LocationTrackingSetup, FieldVisits, HomeTab, TasksTab, TasksTab, LeaveScreen, LeaveScreen, FieldVisits, AttendanceDetails, MyActivityLogs, UpcomingBirthdays, RaiseTicket, MyTeam, AdminTab, TasksTab, TasksTab, FieldVisits
- **State**: complete

### DocumentsScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\DocumentsScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### FieldVisitScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\FieldVisitScreen.tsx
- **Services**: import { FieldVisitService, FieldVisit } from "@/services/field-visit.service";, import { AttendanceService } from "@/services/attendance.service";, import { OfficeService } from "@/services/office.service";, import { locationTrackingCoordinator } from "@/services/location/LocationTrackingCoordinator";, import { Destination } from "@/services/location/types";, import { nativeBridge } from "@/services/nativeBridge/client";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LeaveScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\LeaveScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LocationTrackingSetupScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\LocationTrackingSetupScreen.tsx
- **Services**: import { nativeBridge } from "@/services/nativeBridge/client";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LoginScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\LoginScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### MyActivityLogsScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\MyActivityLogsScreen.tsx
- **Services**: import { ActivityService } from "@/services/activity.service";
- **Data Fetched**: None
- **Navigation**: ActivityLogging
- **State**: complete

### MyTeamScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\MyTeamScreen.tsx
- **Services**: import { BusinessClockService } from "@/services/business-clock.service";, import { AttendanceService, effectiveOfficeRadius } from "@/services/attendance.service";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### NotificationsScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\NotificationsScreen.tsx
- **Services**: import { EventService } from "@/services/event.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### PayrollScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\PayrollScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ProfileScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\ProfileScreen.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: MyTeam, LeaveScreen, Notifications
- **State**: complete

### ProjectsScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\ProjectsScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### RaiseTicketScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\RaiseTicketScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### SiteVisitApprovalsScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\SiteVisitApprovalsScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### TasksScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\TasksScreen.tsx
- **Services**: import { BusinessClockService } from "@/services/business-clock.service";, import { EventAnnouncement, EventService } from "@/services/event.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### UpcomingBirthdaysScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\UpcomingBirthdaysScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ActivityAnalysisScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\ActivityAnalysisScreen.tsx
- **Services**: import { ActivityService } from "@/services/activity.service";, import { BusinessClockService } from "@/services/business-clock.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### AdminDashboardScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\AdminDashboardScreen.tsx
- **Services**: import { DashboardSummaryService } from "@/services/dashboard-summary.service";
- **Data Fetched**: None
- **Navigation**: TVDisplay, UserManagement, AttendanceControl, LeaveManagement, TaskProjectControl, TicketManagement, LiveTracking, TVDisplay, UserManagement, AttendanceControl, FieldVisitAdmin, TeamHierarchy, CheckInLogs, SuspiciousAttendance, AttendanceCalendar, AttendanceRegularization, AdvancedAttendanceReport, EventManagement, LeaveBalance, SmartOfficeIntegration, BiometricUserMatch, SmartOfficeEmployeeImport, SmartOfficeImportedData, PermissionsManager, SiteVisitObserver, InTransit, OfficeSettings, SiteSettings, ActivityAnalysis, NotificationManagement, AuditLogs
- **State**: complete

### AdvancedAttendanceReportScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\AdvancedAttendanceReportScreen.tsx
- **Services**: import { BusinessClockService } from "@/services/business-clock.service";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### AttendanceCalendarScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\AttendanceCalendarScreen.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### AttendanceControlScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\AttendanceControlScreen.tsx
- **Services**: import { AttendanceService, AttendancePolicy } from "@/services/attendance.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### AttendanceControlScreenNew.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\AttendanceControlScreenNew.tsx
- **Services**: import { biometricSyncService } from "@/services/biometric-sync-secure.service";, import { AttendanceService } from "@/services/attendance.service";, import { BusinessClockService } from "@/services/business-clock.service";, import { CanonicalAttendanceService } from "@/services/canonical-attendance.service";
- **Data Fetched**: fetch
- **Navigation**: BiometricUserMatch
- **State**: complete

### AttendanceImportScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\AttendanceImportScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### AttendanceIntelligenceScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\AttendanceIntelligenceScreen.tsx
- **Services**: import { EmployeeMasterService } from "@/services/attendanceIntelligence/employeeMaster.service";, import { AttendanceFactEngine } from "@/services/attendanceIntelligence/attendanceFact.service";, import { AttendanceAnalyticsService } from "@/services/attendanceIntelligence/analytics.service";, import { AttendanceAnomalyEngine } from "@/services/attendanceIntelligence/anomalyDetection.service";, import { ExceptionCenterService } from "@/services/attendanceIntelligence/exceptionCenter.service";, import { AttendanceReconciliationEngine } from "@/services/attendanceIntelligence/reconciliation.service";, import { AttendanceInsightEngine } from "@/services/attendanceIntelligence/insights.service";, import { AskAttendanceEngine } from "@/services/attendanceIntelligence/askAttendance.service";, import { AttendanceSnapshotService } from "@/services/attendanceIntelligence/snapshot.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### AttendanceRegularizationScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\AttendanceRegularizationScreen.tsx
- **Services**: import { AttendanceRegularizationService } from "@/services/attendance-regularization.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### AuditLogsScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\AuditLogsScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### BiometricUserMatchScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\BiometricUserMatchScreen.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### CheckInLogsScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\CheckInLogsScreen.tsx
- **Services**: import { BusinessClockService } from "@/services/business-clock.service";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### DocumentManagementScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\DocumentManagementScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### EventManagementScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\EventManagementScreen.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### FieldVisitAdminScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\FieldVisitAdminScreen.tsx
- **Services**: import { BusinessClockService } from "@/services/business-clock.service";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### InTransitScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\InTransitScreen.tsx
- **Services**: import { BusinessClockService } from "@/services/business-clock.service";, import { TransitWarningService } from "@/services/transit-warning.service";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### LeaveBalanceScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\LeaveBalanceScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LeaveManagementScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\LeaveManagementScreen.tsx
- **Services**: import { LeaveService } from "@/services/leave.service";, import { BusinessClockService } from "@/services/business-clock.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LiveTrackingScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\LiveTrackingScreen.tsx
- **Services**: import { TrackingAdminService } from "@/services/tracking-admin.service";, import { BusinessClockService } from "@/services/business-clock.service";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### NotificationManagementScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\NotificationManagementScreen.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### OfficeSettingsScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\OfficeSettingsScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### PermissionsManagerScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\PermissionsManagerScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ReportsHubScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\ReportsHubScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### SiteSettingsScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\SiteSettingsScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### SiteVisitObserverScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\SiteVisitObserverScreen.tsx
- **Services**: import { BusinessClockService } from "@/services/business-clock.service";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### SmartOfficeEmployeeImport.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\SmartOfficeEmployeeImport.tsx
- **Services**: import type { EmployeeMatchResult } from "@/services/attendance-import.service";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### SmartOfficeImportedData.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\SmartOfficeImportedData.tsx
- **Services**: import { smartOfficeService } from "@/services/smartoffice.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### SmartOfficeIntegrationScreenNew.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\SmartOfficeIntegrationScreenNew.tsx
- **Services**: import { smartOfficeService } from '@/services/smartoffice.service';
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### SmartOfficeSecureSyncScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\SmartOfficeSecureSyncScreen.tsx
- **Services**: import { BusinessClockService } from "@/services/business-clock.service";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### SuspiciousAttendanceScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\SuspiciousAttendanceScreen.tsx
- **Services**: import { TrackingAdminService } from "@/services/tracking-admin.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### TaskProjectControlScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\TaskProjectControlScreen.tsx
- **Services**: import { BusinessClockService } from "@/services/business-clock.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### TeamHierarchyScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\TeamHierarchyScreen.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### TicketManagementScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\TicketManagementScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### TVDisplayScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\TVDisplayScreen.tsx
- **Services**: import { TrackingAdminService } from "@/services/tracking-admin.service";, import { classifyTvAttendance } from "@/services/tv-occupancy";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### UserManagementScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\UserManagementScreen.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### AttendanceRegisterReportScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\reports\AttendanceRegisterReportScreen.tsx
- **Services**: import { CanonicalAttendanceService, CanonicalAttendanceDay } from "@/services/canonical-attendance.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### GeofenceEventsReportScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\reports\GeofenceEventsReportScreen.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: partial

### LateArrivalReportScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\reports\LateArrivalReportScreen.tsx
- **Services**: import { CanonicalAttendanceService, CanonicalAttendanceDay } from "@/services/canonical-attendance.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LeaveBalanceSummaryReportScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\reports\LeaveBalanceSummaryReportScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LeaveUsageReportScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\reports\LeaveUsageReportScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### OvertimeReportScreen.tsx
- **Type**: Screen
- **Path**: d:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\reports\OvertimeReportScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

## Components

### ActiveJourneyCard.tsx
- **Services**: import { readActiveTrackingConfig } from "@/services/location/backgroundLocationTask";, import { Destination, DrivingRoute } from "@/services/location/types";, import { isDestinationForToday } from "@/services/location/trackingDate";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ActiveJourneyCard.web.tsx
- **Services**: import { Destination } from "@/services/location/types";, import { nativeBridge } from "@/services/nativeBridge/client";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### AndroidHrmsShell.tsx
- **Services**: import { locationTrackingCoordinator } from "@/services/location/LocationTrackingCoordinator";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### AttendanceCheckoutFlow.tsx
- **Services**: import { AttendanceService } from "@/services/attendance.service";, import { stopAttendanceTracking } from "@/services/location/attendanceTrackingLifecycle";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### AutomaticUpdates.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### Button.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### Card.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### CheckoutActivityModal.tsx
- **Services**: import { ActivityService } from "@/services/activity.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### CheckoutConfirmationModal.tsx
- **Services**: import { AttendancePolicy } from "@/services/attendance.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### CheckoutNotesModal.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### CurrentLocationFallbackModal.tsx
- **Services**: import { FieldVisit } from "@/services/field-visit.service";
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### DeviceSessionsModal.tsx
- **Services**: import { DeviceSessionService, type UserDeviceSession } from "@/services/device-session.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ErrorBoundary.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ErrorFallback.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### FieldVisitFeedbackModal.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### HeaderTitle.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LocationComparisonMap.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LocationComparisonMap.web.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LocationSearchInput.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### LocationTimelineModal.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LocationTimelineModal.web.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### MapPickerModal.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### MapPickerModal.web.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### MarkedLocationReviewPanel.tsx
- **Services**: import { BusinessClockService } from "@/services/business-clock.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### MeetingDetailModal.tsx
- **Services**: import { OfficeService } from "@/services/office.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### NativeShellConnector.tsx
- **Services**: import { nativeBridge } from "@/services/nativeBridge/client";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### NextStopModal.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### PageHeader.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### PaginationControls.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ScreenFlatList.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ScreenKeyboardAwareScrollView.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ScreenScrollView.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### SitePickerModal.tsx
- **Services**: import { PredefinedSite, PredefinedSiteService } from "@/services/predefined-site.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### SiteVisitObserverMap.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### SiteVisitObserverMap.web.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### SmartOfficeActionCard.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### Spacer.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ThemedText.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ThemedView.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### VisitDetailModal.tsx
- **Services**: import { FieldVisit } from "@/services/field-visit.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### GeofenceReasonModal.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ObserverDetailDrawer.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ObserverFilterBar.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ObserverSummaryCards.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### AuthContext.tsx
- **Services**: import { DeviceSessionService } from "@/services/device-session.service";, import { stopNativeTracking } from "@/services/location/backgroundLocationTask";, import { clearOfflineLocationQueue } from "@/services/location/secureQueue";, import { CurrentLocationVisitService } from "@/services/current-location-visit.service";, import { deactivateCurrentDevicePushToken } from "@/services/location/notification.service";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### LocationTrackingContext.tsx
- **Services**: import { locationTrackingCoordinator } from "@/services/location/LocationTrackingCoordinator";, import { TrackingHealth } from "@/services/location/types";, import { BusinessClockService } from "@/services/business-clock.service";, import { nativeBridge } from "@/services/nativeBridge/client";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### PermissionsContext.tsx
- **Services**: None
- **Data Fetched**: fetch
- **Navigation**: None
- **State**: complete

### AdminStackNavigator.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### AttendanceStackNavigator.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### deferredScreen.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### HomeStackNavigator.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### MainTabNavigator.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ProfileStackNavigator.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### ReportsStackNavigator.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### RootNavigator.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### TasksStackNavigator.tsx
- **Services**: None
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

### App.tsx
- **Services**: import { CurrentLocationVisitService } from "@/services/current-location-visit.service";, import { AttendanceService } from "@/services/attendance.service";, import { scheduleAttendanceReminders } from "@/services/location/notification.service";, import { nativeBridge } from "@/services/nativeBridge/client";
- **Data Fetched**: None
- **Navigation**: None
- **State**: complete

