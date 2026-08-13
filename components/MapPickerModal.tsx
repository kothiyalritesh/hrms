import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  type MapPressEvent,
} from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";

import { ThemedText } from "@/components/ThemedText";
import { reverseGeocode } from "@/utils/reverseGeocode";

export interface MapPickResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

interface Props {
  visible: boolean;
  initialLat: number;
  initialLon: number;
  initialName: string;
  onConfirm: (result: MapPickResult) => void;
  onClose: () => void;
}

const MAP_DELTA = {
  latitudeDelta: 0.015,
  longitudeDelta: 0.015,
};

export default function MapPickerModal({
  visible,
  initialLat,
  initialLon,
  initialName,
  onConfirm,
  onClose,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const geocodeSequence = useRef(0);
  const [pickedLat, setPickedLat] = useState(initialLat);
  const [pickedLon, setPickedLon] = useState(initialLon);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [centerLat, setCenterLat] = useState(initialLat);
  const [centerLon, setCenterLon] = useState(initialLon);
  const [centerName, setCenterName] = useState(initialName);
  const [ready, setReady] = useState(false);

  const handleShow = () => {
    setPickedLat(initialLat);
    setPickedLon(initialLon);
    setCenterLat(initialLat);
    setCenterLon(initialLon);
    setCenterName(initialName);
    setSearchText("");
    setReady(false);
    setMapKey((key) => key + 1);
  };

  const selectCoordinates = async (latitude: number, longitude: number) => {
    const sequence = ++geocodeSequence.current;
    setPickedLat(latitude);
    setPickedLon(longitude);
    setCenterLat(latitude);
    setCenterLon(longitude);
    const address = await reverseGeocode(latitude, longitude);
    if (sequence !== geocodeSequence.current) return;
    setCenterName(
      address ||
        `Pinned location (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`,
    );
  };

  const handleMapPress = (event: MapPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    void selectCoordinates(latitude, longitude);
  };

  const handleSearch = async () => {
    const query = searchText.trim();
    if (!query) return;

    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
    if (!apiKey) {
      Alert.alert(
        "Map search unavailable",
        "The Google Maps API key is missing from this build.",
      );
      return;
    }

    setSearching(true);
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&region=in&key=${apiKey}`,
        { headers: { "Accept-Language": "en" } },
      );
      const data = await response.json();
      const result = data?.results?.[0];

      if (!response.ok || !result) {
        Alert.alert(
          "Location not found",
          data?.error_message ||
            "Google Maps could not find that location. Try a more specific search.",
        );
        return;
      }

      const latitude = result.geometry.location.lat;
      const longitude = result.geometry.location.lng;
      const name = result.formatted_address
        ? `${result.name || query}, ${result.formatted_address}`
        : result.name || query;

      setCenterLat(latitude);
      setCenterLon(longitude);
      setCenterName(name);
      setPickedLat(latitude);
      setPickedLon(longitude);
      mapRef.current?.animateToRegion(
        { latitude, longitude, ...MAP_DELTA },
        400,
      );
    } catch {
      Alert.alert(
        "Map search unavailable",
        "Check your internet connection and try again.",
      );
    } finally {
      setSearching(false);
    }
  };

  const handleLiveLocation = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(
          "Location permission required",
          "Allow location access in device settings to use your live location.",
        );
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = position.coords;
      await selectCoordinates(latitude, longitude);
      mapRef.current?.animateToRegion(
        { latitude, longitude, ...MAP_DELTA },
        400,
      );
    } catch {
      Alert.alert(
        "Live location unavailable",
        "Check GPS and location permissions, then try again.",
      );
    } finally {
      setLocating(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onShow={handleShow}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay}>
        <KeyboardAvoidingView
          style={styles.sheet}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.backButton}>
              <Feather name="arrow-left" size={20} color="#374151" />
              <ThemedText style={styles.backButtonText}>Back</ThemedText>
            </TouchableOpacity>
            <ThemedText style={styles.title}>Pin Location</ThemedText>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityLabel="Close location picker"
            >
              <Feather name="x" size={20} color="#374151" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Feather
              name="search"
              size={15}
              color="#9CA3AF"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search city, area or landmark…"
              placeholderTextColor="#9CA3AF"
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            {searching ? (
              <ActivityIndicator size="small" color="#60045d" />
            ) : (
              <TouchableOpacity onPress={handleSearch} style={styles.goButton}>
                <ThemedText style={styles.goButtonText}>Go</ThemedText>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={styles.liveLocationButton}
            onPress={handleLiveLocation}
            disabled={locating}
          >
            {locating ? (
              <ActivityIndicator size="small" color="#60045d" />
            ) : (
              <Feather name="crosshair" size={15} color="#60045d" />
            )}
            <ThemedText style={styles.liveLocationText}>
              {locating ? "Getting live location..." : "Use My Live Location"}
            </ThemedText>
          </TouchableOpacity>

          <View style={styles.mapContainer}>
            {!ready && (
              <View style={[StyleSheet.absoluteFill, styles.loader]}>
                <ActivityIndicator color="#60045d" size="large" />
                <ThemedText style={styles.loaderText}>
                  Loading map…
                </ThemedText>
              </View>
            )}
            <MapView
              key={mapKey}
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
              initialRegion={{
                latitude: centerLat,
                longitude: centerLon,
                ...MAP_DELTA,
              }}
              loadingEnabled
              showsUserLocation
              showsMyLocationButton
              onMapReady={() => setReady(true)}
              onPress={handleMapPress}
            >
              <Marker
                coordinate={{ latitude: pickedLat, longitude: pickedLon }}
                title={centerName}
                draggable
                onDragEnd={(event) => {
                  const { latitude, longitude } = event.nativeEvent.coordinate;
                  void selectCoordinates(latitude, longitude);
                }}
              />
            </MapView>
          </View>

          <View style={styles.footer}>
            <View style={styles.coordinateRow}>
              <Feather name="map-pin" size={14} color="#60045d" />
              <ThemedText style={styles.footerText}>
                {pickedLat.toFixed(6)}, {pickedLon.toFixed(6)}
              </ThemedText>
            </View>
            <ThemedText style={styles.footerHint}>
              Tap the map or drag the pin to adjust.
            </ThemedText>
            <TouchableOpacity
              style={styles.confirmButton}
              onPress={() =>
                onConfirm({
                  latitude: pickedLat,
                  longitude: pickedLon,
                  displayName: centerName,
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Confirm selected location"
            >
              <Feather name="check" size={18} color="#fff" />
              <ThemedText style={styles.confirmButtonText}>
                Confirm Location
              </ThemedText>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
  },
  sheet: {
    width: "100%",
    maxWidth: 720,
    height: "88%",
    minHeight: 480,
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: "#fff",
    elevation: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    minHeight: 54,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#fff",
    zIndex: 3,
  },
  backButton: {
    width: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
  },
  backButtonText: { color: "#374151", fontSize: 13, fontWeight: "600" },
  closeButton: {
    width: 44,
    alignItems: "flex-end",
    paddingVertical: 8,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
  },
  confirmButton: {
    width: "100%",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#60045d",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  confirmButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F3F4F6",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },
  goButton: {
    backgroundColor: "#60045d",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  goButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  liveLocationButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 12,
    marginBottom: 10,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#60045d40",
    backgroundColor: "#F5EEF5",
  },
  liveLocationText: { color: "#60045d", fontWeight: "700", fontSize: 13 },
  mapContainer: { flex: 1, minHeight: 220 },
  loader: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F9FAFB",
    zIndex: 10,
  },
  loaderText: { marginTop: 10, color: "#6B7280", fontSize: 13 },
  footer: {
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: "#F9FAFB",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    zIndex: 3,
  },
  coordinateRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  footerText: { fontSize: 12, color: "#60045d", fontWeight: "600" },
  footerHint: { fontSize: 11, color: "#6B7280" },
});
