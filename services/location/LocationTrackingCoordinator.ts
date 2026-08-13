import NetInfo from "@react-native-community/netinfo";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { AppState, AppStateStatus, Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import {
  configureDestinationGeofences,
  LIVE_LOCATION_TASK,
  readActiveTrackingConfig,
  refreshNativeTrackingOptions,
  startNativeTracking,
  stopNativeTracking,
  writeActiveTrackingConfig,
} from "@/services/location/backgroundLocationTask";
import { createJourneyState } from "@/services/location/geo";
import {
  handleNotificationResponse,
  initializeNotificationInfrastructure,
  isNotificationPermissionGranted,
  notifyLocationProblem,
  registerDevicePushToken,
  requestNotificationPermission,
} from "@/services/location/notification.service";
import {
  readOfflineQueue,
  removeOfflinePing,
} from "@/services/location/secureQueue";
import {
  ActiveTrackingConfig,
  Destination,
  TrackingHealth,
} from "@/services/location/types";
import { BusinessClockService } from "@/services/business-clock.service";

type CoordinatorUser = { id: string; name: string };
type HealthListener = (health: TrackingHealth) => void;

const DEFAULT_HEALTH: TrackingHealth = {
  platformSupported: Platform.OS !== "web",
  notificationsGranted: false,
  foregroundLocationGranted: false,
  preciseLocationGranted: false,
  backgroundLocationGranted: false,
  locationServicesEnabled: false,
  nativeTaskRegistered: false,
  nativeTaskActive: false,
  trackingActive: false,
  activeAttendanceId: null,
  activeDestinationName: null,
  journeyStatus: "NO_DESTINATION",
  routeDistanceM: null,
  routeDurationSeconds: null,
  routeUpdatedAt: null,
  lastLocationAt: null,
  lastAccuracyM: null,
  warning:
    Platform.OS === "web"
      ? "Reliable background tracking is unavailable in a web browser."
      : null,
};

function androidApiLevel() {
  if (Platform.OS !== "android") return 0;
  const parsed = Number(Platform.Version);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validCoordinate(value: unknown, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

class LocationTrackingCoordinator {
  private user: CoordinatorUser | null = null;
  private health: TrackingHealth = DEFAULT_HEALTH;
  private listeners = new Set<HealthListener>();
  private operation: Promise<unknown> = Promise.resolve();
  private notificationSubscription:
    | import("expo-notifications").EventSubscription
    | null = null;
  private networkUnsubscribe: (() => void) | null = null;

  subscribe(listener: HealthListener) {
    this.listeners.add(listener);
    listener(this.health);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(next: Partial<TrackingHealth>) {
    this.health = { ...this.health, ...next };
    for (const listener of this.listeners) listener(this.health);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation);
    this.operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async initialize(user: CoordinatorUser) {
    this.user = user;
    await initializeNotificationInfrastructure();
    await requestNotificationPermission();
    if (Platform.OS !== "web" && !this.notificationSubscription) {
      const Notifications = await import("expo-notifications");
      this.notificationSubscription =
        Notifications.addNotificationResponseReceivedListener((response) => {
          void this.handleNotificationResponse(response);
        });
      const lastResponse =
        await Notifications.getLastNotificationResponseAsync();
      if (lastResponse) await this.handleNotificationResponse(lastResponse);
    }
    if (!this.networkUnsubscribe) {
      this.networkUnsubscribe = NetInfo.addEventListener((state) => {
        if (state.isConnected) void this.syncOfflineLocations();
      });
    }
    await this.refreshHealth();
    if (this.health.notificationsGranted) {
      void registerDevicePushToken(user.id);
    }
  }

  dispose() {
    this.user = null;
    this.notificationSubscription?.remove();
    this.notificationSubscription = null;
    this.networkUnsubscribe?.();
    this.networkUnsubscribe = null;
    this.publish(DEFAULT_HEALTH);
  }

  requiresBackgroundPermissionEducation() {
    return Platform.OS === "android" && androidApiLevel() >= 30;
  }

  async requestRequiredPermissions(options?: {
    backgroundEducationAccepted?: boolean;
  }) {
    if (Platform.OS === "web") {
      await this.refreshHealth();
      return this.health;
    }
    await initializeNotificationInfrastructure();
    await requestNotificationPermission();
    let foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) {
      foreground = await Location.requestForegroundPermissionsAsync();
    }
    if (foreground.granted) {
      let background = await Location.getBackgroundPermissionsAsync();
      const educationRequired =
        this.requiresBackgroundPermissionEducation() && !background.granted;
      if (
        !background.granted &&
        (!educationRequired || options?.backgroundEducationAccepted)
      ) {
        background = await Location.requestBackgroundPermissionsAsync();
      }
    }
    await this.refreshHealth();
    if (this.user && this.health.notificationsGranted) {
      void registerDevicePushToken(this.user.id);
    }
    if (
      this.user &&
      this.health.foregroundLocationGranted &&
      this.health.preciseLocationGranted &&
      this.health.backgroundLocationGranted &&
      this.health.locationServicesEnabled
    ) {
      await this.restoreIfRequired();
    }
    return this.health;
  }

  async refreshHealth() {
    if (Platform.OS === "web") {
      this.publish(DEFAULT_HEALTH);
      return this.health;
    }
    const [
      notificationsGranted,
      foreground,
      background,
      servicesEnabled,
      config,
    ] = await Promise.all([
      isNotificationPermissionGranted(),
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
      Location.hasServicesEnabledAsync().catch(() => false),
      readActiveTrackingConfig(),
    ]);
    const [taskRegistered, taskActive] = await Promise.all([
      TaskManager.isTaskRegisteredAsync(LIVE_LOCATION_TASK).catch(() => false),
      Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK).catch(
        () => false,
      ),
    ]);
    const precise =
      foreground.granted &&
      (Platform.OS === "android"
        ? foreground.android?.accuracy === "fine"
        : foreground.ios?.accuracy !== "reduced");
    let warning: string | null = null;
    if (!notificationsGranted)
      warning = "Device notifications are not allowed.";
    if (!foreground.granted) warning = "Foreground location is not allowed.";
    else if (!precise) {
      warning =
        "Only approximate location is enabled. Background accuracy is approximate too.";
    } else if (!background.granted) {
      warning =
        Platform.OS === "android" && androidApiLevel() >= 30
          ? 'Select "Allow all the time" on the app location Settings page.'
          : "Background location is not allowed.";
    } else if (!servicesEnabled) warning = "Location services (GPS) are off.";
    else if (config && !taskActive) {
      warning = "The native background location service is not active.";
    }
    const trackingStartedAt = config?.trackingStartedAt
      ? Date.parse(config.trackingStartedAt)
      : Number.NaN;
    const lastReliableAt = config?.lastSuccessfulLocationAt
      ? Date.parse(config.lastSuccessfulLocationAt)
      : trackingStartedAt;
    const stale =
      !!config &&
      taskActive &&
      Number.isFinite(lastReliableAt) &&
      Date.now() - lastReliableAt >= 15 * 60 * 1000;
    if (!warning && stale) {
      warning =
        "No reliable location update has been received for at least 15 minutes.";
    }
    if (config && (stale || !notificationsGranted)) {
      const eventType = stale ? "LOCATION_STALE" : "PERMISSION_REVOKED";
      void Promise.all([
        stale ? notifyLocationProblem("location_stale") : Promise.resolve(null),
        supabase.rpc("record_tracking_health_event", {
          p_attendance_log_id: config.attendanceId,
          p_event_type: eventType,
          p_metadata: {
            source: "tracking_health_reconcile",
            notifications_granted: notificationsGranted,
            last_reliable_location_at: config.lastSuccessfulLocationAt,
            last_accuracy_m: config.lastAccuracyM,
          },
        }),
      ]);
    }
    this.publish({
      platformSupported: true,
      notificationsGranted,
      foregroundLocationGranted: foreground.granted,
      preciseLocationGranted: !!precise,
      backgroundLocationGranted: background.granted,
      locationServicesEnabled: servicesEnabled,
      nativeTaskRegistered: taskRegistered,
      nativeTaskActive: taskActive,
      trackingActive: !!config && taskActive,
      activeAttendanceId: config?.attendanceId ?? null,
      activeDestinationName: config?.destination?.name ?? null,
      journeyStatus:
        config?.journeyState?.status ??
        (config?.destination ? "TRAVELLING" : "NO_DESTINATION"),
      routeDistanceM: config?.routeProgress?.distanceM ?? null,
      routeDurationSeconds: config?.routeProgress?.durationSeconds ?? null,
      routeUpdatedAt: config?.routeProgress?.calculatedAt ?? null,
      lastLocationAt: config?.lastSuccessfulLocationAt ?? null,
      lastAccuracyM: config?.lastAccuracyM ?? null,
      warning,
    });
    return this.health;
  }

  private async findOpenAttendance() {
    if (!this.user) return { data: null, error: new Error("NO_USER") };
    const result = await supabase
      .from("attendance_logs")
      .select(
        "id,user_id,checkin_time,checkout_time,status,checkin_location,office_id,created_at",
      )
      .eq("user_id", this.user.id)
      .not("checkin_time", "is", null)
      .is("checkout_time", null)
      .order("checkin_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    return result;
  }

  private async loadActiveDestination(): Promise<Destination | null> {
    if (!this.user) return null;
    const businessDate = await BusinessClockService.getDate();
    const { data } = await supabase
      .from("field_visits")
      .select(
        "id,date,location_name,project_name,destination_coords,checkin_radius_m,status,journey_status,approach_1km_notified_at,approach_500m_notified_at,arrived_at,departed_at",
      )
      .eq("user_id", this.user.id)
      .eq("date", businessDate)
      .in("status", ["PENDING", "IN_TRANSIT", "CHECKED_IN"])
      .order("created_at", { ascending: false })
      .limit(10);
    for (const visit of data ?? []) {
      const coordinates = visit.destination_coords as Record<
        string,
        unknown
      > | null;
      const latitude = validCoordinate(
        coordinates?.latitude ?? coordinates?.lat,
        -90,
        90,
      );
      const longitude = validCoordinate(
        coordinates?.longitude ?? coordinates?.lng ?? coordinates?.lon,
        -180,
        180,
      );
      if (latitude == null || longitude == null) continue;
      return {
        fieldVisitId: visit.id,
        journeyId: visit.id,
        visitDate: visit.date,
        name: visit.project_name || visit.location_name || "destination",
        latitude,
        longitude,
        arrivalRadiusM: Math.max(
          25,
          Math.min(Number(visit.checkin_radius_m) || 100, 1_000),
        ),
      };
    }
    return null;
  }

  async startForAttendance(attendanceId: string) {
    return this.serial(async () => {
      if (!this.user || Platform.OS === "web") {
        await this.refreshHealth();
        return false;
      }
      const { data: attendance, error } = await supabase
        .from("attendance_logs")
        .select("id,user_id,checkin_location,office_id,checkout_time,status")
        .eq("id", attendanceId)
        .eq("user_id", this.user.id)
        .is("checkout_time", null)
        .maybeSingle();
      if (error || !attendance) return false;
      const existing = await readActiveTrackingConfig();
      const destination = await this.loadActiveDestination();
      await this.refreshHealth();
      if (
        !this.health.foregroundLocationGranted ||
        !this.health.preciseLocationGranted ||
        !this.health.backgroundLocationGranted ||
        !this.health.locationServicesEnabled
      ) {
        const [foreground, background] = await Promise.all([
          Location.getForegroundPermissionsAsync(),
          Location.getBackgroundPermissionsAsync(),
        ]);
        const permissionExplicitlyDenied =
          foreground.status === "denied" || background.status === "denied";
        if (
          permissionExplicitlyDenied ||
          (foreground.granted && !this.health.preciseLocationGranted) ||
          !this.health.locationServicesEnabled
        ) {
          await this.recordPermissionProblem(attendanceId);
        }
        return false;
      }

      if (
        existing?.attendanceId === attendanceId &&
        existing.destination?.journeyId === destination?.journeyId &&
        (await Location.hasStartedLocationUpdatesAsync(
          LIVE_LOCATION_TASK,
        ).catch(() => false))
      ) {
        await this.refreshHealth();
        return true;
      }

      const { data: sessionData } = await supabase.rpc(
        "ensure_tracking_session",
        {
          p_attendance_log_id: attendanceId,
          p_native_task_active: true,
        },
      );
      const session = Array.isArray(sessionData) ? sessionData[0] : sessionData;
      const checkinLocation = attendance.checkin_location as Record<
        string,
        unknown
      > | null;
      const businessClock = await BusinessClockService.get();
      const config: ActiveTrackingConfig = {
        userId: this.user.id,
        userName: this.user.name,
        attendanceId,
        trackingSessionId: session?.tracking_session_id ?? null,
        baseLatitude: validCoordinate(checkinLocation?.latitude, -90, 90),
        baseLongitude: validCoordinate(checkinLocation?.longitude, -180, 180),
        officeRadiusM: 100,
        destination,
        journeyState: destination
          ? createJourneyState(destination.journeyId)
          : null,
        routeProgress:
          destination && existing?.destination?.journeyId === destination.journeyId
            ? (existing?.routeProgress ?? null)
            : null,
        lastSuccessfulLocationAt: existing?.lastSuccessfulLocationAt ?? null,
        lastAccuracyM: existing?.lastAccuracyM ?? null,
        trackingStartedAt:
          existing?.trackingStartedAt ?? new Date().toISOString(),
        serverClockOffsetMs:
          Date.parse(businessClock.now) - Date.now(),
        trackingMode: destination ? "DISTANT" : "ATTENDANCE",
      };
      const started = await startNativeTracking(config);
      await this.refreshHealth();
      return started;
    });
  }

  async stopForAttendance(attendanceId: string, reason: string) {
    return this.serial(async () => {
      const config = await readActiveTrackingConfig();
      if (config && config.attendanceId !== attendanceId) return false;
      const { data: attendance, error } = await supabase
        .from("attendance_logs")
        .select("checkout_time")
        .eq("id", attendanceId)
        .maybeSingle();
      if (error || !attendance?.checkout_time) {
        // A failed or uncommitted checkout must never stop tracking.
        return false;
      }
      await supabase.rpc("stop_tracking_session", {
        p_attendance_log_id: attendanceId,
        p_stop_reason: reason,
      });
      await stopNativeTracking();
      await this.refreshHealth();
      return true;
    });
  }

  async restoreIfRequired() {
    if (!this.user) return false;
    const { data: attendance, error } = await this.findOpenAttendance();
    if (error) return false;
    const existing = await readActiveTrackingConfig();
    if (!attendance) {
      if (existing) {
        await supabase.rpc("stop_tracking_session", {
          p_attendance_log_id: existing.attendanceId,
          p_stop_reason: "AUTHORITATIVE_ATTENDANCE_CLOSED",
        });
        await stopNativeTracking();
      }
      await this.refreshHealth();
      return false;
    }
    if (existing?.attendanceId && existing.attendanceId !== attendance.id) {
      await stopNativeTracking();
    }
    return this.startForAttendance(attendance.id);
  }

  async updateActiveDestination(fieldVisitId: string) {
    const result = await this.serial(async () => {
      const config = await readActiveTrackingConfig();
      if (!this.user) return false;
      const destination = await this.loadActiveDestination();
      if (!destination || destination.fieldVisitId !== fieldVisitId) {
        return false;
      }
      if (!config) return "START_REQUIRED" as const;
      if (config.destination?.journeyId !== destination.journeyId) {
        config.destination = destination;
        config.journeyState = createJourneyState(destination.journeyId);
        config.routeProgress = null;
        config.trackingMode = "DISTANT";
        await writeActiveTrackingConfig(config);
        await configureDestinationGeofences(config);
      }
      if (AppState.currentState === "active") {
        await refreshNativeTrackingOptions(config);
      }
      await this.refreshHealth();
      return true;
    });
    if (result !== "START_REQUIRED") return result;
    const { data: attendance, error } = await this.findOpenAttendance();
    if (error || !attendance) return false;
    return this.startForAttendance(attendance.id);
  }

  async clearActiveDestination() {
    return this.serial(async () => {
      const config = await readActiveTrackingConfig();
      if (!config) return;
      const nextDestination = await this.loadActiveDestination();
      if (nextDestination) {
        config.destination = nextDestination;
        config.journeyState = createJourneyState(nextDestination.journeyId);
        config.routeProgress = null;
        config.trackingMode = "DISTANT";
        await writeActiveTrackingConfig(config);
        await configureDestinationGeofences(config);
        if (AppState.currentState === "active") {
          await refreshNativeTrackingOptions(config);
        }
      } else {
        // A field visit is destination context, not the owner of the tracking
        // lifecycle. Keep the foreground service and server session alive
        // until the authoritative attendance checkout is committed.
        config.destination = null;
        config.journeyState = null;
        config.routeProgress = null;
        config.trackingMode = "ATTENDANCE";
        await writeActiveTrackingConfig(config);
        await configureDestinationGeofences(config);
        if (AppState.currentState === "active") {
          await refreshNativeTrackingOptions(config);
        }
      }
      await this.refreshHealth();
    });
  }

  async syncOfflineLocations() {
    const queue = await readOfflineQueue();
    for (const item of queue) {
      const { data, error } = await supabase.rpc("record_location_ping", {
        p_attendance_log_id: item.config.attendanceId,
        p_tracking_session_id: item.config.trackingSessionId,
        p_field_visit_id: item.config.fieldVisitId,
        p_client_event_id: item.location.clientEventId,
        p_latitude: item.location.latitude,
        p_longitude: item.location.longitude,
        p_accuracy_m: item.location.accuracy,
        p_altitude_m: item.location.altitude,
        p_heading: item.location.heading,
        p_speed_mps: item.location.speed,
        p_mocked: item.location.mocked,
        p_recorded_at: item.location.capturedAt,
        p_provider: "expo-location-offline",
        p_client_quality_status: item.qualityStatus,
      });
      if (error) {
        const permanentFailure = [
          "INVALID_TIMESTAMP_SKEW",
          "CLIENT_EVENT_ID_REQUIRED",
          "INVALID_COORDINATES",
          "TRACKING_SESSION_MISMATCH",
        ].some((code) => error.message?.includes(code));
        if (permanentFailure) {
          await removeOfflinePing(item.location.clientEventId);
          continue;
        }
        break;
      }
      await removeOfflinePing(item.location.clientEventId);
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.tracking_session_status === "STOPPED") {
        await stopNativeTracking();
        break;
      }
    }
    await this.refreshHealth();
  }

  async handleAppStateChange(state: AppStateStatus) {
    if (state !== "active") return;
    await this.restoreIfRequired();
    await this.syncOfflineLocations();
    const config = await readActiveTrackingConfig();
    if (!config) return;
    const currentDestination = await this.loadActiveDestination();
    if (!currentDestination) await this.clearActiveDestination();
    else await this.updateActiveDestination(currentDestination.fieldVisitId);
  }

  async handleNotificationResponse(
    response: import("expo-notifications").NotificationResponse,
  ) {
    await handleNotificationResponse(response);
  }

  getTrackingHealth() {
    return this.health;
  }

  private async recordPermissionProblem(attendanceId: string) {
    const type = !this.health.backgroundLocationGranted
      ? "background_permission_revoked"
      : !this.health.preciseLocationGranted
        ? "precise_location_disabled"
        : "gps_off";
    await notifyLocationProblem(type);
    await supabase.rpc("record_tracking_health_event", {
      p_attendance_log_id: attendanceId,
      p_event_type: type === "gps_off" ? "GPS_OFF" : "PERMISSION_REVOKED",
      p_metadata: {
        background_location: this.health.backgroundLocationGranted,
        precise_location: this.health.preciseLocationGranted,
        gps: this.health.locationServicesEnabled,
      },
    });
  }
}

export const locationTrackingCoordinator = new LocationTrackingCoordinator();
