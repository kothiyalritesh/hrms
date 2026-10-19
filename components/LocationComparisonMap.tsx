import React from "react";
import { StyleSheet } from "react-native";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
} from "react-native-maps";
import SafeMapView from "@/components/SafeMapView";

type Props = {
  selected: { latitude: number; longitude: number; name: string };
  actual: { latitude: number; longitude: number; name: string };
  radiusMetres: number;
};

export default function LocationComparisonMap({
  selected,
  actual,
  radiusMetres,
}: Props) {
  const latitudeDelta = Math.max(
    Math.abs(selected.latitude - actual.latitude) * 1.8,
    0.01,
  );
  const longitudeDelta = Math.max(
    Math.abs(selected.longitude - actual.longitude) * 1.8,
    0.01,
  );
  return (
    <SafeMapView
      style={styles.map}
      provider={
        process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
          ? PROVIDER_GOOGLE
          : undefined
      }
      accessibilityLabel="Map comparing the selected site and your marked current location"
      initialRegion={{
        latitude: (selected.latitude + actual.latitude) / 2,
        longitude: (selected.longitude + actual.longitude) / 2,
        latitudeDelta,
        longitudeDelta,
      }}
    >
      <Marker
        coordinate={selected}
        title={selected.name}
        description="Selected predefined site"
        pinColor="#2563EB"
      />
      <Marker
        coordinate={actual}
        title={actual.name}
        description="Your marked current location"
        pinColor="#F97316"
      />
      <Circle
        center={selected}
        radius={radiusMetres}
        strokeColor="#16A34A"
        fillColor="rgba(22,163,74,0.15)"
      />
      <Polyline
        coordinates={[selected, actual]}
        strokeColor="#7C3AED"
        strokeWidth={3}
      />
    </SafeMapView>
  );
}

const styles = StyleSheet.create({
  map: { width: "100%", height: 240, borderRadius: 12 },
});
