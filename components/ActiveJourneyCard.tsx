import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { haversineDistanceM } from "@/services/location/geo";
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Location from "expo-location";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { ThemedText } from "@/components/ThemedText";
import { readActiveTrackingConfig } from "@/services/location/backgroundLocationTask";
import {
  computeDrivingRoute,
  decodeGooglePolyline,
} from "@/services/location/route.service";
import { Destination, DrivingRoute } from "@/services/location/types";
import { isDestinationForToday } from "@/services/location/trackingDate";
import { openGoogleMapsNavigation } from "@/utils/googleNavigation";

type Props = {
  fallbackDestination?: Destination | null;
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

export default function ActiveJourneyCard({
  fallbackDestination = null,
}: Props) {
  const mapRef = useRef<MapView | null>(null);
  const requestRunning = useRef(false);
  const lastRouteKey = useRef<string | null>(null);
  const [destination, setDestination] = useState<Destination | null>(
    fallbackDestination,
  );
  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshRoute = useCallback(async () => {
    if (requestRunning.current) return;
    requestRunning.current = true;
    try {
      const config = await readActiveTrackingConfig();
      const authoritativeNow = Number.isFinite(config?.serverClockOffsetMs)
        ? new Date(Date.now() + Number(config?.serverClockOffsetMs))
        : null;
      const cachedDestination =
        config?.destination &&
        (!authoritativeNow ||
          isDestinationForToday(config.destination, authoritativeNow))
          ? config.destination
          : null;
      const nextDestination = cachedDestination ?? fallbackDestination;
      if (!nextDestination) {
        setDestination(null);
        setRoute(null);
        setLoading(false);
        return;
      }
      setDestination(nextDestination);

      let origin: {
        latitude: number;
        longitude: number;
      } | null = null;
      let routeKey: string | null = null;
      if (
        config?.routeProgress?.destinationJourneyId ===
        nextDestination.journeyId
      ) {
        origin = {
          latitude: config.routeProgress.originLatitude,
          longitude: config.routeProgress.originLongitude,
        };
        routeKey = `${nextDestination.journeyId}:${config.routeProgress.calculatedAt}`;
      } else {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) {
          setLoading(false);
          return;
        }
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        origin = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        };
        routeKey = `${nextDestination.journeyId}:${origin.latitude.toFixed(
          5,
        )}:${origin.longitude.toFixed(5)}`;
      }

      if (routeKey === lastRouteKey.current) {
        setLoading(false);
        return;
      }
      const nextRoute = await computeDrivingRoute(
        origin,
        nextDestination,
        true,
      );
      if (nextRoute) {
        lastRouteKey.current = routeKey;
        setRoute(nextRoute);
      }
      setLoading(false);
    } finally {
      requestRunning.current = false;
    }
  }, [fallbackDestination]);

  useEffect(() => {
    void refreshRoute();
    const interval = setInterval(() => void refreshRoute(), 15_000);
    return () => clearInterval(interval);
  }, [refreshRoute]);

  const routeCoordinates = useMemo(
    () =>
      route?.encodedPolyline != null
        ? decodeGooglePolyline(route.encodedPolyline)
        : [],
    [route],
  );

  useEffect(() => {
    if (routeCoordinates.length < 2) return;
    const timeout = setTimeout(() => {
      mapRef.current?.fitToCoordinates(routeCoordinates, {
        edgePadding: { top: 44, right: 44, bottom: 44, left: 44 },
        animated: true,
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [routeCoordinates]);

  if (!destination) return null;

  const origin = route
    ? {
        latitude: route.originLatitude,
        longitude: route.originLongitude,
      }
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <ThemedText style={styles.liveText}>LIVE JOURNEY</ThemedText>
        </View>
        {route ? (
          <ThemedText style={styles.trafficText}>Traffic-aware</ThemedText>
        ) : null}
      </View>

      <ThemedText style={styles.destination} numberOfLines={1}>
        {destination.name}
      </ThemedText>

      {loading && !route ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#6D1B6D" />
          <ThemedText style={styles.loadingText}>
            Calculating the best driving route...
          </ThemedText>
        </View>
      ) : (
        <>
          <View style={styles.metrics}>
            <View>
              <ThemedText style={styles.metricValue}>
                {route?.durationSeconds ? formatEta(route.durationSeconds) : origin && destination ? formatEta(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude) / 8.33) : "..."}
              </ThemedText>
              <ThemedText style={styles.metricLabel}>
                {route?.durationSeconds ? "estimated arrival" : "estimated arrival (fallback)"}
              </ThemedText>
            </View>
            <View style={styles.metricDivider} />
            <View>
              <ThemedText style={styles.metricValue}>
                {route?.distanceM ? formatDistance(route.distanceM) : origin && destination ? formatDistance(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude)) : "..."}
              </ThemedText>
              <ThemedText style={styles.metricLabel}>{route?.distanceM ? "road distance" : "straight-line dist."}</ThemedText>
            </View>
          </View>

          {origin && destination && (
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={{
                latitude: origin.latitude,
                longitude: origin.longitude,
                latitudeDelta: 0.08,
                longitudeDelta: 0.08,
              }}
            >
              <Marker
                coordinate={{ latitude: origin.latitude, longitude: origin.longitude }}
                title="Current location"
                pinColor="#10B981"
              />
              <Marker
                coordinate={{ latitude: destination.latitude, longitude: destination.longitude }}
                title={destination.name}
                pinColor="#6D1B6D"
              />
              {routeCoordinates.length > 1 ? (
                <Polyline coordinates={routeCoordinates} strokeColor="#6D1B6D" strokeWidth={6} />
              ) : (
                <Polyline coordinates={[origin, destination]} strokeColor="#6D1B6D" strokeWidth={4} lineDashPattern={[10, 10]} />
              )}
            </MapView>
          )}
        </>
      )}

      {origin && destination && (
        <View style={{ marginTop: 12 }}>
          <TouchableOpacity
            style={styles.navigateButton}
            onPress={() =>
              void openGoogleMapsNavigation(
                { latitude: destination.latitude, longitude: destination.longitude },
                origin
              )
            }
          >
            <Feather name="navigation" size={16} color="#FFFFFF" />
            <ThemedText style={styles.navigateButtonText}>
              Start turn-by-turn navigation
            </ThemedText>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E9D8E9",
    shadowColor: "#6D1B6D",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
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
    backgroundColor: "#10B981",
  },
  liveText: {
    color: "#047857",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.7,
  },
  trafficText: { color: "#6B7280", fontSize: 11 },
  destination: {
    marginTop: 7,
    color: "#28162A",
    fontWeight: "800",
    fontSize: 17,
  },
  loading: {
    minHeight: 104,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  loadingText: { color: "#6B7280", fontSize: 12 },
  metrics: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 12,
    gap: 18,
  },
  metricValue: { color: "#6D1B6D", fontSize: 20, fontWeight: "900" },
  metricLabel: { color: "#6B7280", fontSize: 10, marginTop: 1 },
  metricDivider: { height: 34, width: 1, backgroundColor: "#E5E7EB" },
  map: {
    height: 220,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  currentMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(37,99,235,0.24)",
    alignItems: "center",
    justifyContent: "center",
  },
  currentMarkerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#2563EB",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  unavailable: {
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    borderRadius: 10,
    padding: 12,
    marginVertical: 12,
    fontSize: 12,
  },
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
