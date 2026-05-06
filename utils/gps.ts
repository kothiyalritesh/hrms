import { Platform } from "react-native";
import * as Location from "expo-location";

export type GPSCoords = { latitude: number; longitude: number; accuracy: number };

/**
 * Gets current GPS position.
 * On web: uses native navigator.geolocation (most accurate, uses device GPS/WiFi/IP).
 * On native: uses expo-location.
 */
export async function getCurrentGPS(): Promise<GPSCoords | null> {
  if (Platform.OS === "web") {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy ?? 0,
          });
        },
        () => resolve(null),
        {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 60000,
        }
      );
    });
  }

  // Native (iOS / Android)
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? 0,
    };
  } catch {
    return null;
  }
}
