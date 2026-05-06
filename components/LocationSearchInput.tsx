import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import MapPickerModal from "@/components/MapPickerModal";

export interface PlaceResult {
  displayName: string;
  latitude: number;
  longitude: number;
  type: string;
}

interface RichResult extends PlaceResult {
  distM?: number;
}

interface Props {
  label: string;
  value: string;
  onSelect: (place: PlaceResult) => void;
  onChange?: (text: string) => void;
  placeholder?: string;
  required?: boolean;
}

// ── Mappls (MapmyIndia) credentials ──────────────────────────────────────────
const MAPPLS_CLIENT_ID = process.env.EXPO_PUBLIC_MAPPLS_CLIENT_ID || "";
const MAPPLS_CLIENT_SECRET = process.env.EXPO_PUBLIC_MAPPLS_CLIENT_SECRET || "";
const MAPPLS_REST_KEY = process.env.EXPO_PUBLIC_MAPPLS_REST_KEY || "";

// Optional extras
const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || "";
const TOMTOM_KEY = process.env.EXPO_PUBLIC_TOMTOM_KEY || "";

const H = { "Accept-Language": "en", "User-Agent": "RealtyHRMS/1.0" };

// ── Mappls OAuth2 token cache ─────────────────────────────────────────────────
// Mappls endpoints block CORS on web — proxy via metro dev-server middleware
const IS_WEB = Platform.OS === "web";

// On web: route through local proxy to bypass CORS
// /mappls-api/* → https://atlas.mappls.com/api/*
// /mappls-auth/* → https://outpost.mappls.com/api/*
const MAPPLS_PLACES_BASE = IS_WEB
  ? "/mappls-api/places"
  : "https://atlas.mappls.com/api/places";
const MAPPLS_AUTH_BASE = IS_WEB
  ? "/mappls-auth/security/oauth"
  : "https://outpost.mappls.com/api/security/oauth";

// ── Debug logger (web + __DEV__ only) ────────────────────────────────────────
const DBG = IS_WEB && typeof __DEV__ !== "undefined" && __DEV__;
function dbgGroup(label: string) { if (DBG) console.group(`%c[MapmyIndia] ${label}`, "color:#60045d;font-weight:bold"); }
function dbgEnd() { if (DBG) console.groupEnd(); }
function dbgLog(...args: any[]) { if (DBG) console.log(...args); }
function dbgWarn(...args: any[]) { if (DBG) console.warn(...args); }
function dbgTable(data: any) { if (DBG && Array.isArray(data) && data.length) console.table(data); }
let _mapplsToken = "";
let _mapplsTokenExpiry = 0;

