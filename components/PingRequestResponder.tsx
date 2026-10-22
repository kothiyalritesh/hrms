import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrentGPS } from "@/utils/gps";

/**
 * Answers "Request Ping" from Live Tracking. Whenever HRMS is open (opened from
 * the ping notification or normally), pending requests for this employee are
 * answered with one fresh GPS reading. Renders nothing.
 */
export default function PingRequestResponder() {
  const { user } = useAuth();
  const busyRef = useRef(false);
  const attemptedRef = useRef<Set<string>>(new Set());

  const answer = useCallback(async () => {
    if (!user?.id || busyRef.current) return;
    busyRef.current = true;
    try {
      const { data, error } = await supabase.rpc("rpc_my_pending_ping_requests");
      if (error || !Array.isArray(data) || data.length === 0) return;
      const newest = (data as { id: string }[]).find((r) => !attemptedRef.current.has(r.id));
      if (!newest) return;
      attemptedRef.current.add(newest.id);

      const gps = await getCurrentGPS();
      if (!gps) {
        // Location off / denied / no signal: the request stays pending and is
        // tried again on the next check instead of being skipped for good.
        attemptedRef.current.delete(newest.id);
        return;
      }
      await supabase.rpc("rpc_fulfill_location_ping_request", {
        p_request_id: newest.id,
        p_latitude: gps.latitude,
        p_longitude: gps.longitude,
        p_accuracy_m: gps.accuracy ?? null,
        p_mocked: gps.mocked ?? false,
        p_captured_at: gps.capturedAt,
      });
    } catch (error) {
      console.warn("[PingRequestResponder] could not answer ping request:", error);
    } finally {
      busyRef.current = false;
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void answer();

    // New requests arrive in realtime while HRMS is open.
    const channel = supabase
      .channel(`ping-requests-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "location_ping_requests", filter: `target_user_id=eq.${user.id}` },
        () => void answer(),
      )
      .subscribe();

    // Fallback when the realtime socket is suspended.
    const timer = setInterval(() => void answer(), 60_000);

    let removeForeground: (() => void) | undefined;
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const onVisible = () => {
        if (document.visibilityState === "visible") void answer();
      };
      document.addEventListener("visibilitychange", onVisible);
      removeForeground = () => document.removeEventListener("visibilitychange", onVisible);
    } else {
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") void answer();
      });
      removeForeground = () => sub.remove();
    }

    return () => {
      clearInterval(timer);
      removeForeground?.();
      void supabase.removeChannel(channel);
    };
  }, [user?.id, answer]);

  return null;
}
