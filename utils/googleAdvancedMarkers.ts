export const HRMS_GOOGLE_MAP_ID =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

export function advancedMapOptions<T extends Record<string, unknown>>(
  options: T,
): T & { mapId: string } {
  return { ...options, mapId: HRMS_GOOGLE_MAP_ID };
}

export async function loadAdvancedMarkerLibrary(google: any) {
  if (!google?.maps?.importLibrary) {
    throw new Error("Google Maps advanced markers are unavailable");
  }
  return google.maps.importLibrary("marker");
}

export function markerCoordinate(position: any, axis: "lat" | "lng") {
  const value = position?.[axis];
  return typeof value === "function" ? value.call(position) : Number(value);
}