async function getMapplsToken(): Promise<string> {
  if (_mapplsToken && Date.now() < _mapplsTokenExpiry) return _mapplsToken;
  if (!MAPPLS_CLIENT_ID || !MAPPLS_CLIENT_SECRET) return "";
  try {
    const res = await fetch(`${MAPPLS_AUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(MAPPLS_CLIENT_ID)}&client_secret=${encodeURIComponent(MAPPLS_CLIENT_SECRET)}`,
    });
    const data = await res.json();
    if (data.access_token) {
      _mapplsToken = data.access_token;
      _mapplsTokenExpiry = Date.now() + ((data.expires_in || 86400) - 60) * 1000;
      return _mapplsToken;
    }
  } catch {}
  return "";
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function fmtDist(m: number) {
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

function getTypeIcon(type: string): any {
  if (/hotel|lodge|resort|inn|guest/i.test(type)) return "coffee";
  if (/hospital|clinic|pharmacy|health/i.test(type)) return "activity";
  if (/school|college|university/i.test(type)) return "book";
  if (/restaurant|cafe|food|fast_food/i.test(type)) return "coffee";
  if (/road|street|highway/i.test(type)) return "navigation";
  if (/residential|house|apartment|flat|society/i.test(type)) return "home";
  if (/commercial|office|shop|mall|market/i.test(type)) return "briefcase";
  return "map-pin";
}

// ── Source 1 (PRIMARY): Mappls Autosuggest ─────────────────────────────────
async function fromMapplsAutosuggest(q: string, uLat?: number, uLon?: number): Promise<RichResult[]> {
  if (IS_WEB) {
    // On web: use REST key via proxy (OAuth token not needed)
    return fromMapplsRestKeyWeb(q, uLat, uLon);
  }
  const token = await getMapplsToken();
  if (!token) return fromMapplsRestKey(q, uLat, uLon);
  const loc = uLat != null ? `&location=${uLat},${uLon}` : "";
  try {
    const url = `${MAPPLS_PLACES_BASE}/search/json?query=${encodeURIComponent(q)}&region=IND${loc}`;
    const res = await fetch(url, {
      headers: { ...H, Authorization: `Bearer ${token}` } as HeadersInit,
    });
    const data = await res.json();
    const items = data.suggestedLocations || data.results || [];
    return items.map((p: any) => {
      const lat = parseFloat(p.latitude || p.lat || "0");
      const lon = parseFloat(p.longitude || p.lng || p.lon || "0");
      if (!lat || !lon) return null;
      const name = p.placeName || p.placeAddress || p.name || q;
      const addr = p.placeAddress || p.address || "";
      return {
        displayName: addr && addr !== name ? `${name}, ${addr}` : name,
        latitude: lat, longitude: lon,
        type: p.type || p.orderIndex || "place",
        distM: uLat != null ? haversineM(uLat, uLon!, lat, lon) : undefined,
      } as RichResult;
    }).filter(Boolean) as RichResult[];
  } catch { return []; }
}

// ── Source 1c: Mappls REST key — web via proxy ──────────────────────────
async function fromMapplsRestKeyWeb(q: string, uLat?: number, uLon?: number): Promise<RichResult[]> {
  if (!MAPPLS_REST_KEY) {
    dbgWarn("[MapmyIndia] REST key not set (EXPO_PUBLIC_MAPPLS_REST_KEY). Skipping Mappls on web.");
    return [];
  }
  const loc = uLat != null ? `&location=${uLat},${uLon}` : "";
  const url = `${MAPPLS_PLACES_BASE}/search/json?query=${encodeURIComponent(q)}&region=IND${loc}&rest_key=${MAPPLS_REST_KEY}`;
  dbgGroup(`Autosuggest (web/proxy) — "${q}"`);
  dbgLog("🌐 URL:", url);
  dbgLog("📍 GPS bias:", uLat != null ? `${uLat}, ${uLon}` : "none");
  try {
    const res = await fetch(url);
    dbgLog("📶 HTTP status:", res.status, res.statusText);
    const data = await res.json();
    dbgLog("📦 Raw response:", data);
    const items = data.suggestedLocations || data.results || [];
    dbgLog(`✅ Items found: ${items.length}`);
    if (items.length) dbgTable(items.map((p: any) => ({ placeName: p.placeName, placeAddress: p.placeAddress, latitude: p.latitude, longitude: p.longitude, type: p.type })));
    else dbgWarn("⚠️ No items in suggestedLocations/results. Full response above.");
    dbgEnd();
    return items.map((p: any) => {
      const lat = parseFloat(p.latitude || p.lat || "0");
      const lon = parseFloat(p.longitude || p.lng || p.lon || "0");
      if (!lat || !lon) return null;
      const name = p.placeName || p.placeAddress || p.name || q;
      const addr = p.placeAddress || p.address || "";
      return {
        displayName: addr && addr !== name ? `${name}, ${addr}` : name,
        latitude: lat, longitude: lon,
        type: p.type || "place",
        distM: uLat != null ? haversineM(uLat, uLon!, lat, lon) : undefined,
      } as RichResult;
    }).filter(Boolean) as RichResult[];
  } catch (e) {
    dbgWarn("❌ Fetch error:", e);
    dbgEnd();
    return [];
  }
}

// ── Source 1b: Mappls via REST key (native only) ─────────────────────────────
async function fromMapplsRestKey(q: string, uLat?: number, uLon?: number): Promise<RichResult[]> {
  if (IS_WEB || !MAPPLS_REST_KEY) return [];
  const loc = uLat != null ? `&location=${uLat},${uLon}` : "";
  try {
    const url = `${MAPPLS_PLACES_BASE}/search/json?query=${encodeURIComponent(q)}&region=IND${loc}&rest_key=${MAPPLS_REST_KEY}`;
    const res = await fetch(url, { headers: H });
    const data = await res.json();
    const items = data.suggestedLocations || data.results || [];
    return items.map((p: any) => {
      const lat = parseFloat(p.latitude || p.lat || "0");
      const lon = parseFloat(p.longitude || p.lng || p.lon || "0");
      if (!lat || !lon) return null;
      const name = p.placeName || p.placeAddress || p.name || q;
      const addr = p.placeAddress || p.address || "";
      return {
        displayName: addr && addr !== name ? `${name}, ${addr}` : name,
        latitude: lat, longitude: lon,
        type: p.type || "place",
        distM: uLat != null ? haversineM(uLat, uLon!, lat, lon) : undefined,
      } as RichResult;
    }).filter(Boolean) as RichResult[];
  } catch { return []; }
}

// ── Source 2: Mappls Nearby Search ───────────────────────────────────────
async function fromMapplsNearby(q: string, uLat?: number, uLon?: number): Promise<RichResult[]> {
  if (!uLat || !uLon) return [];
  if (IS_WEB && !MAPPLS_REST_KEY) {
    dbgWarn("[MapmyIndia] Nearby skipped — no REST key.");
    return [];
  }
  const token = IS_WEB ? "" : await getMapplsToken();
  if (!IS_WEB && !token && !MAPPLS_REST_KEY) return [];
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
  const keyParam = !token && MAPPLS_REST_KEY ? `&rest_key=${MAPPLS_REST_KEY}` : "";
  const url = `${MAPPLS_PLACES_BASE}/nearby/json?keywords=${encodeURIComponent(q)}&refLocation=${uLat},${uLon}&radius=50000&region=IND${keyParam}`;
  if (IS_WEB) {
    dbgGroup(`Nearby (web/proxy) — "${q}"`);
    dbgLog("🌐 URL:", url);
    dbgLog("📍 refLocation:", `${uLat}, ${uLon}`);
  }
  try {
    const res = await fetch(url, { headers: { ...H, ...authHeader } as HeadersInit });
    if (IS_WEB) dbgLog("📶 HTTP status:", res.status, res.statusText);
    const data = await res.json();
    if (IS_WEB) {
      dbgLog("📦 Raw response:", data);
      const items = data.suggestedLocations || data.nearbyPlaces || [];
      dbgLog(`✅ Items found: ${items.length}`);
      if (items.length) dbgTable(items.map((p: any) => ({ placeName: p.placeName, placeAddress: p.placeAddress, latitude: p.latitude, longitude: p.longitude, type: p.type, distance: p.distance })));
      else dbgWarn("⚠️ No items in suggestedLocations/nearbyPlaces. Full response above.");
      dbgEnd();
    }
    const items = data.suggestedLocations || data.nearbyPlaces || [];
    return items.map((p: any) => {
      const lat = parseFloat(p.latitude || p.lat || "0");
      const lon = parseFloat(p.longitude || p.lng || p.lon || "0");
      if (!lat || !lon) return null;
      const name = p.placeName || p.name || q;
      const addr = p.placeAddress || p.address || "";
      return {
        displayName: addr && addr !== name ? `${name}, ${addr}` : name,
        latitude: lat, longitude: lon,
        type: p.type || "place",
        distM: uLat != null ? haversineM(uLat, uLon!, lat, lon) : undefined,
      } as RichResult;
    }).filter(Boolean) as RichResult[];
  } catch (e) {
    if (IS_WEB) { dbgWarn("❌ Fetch error:", e); dbgEnd(); }
    return [];
  }
}

// ── Source 3: Google Maps Places (optional, best global coverage) ─────────────
async function fromGoogleMaps(q: string, uLat?: number, uLon?: number): Promise<RichResult[]> {
  if (!GMAPS_KEY) return [];
  const location = uLat != null ? `&location=${uLat},${uLon}&radius=50000` : "";
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q + " India")}&key=${GMAPS_KEY}${location}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.results || []).map((p: any) => ({
      displayName: p.formatted_address ? `${p.name}, ${p.formatted_address}` : p.name,
      latitude: p.geometry.location.lat,
      longitude: p.geometry.location.lng,
      type: p.types?.[0] || "place",
      distM: uLat != null ? haversineM(uLat, uLon!, p.geometry.location.lat, p.geometry.location.lng) : undefined,
    }));
  } catch { return []; }
}

