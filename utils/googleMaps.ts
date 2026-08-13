/**
 * Google Maps Distance Matrix utility.
 * - Web: uses Maps JS SDK DistanceMatrixService (no CORS)
 * - Native: uses REST API directly (no browser CORS restrictions)
 * Falls back to Haversine estimate if API unavailable.
 */

import { Platform } from "react-native";

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export type Coords = { latitude: number; longitude: number };

function haversineFallbackMinutes(from: Coords, to: Coords): number {
  const R = 6371;
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.latitude * Math.PI) / 180) *
      Math.cos((to.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const straightKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round((straightKm * 1.4 / 30) * 60);
}

export async function getDrivingMinutes(from: Coords, to: Coords): Promise<number> {
  if (!GOOGLE_API_KEY) return haversineFallbackMinutes(from, to);

  // Web: use Maps JS SDK — avoids CORS that blocks the REST JSON endpoint
  if (Platform.OS === "web" && typeof window !== "undefined" && (window as any).google?.maps) {
    return new Promise((resolve) => {
      try {
        const svc = new (window as any).google.maps.DistanceMatrixService();
        svc.getDistanceMatrix(
          {
            origins: [new (window as any).google.maps.LatLng(from.latitude, from.longitude)],
            destinations: [new (window as any).google.maps.LatLng(to.latitude, to.longitude)],
            travelMode: "DRIVING",
          },
          (res: any, status: string) => {
            if (status === "OK") {
              const el = res?.rows?.[0]?.elements?.[0];
              if (el?.status === "OK") { resolve(Math.round(el.duration.value / 60)); return; }
            }
            resolve(haversineFallbackMinutes(from, to));
          }
        );
      } catch { resolve(haversineFallbackMinutes(from, to)); }
    });
  }

  // Native: REST API has no CORS issue
  if (Platform.OS !== "web") {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/distancematrix/json` +
        `?origins=${from.latitude},${from.longitude}` +
        `&destinations=${to.latitude},${to.longitude}` +
        `&mode=driving&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      const element = json?.rows?.[0]?.elements?.[0];
      if (element?.status === "OK" && element?.duration?.value) {
        return Math.round(element.duration.value / 60);
      }
    } catch { /* fall through */ }
  }

  return haversineFallbackMinutes(from, to);
}
