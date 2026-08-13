import { useEffect, useRef, useCallback } from "react";
import { isMedian, medianRequestLocation } from "@/utils/medianBridge";
import { Platform, AppState, AppStateStatus } from "react-native";
import { supabase } from "@/lib/supabase";
import { googleGeolocate } from "@/utils/googleGeolocation";
import * as Crypto from "expo-crypto";
import { LOCATION_RPC_ENABLED } from "@/services/location/capabilities";

const POLL_MS = 60 * 1000; // live ping every 1 min (foreground)
const BG_POLL_MS = 2 * 60 * 1000; // live ping every 2 min (background tab)
const HOURLY_MS = 30 * 60 * 1000; // snapshot ping every 30 min
const FENCE_M = 50; // default geo-fence radius (matches office default)
const NO_PING_ALERT_MS = 15 * 60 * 1000;

// ── India bounding box ────────────────────────────────────────────────────────
// Rejects coordinates that are clearly outside India (South Africa VPN/datacenter
// IPs resolve to ~-30°lat which poisons the distance-mismatch and live-board data).
// Generous box: Kashmir (37.1°N) to Kanyakumari (8.0°N), Rann of Kutch (68.1°E)
// to Arunachal (97.4°E).  IP-sourced coords are NEVER written — they are too
// unreliable (old PCs / cloud IPs can resolve to any country).
const INDIA_BOUNDS = { latMin: 6.5, latMax: 37.6, lonMin: 68.0, lonMax: 97.5 };

function isWithinIndia(lat: number, lon: number): boolean {
  return (
    lat >= INDIA_BOUNDS.latMin &&
    lat <= INDIA_BOUNDS.latMax &&
    lon >= INDIA_BOUNDS.lonMin &&
    lon <= INDIA_BOUNDS.lonMax
  );
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getStatus(
  dist: number | null,
  gpsAvailable: boolean,
  fenceM: number,
): string {
  if (!gpsAvailable || dist === null) return "RED_GPS_OFF";
  if (dist <= fenceM * 0.7) return "GREEN";
  if (dist <= fenceM * 0.9) return "YELLOW";
  if (dist <= fenceM) return "ORANGE";
  return "RED_RANGE";
}

/** Returns GPS coords — cascades: Median → Expo → browser → Google Geolocation (cell/WiFi/IP) */
async function getGPS(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source: "app" | "web" | "cell" | "ip";
} | null> {
  // 1. Median APK bridge
  if (isMedian()) {
    const pos = await medianRequestLocation();
    if (pos) return { ...pos, accuracy: null, source: "app" };
  }
  // 2. Expo Location (native)
  if (Platform.OS !== "web") {
    try {
      const Location = await import("expo-location");
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        // Reject stale cache hits — real GPS is <100m accuracy; network cache is >500m
        if (loc.coords.accuracy != null && loc.coords.accuracy > 1000) {
          console.log(
            `[LocationMonitor] Low-accuracy native ping rejected: ${Math.round(loc.coords.accuracy)}m`,
          );
          // fall through to browser / google fallback
        } else if (isWithinIndia(loc.coords.latitude, loc.coords.longitude)) {
          return {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy ?? null,
            source: "app",
          };
        }
      }
    } catch {
      /* fall through */
    }
  }
  // 3. Browser geolocation
  if (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    navigator?.geolocation
  ) {
    const pos = await new Promise<{
      latitude: number;
      longitude: number;
      accuracy: number | null;
    } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy ?? null,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
      );
    });
    if (pos) return { ...pos, source: "web" };
  }
  // 4. Google Geolocation API (cell tower + WiFi only — NOT IP fallback)
  // We pass considerIp:false so Google only uses cell/WiFi signals.
  // IP-based geolocation resolves to datacenter/VPN locations (South Africa,
  // Singapore, etc.) on old or office PCs and would poison the live board.
  const google = await googleGeolocate({ considerIp: false });
  if (
    google &&
    google.source !== "ip" &&
    isWithinIndia(google.latitude, google.longitude)
  ) {
    return {
      latitude: google.latitude,
      longitude: google.longitude,
      accuracy: typeof google.accuracy === "number" ? google.accuracy : null,
      source: google.source as any,
    };
  }
  return null;
}

