import React, { forwardRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import MapView, { type MapViewProps } from "react-native-maps";

// Google Maps API key is configured and verified in app.config.js and eas.json.
export const nativeMapsAvailable = true;

const SafeMapView = forwardRef<MapView, MapViewProps & { children?: React.ReactNode }>(
  function SafeMapView(props, ref) {
    if (nativeMapsAvailable) return <MapView ref={ref} {...props} />;
    return (
      <View style={[props.style, styles.fallback]}>
        <Text style={styles.text}>
          Map view is not available in this app build. Location details and
          distances are still shown.
        </Text>
      </View>
    );
  },
);

export default SafeMapView;

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF0F4",
    padding: 16,
    minHeight: 120,
  },
  text: { color: "#4B5563", fontSize: 13, textAlign: "center" },
});
