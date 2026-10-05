// utils/googleGeolocation.ts
// Google Geolocation API — uses cell towers + WiFi + IP fallback
// Docs: https://developers.google.com/maps/documentation/geolocation/overview

const GEOLOCATE_URL = "https://www.googleapis.com/geolocation/v1/geolocate";
const MAPS_API_KEY  = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export type GeoCoords = { latitude: number; longitude: number; accuracy?: number; source: "gps" | "cell" | "wifi" | "ip" };

/**
 * Ask Google Geolocation API for location using cell towers + WiFi.
 * By default considerIp is FALSE — IP geolocation resolves to datacenter/VPN
 * locations on old PCs (we've seen South Africa, Singapore, etc.) which poisons
 * distance-mismatch alerts. Only pass considerIp:true if you have a specific
 * reason and understand the risk.
 */
export async function googleGeolocate(opts: { considerIp?: boolean } = {}): Promise<GeoCoords | null> {
  if (!MAPS_API_KEY) return null;
  const considerIp = opts.considerIp ?? false; // default OFF — IP = unreliable
  try {
    const res = await fetch(`${GEOLOCATE_URL}?key=${MAPS_API_KEY}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ considerIp }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.location?.lat) return null;
    const source = json.accuracy < 500 ? "cell" : considerIp ? "ip" : "cell";
    // Reject IP-sourced result when considerIp was false (shouldn't happen, but guard anyway)
    if (!considerIp && json.accuracy > 50000) return null;
    return {
      latitude:  json.location.lat,
      longitude: json.location.lng,
      accuracy:  json.accuracy,
      source,
    };
  } catch {
    return null;
  }
}

// ── Reverse geocoding (coords → human address) ─────────────────────────────────

// Simple in-memory cache so we don't re-hit the API for the same spot.
const _revCache = new Map<string, string>();

/**
 * Turn coordinates into a human-readable street address via Nominatim.
 * Works on web and native. Returns null on error.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = _revCache.get(key);
  if (cached) return cached;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const addr: string | undefined = json?.display_name;
    if (addr) _revCache.set(key, addr);
    return addr ?? null;
  } catch {
    return null;
  }
}

// ── Map URL helpers ────────────────────────────────────────────────────────────

/** Google Maps Static API image URL (for web embeds / img tags) */
export function googleStaticMapUrl(lat: number, lng: number, zoom = 16, size = "600x300"): string {
  return (
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${lat},${lng}` +
    `&zoom=${zoom}` +
    `&size=${size}` +
    `&scale=2` +
    `&maptype=roadmap` +
    `&markers=color:red%7C${lat},${lng}` +
    `&key=${MAPS_API_KEY}`
  );
}

/** Google Maps Embed API iframe URL */
export function googleEmbedMapUrl(lat: number, lng: number, zoom = 16): string {
  return (
    `https://www.google.com/maps/embed/v1/place` +
    `?key=${MAPS_API_KEY}` +
    `&q=${lat},${lng}` +
    `&zoom=${zoom}`
  );
}

/** Opens Google Maps in browser/app to the given coords */
export function googleMapsDeepLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Navigate (directions) deep link */
export function googleMapsNavLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** Google Maps Embed API directions iframe URL (origin → destination, driving) */
export function googleEmbedDirectionsUrl(
  oLat: number, oLng: number, dLat: number, dLng: number,
): string {
  return (
    `https://www.google.com/maps/embed/v1/directions` +
    `?key=${MAPS_API_KEY}` +
    `&origin=${oLat},${oLng}` +
    `&destination=${dLat},${dLng}` +
    `&mode=driving`
  );
}
