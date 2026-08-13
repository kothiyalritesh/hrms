import {
  Destination,
  DrivingRoute,
  RouteProgress,
  TrackingLocation,
} from "@/services/location/types";
import { haversineDistanceM } from "@/services/location/geo";

const ROUTES_ENDPOINT =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const REQUEST_TIMEOUT_MS = 12_000;

type Coordinate = { latitude: number; longitude: number };

function parseGoogleDuration(value: unknown) {
  if (typeof value !== "string" || !value.endsWith("s")) return null;
  const seconds = Number.parseFloat(value.slice(0, -1));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

export async function computeDrivingRoute(
  origin: Coordinate,
  destination: Destination,
  includePolyline = false,
): Promise<DrivingRoute | null> {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": includePolyline
          ? "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"
          : "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: origin.latitude,
              longitude: origin.longitude,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: destination.latitude,
              longitude: destination.longitude,
            },
          },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        polylineQuality: includePolyline ? "OVERVIEW" : undefined,
        computeAlternativeRoutes: false,
        languageCode: "en-IN",
        units: "METRIC",
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      routes?: {
        distanceMeters?: number;
        duration?: string;
        polyline?: { encodedPolyline?: string };
      }[];
    };
    const route = payload.routes?.[0];
    const distanceM = Number(route?.distanceMeters);
    const durationSeconds = parseGoogleDuration(route?.duration);
    if (
      !Number.isFinite(distanceM) ||
      distanceM < 0 ||
      durationSeconds == null
    ) {
      return null;
    }
    return {
      destinationJourneyId: destination.journeyId,
      distanceM: Math.round(distanceM),
      durationSeconds,
      calculatedAt: new Date().toISOString(),
      originLatitude: origin.latitude,
      originLongitude: origin.longitude,
      encodedPolyline: route?.polyline?.encodedPolyline ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function refreshIntervalMs(distanceM: number | null) {
  if (distanceM != null && distanceM <= 1_000) return 20_000;
  if (distanceM != null && distanceM <= 5_000) return 45_000;
  return 90_000;
}

export async function refreshRouteProgress(
  existing: RouteProgress | null | undefined,
  location: TrackingLocation,
  destination: Destination,
): Promise<RouteProgress | null> {
  const isSameJourney =
    existing?.destinationJourneyId === destination.journeyId;
  if (isSameJourney && existing) {
    const ageMs = Date.now() - Date.parse(existing.calculatedAt);
    const movedM = haversineDistanceM(
      existing.originLatitude,
      existing.originLongitude,
      location.latitude,
      location.longitude,
    );
    if (
      Number.isFinite(ageMs) &&
      ageMs >= 0 &&
      ageMs < refreshIntervalMs(existing.distanceM) &&
      movedM < 75
    ) {
      return existing;
    }
  }

  const route = await computeDrivingRoute(location, destination);
  if (!route) return isSameJourney ? (existing ?? null) : null;
  const { encodedPolyline: _encodedPolyline, ...progress } = route;
  return progress;
}

export function decodeGooglePolyline(encoded: string): Coordinate[] {
  const coordinates: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const values: number[] = [];
    for (let coordinateIndex = 0; coordinateIndex < 2; coordinateIndex += 1) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index <= encoded.length);
      values.push(result & 1 ? ~(result >> 1) : result >> 1);
    }
    latitude += values[0];
    longitude += values[1];
    coordinates.push({
      latitude: latitude / 100_000,
      longitude: longitude / 100_000,
    });
  }
  return coordinates;
}
