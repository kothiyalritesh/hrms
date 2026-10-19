import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Location from "expo-location";
import { useIsFocused } from "@react-navigation/native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import SafeMapView from "@/components/SafeMapView";
import { ThemedText } from "@/components/ThemedText";
import { DARK_GOOGLE_MAP_STYLE } from "@/constants/mapStyles";
import { useTheme } from "@/hooks/useTheme";
import { haversineDistanceM } from "@/services/location/geo";
import { readActiveTrackingConfig } from "@/services/location/backgroundLocationTask";
import {
  computeDrivingRoute,
  decodeGooglePolyline,
} from "@/services/location/route.service";
import { Destination, DrivingRoute } from "@/services/location/types";
import { isDestinationForToday } from "@/services/location/trackingDate";
import { openGoogleMapsNavigation } from "@/utils/googleNavigation";
import {
  googleMapsNavLink,
  googleStaticMapUrl,
} from "@/utils/googleGeolocation";

// If the native Google map has not reported ready by then (bad/missing Android
// key, SHA-1 mismatch, Play Services issue), show a static map instead.
const MAP_READY_TIMEOUT_MS = 8_000;
// The browser Maps key is HTTP-referrer restricted; native requests carry no
// referrer, so send the hosted web origin explicitly for the Static API.
const STATIC_MAP_REFERER = "https://bop.in/HRMS/";
// Road-route refresh throttle while the user moves.
const ROUTE_REFRESH_MOVE_M = 150;
const ROUTE_REFRESH_INTERVAL_MS = 60_000;
// A road route older than this is no longer shown once a refresh fails.
const ROUTE_MAX_STALE_MS = 3 * 60_000;
// Fixes worse than this are ignored once a better fix exists.
const MAX_USABLE_ACCURACY_M = 500;
const MAP_HEIGHT = 240;
const EDGE_PADDING = { top: 56, right: 48, bottom: 56, left: 48 };

type Coordinate = { latitude: number; longitude: number };
type PermissionState = "unknown" | "granted" | "denied" | "blocked";
type RouteStatus = "idle" | "loading" | "ok" | "failed";

type Props = {
  fallbackDestination?: Destination | null;
  /** The user is already checked in at this destination. */
  onSite?: boolean;
};

function formatDistance(distanceM: number) {
  if (distanceM < 1_000) return `${Math.max(1, Math.round(distanceM))} m`;
  const kilometres = distanceM / 1_000;
  return `${kilometres < 10 ? kilometres.toFixed(1) : Math.round(kilometres)} km`;
}

function formatEta(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? `${hours} hr ${remainingMinutes} min`
    : `${hours} hr`;
}

