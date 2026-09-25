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
import { refreshRouteProgress } from "@/services/location/route.service";
import {
  notifyJourneyEvent,
  notifyLocationProblem,
} from "@/services/location/notification.service";
import { enqueueOfflinePing } from "@/services/location/secureQueue";
import {
  ActiveTrackingConfig,
  LocationQuality,
  TrackingLocation,
} from "@/services/location/types";
import { isDestinationForToday } from "@/services/location/trackingDate";

export const LIVE_LOCATION_TASK = "hrms-attendance-location-v2";
export const DESTINATION_GEOFENCE_TASK = "hrms-destination-geofences-v2";
const ACTIVE_CONFIG_KEY = "hrms.location.active-config.v2";
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
    return {
      uploaded: true,
      attendanceClosed: result?.tracking_session_status === "STOPPED",
    };
  }

  if (
    error.message?.includes("NO_OPEN_ATTENDANCE") ||
    error.message?.includes("ATTENDANCE_CLOSED")
  ) {
    return { uploaded: false, attendanceClosed: true };
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
  return { uploaded: false, attendanceClosed: false };
}

async function processLocation(locationObject: Location.LocationObject) {
  const config = await readActiveTrackingConfig();
  if (!config) return;
  const authoritativeNow = Number.isFinite(config.serverClockOffsetMs)
    ? new Date(Date.now() + Number(config.serverClockOffsetMs))
    : null;
  if (
    config.destination &&
    authoritativeNow &&
    !isDestinationForToday(config.destination, authoritativeNow)
  ) {
    await stopNativeTracking();
    return;
  }
  const location = toTrackingLocation(locationObject);
  let qualityStatus: LocationQuality = "RELIABLE";
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
  if (qualityStatus === "RELIABLE") {
    config.lastSuccessfulLocationAt = location.capturedAt;
    config.lastAccuracyM = location.accuracy;
    
    // Evaluate Office Geofence (200m rule) if tracking regular attendance
    if (!config.destination && config.baseLatitude && config.baseLongitude && config.officeId) {
      const distanceToOffice = haversineDistanceM(
        location.latitude,
        location.longitude,
        config.baseLatitude,
        config.baseLongitude,
      );
      if (distanceToOffice > config.officeRadiusM) {
        // Trigger Geofence Violation Backend State Machine
        await supabase.rpc("rpc_ingest_location_observation", {
          p_user_id: config.userId,
          p_client_event_id: location.clientEventId,
          p_latitude: location.latitude,
          p_longitude: location.longitude,
          p_accuracy_m: location.accuracy ?? 0,
          p_detected_at: location.capturedAt,
          p_event_source: "BACKGROUND_TRACKING",
          p_geofence_type: "OFFICE",
          p_geofence_id: config.officeId,
        }).catch(() => null);
      }
    }
  }
  await writeActiveTrackingConfig(config);
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

function getLocationOptions(
  config: ActiveTrackingConfig,
): Location.LocationTaskOptions {
  const distantDestination = config.trackingMode === "DISTANT";
  const farDestination = config.trackingMode === "FAR";
  const nearDestination = config.trackingMode === "NEAR";
  const arrived = config.trackingMode === "ARRIVED";
  const attendanceOnly = config.trackingMode === "ATTENDANCE";
  return {
    accuracy: nearDestination
      ? Location.Accuracy.BestForNavigation
      : farDestination || arrived || attendanceOnly
        ? Location.Accuracy.High
        : Location.Accuracy.Balanced,
    timeInterval: arrived || attendanceOnly
      ? 900_000 // 15 mins
      : nearDestination
        ? 30_000
        : farDestination
          ? 300_000
          : distantDestination
            ? 900_000
            : 120_000,
    distanceInterval: arrived || attendanceOnly
      ? 200 // 200m radius rule
      : nearDestination
        ? 50
        : farDestination
          ? 500
          : distantDestination
            ? 1000
            : 100,
    deferredUpdatesDistance: arrived || attendanceOnly
      ? 200
      : nearDestination
        ? 50
        : farDestination
          ? 500
          : 100,
    deferredUpdatesInterval: arrived || attendanceOnly
      ? 900_000
      : nearDestination
        ? 30_000
        : farDestination
          ? 300_000
          : distantDestination
            ? 900_000
            : 120_000,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    foregroundService: {
      notificationTitle: "BOP HRMS - Location tracking active",
      notificationBody:
        "Location checked every 15 minutes or 200m movement for attendance compliance.",
      notificationColor: "#6D1B6D",
      killServiceOnDestroy: false,
    },
  };
}

export async function startNativeTracking(config: ActiveTrackingConfig) {
  if (Platform.OS === "web") return false;
  await writeActiveTrackingConfig(config);
  if (!(await TaskManager.isAvailableAsync())) return false;
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
    LIVE_LOCATION_TASK,
  ).catch(() => false);
  const registered = await TaskManager.isTaskRegisteredAsync(
    LIVE_LOCATION_TASK,
  ).catch(() => false);
  if (!alreadyStarted || !registered) {
    await Location.startLocationUpdatesAsync(
      LIVE_LOCATION_TASK,
      getLocationOptions(config),
    );
  }
  await configureDestinationGeofences(config);
  return true;
}

/**
 * Re-registering an existing Expo location task updates its native options.
 * Call this only while the app is foregrounded: Android can reject attempts
 * to start or update a foreground service from the background.
 */
export async function refreshNativeTrackingOptions(
  config: ActiveTrackingConfig,
) {
  if (Platform.OS === "web") return false;
  await writeActiveTrackingConfig(config);
  if (!(await TaskManager.isAvailableAsync())) return false;
  await Location.startLocationUpdatesAsync(
    LIVE_LOCATION_TASK,
    getLocationOptions(config),
  );
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
  if (Platform.OS !== "web") {
    const locationRunning = await Location.hasStartedLocationUpdatesAsync(
      LIVE_LOCATION_TASK,
    ).catch(() => false);
    if (locationRunning) {
      await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK).catch(
        () => undefined,
      );
    }
    const geofenceRunning = await Location.hasStartedGeofencingAsync(
      DESTINATION_GEOFENCE_TASK,
    ).catch(() => false);
    if (geofenceRunning) {
      await Location.stopGeofencingAsync(DESTINATION_GEOFENCE_TASK).catch(
        () => undefined,
      );
    }
  }
  await writeActiveTrackingConfig(null);
}
