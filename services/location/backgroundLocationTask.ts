import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { LOCATION_RPC_ENABLED } from "@/services/location/capabilities";
import {
  advanceJourney,
  classifyLocationQuality,
  haversineDistanceM,
} from "@/services/location/geo";
import { reportDeviceHealth } from "@/services/location/deviceHealth";
import { refreshRouteProgress } from "@/services/location/route.service";
import {
  handleOfficeRelation,
  notifyJourneyEvent,
  notifyLocationProblem,
} from "@/services/location/notification.service";
import { enqueueOfflinePing } from "@/services/location/secureQueue";
import { drainOfflineQueue } from "@/services/location/offlineSync";
import {
  ActiveTrackingConfig,
  LocationQuality,
  TrackingLocation,
} from "@/services/location/types";
import { isDestinationForToday } from "@/services/location/trackingDate";

export const LIVE_LOCATION_TASK = "hrms-attendance-location-v2";
/**
 * Bump when getLocationOptions changes: a running service with older options
 * is restarted with the new ones the next time HRMS is opened.
 */
export const TRACKING_OPTIONS_VERSION = 2;
export const DESTINATION_GEOFENCE_TASK = "hrms-destination-geofences-v2";
const ACTIVE_CONFIG_KEY = "hrms.location.active-config.v2";
/** A shift never lasts this long; an older session was abandoned (missed checkout). */
const MAX_TRACKING_SESSION_MS = 16 * 60 * 60_000;
const LEGACY_CONFIG_KEY = "@hrms_live_user";

async function getProtectedValue(key: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return null;
  }
  return SecureStore.getItemAsync(key);
}

async function setProtectedValue(key: string, value: string | null) {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  if (value == null) await SecureStore.deleteItemAsync(key);
  else {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  }
}

export async function readActiveTrackingConfig() {
  const raw = await getProtectedValue(ACTIVE_CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveTrackingConfig;
  } catch {
    return null;
  }
}

export async function writeActiveTrackingConfig(
  config: ActiveTrackingConfig | null,
) {
  await setProtectedValue(
    ACTIVE_CONFIG_KEY,
    config ? JSON.stringify(config) : null,
  );
  if (!config) await AsyncStorage.removeItem(LEGACY_CONFIG_KEY);
}

type ActiveTrackingConfigPatch = Partial<ActiveTrackingConfig>;

function isLaterTimestamp(
  candidate: string | null | undefined,
  current: string | null | undefined,
) {
  const candidateMs = candidate ? Date.parse(candidate) : Number.NaN;
  if (!Number.isFinite(candidateMs)) return false;
  const currentMs = current ? Date.parse(current) : Number.NaN;
  return !Number.isFinite(currentMs) || candidateMs > currentMs;
}

function isCompleteConfig(
  patch: ActiveTrackingConfigPatch,
): patch is ActiveTrackingConfig {
  return (
    typeof patch.userId === "string" &&
    typeof patch.trackingStartedAt === "string" &&
    "attendanceId" in patch
  );
}

/**
 * Writes `patch` over the NEWEST saved config, re-read right before writing.
 * The background task records fixes concurrently with foreground operations
 * that await the network; a plain write of an older copy used to roll
 * lastSuccessfulLocationAt back and raise a false "no location" warning.
 * Fix timestamps always keep the later of the saved and the patched value.
 *
 * `patch` may be a function of the latest config; returning null writes
 * nothing. With no saved config only a complete config is written (a partial
 * patch means the session was stopped meanwhile and must not be revived).
 * Returns the written config, or null when nothing was written.
 */
