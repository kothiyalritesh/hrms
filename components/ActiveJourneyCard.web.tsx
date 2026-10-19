import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Destination } from "@/services/location/types";
import { nativeBridge } from "@/services/nativeBridge/client";
import { loadGoogleMaps } from "@/utils/googleMapsLoader";
import { openGoogleMapsNavigation } from "@/utils/googleNavigation";
import {
  advancedMapOptions,
  loadAdvancedMarkerLibrary,
} from "@/utils/googleAdvancedMarkers";

const googleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export default function ActiveJourneyCard({
  fallbackDestination,
}: {
  fallbackDestination?: Destination | null;
  /** Accepted for parity with the native card; the web card has one layout. */
  onSite?: boolean;
}) {
  const { theme, isDark } = useTheme();
  const mapRef = useRef<HTMLDivElement>(null);
  const [nativeShell, setNativeShell] = useState(() => nativeBridge.isAvailable());
  const [mapFailed, setMapFailed] = useState(false);
  const [distanceText, setDistanceText] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setNativeShell(nativeBridge.isAvailable());
    refresh();
    window.addEventListener("bop-native-ready", refresh);
    const removeBridgeListener = nativeBridge.on("bridge.ready", refresh);
    return () => {
      window.removeEventListener("bop-native-ready", refresh);
      removeBridgeListener();
    };
  }, []);

  useEffect(() => {
    if (!fallbackDestination || !mapRef.current || !googleMapsKey) {
      setMapFailed(!googleMapsKey);
      return;
    }
    let disposed = false;
      let activeWatchId: number | undefined = undefined;

    // Decode Google encoded polyline format
    function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
      const points: Array<{ lat: number; lng: number }> = [];
      let index = 0, lat = 0, lng = 0;
      while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        lat += result & 1 ? ~(result >> 1) : result >> 1;
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        lng += result & 1 ? ~(result >> 1) : result >> 1;
        points.push({ lat: lat / 1e5, lng: lng / 1e5 });
      }
      return points;
    }

    void loadGoogleMaps()
      .then(async (maps) => {
        if (disposed || !mapRef.current) return;
        const destination = {
          lat: fallbackDestination.latitude,
          lng: fallbackDestination.longitude,
        };
        const map = new maps.Map(mapRef.current, advancedMapOptions({
          center: destination,
          zoom: 15,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "cooperative",
        }));
        const google = (window as any).google;
        const { AdvancedMarkerElement } =
          await loadAdvancedMarkerLibrary(google);
        new AdvancedMarkerElement({
          map,
          position: destination,
          title: fallbackDestination.name,
        });
        setMapFailed(false);

        
        if (!navigator.geolocation) return;
        
        let originMarker: any = null;
        let routeDrawn = false;
        
        activeWatchId = navigator.geolocation.watchPosition(
          (position) => {
            if (disposed) return;
            const origin = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            };
            
            if (!originMarker) {
              originMarker = new AdvancedMarkerElement({
                map,
                position: origin,
                title: "Current location",
              });
            } else {
              originMarker.position = origin;
            }

            // Calculate distance using haversine if geometry lib isn't loaded
            const R = 6371; // km
            const dLat = (destination.lat - origin.lat) * Math.PI / 180;
            const dLon = (destination.lng - origin.lng) * Math.PI / 180;
            const a = 
              Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(origin.lat * Math.PI / 180) * Math.cos(destination.lat * Math.PI / 180) * 
              Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = R * c;
            setDistanceText(distance < 1 ? `${Math.round(distance * 1000)} m away` : `${distance.toFixed(2)} km away`);

            if (!routeDrawn) {
              routeDrawn = true;
              // Use Routes API (replaces deprecated DirectionsService/DirectionsRenderer)
              const routesApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
              fetch(
                `https://routes.googleapis.com/directions/v2:computeRoutes`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": routesApiKey,
                    "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
                  },
                  body: JSON.stringify({
                    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
                    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
                    travelMode: "DRIVE",
                  }),
                },
              )
                .then((r) => r.json())
                .then((data) => {
                  if (disposed) return;
                  const route = data?.routes?.[0];
                  if (route?.polyline?.encodedPolyline) {
                    const decoded = decodePolyline(route.polyline.encodedPolyline);
                    new maps.Polyline({
                      map,
                      path: decoded,
                      strokeColor: "#6D1B6D",
                      strokeWeight: 5,
                    });
                    const bounds = new maps.LatLngBounds();
                    for (const p of decoded) bounds.extend(p);
                    map.fitBounds(bounds, 48);
                    if (route.distanceMeters) {
                      const km = route.distanceMeters / 1000;
                      setDistanceText((km < 1 ? `${route.distanceMeters} m` : `${km.toFixed(1)} km`) + " away");
                    }
                    return;
                  }
                  // Fallback: straight-line polyline
                  drawFallbackPolyline();
                })
                .catch(() => { if (!disposed) drawFallbackPolyline(); });

              function drawFallbackPolyline() {
                const bounds = new maps.LatLngBounds();
                bounds.extend(origin);
                bounds.extend(destination);
                new maps.Polyline({
                  map,
                  path: [origin, destination],
                  strokeColor: "#6D1B6D",
                  strokeWeight: 4,
                });
                map.fitBounds(bounds, 48);
              }
            }
          },
          () => {},
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
        );

      })
      .catch(() => {
        if (!disposed) setMapFailed(true);
      });

    return () => {
      disposed = true;
      if (activeWatchId !== undefined) navigator.geolocation.clearWatch(activeWatchId);
    };
  }, [
    fallbackDestination?.journeyId,
    fallbackDestination?.latitude,
    fallbackDestination?.longitude,
    fallbackDestination?.name,
  ]);

  if (!fallbackDestination) return null;
  const fallbackMapUrl =
    "https://maps.google.com/maps?q=" +
    encodeURIComponent(
      `${fallbackDestination.latitude},${fallbackDestination.longitude}`,
    ) +
    "&z=15&output=embed";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundDefault,
          borderColor: isDark ? theme.border : "#E9D8E9",
        },
      ]}
    >
      <ThemedText style={styles.title}>
          Route to {fallbackDestination.name}
        </ThemedText>
        {distanceText && (
          <ThemedText style={{ color: isDark ? "#E2A6E2" : "#6D1B6D", fontWeight: "600", marginBottom: 8, fontSize: 14 }}>
            {distanceText} (Live)
          </ThemedText>
        )}

      {mapFailed ? (
        <iframe
          src={fallbackMapUrl}
          title={`Map to ${fallbackDestination.name}`}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          style={{ width: "100%", height: 230, border: 0, borderRadius: 10 }}
        />
      ) : (
        <div
          ref={mapRef}
          aria-label={`Driving map to ${fallbackDestination.name}`}
          style={{ width: "100%", height: 230, borderRadius: 10, overflow: "hidden" }}
        />
      )}

      <ThemedText
        style={[
          nativeShell ? styles.nativeStatus : styles.warning,
          isDark
            ? nativeShell
              ? { color: theme.successText, backgroundColor: theme.successBg }
              : { color: theme.warningText, backgroundColor: theme.warningBg }
            : null,
        ]}
      >
        {nativeShell
          ? "Android background arrival tracking is connected."
          : "Browser tracking works only while this page remains open and active. Background arrival alerts are not guaranteed."}
      </ThemedText>
      <TouchableOpacity
        style={styles.button}
        onPress={() =>
          void openGoogleMapsNavigation({
            latitude: fallbackDestination.latitude,
            longitude: fallbackDestination.longitude,
          })
        }
      >
        <Feather name="navigation" size={15} color="#FFFFFF" />
        <ThemedText style={styles.buttonText}>Open driving route</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    gap: 10,
  },
  title: { fontSize: 15, fontWeight: "800" },
  warning: {
    color: "#92400E",
    backgroundColor: "#FFFBEB",
    borderRadius: 8,
    padding: 8,
    fontSize: 12,
    lineHeight: 17,
  },
  nativeStatus: {
    color: "#047857",
    backgroundColor: "#ECFDF5",
    borderRadius: 8,
    padding: 8,
    fontSize: 12,
    lineHeight: 17,
  },
  button: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: "#6D1B6D",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: { color: "#FFFFFF", fontWeight: "800" },
});