async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return true;
  try {
    const Location = await import("expo-location");
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

async function savePing(
  userId: string,
  gps: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    source: "app" | "web" | "cell" | "ip";
  } | null,
  baseLat: number | null,
  baseLng: number | null,
  fenceRadius: number,
) {
  // Reject coordinates outside India — IP geolocation on old/office PCs can
  // resolve to South Africa, Singapore, etc. Treat those as "no GPS".
  const validGps =
    gps && isWithinIndia(gps.latitude, gps.longitude) ? gps : null;
  if (gps && !validGps) {
    console.warn(
      `[LocationMonitor] Rejected out-of-India ping: ${gps.latitude},${gps.longitude}`,
    );
  }
  const gpsAvailable = validGps !== null;
  let distM: number | null = null;
  if (validGps && baseLat != null && baseLng != null) {
    distM = haversineM(baseLat, baseLng, validGps.latitude, validGps.longitude);
  }
  const status = getStatus(distM, gpsAvailable, fenceRadius);
  try {
    if (validGps) {
      const recordedAt = new Date().toISOString();
      const { error } = LOCATION_RPC_ENABLED
        ? await supabase.rpc("record_location_ping", {
            p_attendance_log_id: null,
            p_tracking_session_id: null,
            p_field_visit_id: null,
            p_client_event_id: Crypto.randomUUID(),
            p_latitude: validGps.latitude,
            p_longitude: validGps.longitude,
            p_accuracy_m: validGps.accuracy,
            p_altitude_m: null,
            p_heading: null,
            p_speed_mps: null,
            p_mocked: false,
            p_recorded_at: recordedAt,
            p_provider:
              validGps.source === "web"
                ? "browser-foreground"
                : validGps.source,
            p_client_quality_status: "RELIABLE",
          })
        : { error: null };
      const rpcMissing =
        !LOCATION_RPC_ENABLED ||
        error?.code === "PGRST202" ||
        error?.code === "42883" ||
        error?.message?.includes("record_location_ping");
      if (rpcMissing) {
        await supabase.from("location_tracking").insert({
          user_id: userId,
          latitude: validGps.latitude,
          longitude: validGps.longitude,
          accuracy: validGps.accuracy,
          distance_from_base: distM,
          status,
          gps_available: true,
          source: "web",
          date: new Date(Date.parse(recordedAt) + 330 * 60 * 1000)
            .toISOString()
            .slice(0, 10),
          recorded_at: recordedAt,
        });
      }
    }
  } catch {
    /* silent */
  }
  return { gpsAvailable, distM, status };
}

async function insertAlert(
  userId: string,
  alertType: string,
  message: string,
  distanceM?: number,
) {
  try {
    const { data: existing } = await supabase
      .from("location_alerts")
      .select("id")
      .eq("user_id", userId)
      .eq("alert_type", alertType)
      .eq("resolved", false)
      .limit(1);
    if (existing?.length) return;
    await supabase.from("location_alerts").insert({
      user_id: userId,
      alert_type: alertType,
      message,
      distance_m: distanceM ?? null,
    });
    const { data: matrix } = await supabase
      .from("escalation_matrix")
      .select("user_id, notify_gps_off, notify_out_range, notify_no_data");
    const inserts = (matrix ?? [])
      .filter((row: any) => {
        if (alertType === "GPS_OFF" && row.notify_gps_off) return true;
        if (alertType === "OUT_OF_RANGE" && row.notify_out_range) return true;
        if (alertType === "NO_DATA" && row.notify_no_data) return true;
        return false;
      })
      .map((row: any) => ({
        user_id: row.user_id,
        title:
          alertType === "GPS_OFF"
            ? "🔴 Location OFF Alert"
            : alertType === "OUT_OF_RANGE"
              ? "🟠 Out of Range Alert"
              : "⚠️ No Data Alert",
        message,
        type: "location_alert",
      }));
    if (inserts.length) await supabase.from("notifications").insert(inserts);
  } catch {
    /* silent */
  }
}

async function resolveAlerts(userId: string, alertType: string) {
  try {
    await supabase
      .from("location_alerts")
      .update({ resolved: true })
      .eq("user_id", userId)
      .eq("alert_type", alertType)
      .eq("resolved", false);
  } catch {
    /* silent */
  }
}

