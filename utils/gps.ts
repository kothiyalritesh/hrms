import { Platform } from "react-native";
import * as Location from "expo-location";

export type GPSCoords = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  mocked?: boolean;
  source?: string;
  capturedAt: string;
  provider: string;
};

export const DEFAULT_LOCATION_MAX_AGE_MS = 120_000;
export const DEFAULT_LOCATION_MAX_ACCURACY_M = 100;

export class GPSValidationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_COORDINATES"
      | "STALE_LOCATION"
      | "MOCK_LOCATION"
      | "POOR_ACCURACY"
      | "GPS_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "GPSValidationError";
  }
}

/** Coordinate validation intentionally accepts zero latitude/longitude. */
export function hasValidCoordinates(
  value: Pick<GPSCoords, "latitude" | "longitude">,
): boolean {
  return (
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

export function validateGPS(
  value: GPSCoords,
  options: {
    now?: number;
    maxAgeMs?: number;
    maxAccuracyM?: number;
    rejectMocked?: boolean;
  } = {},
): GPSCoords {
  if (!hasValidCoordinates(value)) {
    throw new GPSValidationError(
      "INVALID_COORDINATES",
      "The GPS reading contained invalid coordinates. Please try again.",
    );
  }
  const capturedAt = Date.parse(value.capturedAt);
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_LOCATION_MAX_AGE_MS;
  if (!Number.isFinite(capturedAt) || capturedAt > now + 10_000 || now - capturedAt > maxAgeMs) {
    throw new GPSValidationError(
      "STALE_LOCATION",
      "The GPS reading was stale. A new location is required.",
    );
  }
  if (options.rejectMocked !== false && value.mocked === true) {
    throw new GPSValidationError(
      "MOCK_LOCATION",
      "Mock location was detected. Disable fake-location apps and try again.",
    );
  }
  const accuracy = Number(value.accuracy);
  const maxAccuracyM =
    options.maxAccuracyM ?? DEFAULT_LOCATION_MAX_ACCURACY_M;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > maxAccuracyM) {
    throw new GPSValidationError(
      "POOR_ACCURACY",
      `GPS accuracy must be ${maxAccuracyM} metres or better. Move outdoors and try again.`,
    );
  }
  return value;
}

/**
 * Captures independent current-position samples and returns the most accurate
 * fresh fix. The provider call always requests maximumAge=0/current position.
 */
export async function getBestFreshGPS(options: {
  maxSamples?: number;
  preferredAccuracyM?: number;
  maxAccuracyM?: number;
  maxAgeMs?: number;
} = {}): Promise<GPSCoords> {
  const maxSamples = Math.max(1, Math.min(options.maxSamples ?? 3, 3));
  const preferredAccuracyM = options.preferredAccuracyM ?? 30;
  const candidates: GPSCoords[] = [];
  let lastError: unknown;
  const deadline = Date.now() + 15_000;

  for (let sample = 0; sample < maxSamples; sample += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    try {
      const reading = await Promise.race([
        getCurrentGPS(),
        new Promise<null>((resolve) =>
          setTimeout(resolve, Math.min(5_000, remainingMs)),
        ),
      ]);
      if (!reading) {
        lastError = new GPSValidationError("GPS_UNAVAILABLE", gpsFailureMessage());
      } else {
        const reportedAccuracy = Number(reading.accuracy);
        if (!Number.isFinite(reportedAccuracy) || reportedAccuracy < 0) {
          throw new GPSValidationError(
            "POOR_ACCURACY",
            "GPS did not provide a usable accuracy estimate. Enable precise location and try again.",
          );
        }
        // Validate everything except the configured final accuracy threshold so
        // a later sample can replace a weak reading.
        validateGPS(reading, {
          maxAgeMs: options.maxAgeMs,
          maxAccuracyM: Number.POSITIVE_INFINITY,
        });
        candidates.push(reading);
        if (Number(reading.accuracy) <= preferredAccuracyM) break;
      }
    } catch (error) {
      lastError = error;
      if (error instanceof GPSValidationError && error.code === "MOCK_LOCATION") {
        throw error;
      }
    }
  }

  const best = candidates.sort(
    (left, right) => Number(left.accuracy) - Number(right.accuracy),
  )[0];
  if (!best) {
    if (lastError instanceof Error) throw lastError;
    throw new GPSValidationError(
      "GPS_UNAVAILABLE",
      "A fresh GPS reading could not be obtained. Check location permission and try again.",
    );
  }
  return validateGPS(best, {
    maxAgeMs: options.maxAgeMs,
    maxAccuracyM: options.maxAccuracyM,
  });
}

/** Why the most recent getCurrentGPS() call returned no location. */
export type GpsFailureCode =
  | "PERMISSION_DENIED"
  | "SERVICES_OFF"
  | "POSITION_UNAVAILABLE"
  | "TIMEOUT"
  | "OUT_OF_REGION"
  | "INSECURE_CONTEXT"
  | "UNSUPPORTED"
  | "UNKNOWN";

let lastGpsFailure: { code: GpsFailureCode; at: number } | null = null;
function failed(code: GpsFailureCode): null {
  lastGpsFailure = { code, at: Date.now() };
  return null;
}

/** Reason for the last failed getCurrentGPS() call (null if it succeeded or is old). */
export function getLastGpsFailure(): GpsFailureCode | null {
  return lastGpsFailure && Date.now() - lastGpsFailure.at < 60_000 ? lastGpsFailure.code : null;
}

const GPS_FAILURE_MESSAGES: Record<GpsFailureCode, string> = {
  PERMISSION_DENIED:
    "Location permission is off for HRMS. Allow location (precise) for HRMS in your phone or browser settings, then try again.",
  SERVICES_OFF:
    "Your phone's location (GPS) is turned off. Turn on Location in the quick settings and try again.",
  POSITION_UNAVAILABLE:
    "Your device could not find a GPS signal. Move near a window or outdoors and try again.",
  TIMEOUT:
    "Getting your location took too long (weak GPS signal). Move outdoors or near a window and try again.",
  OUT_OF_REGION:
    "Your location reading looks wrong (outside India). Turn off any fake-GPS or VPN app and try again.",
  INSECURE_CONTEXT:
    "Location only works on the secure HRMS address (https://). Open HRMS from the official link.",
  UNSUPPORTED:
    "This browser cannot share location. Use the HRMS app or a current version of Chrome.",
  UNKNOWN:
    "Your location could not be read. Check that location is on and allowed for HRMS, then try again.",
};

/** A specific, user-facing reason for the last failed location attempt. */
export function gpsFailureMessage(code: GpsFailureCode | null = getLastGpsFailure()): string {
  return GPS_FAILURE_MESSAGES[code ?? "UNKNOWN"];
}

const INDIA = { latMin: 6.5, latMax: 37.6, lonMin: 68.0, lonMax: 97.5 };
function inIndia(lat: number, lon: number) {
  return (
    lat >= INDIA.latMin &&
    lat <= INDIA.latMax &&
    lon >= INDIA.lonMin &&
    lon <= INDIA.lonMax
  );
}

/**
 * Get current position.
 * - Native/APK: Median bridge → Expo Location
 * - Web: navigator.geolocation with enableHighAccuracy (real GPS on mobile browsers,
 *   WiFi triangulation on desktop). googleGeolocate is NOT used here because in a
 *   browser context it has no cell/WiFi data, so Google falls back to IP geolocation
 *   which resolves to the ISP datacenter — easily 500–2000m from actual location.
 */
export async function getCurrentGPS(): Promise<GPSCoords | null> {
  lastGpsFailure = null;
  // ── Native: Median APK bridge ──────────────────────────────────────────────
  if (
    typeof window !== "undefined" &&
    (typeof (window as any).median !== "undefined" ||
      typeof (window as any).gonative !== "undefined")
  ) {
    const { medianRequestLocation } = await import("@/utils/medianBridge");
    const pos = await medianRequestLocation();
    if (!pos) failed("TIMEOUT");
    if (pos && Number.isFinite(Number(pos.accuracy)))
      return {
        ...pos,
        source: "app",
        provider: "median-native-bridge",
        capturedAt: pos.capturedAt ?? new Date().toISOString(),
      };
  }

  // ── Native: Expo Location ──────────────────────────────────────────────────
  if (Platform.OS !== "web") {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return failed("PERMISSION_DENIED");
      const servicesOn = await Location.hasServicesEnabledAsync().catch(() => true);
      if (!servicesOn) return failed("SERVICES_OFF");
      {
        // A current, highest-accuracy fix is required for field-visit evidence.
        // getCurrentPositionAsync does not use Expo's last-known cached position API.
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        });
        const { latitude, longitude, accuracy } = loc.coords;
        if (inIndia(latitude, longitude)) {
          return {
            latitude,
            longitude,
            accuracy,
            mocked: loc.mocked ?? false,
            source: "app",
            provider: "expo-location",
            capturedAt: new Date(loc.timestamp).toISOString(),
          };
        }
        return failed("OUT_OF_REGION");
      }
    } catch (error: any) {
      const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
      if (/services|disabled|provider/i.test(text)) return failed("SERVICES_OFF");
      if (/timeout|timed out/i.test(text)) return failed("TIMEOUT");
      if (/permission|denied|unauthori/i.test(text)) return failed("PERMISSION_DENIED");
      return failed("POSITION_UNAVAILABLE");
    }
  }

  // ── Web: browser navigator.geolocation (primary — real GPS on mobile browsers) ──
  // Do NOT use googleGeolocate here — in a browser context it has no WiFi/cell
  // data to send, so Google falls back to IP geolocation which can be 500–2000m
  // off (ISP datacenter, not the user's actual location).
  // navigator.geolocation with enableHighAccuracy uses the device GPS chip on
  // mobile browsers, and WiFi triangulation on desktops — both far more accurate.
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      return failed("INSECURE_CONTEXT");
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return failed("UNSUPPORTED");
    }
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      let reason: GpsFailureCode = "TIMEOUT";
      const fromError = (err: GeolocationPositionError | null | undefined): GpsFailureCode =>
        err?.code === 1 ? "PERMISSION_DENIED" : err?.code === 2 ? "POSITION_UNAVAILABLE" : "TIMEOUT";
      const pos = await new Promise<GPSCoords | null>((resolve) => {
        let done = false;
        const finish = (result: GPSCoords | null) => {
          if (done) return;
          done = true;
          resolve(result);
        };
        // Try getCurrentPosition first (fast path)
        navigator.geolocation.getCurrentPosition(
          (p) =>
            finish({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy: p.coords.accuracy,
              source: "web",
              provider: "browser-geolocation",
              capturedAt: new Date(p.timestamp).toISOString(),
            }),
          (firstError) => {
            reason = fromError(firstError);
            // Denied: retrying cannot succeed, so tell the user right away.
            if (reason === "PERMISSION_DENIED") {
              finish(null);
              return;
            }
            // Safari sometimes needs watchPosition — getCurrentPosition silently times out
            const wid = navigator.geolocation.watchPosition(
              (p) => {
                navigator.geolocation.clearWatch(wid);
                finish({
                  latitude: p.coords.latitude,
                  longitude: p.coords.longitude,
                  accuracy: p.coords.accuracy,
                  source: "web",
                  provider: "browser-geolocation",
                  capturedAt: new Date(p.timestamp).toISOString(),
                });
              },
              (watchError) => {
                reason = fromError(watchError);
                navigator.geolocation.clearWatch(wid);
                finish(null);
              },
              { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
            );
            setTimeout(() => {
              navigator.geolocation.clearWatch(wid);
              finish(null);
            }, 15000);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        );
        setTimeout(() => finish(null), 20000);
      });
      if (pos && inIndia(pos.latitude, pos.longitude)) return pos;
      if (pos) return pos; // outside India bounds but still valid (return it, let caller decide)
      return failed(reason);
    }
  }

  return failed(getLastGpsFailure() ?? "UNKNOWN");
}
