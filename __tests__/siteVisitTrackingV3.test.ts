// @ts-nocheck -- unit and integration contracts for Site Visit Tracking v3 architecture
jest.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: jest.fn().mockResolvedValue({ data: { success: true, inserted: 1 }, error: null }),
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
  classifyGpsQuality,
  cleanRouteBreadcrumbs,
} from "../utils/routeCleanup";
import { computeVisitSummary } from "../utils/gpsQuality";
import {
  computeTrackingHealth,
  computeGpsQuality,
} from "../components/observer/ObserverDetailDrawer";
import { siteVisitQueue } from "../services/location/siteVisitQueue";
import { toSiteVisitPing } from "../services/location/siteVisitLocationTask";

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("Site Visit Tracking v3 Architecture (7 Enterprise Refinements)", () => {
  const v3Migration = read(
    "supabase/migrations/20260910010000_site_visit_tracking_v3_schema.sql",
  );
  const queueSrc = read("services/location/siteVisitQueue.ts");
  const taskSrc = read("services/location/siteVisitLocationTask.ts");
  const coordinatorSrc = read("services/location/SiteVisitTrackingCoordinator.ts");
  const drawerSrc = read("components/observer/ObserverDetailDrawer.tsx");

  describe("1. client_event_id Lifecycle & Idempotency", () => {
    it("generates UUID once upon location capture and persists it", () => {
      const loc = {
        coords: { latitude: 28.5355, longitude: 77.391, accuracy: 12 },
        timestamp: 1725960000000,
        mocked: false,
      };
      const ping = toSiteVisitPing(loc as any, "foreground");
      expect(ping.client_event_id).toBeDefined();
      expect(typeof ping.client_event_id).toBe("string");
      expect(ping.source).toBe("foreground");
    });

    it("preserves unique client_event_id across queue retries", async () => {
      await siteVisitQueue.clearQueue();
      const testPing = {
        client_event_id: "test-event-uuid-1",
        field_visit_id: "test-visit-1",
        latitude: 28.5355,
        longitude: 77.391,
        accuracy: 10,
        altitude: null,
        heading: null,
        speed: 1,
        mocked: false,
        source: "foreground" as const,
        captured_at: new Date().toISOString(),
        retry_count: 0,
        created_at: Date.now(),
      };

      await siteVisitQueue.enqueuePing(testPing);
      // Attempt to enqueue duplicate with same client_event_id
      await siteVisitQueue.enqueuePing(testPing);

      const count = await siteVisitQueue.getPendingPingCount();
      expect(count).toBe(1);

      const batch = await siteVisitQueue.peekBatch(10);
      expect(batch[0].client_event_id).toBe("test-event-uuid-1");

      // Increment retry count
      await siteVisitQueue.incrementRetryCount(["test-event-uuid-1"]);
      const retriedBatch = await siteVisitQueue.peekBatch(10);
      expect(retriedBatch[0].retry_count).toBe(1);

      // Dequeue on server ACK
      await siteVisitQueue.dequeuePings(["test-event-uuid-1"]);
      const finalCount = await siteVisitQueue.getPendingPingCount();
      expect(finalCount).toBe(0);
    });
  });

  describe("2. Raw Point Retention + Quality Classification", () => {
    it("classifies GPS quality into HIGH, ACCEPTABLE, WEAK, INVALID", () => {
      expect(classifyGpsQuality(10)).toBe("HIGH");
      expect(classifyGpsQuality(20)).toBe("HIGH");
      expect(classifyGpsQuality(35)).toBe("ACCEPTABLE");
      expect(classifyGpsQuality(50)).toBe("ACCEPTABLE");
      expect(classifyGpsQuality(78)).toBe("WEAK");
      expect(classifyGpsQuality(100)).toBe("WEAK");
      expect(classifyGpsQuality(137)).toBe("INVALID");
      expect(classifyGpsQuality(null)).toBe("INVALID");
    });

    it("preserves raw points in DB migration while polyline only draws valid points", () => {
      expect(v3Migration).toContain("check (quality_status in ('RELIABLE', 'LOW_ACCURACY', 'REJECTED', 'MOCKED', 'STALE', 'IMPOSSIBLE_SPEED'))");
      expect(v3Migration).toContain("v_quality := 'REJECTED'");

      // Test cleanRouteBreadcrumbs: filters out accuracy > 100m for map polyline
      const breadcrumbs = [
        { latitude: 28.5355, longitude: 77.391, accuracy_m: 15, recorded_at: "2026-09-10T10:00:00Z", quality_status: "RELIABLE" },
        { latitude: 28.5356, longitude: 77.3911, accuracy_m: 137, recorded_at: "2026-09-10T10:00:10Z", quality_status: "REJECTED" }, // Retained in history, filtered from polyline
        { latitude: 28.5357, longitude: 77.3912, accuracy_m: 18, recorded_at: "2026-09-10T10:00:20Z", quality_status: "RELIABLE" },
      ];

      const cleaned = cleanRouteBreadcrumbs(breadcrumbs as any);
      expect(cleaned.length).toBe(2);
      expect(cleaned[0].latitude).toBe(28.5355);
      expect(cleaned[1].latitude).toBe(28.5357);
    });
  });

  describe("3. Orthogonal Status Model (Tracking Health vs GPS Quality)", () => {
    it("decouples tracking health from satellite GPS quality", () => {
      const now = Date.now();
      const freshUpload = new Date(now - 5000).toISOString();

      // Scenario: Tracker is working live (<15s), but GPS fix is weak (±78m indoors)
      const trackingHealth = computeTrackingHealth(freshUpload, 0);
      const gpsQuality = computeGpsQuality(78);
      expect(trackingHealth).toBe("ACTIVE");
      expect(gpsQuality).toBe("WEAK");

      // Scenario: Offline in basement, but GPS has a lock (±10m)
      const offlineHealth = computeTrackingHealth(freshUpload, 5); // 5 pings queued
      const strongGps = computeGpsQuality(10);
      expect(offlineHealth).toBe("OFFLINE");
      expect(strongGps).toBe("HIGH");

      // Scenario: Delayed upload (30s) with acceptable GPS (35m)
      const delayedUpload = new Date(now - 30000).toISOString();
      expect(computeTrackingHealth(delayedUpload, 0)).toBe("DELAYED");
      expect(computeGpsQuality(35)).toBe("ACCEPTABLE");

      // Scenario: Stale (>60s)
      const staleUpload = new Date(now - 80000).toISOString();
      expect(computeTrackingHealth(staleUpload, 0)).toBe("STALE");
    });
  });

  describe("4. GPS vs Network Down Telemetry", () => {
    it("tracks last_location_at, last_uploaded_at, and pending_ping_count in migration and UI", () => {
      expect(v3Migration).toContain("last_location_at timestamptz");
      expect(v3Migration).toContain("last_uploaded_at timestamptz default now()");
      expect(v3Migration).toContain("pending_ping_count int default 0");
      expect(drawerSrc).toContain("Last GPS Fix");
      expect(drawerSrc).toContain("Last Upload");
    });
  });

  describe("5. Server-Side Validation & Delayed Offline Sync", () => {
    it("migration enforces ownership, active date, and post-checkout delayed sync grace window", () => {
      expect(v3Migration).toContain("where id = p_field_visit_id and user_id = v_uid");
      expect(v3Migration).toContain("v_is_delayed_sync boolean := false");
      expect(v3Migration).toContain("v_recorded_at > v_visit.checkout_time + interval '5 minutes'");
      expect(v3Migration).toContain("v_visit.updated_at < now() - interval '24 hours'");
    });
  });

  describe("6. Robust Persistent Queue Capacity", () => {
    it("defines AsyncStorage persistent queue with 500 ping capacity", () => {
      expect(queueSrc).toContain('QUEUE_STORAGE_KEY = "hrms.site_visit.offline-queue.v2"');
      expect(queueSrc).toContain("MAX_QUEUE_CAPACITY = 500");
      expect(queueSrc).toContain("dequeuePings(clientEventIds: string[])");
    });
  });

  describe("7. Visit Summary Intelligence Layer", () => {
    it("computes comprehensive visit metrics from raw breadcrumbs", () => {
      const rawPoints = [
        { latitude: 28.5355, longitude: 77.391, accuracy_m: 10, recorded_at: "2026-09-10T10:00:00Z", quality_status: "RELIABLE" },
        { latitude: 28.5365, longitude: 77.392, accuracy_m: 12, recorded_at: "2026-09-10T10:00:10Z", quality_status: "RELIABLE" },
        // GPS gap of 3 minutes (180s > 120s)
        { latitude: 28.5375, longitude: 77.393, accuracy_m: 15, recorded_at: "2026-09-10T10:03:10Z", quality_status: "RELIABLE" },
        // Checkin point at 10:03:20
        { latitude: 28.5385, longitude: 77.394, accuracy_m: 12, recorded_at: "2026-09-10T10:03:20Z", quality_status: "RELIABLE" },
        { latitude: 28.5390, longitude: 77.3945, accuracy_m: 80, recorded_at: "2026-09-10T10:03:30Z", quality_status: "LOW_ACCURACY" },
      ];

      const summary = computeVisitSummary(rawPoints as any, { checkinTime: "2026-09-10T10:03:20Z" });

      expect(summary.durationMinutes).toBeGreaterThanOrEqual(3);
      expect(summary.totalDistanceKm).toBeGreaterThan(0);
      expect(summary.travelDistanceKm).toBeGreaterThan(0);
      expect(summary.onsiteDistanceKm).toBeGreaterThan(0);
      expect(summary.gpsGapsCount).toBe(1); // One interval > 120s
      expect(summary.totalBreadcrumbs).toBe(5);
      expect(summary.gpsQualityPct).toBe(80); // 4 out of 5 are <= 50m
      expect(summary.trackingUptimePct).toBeLessThan(100);
    });
  });

  describe("8. Movement & Speed Thresholds", () => {
    it("supports context-aware jump limits (35 km/h pedestrian vs 100 km/h vehicle)", () => {
      const p1 = { latitude: 28.5355, longitude: 77.391, accuracy_m: 10, recorded_at: "2026-09-10T10:00:00Z", quality_status: "RELIABLE" };
      // 500m in 30 seconds = 60 km/h
      const p2 = { latitude: 28.5395, longitude: 77.391, accuracy_m: 10, recorded_at: "2026-09-10T10:00:30Z", quality_status: "RELIABLE" };

      // Under pedestrian site limit (35 km/h), 60 km/h is a jump
      const pedestrianCleaned = cleanRouteBreadcrumbs([p1, p2] as any, { isAtSite: true, isVehicleSite: false });
      expect(pedestrianCleaned[1].flagged_jump).toBe(true);

      // Under vehicle/township site limit (100 km/h), 60 km/h is acceptable
      const vehicleCleaned = cleanRouteBreadcrumbs([p1, p2] as any, { isAtSite: true, isVehicleSite: true });
      expect(vehicleCleaned[1].flagged_jump).toBe(false);
    });
  });
});
