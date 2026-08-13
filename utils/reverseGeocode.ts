import * as Location from "expo-location";
import { Platform } from "react-native";

function formatAddress(value: Location.LocationGeocodedAddress) {
  return [
    value.name,
    value.street,
    value.district,
    value.city,
    value.region,
    value.postalCode,
    value.country,
  ]
    .filter((item, index, all) => item && all.indexOf(item) === index)
    .join(", ");
}

/** Reverse geocoding is best-effort; valid coordinates remain usable if it fails. */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    if (Platform.OS !== "web") {
      const rows = await Location.reverseGeocodeAsync({ latitude, longitude });
      return rows[0] ? formatAddress(rows[0]) : null;
    }

    // Google Geocoding is intentionally not called directly from the client. This
    // standards-based endpoint is used only for a display label; the server stores
    // and verifies the GPS coordinates independently.
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.display_name === "string" ? body.display_name : null;
  } catch {
    return null;
  }
}