// ── Source 4: Overpass — GPS-only (all-India bbox causes 504 timeouts) ────────
async function fromOverpass(q: string, uLat?: number, uLon?: number): Promise<RichResult[]> {
  if (!uLat || !uLon) return []; // skip without GPS to avoid 504
  const bbox = `(${uLat - 0.6},${uLon - 0.6},${uLat + 0.6},${uLon + 0.6})`;
  const esc = q.replace(/"/g, "\\\"");
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const partial = words.slice(0, 2).join(" ").replace(/"/g, "\\\"");
  const overpassQ = `[out:json][timeout:8];
(
  node["name"~"${esc}",i]${bbox};
  way["name"~"${esc}",i]${bbox};
  ${partial !== esc ? `node["name"~"${partial}",i]${bbox}; way["name"~"${partial}",i]${bbox};` : ""}
  node["brand"~"${esc}",i]${bbox};
  way["brand"~"${esc}",i]${bbox};
);
out center 20;`;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", body: overpassQ,
      headers: { "Content-Type": "text/plain" },
    });
    const data = await res.json();
    return (data.elements || []).map((el: any) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!lat || !lon) return null;
      const name = el.tags?.name || el.tags?.brand || q;
      const addr = [el.tags?.["addr:suburb"], el.tags?.["addr:city"], el.tags?.["addr:state"]].filter(Boolean).join(", ");
      return {
        displayName: addr ? `${name}, ${addr}` : name,
        latitude: lat, longitude: lon,
        type: el.tags?.amenity || el.tags?.building || el.tags?.landuse || el.tags?.shop || "place",
        distM: uLat != null ? haversineM(uLat, uLon!, lat, lon) : undefined,
      } as RichResult;
    }).filter(Boolean) as RichResult[];
  } catch { return []; }
}

