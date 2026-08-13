import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { secureStorage } from "@/utils/secureStorage";
import {
  Destination,
  JourneyEventType,
  RouteProgress,
} from "@/services/location/types";

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
const DEVICE_ID_KEY = "@hrms_device_registration_id_v1";
const ARRIVAL_SOUND = "arrival_ping.wav";
const PROBLEM_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function initializeNotificationInfrastructure() {
  if (Platform.OS === "web") return;
  if (Platform.OS === "android") {
    await Promise.all([
      Notifications.setNotificationChannelAsync(TRACKING_CHANNEL_ID, {
        name: "Active Location Tracking",
        description: "Ongoing attendance-linked background tracking",
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
        enableVibrate: false,
        showBadge: false,
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
      Notifications.setNotificationChannelAsync(ARRIVAL_CHANNEL_ID, {
        name: "Destination Alerts",
        description: "Approach and confirmed-arrival alerts",
        importance: Notifications.AndroidImportance.MAX,
        sound: ARRIVAL_SOUND,
        enableVibrate: true,
        vibrationPattern: [0, 250, 150, 350],
        showBadge: true,
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
      Notifications.setNotificationChannelAsync(LOCATION_PROBLEMS_CHANNEL_ID, {
        name: "Location Problems",
        description: "GPS, permission, and missing-location warnings",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        enableVibrate: true,
        vibrationPattern: [0, 300, 200, 300],
        showBadge: true,
      }),
      Notifications.setNotificationChannelAsync(MANAGER_UPDATES_CHANNEL_ID, {
        name: "Employee Journey Updates",
        description: "Server-validated employee journey events",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        enableVibrate: true,
        showBadge: true,
      }),
      Notifications.setNotificationChannelAsync(EVENT_NOTIFICATION_CHANNEL_ID, {
        name: "HRMS Events",
        description: "Event announcements and attendance reminders",
        importance: Notifications.AndroidImportance.MAX,
        sound: "default",
        enableVibrate: true,
        vibrationPattern: [0, 300, 180, 450],
        showBadge: true,
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
      Notifications.setNotificationChannelAsync(
        ATTENDANCE_NOTIFICATION_CHANNEL_ID,
        {
          name: "Attendance Reminders",
          description: "Company-policy check-in and checkout reminders",
          importance: Notifications.AndroidImportance.HIGH,
          sound: "default",
          enableVibrate: true,
          showBadge: true,
        },
      ),
      Notifications.setNotificationChannelAsync(FIELD_VISIT_NOTIFICATION_CHANNEL_ID, {
        name: "Field Visit Updates",
        description: "Assignments, approvals, arrivals, check-ins and missed visits",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        enableVibrate: true,
        showBadge: true,
      }),
      Notifications.setNotificationChannelAsync(LEAVE_NOTIFICATION_CHANNEL_ID, {
        name: "Leave and Regularization",
        description: "Requests, decisions and pending approval reminders",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        enableVibrate: true,
        showBadge: true,
      }),
      Notifications.setNotificationChannelAsync(TASK_NOTIFICATION_CHANNEL_ID, {
        name: "Task Updates",
        description: "Assignments, due dates, overdue tasks and completion updates",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        enableVibrate: true,
        showBadge: true,
      }),
      Notifications.setNotificationChannelAsync(ANNOUNCEMENT_NOTIFICATION_CHANNEL_ID, {
        name: "HR Announcements",
        description: "Events, holidays, policies, emergency messages and comp-off updates",
        importance: Notifications.AndroidImportance.MAX,
        sound: "default",
        enableVibrate: true,
        vibrationPattern: [0, 300, 180, 450],
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
    ]);
  }
  await Promise.all([
    Notifications.setNotificationCategoryAsync(VISIT_NOTIFICATION_CATEGORY, [
      {
        identifier: "OPEN_VISIT",
        buttonTitle: "Open Visit",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "NAVIGATE",
        buttonTitle: "Navigate",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "CHECK_IN",
        buttonTitle: "Check In",
        options: { opensAppToForeground: true },
      },
    ]),
    Notifications.setNotificationCategoryAsync(
      PERMISSION_NOTIFICATION_CATEGORY,
      [
        {
          identifier: "FIX_PERMISSION",
          buttonTitle: "Fix Permission",
          options: { opensAppToForeground: true },
        },
      ],
    ),
    Notifications.setNotificationCategoryAsync(EVENT_NOTIFICATION_CATEGORY, [
      {
        identifier: "OPEN_TASKS",
        buttonTitle: "View Event",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "GOT_IT",
        buttonTitle: "Got it",
        options: { opensAppToForeground: true },
      },
    ]),
    Notifications.setNotificationCategoryAsync(ATTENDANCE_NOTIFICATION_CATEGORY, [
      {
        identifier: "OPEN_CHECKOUT",
        buttonTitle: "Open Checkout",
        options: { opensAppToForeground: true },
      },
    ]),
    Notifications.setNotificationCategoryAsync(LEAVE_NOTIFICATION_CATEGORY, [
      {
        identifier: "OPEN_LEAVE",
        buttonTitle: "Open Leave",
        options: { opensAppToForeground: true },
      },
    ]),
    Notifications.setNotificationCategoryAsync(TASK_NOTIFICATION_CATEGORY, [
      {
        identifier: "OPEN_TASK",
        buttonTitle: "Open Task",
        options: { opensAppToForeground: true },
      },
    ]),
    Notifications.setNotificationCategoryAsync(ANNOUNCEMENT_NOTIFICATION_CATEGORY, [
      {
        identifier: "OPEN_ANNOUNCEMENT",
        buttonTitle: "Open HRMS",
        options: { opensAppToForeground: true },
      },
    ]),
  ]);
}

export async function requestNotificationPermission() {
  if (Platform.OS === "web") return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function isNotificationPermissionGranted() {
  if (Platform.OS === "web") return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

const ATTENDANCE_REMINDER_IDS_KEY = "@hrms_attendance_reminder_ids_v1";

export async function scheduleAttendanceReminders(_schedule: {
  checkin_time: string;
  checkout_time: string;
  office_id: string;
}) {
  if (Platform.OS === "web") return;
  if (!(await isNotificationPermissionGranted())) return;
  const oldIds = JSON.parse(
    (await secureStorage.getItem(ATTENDANCE_REMINDER_IDS_KEY)) || "[]",
  ) as string[];
  await Promise.all(
    oldIds.map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined),
    ),
  );
  // Attendance reminders are dispatched by the server after it re-reads the
  // employee's current state. Device-local daily schedules cannot be revoked
  // reliably after the app is killed and caused stale check-in/out reminders.
  const ids: string[] = [];
  await secureStorage.setItem(
    ATTENDANCE_REMINDER_IDS_KEY,
    JSON.stringify(ids),
  );
}

async function scheduleDeviceNotification(params: {
  title: string;
  body: string;
  channelId: string;
  sound: string | "default" | false;
  categoryIdentifier: string;
  data: Record<string, string | number | boolean | null>;
}) {
  if (Platform.OS === "web") return null;
  if (!(await isNotificationPermissionGranted())) return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: params.title,
      body: params.body,
      data: params.data,
      sound: params.sound,
      vibrate:
        params.channelId === ARRIVAL_CHANNEL_ID
          ? [0, 250, 150, 350]
          : [0, 300, 200, 300],
      categoryIdentifier: params.categoryIdentifier,
      color: "#6D1B6D",
    },
    trigger: Platform.OS === "android" ? { channelId: params.channelId } : null,
  });
}

export async function notifyJourneyEvent(
  event: JourneyEventType,
  destination: Destination,
  routeProgress: RouteProgress | null = null,
) {
  if (event === "DEPARTED") return null;
  const deepLink =
    event === "ARRIVED"
      ? `re-hrms://field-visits/${destination.fieldVisitId}?arrival=1`
      : `re-hrms://field-visits/${destination.fieldVisitId}`;
  const commonData = {
    fieldVisitId: destination.fieldVisitId,
    journeyId: destination.journeyId,
    destinationName: destination.name,
    deepLink,
  };
  if (event === "ENTERED_1KM") {
    const etaMinutes = routeProgress
      ? Math.max(1, Math.ceil(routeProgress.durationSeconds / 60))
      : null;
    return scheduleDeviceNotification({
      title: "Approaching destination",
      body: etaMinutes
        ? `About ${etaMinutes} min remaining to ${destination.name}.`
        : `You are approximately 1 km away from ${destination.name}.`,
      channelId: ARRIVAL_CHANNEL_ID,
      sound: ARRIVAL_SOUND,
      categoryIdentifier: VISIT_NOTIFICATION_CATEGORY,
      data: { ...commonData, type: "destination_1km" },
    });
  }
  if (event === "ENTERED_500M") {
    const etaMinutes = routeProgress
      ? Math.max(1, Math.ceil(routeProgress.durationSeconds / 60))
      : null;
    return scheduleDeviceNotification({
      title: "You are about to arrive",
      body: etaMinutes
        ? `${destination.name} is about ${etaMinutes} min away.`
        : `Only about 500 metres remaining to ${destination.name}.`,
      channelId: ARRIVAL_CHANNEL_ID,
      sound: ARRIVAL_SOUND,
      categoryIdentifier: VISIT_NOTIFICATION_CATEGORY,
      data: { ...commonData, type: "destination_500m" },
    });
  }
  return scheduleDeviceNotification({
    title: "You have arrived",
    body: `You are at ${destination.name}. Tap to complete site check-in.`,
    channelId: ARRIVAL_CHANNEL_ID,
    sound: ARRIVAL_SOUND,
    categoryIdentifier: VISIT_NOTIFICATION_CATEGORY,
    data: { ...commonData, type: "destination_arrived" },
  });
}

export async function notifyLocationProblem(
  type:
    | "gps_off"
    | "background_permission_revoked"
    | "precise_location_disabled"
    | "location_stale",
) {
  const dedupeKey = `@hrms_location_problem_last_v1:${type}`;
  const lastShownAt = Number(await secureStorage.getItem(dedupeKey));
  if (
    Number.isFinite(lastShownAt) &&
    Date.now() - lastShownAt < PROBLEM_DEDUPE_WINDOW_MS
  ) {
    return null;
  }
  const content = {
    gps_off: {
      title: "Location tracking interrupted",
      body: "Turn on GPS to continue attendance location tracking.",
    },
    background_permission_revoked: {
      title: "Background location is disabled",
      body: "Allow location all the time so HRMS can track your active attendance.",
    },
    precise_location_disabled: {
      title: "Precise location is disabled",
      body: "Enable precise location so HRMS can verify office and destination proximity.",
    },
    location_stale: {
      title: "Location update missing",
      body: "HRMS has not received a location update recently. Open the app to restore tracking.",
    },
  }[type];
  const notificationId = await scheduleDeviceNotification({
    ...content,
    channelId: LOCATION_PROBLEMS_CHANNEL_ID,
    sound: "default",
    categoryIdentifier: PERMISSION_NOTIFICATION_CATEGORY,
    data: {
      type,
      deepLink: "re-hrms://tracking-setup",
    },
  });
  if (notificationId) {
    await secureStorage.setItem(dedupeKey, String(Date.now()));
  }
  return notificationId;
}

export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
) {
  const data = response.notification.request.content.data as Record<
    string,
    unknown
  >;
  const eventId = typeof data.eventId === "string" ? data.eventId : null;
  if (data.type === "event_announcement" && eventId) {
    if (response.actionIdentifier === "GOT_IT") {
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user?.id) {
        await supabase.rpc("rpc_acknowledge_event", {
          p_event_id: eventId,
          p_user_id: authData.user.id,
        });
      }
    }
    const eventDeepLink =
      typeof data.deepLink === "string"
        ? data.deepLink
        : `re-hrms://tasks/${eventId}`;
    await Linking.openURL(eventDeepLink);
    return;
  }
  if (
    response.actionIdentifier === "FIX_PERMISSION" ||
    String(data.type ?? "").includes("permission") ||
    data.type === "gps_off" ||
    data.type === "location_stale"
  ) {
    await Linking.openURL("re-hrms://tracking-setup");
    return;
  }
  const fieldVisitId =
    typeof data.fieldVisitId === "string" ? data.fieldVisitId : null;
  if (!fieldVisitId) return;
  const [{ data: visit }, { data: authData }] = await Promise.all([
    supabase
      .from("field_visits")
      .select("id,user_id,status,destination_coords")
      .eq("id", fieldVisitId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!visit || visit.user_id !== authData.user?.id) return;
  if (!["PENDING", "IN_TRANSIT", "CHECKED_IN"].includes(String(visit.status))) {
    return;
  }
  if (response.actionIdentifier === "NAVIGATE") {
    const coordinates = visit.destination_coords as Record<
      string,
      unknown
    > | null;
    const latitude = Number(coordinates?.latitude ?? coordinates?.lat);
    const longitude = Number(
      coordinates?.longitude ?? coordinates?.lng ?? coordinates?.lon,
    );
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      await Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
      );
    }
    return;
  }
  const deepLink = typeof data.deepLink === "string" ? data.deepLink : null;
  if (deepLink) await Linking.openURL(deepLink);
}

async function getDeviceRegistrationId() {
  const existing = await secureStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await secureStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export async function registerDevicePushToken(_userId: string) {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  if (!(await isNotificationPermissionGranted())) return null;
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null;
  if (!projectId) return null;
  const token = (
    await Notifications.getExpoPushTokenAsync({ projectId: String(projectId) })
  ).data;
  const deviceId = await getDeviceRegistrationId();
  const { error } = await supabase.rpc("rpc_register_device_push_token", {
    p_token: token,
    p_platform: Platform.OS,
    p_device_id: deviceId,
    p_app_version: Constants.expoConfig?.version ?? null,
  });
  if (error) return null;
  return token;
}

export async function deactivateCurrentDevicePushToken() {
  if (Platform.OS === "web") return;
  const deviceId = await secureStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) return;
  await supabase.rpc("rpc_deactivate_device_push_token", {
    p_device_id: deviceId,
  });
}
