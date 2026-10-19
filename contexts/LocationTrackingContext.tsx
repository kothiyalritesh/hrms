import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { locationTrackingCoordinator } from "@/services/location/LocationTrackingCoordinator";
import { TrackingHealth } from "@/services/location/types";
import { BusinessClockService } from "@/services/business-clock.service";
import { nativeBridge } from "@/services/nativeBridge/client";

interface LocationTrackingContextValue {
  health: TrackingHealth;
  refresh: () => Promise<TrackingHealth>;
  /** Restart tracking if it should run, then refresh health. Never throws. */
  recheck: () => Promise<TrackingHealth>;
  requestRequiredPermissions: (
    backgroundEducationAccepted: boolean,
  ) => Promise<TrackingHealth>;
  requiresBackgroundPermissionEducation: boolean;
}

const LocationTrackingContext =
  createContext<LocationTrackingContextValue | null>(null);

type BrowserLocationPermission = "granted" | "denied" | "prompt";

function reportTrackingError(error: unknown) {
  console.warn("[tracking] background re-check failed", error);
}

async function inspectBrowserLocationPermission(): Promise<{
  available: boolean;
  permission: BrowserLocationPermission;
}> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return { available: false, permission: "denied" };
  }
  try {
    const result = await navigator.permissions?.query({
      name: "geolocation",
    });
    if (result?.state) {
      return {
        available: true,
        permission: result.state as BrowserLocationPermission,
      };
    }
  } catch {
    // Safari and some embedded browsers do not expose geolocation permission
    // state. They can still request it with getCurrentPosition().
  }
  return { available: true, permission: "prompt" };
}

async function requestBrowserLocation() {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return null;
  }
  return new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 30_000,
      maximumAge: 0,
    });
  });
}