export async function mergeWriteActiveTrackingConfig(
  patch:
    | ActiveTrackingConfigPatch
    | ((latest: ActiveTrackingConfig | null) => ActiveTrackingConfigPatch | null),
): Promise<ActiveTrackingConfig | null> {
  const latest = await readActiveTrackingConfig();
  const fields = typeof patch === "function" ? patch(latest) : patch;
  if (!fields) return null;
  if (!latest) {
    if (!isCompleteConfig(fields)) return null;
    const fresh = { ...fields };
    await writeActiveTrackingConfig(fresh);
    return fresh;
  }
  const merged: ActiveTrackingConfig = { ...latest, ...fields };
  if (latest.userId === merged.userId) {
    if (
      isLaterTimestamp(
        latest.lastSuccessfulLocationAt,
        merged.lastSuccessfulLocationAt,
      )
    ) {
      merged.lastSuccessfulLocationAt = latest.lastSuccessfulLocationAt;
      merged.lastAccuracyM = latest.lastAccuracyM;
    }
    if (isLaterTimestamp(latest.lastFixAt, merged.lastFixAt)) {
      merged.lastFixAt = latest.lastFixAt;
    }
    if (isLaterTimestamp(latest.lastSentAt, merged.lastSentAt)) {
      merged.lastSentAt = latest.lastSentAt;
      merged.lastSentLatitude = latest.lastSentLatitude;
      merged.lastSentLongitude = latest.lastSentLongitude;
    }
  }
  await writeActiveTrackingConfig(merged);
  return merged;
}

function toTrackingLocation(
  location: Location.LocationObject,
): TrackingLocation {
  return {
    clientEventId: Crypto.randomUUID(),
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy ?? null,
    altitude: location.coords.altitude ?? null,
    heading: location.coords.heading ?? null,
    speed: location.coords.speed ?? null,
    mocked: location.mocked ?? false,
    capturedAt: new Date(location.timestamp).toISOString(),
  };
}

async function submitLocationToServer(
  config: ActiveTrackingConfig,
  location: TrackingLocation,
  qualityStatus: LocationQuality,
  distanceM: number | null,
) {
  const { data, error } = LOCATION_RPC_ENABLED
    ? await supabase.rpc("record_location_ping", {
        p_attendance_log_id: config.attendanceId,
        p_tracking_session_id: config.trackingSessionId,
        p_field_visit_id: config.destination?.fieldVisitId ?? null,
        p_client_event_id: location.clientEventId,
        p_latitude: location.latitude,
        p_longitude: location.longitude,
        p_accuracy_m: location.accuracy,
        p_altitude_m: location.altitude,
        p_heading: location.heading,
        p_speed_mps: location.speed,
        p_mocked: location.mocked,
        p_recorded_at: location.capturedAt,
        p_provider: "expo-location",
        p_client_quality_status: qualityStatus,
      })
    : {
        data: null,
        error: {
          code: "RPC_ROLLOUT_DISABLED",
          message: "record_location_ping rollout is disabled",
        },
      };
  if (!error) {
    const result = Array.isArray(data) ? data[0] : data;
    const attendanceClosed = result?.tracking_session_status === "STOPPED";
    // Online again: send what was queued while offline.
    if (!attendanceClosed) void drainOfflineQueue().catch(() => undefined);
    return { uploaded: true, attendanceClosed, relation: result?.relation ?? null };
  }

  if (
    error.message?.includes("NO_OPEN_ATTENDANCE") ||
    error.message?.includes("ATTENDANCE_CLOSED")
  ) {
    return { uploaded: false, attendanceClosed: true, relation: null };
  }
  await enqueueOfflinePing({
    config: {
      attendanceId: config.attendanceId,
      trackingSessionId: config.trackingSessionId,
      fieldVisitId: config.destination?.fieldVisitId ?? null,
    },
    location,
    qualityStatus,
  });
  return { uploaded: false, attendanceClosed: false, relation: null };
}

