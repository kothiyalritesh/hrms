import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
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
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [nativeShell, setNativeShell] = useState(() => nativeBridge.isAvailable());
  const [mapFailed, setMapFailed] = useState(false);

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
    let directionsRenderer: any = null;

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
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (disposed) return;
            const origin = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            };
            const service = new maps.DirectionsService();
            new AdvancedMarkerElement({
              map,
              position: origin,
              title: "Current location",
            });
            directionsRenderer = new maps.DirectionsRenderer({
              map,
              suppressMarkers: true,
              polylineOptions: { strokeColor: "#6D1B6D", strokeWeight: 5 },
            });
            service.route(
              {
                origin,
                destination,
                travelMode: maps.TravelMode.DRIVING,
              },
              (result: any, status: string) => {
                if (disposed) return;
                if (status === "OK" && result) {
                  directionsRenderer.setDirections(result);
                  return;
                }
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
              },
            );
          },
          () => {
            // The destination map remains useful when current-location access
            // is unavailable or the user declines the browser prompt.
          },
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
        );
      })
      .catch(() => {
        if (!disposed) setMapFailed(true);
      });

    return () => {
      disposed = true;
      directionsRenderer?.setMap(null);
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
    <View style={styles.card}>
      <ThemedText style={styles.title}>
        Route to {fallbackDestination.name}
      </ThemedText>

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

      <ThemedText style={nativeShell ? styles.nativeStatus : styles.warning}>
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
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E9D8E9",
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
