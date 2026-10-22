import { Destination, JourneyEventType } from "@/services/location/types";
import { nativeBridge } from "@/services/nativeBridge/client";

export const TRACKING_CHANNEL_ID = "hrms_tracking";
export const ARRIVAL_CHANNEL_ID = "hrms_arrival";
export const LOCATION_PROBLEMS_CHANNEL_ID = "hrms_location_problems";
export const MANAGER_UPDATES_CHANNEL_ID = "hrms_manager_updates";
export const EVENT_NOTIFICATION_CHANNEL_ID = "hrms_events";
export const ATTENDANCE_NOTIFICATION_CHANNEL_ID = "hrms_attendance";
export const FIELD_VISIT_NOTIFICATION_CHANNEL_ID = "hrms_field_visits";
export const LEAVE_NOTIFICATION_CHANNEL_ID = "hrms_leave";
export const TASK_NOTIFICATION_CHANNEL_ID = "hrms_tasks";
export const ANNOUNCEMENT_NOTIFICATION_CHANNEL_ID = "hrms_announcements";
export const VISIT_NOTIFICATION_CATEGORY = "hrms_visit_actions";
export const PERMISSION_NOTIFICATION_CATEGORY = "hrms_permission_actions";
export const EVENT_NOTIFICATION_CATEGORY = "hrms_event_actions";
export const ATTENDANCE_NOTIFICATION_CATEGORY = "hrms_attendance_actions";
export const LEAVE_NOTIFICATION_CATEGORY = "hrms_leave_actions";
export const TASK_NOTIFICATION_CATEGORY = "hrms_task_actions";
export const ANNOUNCEMENT_NOTIFICATION_CATEGORY = "hrms_announcement_actions";

// Device notification channels and Expo push tokens are native-only. Browser
// foreground location remains available through the tracking context/hook.
export async function initializeNotificationInfrastructure() {}

export async function requestNotificationPermission() {
  return false;
}

export async function isNotificationPermissionGranted() {
  return false;
}

export async function getNotificationStatus() {
  return { granted: false, canAskAgain: false, mutedChannels: [] as string[] };
}

export async function notifyJourneyEvent(
  _event: JourneyEventType,
  _destination: Destination,
  _routeProgress?: unknown,
) {
  return null;
}

export async function handleOfficeRelation(_attendanceId: string, _relation: unknown) {
  return null;
}

export async function notifyLocationProblem(
  _type:
    | "gps_off"
    | "background_permission_revoked"
    | "precise_location_disabled"
    | "location_stale",
) {
  return null;
}

export async function handleNotificationResponse(_response: unknown) {}

export async function registerDevicePushToken(_userId: string) {
  return null;
}

export async function scheduleAttendanceReminders(_schedule: {
  checkin_time: string;
  checkout_time: string;
  office_id: string;
}) {}

/**
 * Called on logout while the session is still valid. In a browser there is no
 * device token. Inside the Android app the shell owns the push token, so ask
 * it to deactivate this device; otherwise the next person to sign in on this
 * phone would keep receiving the previous employee's notifications.
 * (Without this export, logout on the web build threw "is not a function".)
 */
export async function deactivateCurrentDevicePushToken() {
  if (!nativeBridge.isAvailable()) return;
  await nativeBridge.request("notifications.unregister", undefined, 5_000).catch(() => undefined);
}
