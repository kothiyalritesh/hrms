import * as Notifications from 'expo-notifications';
import NetInfo from "@react-native-community/netinfo";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { AppState, AppStateStatus, Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import {
  configureDestinationGeofences,
  LIVE_LOCATION_TASK,
  mergeWriteActiveTrackingConfig,
  readActiveTrackingConfig,
  refreshNativeTrackingOptions,
  startNativeTracking,
  stopNativeTracking,
  isNativeTrackingOrphaned,
  TRACKING_OPTIONS_VERSION,
  trackingOptionsKey,
} from "@/services/location/backgroundLocationTask";
import { reportDeviceHealth } from "@/services/location/deviceHealth";
import { drainOfflineQueue, trackingOwnerKey } from "@/services/location/offlineSync";
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
  ActiveTrackingConfig,
  Destination,
  TrackingHealth,
  TrackingWarningCode,
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
  warningCode: null,
  notificationHint: null,
  trackingExpected: false,
};

/** No fix of any accuracy for this long while the service runs = stale. */
export const TRACKING_STALE_AFTER_MS = 15 * 60 * 1000;

export const NOTIFICATIONS_OFF_HINT =
  "Notifications are off – you may miss attendance alerts.";

function latestTimestampMs(...values: (string | null | undefined)[]) {
  let latest = Number.NaN;
  for (const value of values) {
    const parsed = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(parsed) && !(parsed <= latest)) latest = parsed;
  }
  return latest;
}

