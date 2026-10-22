import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import {
  mergeWriteActiveTrackingConfig,
  refreshNativeTrackingOptions,
} from "@/services/location/backgroundLocationTask";
import {
  evaluateTrackingHealth,
  NOTIFICATIONS_OFF_HINT,
} from "@/services/location/LocationTrackingCoordinator";
import { ActiveTrackingConfig } from "@/services/location/types";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "uuid-1") }));
jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "AFTER_FIRST_UNLOCK",
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock("expo-task-manager", () => ({
  isTaskDefined: jest.fn(() => true),
  defineTask: jest.fn(),
  isAvailableAsync: jest.fn(async () => true),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));
jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4 },
  ActivityType: { Other: 0 },
  GeofencingEventType: { Enter: 1 },
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedGeofencingAsync: jest.fn(async () => false),
  startGeofencingAsync: jest.fn(async () => undefined),
  stopGeofencingAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-notifications", () => ({}));
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => undefined) },
}));
jest.mock("@/services/location/notification.service", () => ({
  notifyJourneyEvent: jest.fn(),
  notifyLocationProblem: jest.fn(),
  handleNotificationResponse: jest.fn(),
  initializeNotificationInfrastructure: jest.fn(),
  isNotificationPermissionGranted: jest.fn(),
  registerDevicePushToken: jest.fn(),
  requestNotificationPermission: jest.fn(),
}));
jest.mock("@/services/location/secureQueue", () => ({ enqueueOfflinePing: jest.fn() }));
jest.mock("@/services/location/offlineSync", () => ({
  drainOfflineQueue: jest.fn(async () => []),
  trackingOwnerKey: jest.fn(),
}));
jest.mock("@/services/location/deviceHealth", () => ({ reportDeviceHealth: jest.fn() }));
jest.mock("@/services/location/route.service", () => ({ refreshRouteProgress: jest.fn() }));
jest.mock("@/services/business-clock.service", () => ({ BusinessClockService: {} }));
jest.mock("@/lib/supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

const NOW = Date.parse("2026-10-15T10:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

const baseConfig: ActiveTrackingConfig = {
  userId: "user-1",
  userName: "Employee",
  attendanceId: "attendance-1",
  trackingSessionId: "session-1",
  baseLatitude: 28.6,
  baseLongitude: 77.2,
  officeRadiusM: 100,
  destination: null,
  journeyState: null,
  routeProgress: null,
  lastSuccessfulLocationAt: null,
  lastAccuracyM: null,
  trackingStartedAt: minutesAgo(240),
  trackingMode: "ATTENDANCE",
  appliedOptionsKey: "2:ATTENDANCE",
};

const healthy = {
  notificationsGranted: true,
  foregroundGranted: true,
  precise: true,
  backgroundGranted: true,
  servicesEnabled: true,
  taskActive: true,
  openAttendanceKnown: true,
  backgroundSettingsHint: true,
  nowMs: NOW,
};

describe("evaluateTrackingHealth", () => {
  test("notifications off is a hint, never a tracking warning", () => {
    const result = evaluateTrackingHealth({
      ...healthy,
      notificationsGranted: false,
      config: { ...baseConfig, lastSuccessfulLocationAt: minutesAgo(1) },
    });
    expect(result.warning).toBeNull();
    expect(result.warningCode).toBeNull();
    expect(result.notificationHint).toBe(NOTIFICATIONS_OFF_HINT);
  });

  test("indoor low-accuracy fixes keep tracking healthy", () => {
    const result = evaluateTrackingHealth({
      ...healthy,
      config: {
        ...baseConfig,
        lastSuccessfulLocationAt: minutesAgo(120),
        lastFixAt: minutesAgo(2),
      },
    });
    expect(result.warningCode).toBeNull();
  });

  test("no fix of any accuracy for 15 minutes is STALE", () => {
    const result = evaluateTrackingHealth({
      ...healthy,
      config: {
        ...baseConfig,
        lastSuccessfulLocationAt: minutesAgo(40),
        lastFixAt: minutesAgo(20),
      },
    });
    expect(result.warningCode).toBe("STALE");
  });

  test("a just-started service is not stale", () => {
    const result = evaluateTrackingHealth({
      ...healthy,
      config: { ...baseConfig, trackingStartedAt: minutesAgo(3) },
    });
    expect(result.warningCode).toBeNull();
  });

  test("not checked in and nothing running: no warning", () => {
    const result = evaluateTrackingHealth({
      ...healthy,
      taskActive: false,
      openAttendanceKnown: false,
      config: null,
    });
    expect(result.trackingExpected).toBe(false);
    expect(result.warning).toBeNull();
  });

  test("checked in but the service is not running", () => {
    const result = evaluateTrackingHealth({
      ...healthy,
      taskActive: false,
      config: null,
    });
    expect(result.trackingExpected).toBe(true);
    expect(result.warningCode).toBe("TASK_NOT_RUNNING");
  });

  test("permission problems take precedence in order", () => {
    expect(
      evaluateTrackingHealth({
        ...healthy,
        foregroundGranted: false,
        precise: false,
        servicesEnabled: false,
        config: baseConfig,
      }).warningCode,
    ).toBe("LOCATION_DENIED");
    expect(
      evaluateTrackingHealth({ ...healthy, precise: false, config: baseConfig })
        .warningCode,
    ).toBe("APPROXIMATE");
    expect(
      evaluateTrackingHealth({
        ...healthy,
        backgroundGranted: false,
        config: baseConfig,
      }).warningCode,
    ).toBe("BACKGROUND_DENIED");
    expect(
      evaluateTrackingHealth({
        ...healthy,
        servicesEnabled: false,
        config: baseConfig,
      }).warningCode,
    ).toBe("GPS_OFF");
  });
});

describe("mergeWriteActiveTrackingConfig", () => {
  let stored: string | null = null;
  beforeEach(() => {
    jest.clearAllMocks();
    stored = null;
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async () => stored);
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(
      async (_key: string, value: string) => {
        stored = value;
      },
    );
    (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async () => {
      stored = null;
    });
  });

  test("an older copy never rolls back newer fix timestamps", async () => {
    stored = JSON.stringify({
      ...baseConfig,
      lastSuccessfulLocationAt: minutesAgo(1),
      lastAccuracyM: 12,
      lastFixAt: minutesAgo(1),
      lastSentAt: minutesAgo(1),
      lastSentLatitude: 28.61,
      lastSentLongitude: 77.21,
    });
    const written = await mergeWriteActiveTrackingConfig({
      ...baseConfig,
      lastSuccessfulLocationAt: minutesAgo(30),
      lastAccuracyM: 80,
      trackingMode: "ATTENDANCE",
    });
    expect(written?.lastSuccessfulLocationAt).toBe(minutesAgo(1));
    expect(written?.lastAccuracyM).toBe(12);
    expect(written?.lastFixAt).toBe(minutesAgo(1));
    expect(written?.lastSentLatitude).toBe(28.61);
    expect(JSON.parse(stored!).lastSuccessfulLocationAt).toBe(minutesAgo(1));
  });

  test("a partial patch does not revive a stopped session", async () => {
    const written = await mergeWriteActiveTrackingConfig({
      trackingMode: "ATTENDANCE",
    });
    expect(written).toBeNull();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  test("a complete config is written when none is saved", async () => {
    const written = await mergeWriteActiveTrackingConfig(baseConfig);
    expect(written?.attendanceId).toBe("attendance-1");
    expect(stored).not.toBeNull();
  });

  test("foreground refresh skips restarting a service with current options", async () => {
    stored = JSON.stringify(baseConfig);
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);
    await refreshNativeTrackingOptions({ ...baseConfig });
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  test("foreground refresh restarts a stopped service", async () => {
    stored = JSON.stringify(baseConfig);
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(false);
    await refreshNativeTrackingOptions({ ...baseConfig });
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });
});