export function LocationTrackingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useAuth();
  const [health, setHealth] = useState(
    locationTrackingCoordinator.getTrackingHealth(),
  );
  useEffect(() => locationTrackingCoordinator.subscribe(setHealth), []);

  const refreshWebHealth = useCallback(
    async (grantedPosition?: GeolocationPosition | null) => {
      if (!user?.id) {
        const next = locationTrackingCoordinator.getTrackingHealth();
        setHealth(next);
        return next;
      }
      if (nativeBridge.isAvailable()) {
        try {
          const next = await nativeBridge.request<TrackingHealth>(
            "tracking.getStatus",
          );
          setHealth(next);
          return next;
        } catch {
          // The native activity can be recreated independently of the page.
          // Fall back to browser health until the bridge-ready event re-syncs.
        }
      }
      const businessDate = await BusinessClockService.getDate();
      const [permission, attendanceResult, destinationResult, lastPingResult] =
        await Promise.all([
          inspectBrowserLocationPermission(),
          supabase
            .from("attendance_logs")
            .select("id")
            .eq("user_id", user.id)
            .not("checkin_time", "is", null)
            .is("checkout_time", null)
            .order("checkin_time", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("field_visits")
            .select("project_name,location_name")
            .eq("user_id", user.id)
            .eq("date", businessDate)
            .in("status", ["PENDING", "IN_TRANSIT", "CHECKED_IN"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("location_tracking")
            .select("recorded_at,accuracy")
            .eq("user_id", user.id)
            .order("recorded_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      const openAttendance = attendanceResult.error
        ? null
        : attendanceResult.data;
      const permissionGranted =
        !!grantedPosition || permission.permission === "granted";
      const browserAvailable = permission.available;
      const next: TrackingHealth = {
        platformSupported: false,
        notificationsGranted: false,
        foregroundLocationGranted: permissionGranted,
        preciseLocationGranted: permissionGranted,
        backgroundLocationGranted: false,
        locationServicesEnabled: browserAvailable && permissionGranted,
        nativeTaskRegistered: false,
        nativeTaskActive: false,
        trackingActive: false,
        activeAttendanceId: openAttendance?.id ?? null,
        activeDestinationName: destinationResult.error
          ? null
          : destinationResult.data?.project_name ||
            destinationResult.data?.location_name ||
            null,
        journeyStatus: destinationResult.data ? "TRAVELLING" : "NO_DESTINATION",
        routeDistanceM: null,
        routeDurationSeconds: null,
        routeUpdatedAt: null,
        lastLocationAt:
          grantedPosition?.timestamp != null
            ? new Date(grantedPosition.timestamp).toISOString()
            : (lastPingResult.data?.recorded_at ?? null),
        lastAccuracyM:
          grantedPosition?.coords.accuracy ??
          lastPingResult.data?.accuracy ??
          null,
        warning:
          "Continuous and background tracking are unavailable in the web app. Use the installed Android app with foreground-service permissions.",
        warningCode: null,
        notificationHint: null,
        trackingExpected: !!openAttendance,
      };
      setHealth(next);
      return next;
    },
    [user],
  );

  useEffect(() => {
    if (!user?.id) {
      locationTrackingCoordinator.dispose();
      return;
    }
    let disposed = false;
    const reconcile = async () => {
      if (Platform.OS === "web") {
        try {
          if (!disposed && nativeBridge.isAvailable()) {
            await nativeBridge.request("tracking.restore").catch(() => undefined);
          }
        } finally {
          if (!disposed) await refreshWebHealth().catch(reportTrackingError);
        }
        return;
      }
      try {
        await locationTrackingCoordinator.restoreIfRequired();
      } catch (error) {
        reportTrackingError(error);
      } finally {
        // A failed restore must still publish fresh health, never a stale one.
        if (!disposed) {
          await locationTrackingCoordinator
            .refreshHealth()
            .catch(reportTrackingError);
        }
      }
    };

    if (Platform.OS === "web") {
      void reconcile();
    } else {
      void locationTrackingCoordinator
        .initialize({ id: user.id, name: user.name })
        .catch(reportTrackingError)
        .then(reconcile);
    }

    const attendanceChannel = supabase
      .channel(`tracking-attendance-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance_logs",
          filter: `user_id=eq.${user.id}`,
        },
        () => void reconcile(),
      )
      .subscribe();
    const visitChannel = supabase
      .channel(`tracking-visits-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "field_visits",
          filter: `user_id=eq.${user.id}`,
        },
        (payload: any) => {
          if (Platform.OS === "web") {
            if (nativeBridge.isAvailable()) {
              void nativeBridge
                .request("tracking.restore")
                .catch(() => undefined);
            }
            void refreshWebHealth();
            return;
          }
          const visit = payload.new;
          if (
            visit?.id &&
            ["PENDING", "IN_TRANSIT", "CHECKED_IN"].includes(visit.status)
          ) {
            void locationTrackingCoordinator
              .updateActiveDestination(visit.id)
              .catch(reportTrackingError);
          } else {
            void locationTrackingCoordinator
              .handleAppStateChange("active")
              .catch(reportTrackingError);
          }
        },
      )
      .subscribe();
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (Platform.OS === "web") {
          if (state === "active") void refreshWebHealth().catch(reportTrackingError);
        } else if (state === "active") {
          // handleAppStateChange refreshes health in its own finally block.
          void locationTrackingCoordinator
            .handleAppStateChange(state)
            .catch(reportTrackingError);
        }
      },
    );
    const interval = setInterval(() => void reconcile(), 2 * 60 * 1000);

    return () => {
      disposed = true;
      clearInterval(interval);
      appStateSubscription.remove();
      void supabase.removeChannel(attendanceChannel);
      void supabase.removeChannel(visitChannel);
    };
  }, [refreshWebHealth, user?.id, user?.name]);

  const refresh = useCallback(() => {
    if (Platform.OS === "web") return refreshWebHealth();
    return locationTrackingCoordinator.refreshHealth();
  }, [refreshWebHealth]);
  const recheck = useCallback(async (): Promise<TrackingHealth> => {
    if (Platform.OS === "web") {
      if (user?.id && nativeBridge.isAvailable()) {
        await nativeBridge.request("tracking.restore").catch(() => undefined);
      }
      return refreshWebHealth().catch((error) => {
        reportTrackingError(error);
        return locationTrackingCoordinator.getTrackingHealth();
      });
    }
    if (!user?.id) return locationTrackingCoordinator.getTrackingHealth();
    return locationTrackingCoordinator.recheck();
  }, [refreshWebHealth, user?.id]);
  const requestRequiredPermissions = useCallback(
    async (backgroundEducationAccepted: boolean) => {
      if (Platform.OS === "web") {
        if (nativeBridge.isAvailable()) {
          const next = await nativeBridge.request<TrackingHealth>(
            "tracking.requestPermissions",
            { backgroundEducationAccepted },
          );
          setHealth(next);
          await nativeBridge.request("tracking.restore").catch(() => undefined);
          return nativeBridge.request<TrackingHealth>("tracking.getStatus");
        }
        const position = await requestBrowserLocation();
        return refreshWebHealth(position);
      }
      return locationTrackingCoordinator.requestRequiredPermissions({
        backgroundEducationAccepted,
      });
    },
    [refreshWebHealth],
  );

  return (
    <LocationTrackingContext.Provider
      value={{
        health,
        refresh,
        recheck,
        requestRequiredPermissions,
        requiresBackgroundPermissionEducation:
          Platform.OS === "web" && nativeBridge.isAvailable()
            ? true
            : locationTrackingCoordinator.requiresBackgroundPermissionEducation(),
      }}
    >
      {children}
    </LocationTrackingContext.Provider>
  );
}

export function useLocationTracking() {
  const value = useContext(LocationTrackingContext);
  if (!value) {
    throw new Error(
      "useLocationTracking must be used inside LocationTrackingProvider",
    );
  }
  return value;
}
