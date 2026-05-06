import { useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import { getCurrentGPS } from "@/utils/gps";
import { LocationService } from "@/services/location.service";
import { supabase } from "@/lib/supabase";

const PING_INTERVAL_MS = 2 * 60 * 1000; // ping every 2 minutes
const ESCALATION_MINS = 10;

// Global flag so attendance service can trigger monitor start after check-in
export let triggerLocationMonitorStart: (() => void) | null = null;

export function useGlobalLocationMonitor(userId: string | undefined) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outOfBoundSinceRef = useRef<Date | null>(null);
  const escalationSentRef = useRef(false);
  const activeRef = useRef(false);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    activeRef.current = false;
  }, []);

  const ping = useCallback(async () => {
    if (!userId) return;

    // Check if employee is checked in today and not checked out
    const today = new Date().toISOString().split("T")[0];
    const { data: att } = await supabase
      .from("attendance_logs")
      .select("checkin_time, checkout_time, office_id")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle();

    if (!att?.checkin_time || att?.checkout_time) {
      // Not checked in or already checked out — stop pinging
      stop();
      return;
    }

    const gps = await getCurrentGPS();
    if (!gps) return;

    // Get office details
    const officeId = att.office_id;
    if (!officeId) return;

    const { data: office } = await supabase
      .from("offices")
      .select("id, name, latitude, longitude, attendance_radius")
      .eq("id", officeId)
      .single();

    if (!office || office.latitude == null || office.longitude == null) return;

    const minsOutside = outOfBoundSinceRef.current
      ? (Date.now() - outOfBoundSinceRef.current.getTime()) / 60000
      : 0;

    const { status } = await LocationService.logHeartbeat({
      userId,
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracy: gps.accuracy,
      officeId: office.id,
      officeLat: office.latitude,
      officeLon: office.longitude,
      officeRadius: office.attendance_radius ?? 300,
      minsOutside,
    });

    if (status === "OUT_OF_BOUND" || status === "WARNING") {
      if (!outOfBoundSinceRef.current) outOfBoundSinceRef.current = new Date();

      if (minsOutside >= ESCALATION_MINS && !escalationSentRef.current) {
        escalationSentRef.current = true;
        await supabase
          .from("location_violations")
          .update({ escalated: true })
          .eq("user_id", userId)
          .eq("session_date", today)
          .is("resolved_at", null);

        const { data: profile } = await supabase
          .from("profiles")
          .select("name, reporting_manager_id")
          .eq("id", userId)
          .single();

        if (profile?.reporting_manager_id) {
          await supabase.from("notifications").insert({
            user_id: profile.reporting_manager_id,
            title: "🚨 Location Escalation",
            message: `${profile.name} has been outside ${office.name} for ${Math.round(minsOutside)} minutes.`,
            type: "location_violation",
          });
        }
      }
    } else {
      if (outOfBoundSinceRef.current) {
        await LocationService.resolveViolation(userId, "returned");
        outOfBoundSinceRef.current = null;
        escalationSentRef.current = false;
      }
    }
  }, [userId, stop]);

  const start = useCallback(() => {
    if (activeRef.current || !userId) return;
    activeRef.current = true;
    // Fire immediately then repeat
    ping();
    intervalRef.current = setInterval(ping, PING_INTERVAL_MS);
  }, [userId, ping]);

  useEffect(() => {
    // Register global trigger so attendance service can call start after check-in
    triggerLocationMonitorStart = start;
    return () => { triggerLocationMonitorStart = null; };
  }, [start]);

  useEffect(() => {
    if (!userId) { stop(); return; }

    // Check if already checked in — start monitor if so
    const today = new Date().toISOString().split("T")[0];
    supabase
      .from("attendance_logs")
      .select("checkin_time, checkout_time")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.checkin_time && !data?.checkout_time) start();
      });

    // Web: warn user before closing tab while checked in
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (!activeRef.current) return;
        const msg = "You are currently checked in. Closing this tab will stop live GPS tracking. Please check out first.";
        e.preventDefault();
        e.returnValue = msg;
        return msg;
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
        stop();
      };
    }

    return stop;
  }, [userId, start, stop]);

  return { start, stop };
}