async function processLocation(locationObject: Location.LocationObject) {
  const config = await readActiveTrackingConfig();
  if (!config) {
    // The service outlived its session (a stop failed or was skipped): end it.
    await stopNativeTracking();
    return;
  }
  const startedMs = Date.parse(config.trackingStartedAt);
  if (Number.isFinite(startedMs) && Date.now() - startedMs > MAX_TRACKING_SESSION_MS) {
    await stopNativeTracking();
    return;
  }
  const authoritativeNow = Number.isFinite(config.serverClockOffsetMs)
    ? new Date(Date.now() + Number(config.serverClockOffsetMs))
    : null;
  if (
    config.destination &&
    authoritativeNow &&
    !isDestinationForToday(config.destination, authoritativeNow)
  ) {
    // Yesterday's visit is over; attendance tracking itself continues.
    config.destination = null;
    config.journeyState = null;
    config.routeProgress = null;
    config.trackingMode = "ATTENDANCE";
  }
  const location = toTrackingLocation(locationObject);
  // Battery / data: a phone that has not moved sends at most every 2 min in
  // the office and every minute on a visit — still inside the 5-minute LIVE
  // window. Any real movement is sent immediately.
  if (
    config.lastSentAt &&
    config.lastSentLatitude != null &&
    config.lastSentLongitude != null &&
    classifyLocationQuality(location, null) === "RELIABLE"
  ) {
    const sinceMs = Date.parse(location.capturedAt) - Date.parse(config.lastSentAt);
    const movedM = haversineDistanceM(
      config.lastSentLatitude,
      config.lastSentLongitude,
      location.latitude,
      location.longitude,
    );
    const minGapMs = config.destination ? 60_000 : 120_000;
    if (sinceMs >= 0 && sinceMs < minGapMs && movedM < Math.max(25, location.accuracy ?? 25)) {
      return;
    }
  }
  // Office mode is checked too (the server re-checks every point anyway).
  let qualityStatus: LocationQuality = config.destination
    ? "RELIABLE"
    : classifyLocationQuality(location, null);
  let destinationDistanceM: number | null = null;

  if (config.destination && config.journeyState) {
    const preliminaryQuality = classifyLocationQuality(
      location,
      config.journeyState.lastReliableLocation,
    );
    if (preliminaryQuality === "RELIABLE") {
      config.routeProgress = await refreshRouteProgress(
        config.routeProgress,
        location,
        config.destination,
      );
    }
    const transition = advanceJourney(
      config.journeyState,
      config.destination,
      location,
      Date.now(),
      config.routeProgress,
    );
    config.journeyState = transition.state;
    qualityStatus = transition.quality;
    destinationDistanceM = transition.distanceM;
    for (const event of transition.events) {
      await notifyJourneyEvent(event, config.destination, config.routeProgress);
    }
    const trackingDistanceM =
      config.routeProgress?.distanceM ?? destinationDistanceM;
    if (transition.state.arrived) config.trackingMode = "ARRIVED";
    else if (trackingDistanceM != null && trackingDistanceM <= 1_000) {
      config.trackingMode = "NEAR";
    } else if (trackingDistanceM != null && trackingDistanceM <= 5_000) {
      config.trackingMode = "FAR";
    } else {
      config.trackingMode = "DISTANT";
    }
  }

  const result = await submitLocationToServer(
    config,
    location,
    qualityStatus,
    destinationDistanceM,
  );
  if (result.attendanceClosed) {
    await stopNativeTracking();
    return;
  }
  // Office mode: the phone itself alerts (sound + vibration) when the server
  // says the employee has left the office area; push may not reach every phone.
  if (!config.destination && config.attendanceId && result.relation) {
    await handleOfficeRelation(config.attendanceId, result.relation).catch(() => undefined);
  }
  // Any real (non-mocked) fix proves the service is alive, even an indoor
  // LOW_ACCURACY one; only RELIABLE fixes count as a successful location.
  const validFix =
    !location.mocked &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude) &&
    Math.abs(location.latitude) <= 90 &&
    Math.abs(location.longitude) <= 180 &&
    Number.isFinite(Date.parse(location.capturedAt));
  // Network calls above take time: merge into the newest saved config so a
  // destination / session change made meanwhile is not overwritten.
  const saved = await mergeWriteActiveTrackingConfig((latest) => {
    if (!latest || latest.attendanceId !== config.attendanceId) return null;
    const sameJourney =
      (latest.destination?.journeyId ?? null) ===
      (config.destination?.journeyId ?? null);
    const patch: Partial<ActiveTrackingConfig> = sameJourney
      ? {
          destination: config.destination,
          journeyState: config.journeyState,
          routeProgress: config.routeProgress,
          trackingMode: config.trackingMode,
        }
      : {};
    if (validFix) patch.lastFixAt = location.capturedAt;
    if (qualityStatus === "RELIABLE") {
      patch.lastSuccessfulLocationAt = location.capturedAt;
      patch.lastAccuracyM = location.accuracy;
    }
    if (result.uploaded) {
      patch.lastSentAt = location.capturedAt;
      patch.lastSentLatitude = location.latitude;
      patch.lastSentLongitude = location.longitude;
    }
    return patch;
  });
  if (!saved) return;
  void reportDeviceHealth({
    taskName: LIVE_LOCATION_TASK,
    trackingOptionsVersion: TRACKING_OPTIONS_VERSION,
    source: "background",
  });
}

