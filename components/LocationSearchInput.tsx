import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import MapPickerModal from "@/components/MapPickerModal";
import { loadGoogleMaps } from "@/utils/googleMapsLoader";
import { reverseGeocode } from "@/utils/reverseGeocode";
import * as Crypto from "expo-crypto";

export interface PlaceResult {
  displayName: string;
  latitude: number;
  longitude: number;
  type: string;
  placeId?: string;
  locationSource?:
    | "GOOGLE_PLACE"
    | "MAP_PIN"
    | "CURRENT_LOCATION"
    | "MANUAL_COORDINATES";
}

interface Props {
  label: string;
  value: string;
  onSelect: (place: PlaceResult) => void;
  onChange?: (text: string) => void;
  placeholder?: string;
  required?: boolean;
}

const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const IS_WEB = Platform.OS === "web";
const SEARCH_CACHE_MS = 2 * 60 * 1000;
const searchCache = new Map<string, { expiresAt: number; results: PlaceResult[] }>();

async function fetchJsonWithTimeout(url: string, timeoutMs = 9_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error_message || `Location search failed (${response.status})`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// ── Google Places Autocomplete (web — JS SDK, no CORS issues) ────────────────
async function searchGoogleWeb(
  q: string,
  uLat?: number,
  uLon?: number,
  sessionToken?: any,
): Promise<PlaceResult[]> {
  await loadGoogleMaps();
  const google = (window as any).google;
  if (!google?.maps?.places) {
    throw new Error("Google Places is unavailable");
  }

  return new Promise((resolve, reject) => {
    try {
      const svc = new google.maps.places.AutocompleteService();
      const req: any = {
        input: q,
        componentRestrictions: { country: "in" },
        sessionToken,
      };
      if (uLat != null) {
        req.location = new google.maps.LatLng(uLat, uLon!);
        req.radius = 50000;
      }
      svc.getPlacePredictions(req, (predictions: any[], status: string) => {
        if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          resolve([]);
          return;
        }
        if (
          status !== google.maps.places.PlacesServiceStatus.OK ||
          !predictions?.length
        ) {
          reject(new Error(`Google Places search failed: ${status}`));
          return;
        }
        const placeSvc = new google.maps.places.PlacesService(
          document.createElement("div"),
        );
        const results: PlaceResult[] = [];
        let pending = Math.min(predictions.length, 6);
        predictions.slice(0, 6).forEach((pred) => {
          placeSvc.getDetails(
            {
              placeId: pred.place_id,
              fields: ["geometry", "name", "formatted_address", "types"],
              sessionToken,
            },
            (place: any, st: string) => {
              if (
                st === google.maps.places.PlacesServiceStatus.OK &&
                place?.geometry?.location
              ) {
                results.push({
                  displayName: place.formatted_address
                    ? `${place.name}, ${place.formatted_address}`
                    : pred.description,
                  latitude: place.geometry.location.lat(),
                  longitude: place.geometry.location.lng(),
                  type: place.types?.[0] || "place",
                  placeId: pred.place_id,
                  locationSource: "GOOGLE_PLACE",
                });
              }
              if (--pending === 0) resolve(results);
            },
          );
        });
      });
    } catch (error) {
      reject(
        error instanceof Error ? error : new Error("Location search failed"),
      );
    }
  });
}

// ── Google Places Text Search REST API (native — accurate place pins) ────────
async function searchGoogleNative(
  q: string,
  uLat?: number,
  uLon?: number,
  sessionToken?: string,
): Promise<PlaceResult[]> {
  if (!GMAPS_KEY) {
    throw new Error("Google Maps API key is missing from this build");
  }
  const bias = uLat != null ? `&location=${uLat},${uLon}&radius=50000` : "";
  const searchUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&components=country:in&key=${GMAPS_KEY}&sessiontoken=${encodeURIComponent(sessionToken || "")}${bias}`;
  const searchData = await fetchJsonWithTimeout(searchUrl);
  if (searchData.status === "ZERO_RESULTS") return [];
  if (searchData.status !== "OK" || !Array.isArray(searchData.predictions)) {
    throw new Error(
      searchData?.error_message ||
        `Google Places search failed: ${searchData.status || "UNKNOWN"}`,
    );
  }

  const details = await Promise.all(
    searchData.predictions.slice(0, 6).map(async (prediction: any) => {
      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(prediction.place_id)}&fields=formatted_address,name,geometry,types&key=${GMAPS_KEY}&sessiontoken=${encodeURIComponent(sessionToken || "")}`;
      const detail = await fetchJsonWithTimeout(detailUrl);
      const result = detail?.result;
      if (!result?.geometry?.location) return null;
      return {
        displayName: result.name && result.formatted_address
          ? `${result.name}, ${result.formatted_address}`
          : result.formatted_address || prediction.description || q,
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        type: result.types?.[0] || "place",
        placeId: prediction.place_id,
        locationSource: "GOOGLE_PLACE" as const,
      };
    }),
  );
  return details.filter((value): value is PlaceResult => value != null);
}

