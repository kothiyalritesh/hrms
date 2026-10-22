import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import * as Location from "expo-location";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { isNotificationPermissionGranted } from "@/services/location/notification.service";
import { offlineQueueSize } from "@/services/location/secureQueue";

const LAST_REPORT_KEY = "hrms.location.health-report.v1";
const REPORT_EVERY_MS = 10 * 60 * 1000;

/**
 * Tells the server how this phone's tracking is set up (permissions, GPS,
 * background service, queued points, app + tracking version) so HR can tell
 * "not moving" from "tracking is broken", and silence alerts only target phones
 * running the every-minute tracking. Sent when something changes, otherwise at
 * most every 10 minutes. Never throws.
 */
export async function reportDeviceHealth(options: {
  taskName: string;
  trackingOptionsVersion: number;
  source: string;
  force?: boolean;
}) {
  if (Platform.OS === "web") return;
  try {
    const [foreground, background, gpsOn, notifications, taskActive, queueSize] = await Promise.all([
      Location.getForegroundPermissionsAsync().catch(() => null),
      Location.getBackgroundPermissionsAsync().catch(() => null),
      Location.hasServicesEnabledAsync().catch(() => null),
      isNotificationPermissionGranted().catch(() => null),
      Location.hasStartedLocationUpdatesAsync(options.taskName).catch(() => null),
      offlineQueueSize().catch(() => null),
    ]);
    const precise = foreground?.granted
      ? Platform.OS === "android"
        ? foreground.android?.accuracy === "fine"
        : foreground.ios?.accuracy !== "reduced"
      : false;
    const health = {
      platform: Platform.OS,
      app_version: Application.nativeApplicationVersion ?? null,
      build: Application.nativeBuildVersion ?? null,
      tracking_options_version: options.trackingOptionsVersion,
      foreground: foreground?.granted ?? null,
      background: background?.granted ?? null,
      precise,
      gps_on: gpsOn,
      notifications,
      task_active: taskActive,
      queue_size: queueSize,
      source: options.source,
    };
    // What matters for HR; a growing queue only counts once it is large.
    const stateKey = JSON.stringify({ ...health, queue_size: (queueSize ?? 0) >= 30, source: null });
    const previous = await AsyncStorage.getItem(LAST_REPORT_KEY)
      .then((raw) => (raw ? (JSON.parse(raw) as { at: number; key: string }) : null))
      .catch(() => null);
    if (
      !options.force &&
      previous &&
      previous.key === stateKey &&
      Date.now() - previous.at < REPORT_EVERY_MS
    ) {
      return;
    }
    const { error } = await supabase.rpc("rpc_report_tracking_health", { p_health: health });
    if (!error) {
      await AsyncStorage.setItem(LAST_REPORT_KEY, JSON.stringify({ at: Date.now(), key: stateKey }));
    }
  } catch {
    // Health reporting must never disturb tracking.
  }
}
