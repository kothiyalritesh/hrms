import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import {
  startNativeTracking,
  stopNativeTracking,
} from "@/services/location/backgroundLocationTask";
import { ActiveTrackingConfig } from "@/services/location/types";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "00000000-0000-4000-8000-000000000001"),
}));

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
  isTaskRegisteredAsync: jest.fn(),
}));

jest.mock("expo-location", () => ({
  Accuracy: {
    Balanced: 3,
    High: 4,
    BestForNavigation: 6,
  },
  ActivityType: { AutomotiveNavigation: 1 },
  GeofencingEventType: { Enter: 1 },
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedGeofencingAsync: jest.fn(),
  startGeofencingAsync: jest.fn(async () => undefined),
  stopGeofencingAsync: jest.fn(async () => undefined),
  hasServicesEnabledAsync: jest.fn(async () => true),
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
}));

jest.mock("@/services/location/notification.service", () => ({
  notifyJourneyEvent: jest.fn(),
  notifyLocationProblem: jest.fn(),
}));

jest.mock("@/services/location/secureQueue", () => ({
  enqueueOfflinePing: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

const config: ActiveTrackingConfig = {
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
  trackingStartedAt: "2026-07-23T06:00:00.000Z",
  trackingMode: "ATTENDANCE",
};

describe("native task registration integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Location.hasStartedGeofencingAsync as jest.Mock).mockResolvedValue(false);
  });

  test("two start requests register exactly one native location task", async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    (TaskManager.isTaskRegisteredAsync as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await startNativeTracking(config);
    await startNativeTracking(config);

    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      "hrms-attendance-location-v2",
      expect.objectContaining({
        timeInterval: 60_000,
        distanceInterval: 0,
        deferredUpdatesDistance: 0,
        pausesUpdatesAutomatically: false,
      }),
    );
  });

  test("a running service with older options is restarted with the current ones", async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);
    (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(true);

    await startNativeTracking({ ...config, appliedOptionsKey: "1:ATTENDANCE" });

    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      "hrms-attendance-location-v2",
      expect.objectContaining({ distanceInterval: 0, timeInterval: 60_000 }),
    );
  });

  test("a visit switches the running service to 15-second fixes", async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);
    (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(true);
    (Location.startGeofencingAsync as jest.Mock | undefined)?.mockResolvedValue?.(undefined);

    await startNativeTracking({
      ...config,
      appliedOptionsKey: "2:ATTENDANCE",
      trackingMode: "DISTANT",
      destination: {
        fieldVisitId: "visit-1",
        journeyId: "visit-1",
        visitDate: "2026-10-08",
        name: "Site",
        latitude: 28.61,
        longitude: 77.21,
        arrivalRadiusM: 100,
      },
    });

    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      "hrms-attendance-location-v2",
      expect.objectContaining({ distanceInterval: 0, timeInterval: 15_000 }),
    );
  });

  test("stop removes only the location task, geofences, and active config", async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(
      true,
    );
    (Location.hasStartedGeofencingAsync as jest.Mock).mockResolvedValue(true);

    await stopNativeTracking();

    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(Location.stopGeofencingAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("@hrms_live_user");
  });
});