// ── Source 5: Photon (Komoot) — India-filtered, dual queries ─────────────────
async function fromPhoton(q: string, uLat?: number, uLon?: number): Promise<RichResult[]> {
  const bias = uLat != null ? `&lat=${uLat}&lon=${uLon}` : "";
  const urls = [
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en${bias}`,
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q + " India")}&limit=8&lang=en${bias}`,
  ];
  try {
    const settled = await Promise.allSettled(urls.map((u) => fetch(u, { headers: H }).then((r) => r.json())));
    const seen = new Set<string>();
    const out: RichResult[] = [];
    for (const r of settled) {
      if (r.status !== "fulfilled") continue;
      for (const f of (r.value.features || [])) {
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties;
        if (p.countrycode && p.countrycode.toLowerCase() !== "in") continue;
        const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const name = [p.name, p.street, p.city, p.state].filter(Boolean).join(", ");
        out.push({ displayName: name || p.name || "Unknown", latitude: lat, longitude: lon, type: p.osm_value || p.type || "place", distM: uLat != null ? haversineM(uLat, uLon!, lat, lon) : undefined });
      }
    }
    return out;
  } catch { return []; }
}

// ── Source 6: Nominatim — 3 strategies ───────────────────────────────────────
async function fromNominatim(q: string, uLat?: number, uLon?: number): Promise<RichResult[]> {
  const prox = uLat != null ? `&lat=${uLat}&lon=${uLon}` : "";
  const vb = uLat != null ? `&viewbox=${uLon! - 0.4},${uLat! + 0.4},${uLon! + 0.4},${uLat! - 0.4}&bounded=0` : "";
  const variants = [
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=10&countrycodes=in&extratags=1&namedetails=1${prox}`,
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + " India")}&format=json&addressdetails=1&limit=8&countrycodes=in${prox}`,
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=8&countrycodes=in${vb}`,
  ];
  const settled = await Promise.allSettled(variants.map((u) => fetch(u, { headers: H }).then((r) => r.json())));
  const seen = new Set<string>();
  const out: RichResult[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const key = String(item.osm_id || `${item.lat},${item.lon}`);
      if (seen.has(key)) continue;
      seen.add(key);
      const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
      out.push({ displayName: item.display_name, latitude: lat, longitude: lon, type: item.type || item.class || "place", distM: uLat != null ? haversineM(uLat, uLon!, lat, lon) : undefined });
    }
  }
  return out;
}

// ── Source 7: TomTom (optional free key) ─────────────────────────────────────
async function fromTomTom(q: string, uLat?: number, uLon?: number): Promise<RichResult[]> {
  if (!TOMTOM_KEY) return [];
  const center = uLat != null ? `&lat=${uLat}&lon=${uLon}&radius=50000` : "";
  try {
    const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${TOMTOM_KEY}&countrySet=IN&limit=10&language=en-GB${center}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.results || []).map((r: any) => {
      const lat = r.position?.lat, lon = r.position?.lon;
      if (!lat || !lon) return null;
      const name = r.poi?.name || r.address?.freeformAddress || q;
      const addr = r.address?.freeformAddress || "";
      return {
        displayName: addr && addr !== name ? `${name}, ${addr}` : name,
        latitude: lat, longitude: lon,
        type: r.poi?.categories?.[0] || r.type || "place",
        distM: uLat != null ? haversineM(uLat, uLon!, lat, lon) : undefined,
      } as RichResult;
    }).filter(Boolean) as RichResult[];
  } catch { return []; }
}

function useDebounce(fn: (...args: any[]) => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback((...args: any[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

export default function LocationSearchInput({ label, value, onSelect, onChange, placeholder, required }: Props) {
  const [query, setQuery] = useState(value || "");
  const [results, setResults] = useState<RichResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selected, setSelected] = useState(false);
  const [userGps, setUserGps] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number; name: string } | null>(null);

  // Pre-fetch Mappls token on mount (works on both native and web via proxy)
  useEffect(() => { getMapplsToken(); }, []);

  useEffect(() => {
    if (Platform.OS === "web") {
      navigator.geolocation?.getCurrentPosition(
        (p) => setUserGps({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
        () => {},
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
      );
    } else {
      import("expo-location").then(async (Location) => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== "granted") return;
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserGps({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        } catch {}
      });
    }
  }, []);

  const search = async (text: string) => {
    const q = text.trim();
    if (q.length < 2) { setResults([]); setShowResults(false); return; }
    setLoading(true);
    try {
      const uLat = userGps?.latitude;
      const uLon = userGps?.longitude;

      if (DBG) console.group(`%c[MapmyIndia] Search — "${q}"`, "color:#60045d;font-weight:bold;font-size:13px");
      if (DBG) console.log("📍 GPS:", uLat != null ? `${uLat}, ${uLon}` : "unavailable");

      // Mappls runs first (primary), rest in parallel as fallback/supplement
      const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
        fromMapplsAutosuggest(q, uLat, uLon),  // PRIMARY — India's own map data (web: REST key)
        fromMapplsNearby(q, uLat, uLon),        // Mappls nearby (GPS-aware, web: REST key)
        fromGoogleMaps(q, uLat, uLon),          // Google (if key set)
        fromTomTom(q, uLat, uLon),              // TomTom (if key set)
        fromOverpass(q, uLat, uLon),            // Raw OSM tags
        fromPhoton(q, uLat, uLon),              // Fuzzy OSM
        fromNominatim(q, uLat, uLon),           // OSM geocoder
      ]);

      if (DBG) {
        console.log("📊 Source counts:", {
          "Mappls Autosuggest": r1.length,
          "Mappls Nearby": r2.length,
          "Google Maps": r3.length,
          "TomTom": r4.length,
          "Overpass": r5.length,
          "Photon": r6.length,
          "Nominatim": r7.length,
        });
      }

      // Mappls results first, then supplement with others
      const seen = new Set<string>();
      const merged: RichResult[] = [];
      for (const place of [...r1, ...r2, ...r3, ...r4, ...r5, ...r6, ...r7]) {
        if (!place.latitude || !place.longitude) continue;
        const gridKey = `${(place.latitude * 700).toFixed(0)},${(place.longitude * 700).toFixed(0)}`;
        if (seen.has(gridKey)) continue;
        seen.add(gridKey);
        merged.push(place);
      }

      if (uLat != null) merged.sort((a, b) => (a.distM ?? Infinity) - (b.distM ?? Infinity));

      if (DBG) {
        console.log(`🏁 Merged total: ${merged.length} (showing top 15)`);
        if (merged.length) console.table(merged.slice(0, 15).map((r) => ({ displayName: r.displayName, lat: r.latitude, lon: r.longitude, type: r.type, dist: r.distM != null ? `${r.distM}m` : "—" })));
        console.groupEnd();
      }

      setResults(merged.slice(0, 15));
      setShowResults(merged.length > 0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const debouncedSearch = useDebounce(search, 400);

  const handleChange = (text: string) => {
    setQuery(text);
    setSelected(false);
    onChange?.(text);
    debouncedSearch(text);
  };

  const handleSelect = (place: RichResult) => {
    const shortName = place.displayName.split(",")[0].trim();
    setQuery(shortName);
    setResults([]);
    setShowResults(false);
    setSelected(true);
    setMapCenter({ lat: place.latitude, lon: place.longitude, name: shortName });
    onSelect({ ...place, displayName: shortName });
  };

  // Open map — if nothing selected yet, geocode the current query first
  const handleOpenMap = async () => {
    if (mapCenter) { setShowMap(true); return; }
    const q = query.trim();
    if (!q) {
      // Default to user GPS or India centre
      const lat = userGps?.latitude ?? 20.5937;
      const lon = userGps?.longitude ?? 78.9629;
      setMapCenter({ lat, lon, name: q || "India" });
      setShowMap(true);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + " India")}&format=json&limit=1&countrycodes=in`,
        { headers: { "Accept-Language": "en", "User-Agent": "RealtyHRMS/1.0" } }
      );
      const data = await res.json();
      if (data?.[0]) {
        setMapCenter({ lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), name: data[0].display_name?.split(",")[0] || q });
      } else {
        setMapCenter({ lat: userGps?.latitude ?? 28.6139, lon: userGps?.longitude ?? 77.209, name: q });
      }
    } catch {
      setMapCenter({ lat: userGps?.latitude ?? 28.6139, lon: userGps?.longitude ?? 77.209, name: q });
    }
    setLoading(false);
    setShowMap(true);
  };

  const subText = (r: RichResult) => r.displayName.split(",").slice(1, 4).join(",").trim();

  return (
    <View style={s.wrap}>
      {mapCenter && (
        <MapPickerModal
          visible={showMap}
          initialLat={mapCenter.lat}
          initialLon={mapCenter.lon}
          initialName={mapCenter.name}
          onClose={() => setShowMap(false)}
          onConfirm={(result) => {
            setShowMap(false);
            const name = result.displayName || query;
            setQuery(name);
            setSelected(true);
            setMapCenter({ lat: result.latitude, lon: result.longitude, name });
            onSelect({ displayName: name, latitude: result.latitude, longitude: result.longitude, type: "place" });
          }}
        />
      )}

      <ThemedText style={s.label}>{label}{required ? " *" : ""}</ThemedText>

      <View style={[s.inputRow, selected && s.inputRowSelected]}>
        <Feather name="map-pin" size={15} color={selected ? "#10B981" : "#9CA3AF"} style={{ marginRight: 8 }} />
        <TextInput
          style={s.input}
          value={query}
          onChangeText={handleChange}
          placeholder={placeholder || `Search ${label.toLowerCase()}...`}
          placeholderTextColor="#9CA3AF"
          onFocus={() => { if (results.length > 0) setShowResults(true); }}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
        />
        {loading && <ActivityIndicator size="small" color="#60045d" style={{ marginLeft: 6 }} />}
        {selected && <Feather name="check-circle" size={16} color="#10B981" style={{ marginLeft: 6 }} />}
        {query.length > 0 && !loading && (
          <TouchableOpacity onPress={() => { setQuery(""); setResults([]); setSelected(false); setMapCenter(null); onChange?.(""); }}>
            <Feather name="x" size={15} color="#9CA3AF" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        )}
      </View>

      {/* Map pin button — always visible so user can open map freely */}
      <TouchableOpacity style={s.mapBtn} onPress={handleOpenMap}>
        <Feather name="map" size={13} color="#60045d" />
        <ThemedText style={s.mapBtnText}>
          {selected ? "Adjust on Map" : "Pin on Map"}
        </ThemedText>
      </TouchableOpacity>

      {selected && <ThemedText style={s.coordHint}>📍 Location pinned</ThemedText>}

      {showResults && results.length > 0 && (
        <View style={s.dropdown}>
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {results.map((place, i) => (
              <TouchableOpacity
                key={i}
                style={[s.resultItem, i < results.length - 1 && s.resultBorder]}
                onPress={() => handleSelect(place)}
              >
                <View style={s.resultIcon}>
                  <Feather name={getTypeIcon(place.type)} size={14} color="#60045d" />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={s.resultName} numberOfLines={1}>{place.displayName.split(",")[0].trim()}</ThemedText>
                  <ThemedText style={s.resultAddr} numberOfLines={1}>{subText(place)}</ThemedText>
                </View>
                {place.distM != null && (
                  <View style={s.distBadge}>
                    <ThemedText style={s.distText}>{fmtDist(place.distM)}</ThemedText>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {showResults && results.length === 0 && !loading && query.length >= 2 && (
        <View style={s.noResults}>
          <ThemedText style={s.noResultsTxt}>No locations found. Try a different name or spelling.</ThemedText>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 14, position: "relative", zIndex: 100 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  inputRow: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 8,
    paddingHorizontal: 11, paddingVertical: 10, backgroundColor: "#F9FAFB",
  },
  inputRowSelected: { borderColor: "#10B981", backgroundColor: "#F0FDF4" },
  input: { flex: 1, fontSize: 14, color: "#111827" },
  coordHint: { fontSize: 11, color: "#10B981", marginTop: 4, marginLeft: 2 },
  mapBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginTop: 6, alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: "#F5EEF5", borderRadius: 6,
    borderWidth: 1, borderColor: "#60045d30",
  },
  mapBtnText: { fontSize: 12, color: "#60045d", fontWeight: "600" },
  dropdown: {
    position: "absolute", top: "100%", left: 0, right: 0,
    backgroundColor: "#fff", borderRadius: 10, zIndex: 9999,
    borderWidth: 1, borderColor: "#E5E7EB", maxHeight: 300,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }
      : { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 10 }),
  },
  resultItem: { flexDirection: "row", alignItems: "center", padding: 12, gap: 10 },
  resultBorder: { borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  resultIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#F5EEF5", alignItems: "center", justifyContent: "center" },
  resultName: { fontSize: 13, fontWeight: "600", color: "#111827" },
  resultAddr: { fontSize: 11, color: "#6B7280", marginTop: 1 },
  distBadge: { backgroundColor: "#EFF6FF", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  distText: { fontSize: 11, color: "#3B82F6", fontWeight: "700" },
  noResults: { padding: 12, backgroundColor: "#F9FAFB", borderRadius: 8, marginTop: 4 },
  noResultsTxt: { fontSize: 12, color: "#9CA3AF", textAlign: "center" },
});
