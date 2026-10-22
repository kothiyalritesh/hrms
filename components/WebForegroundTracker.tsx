import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { nativeBridge } from "@/services/nativeBridge/client";

// Browser (desktop / iPhone / Android Chrome) location pings while HRMS is open.
// The Android app's WebView is skipped: its native background task already
// sends pings. Browsers stop JavaScript when the screen locks or the tab is in
// the background, so this is foreground-only tracking by design.
const PING_INTERVAL_MS = 60_000;
// The server stores nothing without an open check-in; back off when told so.
const NO_ATTENDANCE_BACKOFF_MS = 10 * 60_000;
// Pings that failed on a bad connection are kept (GPS time included) and sent
// with the next successful ping instead of being lost.
const RETRY_LIMIT = 30;
type PendingPing = Record<string, unknown> & { p_client_event_id: string; p_recorded_at: string };

function newEventId(): string {
  const cryptoApi = (globalThis as any).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 30_000,
      timeout: 20_000,
    }),
  );
}

export default function WebForegroundTracker() {
  const { user } = useAuth();
  const pausedUntil = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<PendingPing[]>([]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !user?.id) return;
    if (nativeBridge.isAvailable()) return; // Android app: native tracking owns pings
    if (!("geolocation" in navigator)) return;

    let cancelled = false;

    const sendPing = async () => {
      if (cancelled || inFlight.current) return;
      if (document.visibilityState !== "visible") return;
      if (Date.now() < pausedUntil.current) return;
      inFlight.current = true;
      try {
        const position = await currentPosition();
        const ping: PendingPing = {
          p_client_event_id: newEventId(),
          p_latitude: position.coords.latitude,
          p_longitude: position.coords.longitude,
          p_accuracy_m: position.coords.accuracy ?? null,
          p_altitude_m: position.coords.altitude ?? null,
          p_heading: position.coords.heading ?? null,
          p_speed_mps: position.coords.speed ?? null,
          p_mocked: false,
          p_recorded_at: new Date(position.timestamp || Date.now()).toISOString(),
          p_provider: "browser-foreground",
        };
        // Older failed pings first (server keeps GPS order; event ids dedupe).
        const queue = [...pending.current, ping];
        pending.current = [];
        for (let i = 0; i < queue.length; i += 1) {
          const item = queue[i];
          const { data, error } = await supabase.rpc("record_location_ping", item);
          const warning = String((data as any)?.health_warning ?? error?.message ?? "");
          if (warning.includes("NO_OPEN_ATTENDANCE") || warning.includes("ATTENDANCE")) {
            pausedUntil.current = Date.now() + NO_ATTENDANCE_BACKOFF_MS;
            break;
          }
          if (error) {
            // P0001 = refused for good (bad time / coordinates): drop it.
            if (String((error as any).code) !== "P0001") {
              pending.current = queue.slice(i).slice(-RETRY_LIMIT);
            }
            console.warn("[WebForegroundTracker] ping not sent:", error.message);
            break;
          }
        }
      } catch (err: any) {
        // Permission denied / no fix: try again on the next tick, never alert.
        if (err?.code === 1) pausedUntil.current = Date.now() + NO_ATTENDANCE_BACKOFF_MS;
      } finally {
        inFlight.current = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void sendPing();
    };

    void sendPing();
    const timer = setInterval(() => void sendPing(), PING_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.id]);

  return null;
}