function toCoordinate(position: Location.LocationObject): Coordinate {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

export default function ActiveJourneyCard({
  fallbackDestination = null,
  onSite = false,
}: Props) {
  const { theme, isDark } = useTheme();
  const isFocused = useIsFocused();
  const mapRef = useRef<MapView | null>(null);
  const mountedRef = useRef(true);
  const routeRequest = useRef<{
    inFlight: boolean;
    journeyId: string | null;
    lastAttemptAt: number;
    lastOrigin: Coordinate | null;
  }>({ inFlight: false, journeyId: null, lastAttemptAt: 0, lastOrigin: null });

  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );
  const [cachedDestination, setCachedDestination] =
    useState<Destination | null>(null);
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [permissionNonce, setPermissionNonce] = useState(0);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const routeRef = useRef<DrivingRoute | null>(null);
  routeRef.current = route;
  const [routeStatus, setRouteStatus] = useState<RouteStatus>("idle");
  const [routeTick, setRouteTick] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setAppActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  // The screen's own visit list is authoritative. Only when it has no visit to
  // show do we fall back to the destination the tracking coordinator cached.
  useEffect(() => {
    if (fallbackDestination || !isFocused) return;
    let cancelled = false;
    const read = async () => {
      try {
        const config = await readActiveTrackingConfig();
        const authoritativeNow = Number.isFinite(config?.serverClockOffsetMs)
          ? new Date(Date.now() + Number(config?.serverClockOffsetMs))
          : null;
        const next =
          config?.destination &&
          (!authoritativeNow ||
            isDestinationForToday(config.destination, authoritativeNow))
            ? config.destination
            : null;
        if (!cancelled) setCachedDestination(next);
      } catch {
        if (!cancelled) setCachedDestination(null);
      }
    };
    void read();
    const interval = setInterval(() => void read(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fallbackDestination, isFocused]);

  const rawDestination = fallbackDestination ?? cachedDestination;
  const destinationKey = rawDestination
    ? `${rawDestination.journeyId}:${rawDestination.latitude}:${rawDestination.longitude}:${rawDestination.name}`
    : null;
  // The screen re-creates the destination object on every render; key it so
  // effects below only re-run when the destination really changes.
  const destination = useMemo(
    () => rawDestination,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destinationKey],
  );
  const destinationPoint = useMemo<Coordinate | null>(
    () =>
      destination
        ? { latitude: destination.latitude, longitude: destination.longitude }
        : null,
    [destination],
  );

  // New destination: forget the previous journey's route.
  useEffect(() => {
    routeRequest.current = {
      inFlight: false,
      journeyId: destination?.journeyId ?? null,
      lastAttemptAt: 0,
      lastOrigin: null,
    };
    setRoute(null);
    setRouteStatus("idle");
  }, [destination]);

  const watchEnabled = !!destination && isFocused && appActive;

  // Foreground live position, only while this screen is visible.
  useEffect(() => {
    if (!watchEnabled) return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    void (async () => {
      try {
        const current = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        if (!current.granted) {
          setPermission(current.canAskAgain === false ? "blocked" : "denied");
          return;
        }
        setPermission("granted");
        setLocationError(null);
        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: 2 * 60_000,
          requiredAccuracy: MAX_USABLE_ACCURACY_M,
        }).catch(() => null);
        if (!cancelled && lastKnown) {
          setUserLocation((previous) => previous ?? toCoordinate(lastKnown));
        }
        const next = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 15,
            timeInterval: 5_000,
          },
          (position) => {
            if (cancelled) return;
            const accuracy = position.coords.accuracy;
            setUserLocation((previous) =>
              previous &&
              accuracy != null &&
              accuracy > MAX_USABLE_ACCURACY_M
                ? previous
                : toCoordinate(position),
            );
          },
          () => {
            if (!cancelled) {
              setLocationError(
                "Live location is unavailable. Turn on GPS to see your position.",
              );
            }
          },
        );
        if (cancelled) next.remove();
        else subscription = next;
      } catch {
        if (!cancelled) {
          setLocationError(
            "Live location is unavailable. Turn on GPS to see your position.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [watchEnabled, permissionNonce]);

  // Re-evaluate the 60 s route refresh even when the user stands still.
  useEffect(() => {
    if (!watchEnabled) return;
    const interval = setInterval(() => setRouteTick((tick) => tick + 1), 15_000);
    return () => clearInterval(interval);
  }, [watchEnabled]);

  // Road route (Google Routes API via route.service), throttled.
  useEffect(() => {
    if (!destination || !userLocation || !watchEnabled) return;
    const state = routeRequest.current;
    if (state.inFlight) return;
    const movedM = state.lastOrigin
      ? haversineDistanceM(
          state.lastOrigin.latitude,
          state.lastOrigin.longitude,
          userLocation.latitude,
          userLocation.longitude,
        )
      : Infinity;
    const due =
      state.journeyId !== destination.journeyId ||
      !state.lastOrigin ||
      movedM > ROUTE_REFRESH_MOVE_M ||
      Date.now() - state.lastAttemptAt >= ROUTE_REFRESH_INTERVAL_MS;
    if (!due) return;

    const journeyId = destination.journeyId;
    routeRequest.current = {
      inFlight: true,
      journeyId,
      lastAttemptAt: Date.now(),
      lastOrigin: userLocation,
    };
    setRouteStatus((previous) => (previous === "ok" ? "ok" : "loading"));
    void computeDrivingRoute(userLocation, destination, true)
      .catch(() => null)
      .then((next) => {
        if (
          !mountedRef.current ||
          routeRequest.current.journeyId !== journeyId
        ) {
          return;
        }
        routeRequest.current.inFlight = false;
        if (next) {
          setRoute(next);
          setRouteStatus("ok");
          return;
        }
        // Keep a recent road route through a brief network blip; never show
        // an old ETA as if it were current.
        const previous = routeRef.current;
        const keep =
          previous &&
          previous.destinationJourneyId === journeyId &&
          Date.now() - Date.parse(previous.calculatedAt) < ROUTE_MAX_STALE_MS
            ? previous
            : null;
        setRoute(keep);
        setRouteStatus(keep ? "ok" : "failed");
      });
  }, [destination, userLocation, watchEnabled, routeTick]);

  const routeCoordinates = useMemo(
    () =>
      route?.encodedPolyline
        ? decodeGooglePolyline(route.encodedPolyline)
        : [],
    [route],
  );
  const hasRoadLine = routeCoordinates.length > 1;
  const hasUserLocation = !!userLocation;

  const latest = useRef({ userLocation, destinationPoint, routeCoordinates });
  latest.current = { userLocation, destinationPoint, routeCoordinates };

  const fitMap = useCallback((animated: boolean) => {
    const map = mapRef.current;
    const { userLocation: here, destinationPoint: there, routeCoordinates: line } =
      latest.current;
    if (!map || !there) return;
    if (!here) {
      map.animateToRegion(
        { ...there, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        animated ? 400 : 0,
      );
      return;
    }
    const points = line.length > 1 ? [here, ...line, there] : [here, there];
    map.fitToCoordinates(points, { edgePadding: EDGE_PADDING, animated });
  }, []);

  // Fit when the map becomes ready, when the first position arrives, and when
  // a new road route is drawn. Not on every GPS tick, so panning is not undone.
  useEffect(() => {
    if (!mapReady) return;
    const timeout = setTimeout(() => fitMap(true), 200);
    return () => clearTimeout(timeout);
  }, [mapReady, hasUserLocation, routeCoordinates, destinationPoint, fitMap]);

  useEffect(() => {
    if (!destination || mapReady) return;
    const timeout = setTimeout(() => setMapFailed(true), MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [destination, mapReady]);

  const requestPermission = useCallback(async () => {
    if (permission === "blocked") {
      void Linking.openSettings();
      return;
    }
    try {
      const result = await Location.requestForegroundPermissionsAsync();
      if (result.granted) {
        setPermission("granted");
        setPermissionNonce((nonce) => nonce + 1);
      } else {
        setPermission(result.canAskAgain === false ? "blocked" : "denied");
      }
    } catch {
      setPermission("denied");
    }
  }, [permission]);

  if (!destination || !destinationPoint) return null;

  const palette = isDark
    ? {
        cardBorder: theme.border,
        title: theme.text,
        muted: theme.textSecondary,
        accent: "#E2A6E2",
        live: "#6EE4C0",
        liveDot: "#1AB88A",
        divider: theme.border,
        routeLine: "#D08CFF",
        overlayBg: "rgba(20,14,28,0.88)",
        overlayText: "#F0EBF8",
        noteBg: theme.warningBg,
        noteText: theme.warningText,
      }
    : {
        cardBorder: "#E9D8E9",
        title: "#28162A",
        muted: "#6B7280",
        accent: "#6D1B6D",
        live: "#047857",
        liveDot: "#10B981",
        divider: "#E5E7EB",
        routeLine: "#6D1B6D",
        overlayBg: "rgba(255,255,255,0.94)",
        overlayText: "#28162A",
        noteBg: "#FEF3C7",
        noteText: "#92400E",
      };

  const straightLineM = userLocation
    ? haversineDistanceM(
        userLocation.latitude,
        userLocation.longitude,
        destinationPoint.latitude,
        destinationPoint.longitude,
      )
    : null;

  const routeLoading = routeStatus === "loading" && !route;
  const waitingForLocation =
    permission === "granted" && !userLocation && !locationError;

  let etaValue: string;
  let etaLabel: string;
  if (route) {
    etaValue = formatEta(route.durationSeconds);
    etaLabel = "estimated arrival";
  } else if (routeLoading) {
    etaValue = "";
    etaLabel = "calculating route...";
  } else if (permission === "denied" || permission === "blocked") {
    etaValue = "--";
    etaLabel = "needs your location";
  } else if (waitingForLocation || permission === "unknown") {
    etaValue = "";
    etaLabel = "finding your location...";
  } else {
    etaValue = "--";
    etaLabel = "ETA unavailable";
  }

  let distanceValue: string;
  let distanceLabel: string;
  if (route) {
    distanceValue = formatDistance(route.distanceM);
    distanceLabel = "road distance";
  } else if (straightLineM != null) {
    distanceValue = formatDistance(straightLineM);
    distanceLabel = "straight-line dist.";
  } else {
    distanceValue = waitingForLocation || permission === "unknown" ? "" : "--";
    distanceLabel = "distance";
  }

  const showStaticFallback = mapFailed && !mapReady;
  const permissionNote =
    permission === "denied" || permission === "blocked"
      ? "Location permission is off, so only the destination is shown."
      : locationError;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundDefault,
          borderColor: palette.cardBorder,
          shadowOpacity: isDark ? 0 : 0.12,
          elevation: isDark ? 0 : 4,
        },
      ]}
    >
      <View style={styles.headingRow}>
        <View style={styles.liveBadge}>
          <View style={[styles.liveDot, { backgroundColor: palette.liveDot }]} />
          <ThemedText style={[styles.liveText, { color: palette.live }]}>
            {onSite ? "ACTIVE VISIT" : "LIVE JOURNEY"}
          </ThemedText>
        </View>
        {route ? (
          <ThemedText style={[styles.trafficText, { color: palette.muted }]}>
            Traffic-aware
          </ThemedText>
        ) : null}
      </View>

      <ThemedText
        style={[styles.destination, { color: palette.title }]}
        numberOfLines={1}
      >
        {destination.name}
      </ThemedText>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          {etaValue ? (
            <ThemedText style={[styles.metricValue, { color: palette.accent }]}>
              {etaValue}
            </ThemedText>
          ) : (
            <ActivityIndicator
              size="small"
              color={palette.accent}
              style={styles.metricSpinner}
            />
          )}
          <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>
            {etaLabel}
          </ThemedText>
        </View>
        <View style={[styles.metricDivider, { backgroundColor: palette.divider }]} />
        <View style={styles.metric}>
          {distanceValue ? (
            <ThemedText style={[styles.metricValue, { color: palette.accent }]}>
              {distanceValue}
            </ThemedText>
          ) : (
            <ActivityIndicator
              size="small"
              color={palette.accent}
              style={styles.metricSpinner}
            />
          )}
          <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>
            {distanceLabel}
          </ThemedText>
        </View>
      </View>

      {showStaticFallback ? (
        <View style={[styles.map, { backgroundColor: theme.backgroundSecondary }]}>
          <Image
            source={{
              uri: googleStaticMapUrl(
                destinationPoint.latitude,
                destinationPoint.longitude,
                14,
              ),
              headers: { Referer: STATIC_MAP_REFERER },
            }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          <TouchableOpacity
            style={[styles.openMapsButton, { backgroundColor: palette.overlayBg }]}
            onPress={() =>
              void Linking.openURL(
                googleMapsNavLink(
                  destinationPoint.latitude,
                  destinationPoint.longitude,
                ),
              )
            }
          >
            <Feather name="external-link" size={13} color={palette.accent} />
            <ThemedText
              style={[styles.openMapsButtonText, { color: palette.accent }]}
            >
              Open in Google Maps
            </ThemedText>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.map, { backgroundColor: theme.backgroundSecondary }]}>
          <SafeMapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            customMapStyle={isDark ? DARK_GOOGLE_MAP_STYLE : []}
            userInterfaceStyle={isDark ? "dark" : "light"}
            toolbarEnabled={false}
            showsMyLocationButton={false}
            onMapReady={() => {
              setMapReady(true);
              setMapFailed(false);
            }}
            initialRegion={{
              latitude: destinationPoint.latitude,
              longitude: destinationPoint.longitude,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
          >
            {userLocation ? (
              <Marker
                coordinate={userLocation}
                title="You are here"
                pinColor="#2563EB"
              />
            ) : null}
            <Marker
              coordinate={destinationPoint}
              title={destination.name}
              pinColor="#DC2626"
            />
            {userLocation && hasRoadLine ? (
              <Polyline
                coordinates={routeCoordinates}
                strokeColor={palette.routeLine}
                strokeWidth={5}
              />
            ) : null}
            {userLocation && !hasRoadLine ? (
              <Polyline
                coordinates={[userLocation, destinationPoint]}
                strokeColor={palette.routeLine}
                strokeWidth={4}
                lineDashPattern={[10, 8]}
              />
            ) : null}
          </SafeMapView>

          {mapReady ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Recenter map on route"
              style={[styles.recenterButton, { backgroundColor: palette.overlayBg }]}
              onPress={() => fitMap(true)}
            >
              <Feather name="crosshair" size={18} color={palette.accent} />
            </TouchableOpacity>
          ) : null}

          {mapReady && userLocation ? (
            <View
              pointerEvents="none"
              style={[styles.routeBadge, { backgroundColor: palette.overlayBg }]}
            >
              <ThemedText
                style={[styles.routeBadgeText, { color: palette.overlayText }]}
              >
                {hasRoadLine
                  ? "Road route"
                  : routeLoading
                    ? "Finding road route..."
                    : "Straight line - road route unavailable"}
              </ThemedText>
            </View>
          ) : null}
        </View>
      )}

      {permissionNote ? (
        <View style={[styles.note, { backgroundColor: palette.noteBg }]}>
          <Feather name="map-pin" size={13} color={palette.noteText} />
          <ThemedText style={[styles.noteText, { color: palette.noteText }]}>
            {permissionNote}
          </ThemedText>
          {permission === "denied" || permission === "blocked" ? (
            <TouchableOpacity onPress={() => void requestPermission()}>
              <ThemedText style={[styles.noteAction, { color: palette.noteText }]}>
                {permission === "blocked" ? "Settings" : "Allow"}
              </ThemedText>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.navigateButton}
        onPress={() => void openGoogleMapsNavigation(destinationPoint)}
      >
        <Feather name="navigation" size={16} color="#FFFFFF" />
        <ThemedText style={styles.navigateButtonText}>
          Start turn-by-turn navigation
        </ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    shadowColor: "#6D1B6D",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveText: {
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.7,
  },
  trafficText: { fontSize: 11 },
  destination: {
    marginTop: 7,
    fontWeight: "800",
    fontSize: 17,
  },
  metrics: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 12,
    gap: 18,
  },
  metric: { flexShrink: 1, minWidth: 0 },
  metricValue: { fontSize: 20, fontWeight: "900" },
  metricSpinner: { alignSelf: "flex-start", height: 28 },
  metricLabel: { fontSize: 10, marginTop: 1 },
  metricDivider: { height: 34, width: 1 },
  map: {
    height: MAP_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  recenterButton: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  routeBadge: {
    position: "absolute",
    left: 8,
    bottom: 8,
    maxWidth: "80%",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  routeBadgeText: { fontSize: 11, fontWeight: "700" },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17 },
  noteAction: { fontSize: 12, fontWeight: "800" },
  openMapsButton: {
    position: "absolute",
    right: 8,
    bottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  openMapsButtonText: { fontSize: 12, fontWeight: "800" },
  navigateButton: {
    minHeight: 46,
    borderRadius: 11,
    backgroundColor: "#6D1B6D",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  navigateButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
});