async function handleTaskFailure() {
  const config = await readActiveTrackingConfig();
  if (!config) return;
  const [servicesEnabled, foreground, background] = await Promise.all([
    Location.hasServicesEnabledAsync().catch(() => false),
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
  ]);
  const permissionRevoked =
    foreground?.granted === false || background?.granted === false;
  await notifyLocationProblem(
    permissionRevoked ? "background_permission_revoked" : "gps_off",
  );
  if (!config.attendanceId) return;
  await supabase.rpc("record_tracking_health_event", {
    p_attendance_log_id: config.attendanceId,
    p_event_type: permissionRevoked ? "PERMISSION_REVOKED" : "GPS_OFF",
    p_metadata: {
      source: "native_background_task",
      location_services_enabled: servicesEnabled,
      foreground_permission: foreground?.status ?? "unknown",
      background_permission: background?.status ?? "unknown",
    },
  });
}

if (!TaskManager.isTaskDefined(LIVE_LOCATION_TASK)) {
  TaskManager.defineTask(
    LIVE_LOCATION_TASK,
    async ({ data, error }: TaskManager.TaskManagerTaskBody<any>) => {
      if (error) {
        await handleTaskFailure();
        return;
      }
      const locations = (data?.locations ?? []) as Location.LocationObject[];
      for (const location of locations.sort(
        (first, second) => first.timestamp - second.timestamp,
      )) {
        await processLocation(location);
      }
    },
  );
}

if (!TaskManager.isTaskDefined(DESTINATION_GEOFENCE_TASK)) {
  TaskManager.defineTask(
    DESTINATION_GEOFENCE_TASK,
    async ({ data, error }: TaskManager.TaskManagerTaskBody<any>) => {
      if (error || data?.eventType !== Location.GeofencingEventType.Enter)
        return;
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        await processLocation(location);
      } catch {
        await handleTaskFailure();
      }
    },
  );
}

/** Options depend only on office vs visit, so they never need changing from the background. */
export function trackingOptionsKey(config: ActiveTrackingConfig) {
  return `${TRACKING_OPTIONS_VERSION}:${config.destination ? "VISIT" : "ATTENDANCE"}`;
}

/**
 * Time-based, never distance-gated: Android delivers a fix every interval
 * even when the employee does not move, so a person sitting still stays LIVE
 * (the server stores only real movement and keeps the rest as a heartbeat).
 * High accuracy (GPS) in every mode: Wi-Fi/cell fixes (> 100 m) are useless
 * for office/site decisions.
 *   Office: one fix a minute.  Visit: one fix every 15 s (route + arrival).
 */
function getLocationOptions(
  config: ActiveTrackingConfig,
): Location.LocationTaskOptions {
  const visit = !!config.destination;
  const intervalMs = visit ? 15_000 : 60_000;
  return {
    accuracy: Location.Accuracy.High,
    timeInterval: intervalMs,
    distanceInterval: 0,
    deferredUpdatesInterval: intervalMs,
    deferredUpdatesDistance: 0,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Other,
    foregroundService: {
      notificationTitle: "BOP HRMS - Location tracking active",
      notificationBody:
        "Your location is being shared for your active attendance session. Tap to view tracking status.",
      notificationColor: "#6D1B6D",
      killServiceOnDestroy: false,
    },
  };
}