function latestIso(...values: (string | null | undefined)[]) {
  const latest = latestTimestampMs(...values);
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

/**
 * Pure tracking-health decision (exported for tests). Notification permission
 * is never a tracking warning; it only produces `notificationHint`.
 */
export function evaluateTrackingHealth(input: {
  notificationsGranted: boolean;
  foregroundGranted: boolean;
  precise: boolean;
  backgroundGranted: boolean;
  servicesEnabled: boolean;
  taskActive: boolean;
  config: ActiveTrackingConfig | null;
  openAttendanceKnown: boolean;
  backgroundSettingsHint: boolean;
  nowMs?: number;
}): {
  warning: string | null;
  warningCode: TrackingWarningCode | null;
  notificationHint: string | null;
  trackingExpected: boolean;
  stale: boolean;
  lastActivityMs: number;
} {
  const { config } = input;
  const nowMs = input.nowMs ?? Date.now();
  const trackingExpected =
    (!!config && (!!config.attendanceId || !!config.destination)) ||
    input.openAttendanceKnown;
  const lastActivityMs = latestTimestampMs(
    config?.lastSuccessfulLocationAt,
    config?.lastFixAt,
    config?.lastSentAt,
    config?.trackingStartedAt,
  );
  const stale =
    !!config &&
    input.taskActive &&
    Number.isFinite(lastActivityMs) &&
    nowMs - lastActivityMs >= TRACKING_STALE_AFTER_MS;

  let warning: string | null = null;
  let warningCode: TrackingWarningCode | null = null;
  if (!input.foregroundGranted) {
    warningCode = "LOCATION_DENIED";
    warning = "Location permission is not allowed.";
  } else if (!input.precise) {
    warningCode = "APPROXIMATE";
    warning =
      "Only approximate location is enabled. Turn on precise location.";
  } else if (!input.backgroundGranted) {
    warningCode = "BACKGROUND_DENIED";
    warning = input.backgroundSettingsHint
      ? 'Select "Allow all the time" on the app location Settings page.'
      : "Background location is not allowed.";
  } else if (!input.servicesEnabled) {
    warningCode = "GPS_OFF";
    warning = "Location services (GPS) are off.";
  } else if (trackingExpected && !input.taskActive) {
    warningCode = "TASK_NOT_RUNNING";
    warning = "Location sharing is not running. Tap to restart it.";
  } else if (trackingExpected && input.taskActive && stale) {
    warningCode = "STALE";
    warning = "No location update has been received for at least 15 minutes.";
  }
  return {
    warning,
    warningCode,
    notificationHint: input.notificationsGranted ? null : NOTIFICATIONS_OFF_HINT,
    trackingExpected,
    stale,
    lastActivityMs,
  };
}

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

const OPEN_ATTENDANCE_MAX_AGE_MS = 16 * 60 * 60_000;

class LocationTrackingCoordinator {
  private user: CoordinatorUser | null = null;
  private health: TrackingHealth = DEFAULT_HEALTH;
  private listeners = new Set<HealthListener>();
  private operation: Promise<unknown> = Promise.resolve();
  private notificationSubscription:
    | any
    | null = null;
  private networkUnsubscribe: (() => void) | null = null;
  /** The page asks for health every ~2 min; report a stale location at most every 30 min. */
  private lastStaleReportAt = 0;
  /** Open attendance id from the last successful server lookup (null = none). */
  private knownOpenAttendanceId: string | null = null;

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

  async initialize(
    user: CoordinatorUser,
    options?: { handleNotificationResponses?: boolean },
  ) {
    this.user = user;
    await initializeNotificationInfrastructure();
    await requestNotificationPermission();
    // The Android web shell forwards notification taps to the page itself;
    // handling them here too opened every tapped notification twice.
    if (
      Platform.OS !== "web" &&
      options?.handleNotificationResponses !== false &&
      !this.notificationSubscription
    ) {
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
      void registerDevicePushToken(user.id).catch(() => {});
    }
  }

  dispose() {
    this.user = null;
    this.knownOpenAttendanceId = null;
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
      void registerDevicePushToken(this.user.id).catch(() => {});
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
      isNotificationPermissionGranted().catch(() => false),
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
    const evaluation = evaluateTrackingHealth({
      notificationsGranted,
      foregroundGranted: foreground.granted,
      precise: !!precise,
      backgroundGranted: background.granted,
      servicesEnabled,
      taskActive,
      config,
      openAttendanceKnown: !!this.knownOpenAttendanceId,
      backgroundSettingsHint:
        Platform.OS === "android" && androidApiLevel() >= 30,
    });
    const { warning, warningCode, notificationHint, trackingExpected } =
      evaluation;
    // Only a real STALE (service running, no fix of any accuracy for 15 min)
    // is reported; never a permission or notification state.
    if (
      warningCode === "STALE" &&
      config?.attendanceId &&
      Date.now() - this.lastStaleReportAt >= 30 * 60 * 1000
    ) {
      this.lastStaleReportAt = Date.now();
      void Promise.all([
        notifyLocationProblem("location_stale"),
        supabase.rpc("record_tracking_health_event", {
          p_attendance_log_id: config.attendanceId,
          p_event_type: "LOCATION_STALE",
          p_metadata: {
            source: "tracking_health_reconcile",
            notifications_granted: notificationsGranted,
            last_reliable_location_at: config.lastSuccessfulLocationAt,
            last_fix_at: config.lastFixAt ?? null,
            last_accuracy_m: config.lastAccuracyM,
          },
        }),
      ]).catch(() => undefined);
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
      lastLocationAt: latestIso(
        config?.lastSuccessfulLocationAt,
        config?.lastFixAt,
      ),
      lastAccuracyM: config?.lastAccuracyM ?? null,
      warning,
      warningCode,
      notificationHint,
      trackingExpected,
    });
    if (config) {
      void reportDeviceHealth({
        taskName: LIVE_LOCATION_TASK,
        trackingOptionsVersion: TRACKING_OPTIONS_VERSION,
        source: "app",
      });
    }
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
      // A session never closed on an earlier day is not "open" (same bound as the server).
      .gte("checkin_time", new Date(Date.now() - OPEN_ATTENDANCE_MAX_AGE_MS).toISOString())
      .order("checkin_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    return result;
  }

  /** Today's attendance is already checked out: the working day is over. */
  private async dayClosedToday() {
    if (!this.user) return false;
    const businessDate = await BusinessClockService.getDate();
    const { data, error } = await supabase
      .from("attendance_logs")
      .select("id")
      .eq("user_id", this.user.id)
      .eq("date", businessDate)
      .not("checkout_time", "is", null)
      .limit(1);
    return !error && (data?.length ?? 0) > 0;
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
      if (!error) {
        if (attendance) this.knownOpenAttendanceId = attendance.id;
        else if (this.knownOpenAttendanceId === attendanceId) {
          this.knownOpenAttendanceId = null;
        }
      }
      if (error || !attendance) {
        await this.refreshHealth();
        return false;
      }
      const existing = await readActiveTrackingConfig();
      const destination = await this.loadActiveDestination();
      if (!(await this.locationPermissionsReady(attendanceId))) return false;

      if (
        existing?.attendanceId === attendanceId &&
        existing.destination?.journeyId === destination?.journeyId &&
        existing.appliedOptionsKey === trackingOptionsKey(existing) &&
        (await Location.hasStartedLocationUpdatesAsync(
          LIVE_LOCATION_TASK,
        ).catch(() => false))
      ) {
        await this.refreshHealth();
        return true;
      }

      const { data: sessionData, error: sessionError } = await supabase.rpc(
        "ensure_tracking_session",
        {
          p_attendance_log_id: attendanceId,
          p_native_task_active: true,
        },
      );
      if (sessionError && /NO_OPEN_ATTENDANCE|ATTENDANCE_CLOSED/i.test(sessionError.message ?? "")) {
        if (this.knownOpenAttendanceId === attendanceId) {
          this.knownOpenAttendanceId = null;
        }
        await this.refreshHealth();
        return false;
      }
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
        appliedOptionsKey: existing?.appliedOptionsKey,
      };
      // startNativeTracking merge-writes the config (keeping any fix the
      // background task recorded meanwhile) and can throw after writing it:
      // health is re-checked either way.
      try {
        return await startNativeTracking(config);
      } finally {
        await this.refreshHealth();
      }
    });
  }

  /** Precise + background location and GPS on; records the problem otherwise. */
  private async locationPermissionsReady(attendanceId: string | null) {
    await this.refreshHealth();
    if (
      this.health.foregroundLocationGranted &&
      this.health.preciseLocationGranted &&
      this.health.backgroundLocationGranted &&
      this.health.locationServicesEnabled
    ) {
      return true;
    }
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

  /**
   * Direct field visit: the employee travels to the site before any office or
   * site check-in. Track the journey on a visit-only session; the first check-in
   * (site arrival creates the attendance) moves tracking to that attendance.
   */
  private async startForVisitTravel(destination: Destination) {
    return this.serial(async () => {
      if (!this.user || Platform.OS === "web") {
        await this.refreshHealth();
        return false;
      }
      // Re-check inside the queue: a restore read before a checkout must not
      // start trip tracking after it.
      if (await this.dayClosedToday()) {
        await this.refreshHealth();
        return false;
      }
      const existing = await readActiveTrackingConfig();
      if (!(await this.locationPermissionsReady(null))) return false;
      if (
        existing &&
        existing.attendanceId == null &&
        existing.destination?.journeyId === destination.journeyId &&
        existing.appliedOptionsKey === trackingOptionsKey(existing) &&
        (await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK).catch(() => false))
      ) {
        await this.refreshHealth();
        return true;
      }
      const sameJourney = existing?.destination?.journeyId === destination.journeyId;
      const businessClock = await BusinessClockService.get();
      const config: ActiveTrackingConfig = {
        userId: this.user.id,
        userName: this.user.name,
        attendanceId: null,
        trackingSessionId: null,
        baseLatitude: null,
        baseLongitude: null,
        officeRadiusM: 100,
        destination,
        journeyState: sameJourney && existing?.journeyState
          ? existing.journeyState
          : createJourneyState(destination.journeyId),
        routeProgress: sameJourney ? (existing?.routeProgress ?? null) : null,
        lastSuccessfulLocationAt: existing?.lastSuccessfulLocationAt ?? null,
        lastAccuracyM: existing?.lastAccuracyM ?? null,
        trackingStartedAt: existing?.trackingStartedAt ?? new Date().toISOString(),
        serverClockOffsetMs: Date.parse(businessClock.now) - Date.now(),
        trackingMode: sameJourney && existing ? existing.trackingMode : "DISTANT",
        appliedOptionsKey: existing?.appliedOptionsKey,
      };
      try {
        return await startNativeTracking(config);
      } finally {
        await this.refreshHealth();
      }
    });
  }

  async stopForAttendance(attendanceId: string, reason: string) {
    return this.serial(async () => {
      const config = await readActiveTrackingConfig();
      // A different, still-owned attendance keeps its tracking; a visit-only
      // trip config (attendanceId null) is stopped by this checkout too.
      if (config?.attendanceId && config.attendanceId !== attendanceId) return false;
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
      if (this.knownOpenAttendanceId === attendanceId) {
        this.knownOpenAttendanceId = null;
      }
      await stopNativeTracking();
      await this.refreshHealth();
      return true;
    });
  }

  async restoreIfRequired() {
    if (!this.user) return false;
    const { data: attendance, error } = await this.findOpenAttendance();
    if (error) {
      // Offline / server error: keep the last known attendance state.
      await this.refreshHealth();
      return false;
    }
    this.knownOpenAttendanceId = attendance?.id ?? null;
    const existing = await readActiveTrackingConfig();
    if (!attendance) {
      // Not checked in, but on the way to today's field visit: track the trip
      // (never after today's checkout: the working day is over).
      const destination = await this.loadActiveDestination();
      if (destination && !(await this.dayClosedToday())) {
        return this.startForVisitTravel(destination);
      }
      if (await isNativeTrackingOrphaned()) await stopNativeTracking();
      if (existing) {
        if (existing.attendanceId) {
          await supabase.rpc("stop_tracking_session", {
            p_attendance_log_id: existing.attendanceId,
            p_stop_reason: "AUTHORITATIVE_ATTENDANCE_CLOSED",
          });
        }
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
      if (!config) {
        await this.refreshHealth();
        return "START_REQUIRED" as const;
      }
      try {
        if (config.destination?.journeyId !== destination.journeyId) {
          config.destination = destination;
          config.journeyState = createJourneyState(destination.journeyId);
          config.routeProgress = null;
          config.trackingMode = "DISTANT";
          if (!(await this.saveDestinationContext(config))) return false;
          await configureDestinationGeofences(config);
        }
        if (AppState.currentState === "active") {
          // No-op when the running service already has these options.
          await refreshNativeTrackingOptions(config);
        }
        return true;
      } finally {
        await this.refreshHealth();
      }
    });
    if (result !== "START_REQUIRED") return result;
    const { data: attendance, error } = await this.findOpenAttendance();
    if (error) return false;
    if (!attendance) return this.restoreIfRequired();
    return this.startForAttendance(attendance.id);
  }

  /**
   * Saves only the destination context onto the NEWEST config (a fix written
   * by the background task meanwhile is kept). False when the session was
   * stopped or replaced meanwhile.
   */
  private async saveDestinationContext(config: ActiveTrackingConfig) {
    const saved = await mergeWriteActiveTrackingConfig((latest) =>
      latest && latest.attendanceId === config.attendanceId
        ? {
            destination: config.destination,
            journeyState: config.journeyState,
            routeProgress: config.routeProgress,
            trackingMode: config.trackingMode,
          }
        : null,
    );
    if (saved) Object.assign(config, saved);
    return !!saved;
  }

  async clearActiveDestination() {
    const result = await this.serial(async () => {
      const config = await readActiveTrackingConfig();
      if (!config) {
        await this.refreshHealth();
        return;
      }
      try {
        const nextDestination = await this.loadActiveDestination();
        if (nextDestination) {
          if (config.destination?.journeyId !== nextDestination.journeyId) {
            config.destination = nextDestination;
            config.journeyState = createJourneyState(nextDestination.journeyId);
            config.routeProgress = null;
            config.trackingMode = "DISTANT";
            if (!(await this.saveDestinationContext(config))) return;
            await configureDestinationGeofences(config);
          }
          if (AppState.currentState === "active") {
            await refreshNativeTrackingOptions(config);
          }
        } else if (!config.attendanceId) {
          // Visit-only trip ended without any check-in: the restore below
          // decides (normally: nothing left to track).
          return "VISIT_TRIP_ENDED" as const;
        } else {
          // A field visit is destination context, not the owner of the tracking
          // lifecycle. Keep the foreground service and server session alive
          // until the authoritative attendance checkout is committed.
          if (config.destination || config.trackingMode !== "ATTENDANCE") {
            config.destination = null;
            config.journeyState = null;
            config.routeProgress = null;
            config.trackingMode = "ATTENDANCE";
            if (!(await this.saveDestinationContext(config))) return;
            await configureDestinationGeofences(config);
          }
          if (AppState.currentState === "active") {
            // No-op when the running service already has these options.
            await refreshNativeTrackingOptions(config);
          }
        }
      } finally {
        await this.refreshHealth();
      }
    });
    if (result === "VISIT_TRIP_ENDED") await this.restoreIfRequired();
  }

  async syncOfflineLocations() {
    const closedAttendanceIds = await drainOfflineQueue();
    // Only the CURRENT attendance being closed stops tracking; an old queued
    // point of yesterday's attendance must not stop today's tracking.
    const config = await readActiveTrackingConfig();
    if (
      config &&
      closedAttendanceIds.includes(
        trackingOwnerKey(config.attendanceId, config.destination?.fieldVisitId ?? null),
      )
    ) {
      await stopNativeTracking();
    }
    await this.refreshHealth();
  }

  async handleAppStateChange(state: AppStateStatus) {
    if (state !== "active") return;
    try {
      await this.restoreIfRequired();
      await this.syncOfflineLocations();
      const config = await readActiveTrackingConfig();
      if (!config) return;
      const currentDestination = await this.loadActiveDestination();
      if (!currentDestination) await this.clearActiveDestination();
      else await this.updateActiveDestination(currentDestination.fieldVisitId);
    } finally {
      await this.refreshHealth().catch(() => undefined);
    }
  }

  /**
   * User-initiated re-check (pull-to-refresh, screen focus): restart tracking
   * if it should run, then publish fresh health. Never throws.
   */
  async recheck() {
    try {
      await this.restoreIfRequired();
    } catch (error) {
      console.warn("[tracking] restore failed during re-check", error);
    }
    try {
      return await this.refreshHealth();
    } catch {
      return this.health;
    }
  }

  async handleNotificationResponse(
    response: any,
  ) {
    await handleNotificationResponse(response);
  }

  getTrackingHealth() {
    return this.health;
  }

  private async recordPermissionProblem(attendanceId: string | null) {
    const type = !this.health.backgroundLocationGranted
      ? "background_permission_revoked"
      : !this.health.preciseLocationGranted
        ? "precise_location_disabled"
        : "gps_off";
    await notifyLocationProblem(type);
    if (!attendanceId) return;
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


