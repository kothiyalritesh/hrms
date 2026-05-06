import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { supabase } from "@/lib/supabase";

export const LOCATION_TRACKING_TASK = "background-location-tracking";

// Register the background task (must be called at top level, outside components)
TaskManager.defineTask(LOCATION_TRACKING_TASK, async ({ data, error }: any) => {
  if (error) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const loc = locations[0];
  if (!loc) return;

  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) return;

  await supabase.from("location_logs").insert({
    user_id: userId,
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    recorded_at: new Date(loc.timestamp).toISOString(),
  });
});

export const LocationTrackingService = {
  async requestPermissions(): Promise<boolean> {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== "granted") return false;
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    return bg === "granted";
  },

  async startTracking(): Promise<void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) throw new Error("Location permission denied");

    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
    if (isRunning) return;

    await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 60000,       // every 60 seconds
      distanceInterval: 50,      // or every 50 meters
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "RE HRMS",
        notificationBody: "Tracking your location during field visit",
        notificationColor: "#1E40AF",
      },
    });
  },

  async stopTracking(): Promise<void> {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK);
    }
  },

  async isTracking(): Promise<boolean> {
    return Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
  },
};