function useDebounce(fn: (...args: any[]) => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(
    (...args: any[]) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay],
  );
}

export default function LocationSearchInput({
  label,
  value,
  onSelect,
  onChange,
  placeholder,
  required,
}: Props) {
  const { theme, isDark } = useTheme();
  const s = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const accent = isDark ? "#E2A6E2" : "#60045d";
  const faint = isDark ? theme.textSecondary : "#9CA3AF";
  const okColor = isDark ? "#34D399" : "#10B981";
  const [query, setQuery] = useState(value || "");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [selected, setSelected] = useState(false);
  const [userGps, setUserGps] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [mapCenter, setMapCenter] = useState<{
    lat: number;
    lon: number;
    name: string;
  } | null>(null);
  const searchSequence = useRef(0);
  const sessionToken = useRef<string | any>(Crypto.randomUUID());

  useEffect(() => {
    if (IS_WEB) {
      navigator.geolocation?.getCurrentPosition(
        (p) =>
          setUserGps({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
          }),
        () => {},
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
      );
    } else {
      import("expo-location").then(async (Location) => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== "granted") return;
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setUserGps({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        } catch (error) {
          console.warn("Map provider search failed", error);
        }
      });
    }
  }, []);

  const search = async (text: string) => {
    const sequence = ++searchSequence.current;
    const q = text.trim();
    if (q.length < 3) {
      setResults([]);
      setSearchError("");
      setShowResults(false);
      return;
    }
    setLoading(true);
    setSearchError("");
    try {
      const uLat = userGps?.latitude;
      const uLon = userGps?.longitude;
      if (IS_WEB && typeof sessionToken.current === "string") {
        await loadGoogleMaps();
        const google = (window as any).google;
        sessionToken.current = new google.maps.places.AutocompleteSessionToken();
      }
      const cacheKey = `${q.toLocaleLowerCase()}|${uLat?.toFixed(2) ?? ""}|${uLon?.toFixed(2) ?? ""}`;
      const cached = searchCache.get(cacheKey);
      const places = cached && cached.expiresAt > Date.now()
        ? cached.results
        : IS_WEB
          ? await searchGoogleWeb(q, uLat, uLon, sessionToken.current)
          : await searchGoogleNative(q, uLat, uLon, String(sessionToken.current));
      if (!cached) {
        if (searchCache.size >= 50) {
          const oldestKey = searchCache.keys().next().value;
          if (oldestKey) searchCache.delete(oldestKey);
        }
        searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_MS, results: places });
      }
      if (sequence !== searchSequence.current) return;
      setResults(places.slice(0, 6));
      setShowResults(true);
    } catch (error) {
      if (sequence !== searchSequence.current) return;
      setResults([]);
      setSearchError(
        error instanceof Error
          ? error.message
          : "Location search is temporarily unavailable.",
      );
      setShowResults(true);
    } finally {
      if (sequence === searchSequence.current) setLoading(false);
    }
  };

  const debouncedSearch = useDebounce(search, 400);

  const handleChange = (text: string) => {
    setQuery(text);
    setSelected(false);
    setSearchError("");
    onChange?.(text);
    debouncedSearch(text);
  };

  const handleSelect = (place: PlaceResult) => {
    searchSequence.current += 1;
    const shortName = place.displayName.split(",")[0].trim();
    setQuery(shortName);
    setResults([]);
    setShowResults(false);
    setSelected(true);
    sessionToken.current = Crypto.randomUUID();
    setMapCenter({
      lat: place.latitude,
      lon: place.longitude,
      name: place.displayName,
    });
    onSelect(place);
  };

  const getFreshLocation = async () => {
    if (IS_WEB) {
      if (!navigator.geolocation) {
        throw new Error("This browser does not support location access.");
      }
      return await new Promise<{ latitude: number; longitude: number }>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (position) =>
              resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              }),
            (error) =>
              reject(
                new Error(
                  error.code === error.PERMISSION_DENIED
                    ? "Location permission was denied. Allow location access in browser settings."
                    : "Your live location could not be obtained. Check GPS and try again.",
                ),
              ),
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
          );
        },
      );
    }

    const Location = await import("expo-location");
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      throw new Error(
        "Location permission was denied. Allow it in device settings.",
      );
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  };

  const handleLiveLocation = async () => {
    searchSequence.current += 1;
    setLocating(true);
    try {
      const location = await getFreshLocation();
      setUserGps(location);
      const address =
        (await reverseGeocode(location.latitude, location.longitude)) ||
        `Current location (${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)})`;
      const place: PlaceResult = {
        displayName: address,
        latitude: location.latitude,
        longitude: location.longitude,
        type: "live_location",
        locationSource: "CURRENT_LOCATION",
      };
      setQuery(address);
      setSelected(true);
      setResults([]);
      setShowResults(false);
      setMapCenter({
        lat: location.latitude,
        lon: location.longitude,
        name: address,
      });
      onSelect(place);
      setShowMap(true);
    } catch (error) {
      Alert.alert(
        "Live location unavailable",
        error instanceof Error ? error.message : "Check GPS and try again.",
      );
    } finally {
      setLocating(false);
    }
  };

  const handleOpenMap = async () => {
    if (mapCenter) {
      setShowMap(true);
      return;
    }
    const q = query.trim();
    if (!q) {
      if (userGps) {
        setMapCenter({
          lat: userGps.latitude,
          lon: userGps.longitude,
          name: "Current location",
        });
        setShowMap(true);
      } else {
        await handleLiveLocation();
      }
      return;
    }

    setLoading(true);
    try {
      const places = IS_WEB
        ? await searchGoogleWeb(q, userGps?.latitude, userGps?.longitude, sessionToken.current)
        : await searchGoogleNative(q, userGps?.latitude, userGps?.longitude, String(sessionToken.current));
      const first = places[0];

      if (first) {
        setMapCenter({
          lat: first.latitude,
          lon: first.longitude,
          name: first.displayName,
        });
        setShowMap(true);
        return;
      }

      if (userGps) {
        setMapCenter({
          lat: userGps.latitude,
          lon: userGps.longitude,
          name: q,
        });
        setShowMap(true);
        return;
      }

      Alert.alert(
        "Location Not Found",
        "Select a search result or enable location access before opening the map.",
      );
    } catch (error) {
      Alert.alert(
        "Location search unavailable",
        error instanceof Error
          ? error.message
          : "Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

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
            onSelect({
              displayName: name,
              latitude: result.latitude,
              longitude: result.longitude,
              type: "place",
              locationSource: "MAP_PIN",
            });
          }}
        />
      )}

      <ThemedText style={s.label}>
        {label}
        {required ? " *" : ""}
      </ThemedText>

      <View style={[s.inputRow, selected && s.inputRowSelected]}>
        <Feather
          name="map-pin"
          size={15}
          color={selected ? okColor : faint}
          style={{ marginRight: 8 }}
        />
        <TextInput
          style={s.input}
          value={query}
          onChangeText={handleChange}
          placeholder={placeholder || `Search ${label.toLowerCase()}...`}
          placeholderTextColor={faint}
          onFocus={() => {
            if (results.length > 0) setShowResults(true);
          }}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
        />
        {loading && (
          <ActivityIndicator
            size="small"
            color={accent}
            style={{ marginLeft: 6 }}
          />
        )}
        {selected && (
          <Feather
            name="check-circle"
            size={16}
            color={okColor}
            style={{ marginLeft: 6 }}
          />
        )}
        {query.length > 0 && !loading && (
          <TouchableOpacity
            onPress={() => {
              searchSequence.current += 1;
              setLoading(false);
              setQuery("");
              setResults([]);
              setSearchError("");
              setShowResults(false);
              setSelected(false);
              setMapCenter(null);
              onChange?.("");
            }}
          >
            <Feather
              name="x"
              size={15}
              color={faint}
              style={{ marginLeft: 6 }}
            />
          </TouchableOpacity>
        )}
      </View>

      <View style={s.actionRow}>
        <TouchableOpacity
          style={s.mapBtn}
          onPress={handleOpenMap}
          disabled={loading || locating}
        >
          <Feather name="map" size={13} color={accent} />
          <ThemedText style={s.mapBtnText}>
            {selected ? "Adjust on Map" : "Pin on Map"}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.liveBtn}
          onPress={handleLiveLocation}
          disabled={loading || locating}
        >
          {locating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="crosshair" size={13} color="#fff" />
          )}
          <ThemedText style={s.liveBtnText}>
            {locating ? "Locating..." : "Use Live Location"}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {!!searchError && (
        <View style={s.searchError}>
          <Feather name="alert-circle" size={13} color={isDark ? theme.errorText : "#B91C1C"} />
          <ThemedText style={s.searchErrorText}>{searchError}</ThemedText>
          <TouchableOpacity onPress={() => void search(query)} disabled={loading}>
            <ThemedText style={s.retryText}>Retry</ThemedText>
          </TouchableOpacity>
        </View>
      )}

      {selected && (
        <ThemedText style={s.coordHint}>📍 Location pinned</ThemedText>
      )}

      {showResults && results.length > 0 && (
        <View style={s.dropdown}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {results.map((place, i) => (
              <TouchableOpacity
                key={i}
                style={[s.resultItem, i < results.length - 1 && s.resultBorder]}
                onPress={() => handleSelect(place)}
              >
                <View style={s.resultIcon}>
                  <Feather name="map-pin" size={14} color={accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={s.resultName} numberOfLines={1}>
                    {place.displayName.split(",")[0].trim()}
                  </ThemedText>
                  <ThemedText style={s.resultAddr} numberOfLines={1}>
                    {place.displayName.split(",").slice(1, 3).join(",").trim()}
                  </ThemedText>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {showResults &&
        results.length === 0 &&
        !loading &&
        !searchError &&
        query.length >= 3 && (
          <View style={s.noResults}>
            <ThemedText style={s.noResultsTxt}>
              No locations found. Try a different name or spelling.
            </ThemedText>
          </View>
        )}
    </View>
  );
}

type ThemeColors = typeof Colors.light;

/** Light values are the original design; dark values come from the theme. */
function createStyles(t: ThemeColors, dark: boolean) {
  return StyleSheet.create({
  wrap: { marginBottom: 14, position: "relative", zIndex: 100 },
  label: { fontSize: 13, fontWeight: "600", color: dark ? t.text : "#374151", marginBottom: 6 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: dark ? t.border : "#E5E7EB",
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 10,
    backgroundColor: dark ? t.backgroundSecondary : "#F9FAFB",
  },
  inputRowSelected: { borderColor: dark ? "#34D399" : "#10B981", backgroundColor: dark ? t.successBg : "#F0FDF4" },
  input: { flex: 1, fontSize: 14, color: dark ? t.text : "#111827" },
  coordHint: { fontSize: 11, color: dark ? "#34D399" : "#10B981", marginTop: 4, marginLeft: 2 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  mapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: dark ? t.backgroundSecondary : "#F5EEF5",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: dark ? "#A838A880" : "#60045d30",
  },
  mapBtnText: { fontSize: 12, color: dark ? "#E2A6E2" : "#60045d", fontWeight: "600" },
  liveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#60045d",
    borderRadius: 6,
  },
  liveBtnText: { fontSize: 12, color: "#fff", fontWeight: "700" },
  searchError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 9,
    marginTop: 6,
    borderRadius: 7,
    backgroundColor: dark ? t.errorBg : "#FEF2F2",
  },
  searchErrorText: { flex: 1, fontSize: 11, color: dark ? t.errorText : "#B91C1C" },
  retryText: { fontSize: 12, fontWeight: "800", color: dark ? t.errorText : "#991B1B" },
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    backgroundColor: dark ? t.backgroundDefault : "#fff",
    borderRadius: 10,
    zIndex: 9999,
    borderWidth: 1,
    borderColor: dark ? t.border : "#E5E7EB",
    maxHeight: 300,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }
      : {
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 10,
        }),
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 10,
  },
  resultBorder: { borderBottomWidth: 1, borderBottomColor: dark ? t.border : "#F3F4F6" },
  resultIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: dark ? t.backgroundSecondary : "#F5EEF5",
    alignItems: "center",
    justifyContent: "center",
  },
  resultName: { fontSize: 13, fontWeight: "600", color: dark ? t.text : "#111827" },
  resultAddr: { fontSize: 11, color: dark ? t.textSecondary : "#6B7280", marginTop: 1 },
  noResults: {
    padding: 12,
    backgroundColor: dark ? t.backgroundSecondary : "#F9FAFB",
    borderRadius: 8,
    marginTop: 4,
  },
  noResultsTxt: { fontSize: 12, color: dark ? t.textSecondary : "#9CA3AF", textAlign: "center" },
  });
}
