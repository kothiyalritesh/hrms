import { useEffect, useRef, useCallback } from "react";
import { Alert, Platform } from "react-native";
import { getCurrentGPS } from "@/utils/gps";
import { LocationService, haversineM } from "@/services/location.service";
import { supabase } from "@/lib/supabase";

const INTERVAL_MOVING_MS   = 2 * 60 * 1000;
const INTERVAL_STATIC_MS   = 5 * 60 * 1000;
const MOVEMENT_THRESHOLD_M = 30;
const ESCALATION_MINS      = 10;

export interface LocationMonitorConfig {
  userId: string;
  officeId: string;
  officeLat: number;
  officeLon: number;
  officeRadius: number;
  officeName: string;
  active: boolean;
  onCheckOut?: () => void | Promise<void>;
}

export function useLocationMonitor(config: LocationMonitorConfig) {
  const intervalRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCoordsRef         = useRef<{ latitude: number; longitude: number } | null>(null);
  const outOfBoundSinceRef    = useRef<Date | null>(null);
  const alertShownRef         = useRef(false);
  const escalationSentRef     = useRef(false);  // prevent repeated manager notifications

  const stopMonitor = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const runCheck = useCallback(async () => {
    if (!config.active || !config.userId || !config.officeId) return;

    const gps = await getCurrentGPS();
    if (!gps) return;

    // Adaptive ping: determine if user is moving
    let isMoving = false;
    if (lastCoordsRef.current) {
      const moved = haversineM(
        lastCoordsRef.current.latitude, lastCoordsRef.current.longitude,
        gps.latitude, gps.longitude
      );
      isMoving = moved > MOVEMENT_THRESHOLD_M;
    }
    lastCoordsRef.current = gps;

    const minsOutside = outOfBoundSinceRef.current
      ? (Date.now() - outOfBoundSinceRef.current.getTime()) / 60000
      : 0;

    // Log heartbeat to DB
    const { status, distanceM } = await LocationService.logHeartbeat({
      userId: config.userId,
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracy: gps.accuracy,
      officeId: config.officeId,
      officeLat: config.officeLat,
      officeLon: config.officeLon,
      officeRadius: config.officeRadius,
      minsOutside,
    });

    if (status === "OUT_OF_BOUND" || status === "WARNING") {
      // Track how long they've been outside
      if (!outOfBoundSinceRef.current) {
        outOfBoundSinceRef.current = new Date();
      }

      // Auto-escalate after ESCALATION_MINS — only notify manager once
      if (minsOutside >= ESCALATION_MINS && !escalationSentRef.current) {
        escalationSentRef.current = true;
        await supabase.from("location_violations")
          .update({ escalated: true })
          .eq("user_id", config.userId)
          .eq("session_date", new Date().toISOString().split("T")[0])
          .is("resolved_at", null);

        // Notify manager
        const { data: profile } = await supabase
          .from("profiles")
          .select("name, reporting_manager_id")
          .eq("id", config.userId)
          .single();

        if (profile?.reporting_manager_id) {
          await supabase.from("notifications").insert({
            user_id: profile.reporting_manager_id,
            title: "🚨 Location Escalation",
            message: `${profile.name} has been outside ${config.officeName} for ${Math.round(minsOutside)} minutes.`,
            type: "location_violation",
          });
        }
      }

      // Show alert (only once per violation event)
      if (!alertShownRef.current) {
        alertShownRef.current = true;
        const distText = distanceM >= 1000
          ? `${(distanceM / 1000).toFixed(1)} km`
          : `${distanceM} m`;

        if (Platform.OS === "web" && typeof window !== "undefined") {
          const action = window.confirm(
            `⚠️ Location Alert\n\nYou are ${distText} outside ${config.officeName}.\n\nPlease return to your designated area.\n\nClick OK to acknowledge, or Cancel to Check Out.`
          );
          if (!action) {
            // Cancel = Check Out
            await LocationService.resolveViolation(config.userId, "checked_out");
            await config.onCheckOut?.();
          } else {
            await LocationService.acknowledgeViolation(config.userId);
          }
        } else {
          Alert.alert(
            "📍 Outside Designated Area",
            `You are ${distText} outside ${config.officeName}.\n\nPlease return to your designated area.`,
            [
              {
                text: "Check Out",
                style: "destructive",
                onPress: async () => {
                  await LocationService.resolveViolation(config.userId, "checked_out");
                  await config.onCheckOut?.();
                },
              },
              {
                text: "OK - I'll Return",
                onPress: async () => {
                  await LocationService.acknowledgeViolation(config.userId);
                },
              },
            ],
            { cancelable: false }
          );
        }
      }
    } else {
      // Back in zone — reset all flags
      if (outOfBoundSinceRef.current) {
        await LocationService.resolveViolation(config.userId, "returned");
        outOfBoundSinceRef.current = null;
        escalationSentRef.current = false;
      }
      alertShownRef.current = false;
    }

    // Adaptive interval: reschedule based on movement
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = setInterval(runCheck, isMoving ? INTERVAL_MOVING_MS : INTERVAL_STATIC_MS);
    }
  }, [config]);

  useEffect(() => {
    if (!config.active || !config.userId || !config.officeId) {
      stopMonitor();
      return;
    }

    // Start with moving interval, adapts after first check
    intervalRef.current = setInterval(runCheck, INTERVAL_MOVING_MS);

    return stopMonitor;
  }, [config.active, config.userId, config.officeId, runCheck, stopMonitor]);
}
