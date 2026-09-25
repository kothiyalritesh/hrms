jest.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: jest.fn().mockResolvedValue({ data: { success: true }, error: null }),
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
    channel: jest.fn().mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    }),
    removeChannel: jest.fn().mockResolvedValue(undefined),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "test-user-id" } } }),
    },
  },
  supabaseAuthStorageKey: "test-storage-key",
}));
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
// @ts-nocheck -- unit and integration contracts for Site Visit Tracking v2 architecture
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("12345678-1234-1234-1234-123456789abc"),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  AFTER_FIRST_UNLOCK: 1,
}));
jest.mock("expo-task-manager", () => ({
  isTaskDefined: jest.fn().mockReturnValue(true),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));
jest.mock("expo-location", () => ({
  Accuracy: { High: 4, BestForNavigation: 5 },
  ActivityType: { AutomotiveNavigation: 2, Fitness: 1 },
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
}));

import fs from "fs";
import path from "path";
import {
  haversineDistanceM,
  classifyGpsAccuracy,
  cleanRouteBreadcrumbs,
} from "../utils/routeCleanup";
import { computeRouteQuality } from "../utils/gpsQuality";
import { computeTrackingHealth } from "../components/observer/ObserverDetailDrawer";
import {
  getSiteVisitTaskOptions,
  toSiteVisitPing,
  getCurrentTrackingState,
  setTrackingState,
} from "../services/location/siteVisitLocationTask";

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("Site Visit Tracking v2 Architecture (12-Point Enterprise Engine)", () => {
  const migration = read(
    "supabase/migrations/20260910000000_site_visit_tracking_telemetry_source.sql",
  );
  const locationTaskSrc = read("services/location/siteVisitLocationTask.ts");
  const coordinatorSrc = read("services/location/SiteVisitTrackingCoordinator.ts");
  const observerScreenSrc = read("screens/admin/SiteVisitObserverScreen.tsx");
  const drawerSrc = read("components/observer/ObserverDetailDrawer.tsx");
  const typesSrc = read("types/location-database.ts");

  describe("Point 1 & 6: Telemetry metadata & Tiered GPS Configuration", () => {
    it("configures tiered accuracy & intervals for AT_SITE vs IN_TRANSIT", () => {
      const transitOptions = getSiteVisitTaskOptions("IN_TRANSIT", "Site A");
      expect(transitOptions.distanceInterval).toBe(10);
      expect(transitOptions.timeInterval).toBe(10000);

      const siteOptions = getSiteVisitTaskOptions("AT_SITE", "Site A");
      expect(siteOptions.distanceInterval).toBe(5);
      expect(siteOptions.timeInterval).toBe(10000);
    });

    it("creates pings with UUID client_event_id, coordinates, and telemetry source tag", () => {
      const loc = {
        coords: {
          latitude: 28.5355,
          longitude: 77.391,
          accuracy: 8.5,
          altitude: 205,
          heading: 180,
          speed: 1.2,
        },
        timestamp: 1725960000000,
        mocked: false,
      };

      const pingForeground = toSiteVisitPing(loc as any, "foreground");
      expect(pingForeground.client_event_id).toBeDefined();
      expect(pingForeground.source).toBe("foreground");
      expect(pingForeground.accuracy).toBe(8.5);
      expect(pingForeground.speed).toBe(1.2);

      const pingBackground = toSiteVisitPing(loc as any, "background");
      expect(pingBackground.source).toBe("background");

      const pingWeb = toSiteVisitPing(loc as any, "web");
      expect(pingWeb.source).toBe("web");
    });
  });

  describe("Point 2: Location Quality Filter & GPS Classification", () => {
    it("correctly classifies GPS accuracy tiers", () => {
      expect(classifyGpsAccuracy(10)).toBe("HIGH");
      expect(classifyGpsAccuracy(20)).toBe("HIGH");
      expect(classifyGpsAccuracy(35)).toBe("ACCEPTABLE");
      expect(classifyGpsAccuracy(50)).toBe("ACCEPTABLE");
      expect(classifyGpsAccuracy(75)).toBe("LOW");
      expect(classifyGpsAccuracy(100)).toBe("LOW");
      expect(classifyGpsAccuracy(101)).toBe("REJECT");
      expect(classifyGpsAccuracy(250)).toBe("REJECT");
    });

    it("filters mocked points, out of bounds, and bad accuracy (>100m) from route", () => {
      const rawBreadcrumbs = [
        {
          latitude: 28.5355,
          longitude: 77.391,
          accuracy_m: 10,
          recorded_at: "2026-09-10T10:00:00Z",
          speed_mps: 1,
          heading: 0,
          quality_status: "RELIABLE",
        },
        {
          latitude: 28.5356,
          longitude: 77.3911,
          accuracy_m: 150, // Bad accuracy (>100m)
          recorded_at: "2026-09-10T10:00:10Z",
          speed_mps: 1,
          heading: 0,
          quality_status: "LOW_ACCURACY",
        },
        {
          latitude: 28.5357,
          longitude: 77.3912,
          accuracy_m: 15,
          recorded_at: "2026-09-10T10:00:20Z",
          speed_mps: 1,
          heading: 0,
          quality_status: "MOCKED", // Mocked
        },
        {
          latitude: 0,
          longitude: 0, // Invalid coordinate
          accuracy_m: 10,
          recorded_at: "2026-09-10T10:00:30Z",
          speed_mps: 1,
          heading: 0,
          quality_status: "RELIABLE",
        },
        {
          latitude: 28.5358,
          longitude: 77.3913,
          accuracy_m: 12,
          recorded_at: "2026-09-10T10:00:40Z",
          speed_mps: 1,
          heading: 0,
          quality_status: "RELIABLE",
        },
      ];

      const cleaned = cleanRouteBreadcrumbs(rawBreadcrumbs);
      expect(cleaned.length).toBe(2);
      expect(cleaned[0].latitude).toBe(28.5355);
      expect(cleaned[1].latitude).toBe(28.5358);
    });

    it("detects and flags/rejects impossible jumps (>35 km/h at site, >150 km/h in transit)", () => {
      const rawPoints = [
        {
          latitude: 28.5355,
          longitude: 77.391,
          accuracy_m: 10,
          recorded_at: "2026-09-10T10:00:00Z",
          speed_mps: 1,
          heading: 0,
          quality_status: "RELIABLE",
        },
        {
          // ~1.1km away in 5 seconds = ~800 km/h jump
          latitude: 28.5455,
          longitude: 77.391,
          accuracy_m: 10,
          recorded_at: "2026-09-10T10:00:05Z",
          speed_mps: 200,
          heading: 0,
          quality_status: "RELIABLE",
        },
      ];

      // Flag jump test
      const flagged = cleanRouteBreadcrumbs(rawPoints, { rejectJumps: false });
      expect(flagged[1].flagged_jump).toBe(true);

      // Reject jump test
      const rejected = cleanRouteBreadcrumbs(rawPoints, { rejectJumps: true });
      expect(rejected.length).toBe(1);
    });
  });

  describe("Point 3 & 12: Dual Capture Policy & Battery Adaptive Sampling", () => {
    it("defines dual capture condition (>=5m or >=10s) and 25s relaxation for stationary > 60s", () => {
      expect(locationTaskSrc).toContain("distM >= 5");
      expect(locationTaskSrc).toContain("stationaryDurationMs > 60_000 ? 25_000 : 10_000");
      expect(locationTaskSrc).toContain("elapsedSinceLastCaptureMs < requiredHeartbeatMs");
    });
  });

  describe("Point 4 & 5: State Machine, Idempotency & Deduplication", () => {
    it("tracks state machine lifecycle and transitions", () => {
      setTrackingState("NOT_TRACKING");
      expect(getCurrentTrackingState()).toBe("NOT_TRACKING");

      setTrackingState("STARTING");
      expect(getCurrentTrackingState()).toBe("STARTING");

      setTrackingState("IN_TRANSIT");
      expect(getCurrentTrackingState()).toBe("IN_TRANSIT");

      setTrackingState("AT_SITE");
      expect(getCurrentTrackingState()).toBe("AT_SITE");

      setTrackingState("CHECKED_OUT");
      expect(getCurrentTrackingState()).toBe("CHECKED_OUT");

      setTrackingState("STOPPED");
      expect(getCurrentTrackingState()).toBe("STOPPED");
    });

    it("ensures coordinator startForVisit is idempotent", () => {
      expect(coordinatorSrc).toContain(
        "if (this.activeVisitId === visitId && currentConfig?.fieldVisitId === visitId)",
      );
      expect(coordinatorSrc).toContain("return true;");
    });

    it("deduplicates offline buffer by client_event_id and caps storage", () => {
      const queueSrc = fs.readFileSync(path.resolve(__dirname, "..", "services/location/siteVisitQueue.ts"), "utf8");
      expect(queueSrc).toContain("const existingIds = new Set(current.map((p) => p.client_event_id));");
      expect(queueSrc).toContain("MAX_QUEUE_CAPACITY = 500");
    });
  });

  describe("Point 7 & 8: Server-Authoritative Reconciliation & Realtime Observer", () => {
    it("stops tracking when server visit is completed or cancelled", () => {
      expect(coordinatorSrc).toContain("reconcileWithServer");
      expect(coordinatorSrc).toContain('!["IN_TRANSIT", "CHECKED_IN"].includes(visit.status)');
      expect(coordinatorSrc).toContain("RECONCILE_VISIT_INACTIVE");
    });

    it("auto-resumes active visits on app resume / after reboot", () => {
      expect(coordinatorSrc).toContain("Auto-resuming active visit tracking");
      expect(coordinatorSrc).toContain('.in("status", ["IN_TRANSIT", "CHECKED_IN"])');
    });

    it("subscribes to realtime Postgres changes in SiteVisitObserverScreen with 45s fallback", () => {
      expect(observerScreenSrc).toContain('.channel("observer-live-feed")');
      expect(observerScreenSrc).toContain('table: "site_visit_live_locations"');
      expect(observerScreenSrc).toContain("45_000");
    });
  });

  describe("Point 10: Tracking Health Panel & UI Readout", () => {
    it("computes accurate tracking health states", () => {
      const now = Date.now();
      const recent = new Date(now - 5000).toISOString(); // 5s ago
      const delayed = new Date(now - 25000).toISOString(); // 25s ago
      const stale = new Date(now - 70000).toISOString(); // 70s ago

      expect(computeTrackingHealth(recent, 0)).toBe("ACTIVE");
      expect(computeTrackingHealth(delayed, 0)).toBe("DELAYED");
      expect(computeTrackingHealth(stale, 0)).toBe("STALE");
      expect(computeTrackingHealth(recent, 5)).toBe("OFFLINE");
      expect(computeTrackingHealth(null, 0)).toBe("STALE");
    });

    it("displays telemetry source, accuracy with ± readout, and health badge in drawer", () => {
      expect(drawerSrc).toContain("Telemetry Source");
      expect(drawerSrc).toContain("GPS Accuracy");
      expect(drawerSrc).toContain("±");
      expect(drawerSrc).toContain("healthBadge");
    });
  });

  describe("Database Migration Verification", () => {
    it("adds source column and check constraint to database tables", () => {
      expect(migration).toContain("alter table if exists public.site_visit_live_locations");
      expect(migration).toContain("alter table if exists public.site_visit_location_history");
      expect(migration).toContain("check (source in ('foreground', 'background', 'web'))");
    });

    it("updates batch ingestion RPC and observer data function to handle source", () => {
      expect(migration).toContain("create or replace function public.record_site_visit_location_batch");
      expect(migration).toContain("v_source := coalesce(nullif(v_item->>'source', ''), 'foreground');");
      expect(migration).toContain("create or replace function public.get_site_visit_observer_data");
      expect(migration).toContain("'source',        ec.source");
    });
  });
});