async function notifyEmployee(userId: string, minutesElapsed: number) {
  try {
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "location_reminder")
      .gte("created_at", new Date(Date.now() - NO_PING_ALERT_MS).toISOString())
      .limit(1);
    if (existing?.length) return;
    await supabase.from("notifications").insert({
      user_id: userId,
      title: "📍 Location Sharing Paused",
      message: `Your location hasn't been shared for ${minutesElapsed} minutes. Please open the app to resume tracking.`,
      type: "location_reminder",
    });
  } catch {
    /* silent */
  }
}

// Listen for admin ping requests and respond immediately
function usePingRequestListener(params: {
  userId: string | null;
  baseLat: number | null;
  baseLng: number | null;
  fenceRadius: number;
}) {
  const { userId, baseLat, baseLng, fenceRadius } = params;

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`ping-request-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "location_ping_requests",
          filter: `target_user_id=eq.${userId}`,
        },
        async (payload: any) => {
          const requestId = payload.new?.id;
          if (!requestId) return;
          const rawGps = await getGPS();
          // getGPS() already rejects IP coords and out-of-India coordinates,
          // so if we get null here the device genuinely has no usable location.
          const gps =
            rawGps && isWithinIndia(rawGps.latitude, rawGps.longitude)
              ? rawGps
              : null;
          if (!gps) {
            await supabase
              .from("location_ping_requests")
              .update({
                status: "failed",
                responded_at: new Date().toISOString(),
              })
              .eq("id", requestId);
            return;
          }
          await supabase.rpc("record_location_ping", {
            p_attendance_log_id: null,
            p_tracking_session_id: null,
            p_field_visit_id: null,
            p_client_event_id: Crypto.randomUUID(),
            p_latitude: gps.latitude,
            p_longitude: gps.longitude,
            p_accuracy_m: gps.accuracy,
            p_altitude_m: null,
            p_heading: null,
            p_speed_mps: null,
            p_mocked: false,
            p_recorded_at: new Date().toISOString(),
            p_provider: `${gps.source}-ping-request`,
            p_client_quality_status: "RELIABLE",
          });
          await supabase
            .from("location_ping_requests")
            .update({
              status: "fulfilled",
              responded_at: new Date().toISOString(),
              latitude: gps.latitude,
              longitude: gps.longitude,
            })
            .eq("id", requestId);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, baseLat, baseLng, fenceRadius]);
}

export function useLocationMonitor(params: {
  userId: string | null;
  active: boolean;
  userName?: string;
  baseLat?: number | null;
  baseLng?: number | null;
  fenceRadius?: number;
  onLocationUpdate?: (update: {
    available: boolean;
    capturedAt: string;
    accuracyM: number | null;
  }) => void;
}) {
  const {
    userId,
    active,
    userName,
    baseLat,
    baseLng,
    fenceRadius = FENCE_M,
    onLocationUpdate,
  } = params;

  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hourlyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateSubscriptionRef = useRef<ReturnType<
    typeof AppState.addEventListener
  > | null>(null);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);
  const lastPingRef = useRef<number>(0);
  const prevStatusRef = useRef<string>("GREEN");
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  usePingRequestListener({
    userId,
    baseLat: baseLat ?? null,
    baseLng: baseLng ?? null,
    fenceRadius,
  });

  const clearAll = useCallback(() => {
    if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    if (hourlyTimerRef.current) {
      clearInterval(hourlyTimerRef.current);
      hourlyTimerRef.current = null;
    }
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
    appStateSubscriptionRef.current?.remove();
    appStateSubscriptionRef.current = null;
    if (visibilityHandlerRef.current && typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        visibilityHandlerRef.current,
      );
      visibilityHandlerRef.current = null;
    }
  }, []);

  // ── Live ping (every 5 min) — for real-time tracking dashboard ──────────
  const livePing = useCallback(async () => {
    if (!userId) return;
    const gps = await getGPS();
    lastPingRef.current = Date.now();
    const { gpsAvailable, distM, status } = await savePing(
      userId,
      gps,
      baseLat ?? null,
      baseLng ?? null,
      fenceRadius,
    );
    onLocationUpdate?.({
      available: gpsAvailable,
      capturedAt: new Date().toISOString(),
      accuracyM: gps?.accuracy ?? null,
    });
    const name = userName || "An employee";

    if (!gpsAvailable) {
      await insertAlert(
        userId,
        "GPS_OFF",
        `🔴 ${name} has turned OFF their location / GPS is unavailable.`,
      );
    } else {
      if (prevStatusRef.current === "RED_GPS_OFF") {
        await resolveAlerts(userId, "GPS_OFF");
        try {
          await supabase.from("location_alerts").insert({
            user_id: userId,
            alert_type: "GPS_RESTORED",
            message: `✅ ${name}'s GPS has been restored.`,
          });
        } catch {
          /* silent */
        }
      }
    }
    if (status === "RED_RANGE" && distM !== null && distM > 100) {
      await insertAlert(
        userId,
        "OUT_OF_RANGE",
        `🟠 ${name} is ${Math.round(distM)}m away — outside the ${fenceRadius}m geo-fence.`,
        distM,
      );
    } else if (
      status !== "RED_RANGE" &&
      prevStatusRef.current === "RED_RANGE"
    ) {
      await resolveAlerts(userId, "OUT_OF_RANGE");
    }
    prevStatusRef.current = status;
  }, [userId, baseLat, baseLng, fenceRadius, userName, onLocationUpdate]);

  // ── Hourly snapshot ping — for timeline map & Excel report ──────────────
  // Runs on ALL platforms (web + iOS + Android) via JS setInterval.
  // On native, expo-task-manager also runs in background — both write to
  // location_tracking so at least one always succeeds.
  const hourlyPing = useCallback(async () => {
    if (!userId) return;
    const gps = await getGPS();
    if (!gps) return; // skip if no GPS — live ping already handles GPS_OFF alerts
    await savePing(userId, gps, baseLat ?? null, baseLng ?? null, fenceRadius);
  }, [userId, baseLat, baseLng, fenceRadius]);

  useEffect(() => {
    if (!active || !userId) {
      clearAll();
      return;
    }

    let cancelled = false;
    lastPingRef.current = Date.now();
    ensureLocationPermission().then((granted) => {
      if (!granted || cancelled) return;

      // Immediate pings on check-in
      livePing();
      hourlyPing();

      // Live ping interval — adjusts when app backgrounds
      const startLive = (isBackground: boolean) => {
        if (liveTimerRef.current) clearInterval(liveTimerRef.current);
        // On web background (tab hidden) we still run at 5 min via JS timer
        liveTimerRef.current = setInterval(
          livePing,
          isBackground ? BG_POLL_MS : POLL_MS,
        );
      };
      startLive(appStateRef.current !== "active");

      // Hourly ping — fixed 1 hour interval, platform-independent
      hourlyTimerRef.current = setInterval(hourlyPing, HOURLY_MS);

      // AppState listener (native only — web doesn't have AppState)
      appStateSubscriptionRef.current = AppState.addEventListener(
        "change",
        (nextState: AppStateStatus) => {
          const wasBackground = appStateRef.current !== "active";
          const isBackground = nextState !== "active";
          appStateRef.current = nextState;
          if (wasBackground !== isBackground) {
            if (!isBackground) livePing(); // catch-up ping on foreground
            startLive(isBackground);
          }
        },
      );

      // Web: fire a catch-up ping when the tab becomes visible again
      if (Platform.OS === "web" && typeof document !== "undefined") {
        visibilityHandlerRef.current = () => {
          if (!document.hidden) livePing();
        };
        document.addEventListener(
          "visibilitychange",
          visibilityHandlerRef.current,
        );
      }

      // Watchdog — alert if no ping for 15 min
      watchdogRef.current = setInterval(async () => {
        if (!userId) return;
        const elapsed = Date.now() - lastPingRef.current;
        if (elapsed >= NO_PING_ALERT_MS) {
          const mins = Math.round(elapsed / 60000);
          const name = userName || "An employee";
          await insertAlert(
            userId,
            "NO_DATA",
            `⚠️ No location data from ${name} for ${mins} minutes.`,
          );
          await notifyEmployee(userId, mins);
        }
      }, 60 * 1000);
    });

    return () => {
      cancelled = true;
      clearAll();
    };
  }, [active, userId, userName, livePing, hourlyPing, clearAll]);
}