export async function startNativeTracking(config: ActiveTrackingConfig) {
  if (Platform.OS === "web") return false;
  const saved = await mergeWriteActiveTrackingConfig(config);
  if (saved) Object.assign(config, saved);
  if (!(await TaskManager.isAvailableAsync())) return false;
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
    LIVE_LOCATION_TASK,
  ).catch(() => false);
  const registered = await TaskManager.isTaskRegisteredAsync(
    LIVE_LOCATION_TASK,
  ).catch(() => false);
  const key = trackingOptionsKey(config);
  if (!alreadyStarted || !registered || config.appliedOptionsKey !== key) {
    try {
      // Re-registering a running task replaces its options (office <-> visit).
      await Location.startLocationUpdatesAsync(
        LIVE_LOCATION_TASK,
        getLocationOptions(config),
      );
      config.appliedOptionsKey = key;
      await mergeWriteActiveTrackingConfig({ appliedOptionsKey: key });
    } catch (error) {
      // Android refuses to (re)start the service from the background; the
      // running service keeps its options and the next foreground retries.
      if (!alreadyStarted) throw error;
    }
  }
  await configureDestinationGeofences(config);
  return true;
}

/**
 * Re-registering an existing Expo location task updates its native options.
 * Call this only while the app is foregrounded: Android can reject attempts
 * to start or update a foreground service from the background.
 * Skipped when the running service already has the current options (every
 * app foreground calls this; restarting the service each time is wasteful).
 */
export async function refreshNativeTrackingOptions(
  config: ActiveTrackingConfig,
) {
  if (Platform.OS === "web") return false;
  // Callers save their change first; use the newest saved config (never an
  // older copy) and never revive a session that was stopped meanwhile.
  const saved = await readActiveTrackingConfig();
  if (!saved) return false;
  Object.assign(config, saved);
  if (!(await TaskManager.isAvailableAsync())) return false;
  const key = trackingOptionsKey(config);
  const running = await Location.hasStartedLocationUpdatesAsync(
    LIVE_LOCATION_TASK,
  ).catch(() => false);
  if (!running || config.appliedOptionsKey !== key) {
    await Location.startLocationUpdatesAsync(
      LIVE_LOCATION_TASK,
      getLocationOptions(config),
    );
    config.appliedOptionsKey = key;
    await mergeWriteActiveTrackingConfig({ appliedOptionsKey: key });
  }
  await configureDestinationGeofences(config);
  return true;
}

export async function configureDestinationGeofences(
  config: ActiveTrackingConfig,
) {
  if (Platform.OS === "web") return;
  if (!config.destination) {
    const running = await Location.hasStartedGeofencingAsync(
      DESTINATION_GEOFENCE_TASK,
    ).catch(() => false);
    if (running) {
      await Location.stopGeofencingAsync(DESTINATION_GEOFENCE_TASK).catch(
        () => undefined,
      );
    }
    return;
  }
  const { destination } = config;
  await Location.startGeofencingAsync(DESTINATION_GEOFENCE_TASK, [
    {
      identifier: `${destination.journeyId}:1000`,
      latitude: destination.latitude,
      longitude: destination.longitude,
      radius: 1_000,
      notifyOnEnter: true,
      notifyOnExit: false,
    },
    {
      identifier: `${destination.journeyId}:500`,
      latitude: destination.latitude,
      longitude: destination.longitude,
      radius: 500,
      notifyOnEnter: true,
      notifyOnExit: false,
    },
    {
      identifier: `${destination.journeyId}:arrival`,
      latitude: destination.latitude,
      longitude: destination.longitude,
      radius: destination.arrivalRadiusM,
      notifyOnEnter: true,
      notifyOnExit: true,
    },
  ]);
}

export async function stopNativeTracking() {
  // Clear the session first: if the native stop below fails, the next fix the
  // service delivers finds no session and stops the service itself.
  await writeActiveTrackingConfig(null);
  if (Platform.OS === "web") return;
  // Not gated on hasStarted*: that check can itself fail and leave GPS running.
  await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK).catch(() => undefined);
  await Location.stopGeofencingAsync(DESTINATION_GEOFENCE_TASK).catch(() => undefined);
}

/** True when the native location service is running without an HRMS session. */
export async function isNativeTrackingOrphaned() {
  if (Platform.OS === "web") return false;
  const running = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK).catch(() => false);
  return running && !(await readActiveTrackingConfig());
}
