import React, { useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import SafeMapView from "@/components/SafeMapView";

type Point = { latitude: number; longitude: number };

/** Phone map: last known position -> destination, with ETA. */
export default function RouteMiniMap({
  origin,
  destination,
  etaMinutes,
  originLabel = "Last known position",
  destinationLabel = "Destination",
}: {
  origin: Point;
  destination: Point;
  etaMinutes?: number | null;
  originLabel?: string;
  destinationLabel?: string;
}) {
  const mapRef = useRef<MapView | null>(null);
  const fit = () =>
    mapRef.current?.fitToCoordinates([origin, destination], {
      edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
      animated: false,
    });

  return (
    <View style={styles.wrap}>
      <SafeMapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{
          latitude: (origin.latitude + destination.latitude) / 2,
          longitude: (origin.longitude + destination.longitude) / 2,
          latitudeDelta: Math.max(Math.abs(origin.latitude - destination.latitude) * 1.6, 0.01),
          longitudeDelta: Math.max(Math.abs(origin.longitude - destination.longitude) * 1.6, 0.01),
        }}
        onMapReady={fit}
        toolbarEnabled={false}
      >
        <Marker coordinate={origin} title={originLabel} pinColor="#2563EB" />
        <Marker coordinate={destination} title={destinationLabel} pinColor="#DC2626" />
        <Polyline coordinates={[origin, destination]} strokeColor="#60045d" strokeWidth={3} lineDashPattern={[8, 6]} />
      </SafeMapView>
      {etaMinutes != null ? (
        <View style={styles.eta}>
          <Text style={styles.etaText}>ETA {etaMinutes} min</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, borderRadius: 10, overflow: "hidden" },
  map: { width: "100%", height: 240 },
  eta: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(30,41,59,0.92)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  etaText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
});
