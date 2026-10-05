// MapPickerModal.web.tsx — Google Maps rendered directly (no iframe, no data: URI)
import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { loadGoogleMaps } from "@/utils/googleMapsLoader";
import {
  advancedMapOptions,
  loadAdvancedMarkerLibrary,
  markerCoordinate,
} from "@/utils/googleAdvancedMarkers";

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

export default function MapPickerModal({
  visible,
  initialLat,
  initialLon,
  initialName,
  onConfirm,
  onClose,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [pickedLat, setPickedLat] = useState(initialLat);
  const [pickedLon, setPickedLon] = useState(initialLon);
  const [pickedName, setPickedName] = useState(initialName);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [locationError, setLocationError] = useState("");
  const [locating, setLocating] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Reset on open
  useEffect(() => {
    if (visible) {
      setPickedLat(initialLat);
      setPickedLon(initialLon);
      setPickedName(initialName);
      setMapReady(false);
      setMapError("");
      setLocationError("");
    }
  }, [visible, initialLat, initialLon, initialName]);

  // Init map when modal becomes visible and div is mounted
  useEffect(() => {
    if (!visible) return;
    // Small delay to let the Modal render the div
    const timer = setTimeout(() => {
      if (!mapRef.current) return;
      void loadGoogleMaps()
        .then(async () => {
          if (!mapRef.current) return;
          const google = (window as any).google;
          if (!google?.maps?.places) {
            throw new Error("Google Maps and Places are unavailable");
          }

          const map = new google.maps.Map(mapRef.current, advancedMapOptions({
            center: { lat: initialLat, lng: initialLon },
            zoom: 16,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: "greedy",
          }));
          mapInstanceRef.current = map;

          const { AdvancedMarkerElement } = await loadAdvancedMarkerLibrary(google);
          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: initialLat, lng: initialLon },
            gmpDraggable: true,
            title: initialName,
          });
          markerRef.current = marker;

          const geocoderRef_unused = null; // Geocoder replaced by Nominatim
          const nominatimReverseGeocode = async (lat: number, lng: number): Promise<string | null> => {
            try {
              const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
                { headers: { Accept: "application/json" } },
              );
              if (!res.ok) return null;
              const json = await res.json();
              return typeof json?.display_name === "string" ? json.display_name : null;
            } catch { return null; }
          };
          const updatePickedLocation = (lat: number, lng: number) => {
            setPickedLat(lat);
            setPickedLon(lng);
            void nominatimReverseGeocode(lat, lng).then((addr) => {
              if (addr) setPickedName(addr);
            });
          };

          marker.addEventListener("gmp-dragend", () => {
            updatePickedLocation(
              markerCoordinate(marker.position, "lat"),
              markerCoordinate(marker.position, "lng"),
            );
          });

          map.addListener("click", (e: any) => {
            marker.position = e.latLng;
            updatePickedLocation(e.latLng.lat(), e.latLng.lng());
          });

          // Resolve a meaningful label even when the user confirms the initial pin.
          updatePickedLocation(initialLat, initialLon);

          // Places Autocomplete using PlaceAutocompleteElement (replaces deprecated Autocomplete)
          if (inputRef.current) {
            const { PlaceAutocompleteElement } = await google.maps.importLibrary("places") as any;
            const placeAuto = new PlaceAutocompleteElement({
              componentRestrictions: { country: "in" },
            });
            // Hide the built-in input and use our styled one as a trigger
            placeAuto.style.display = "none";
            inputRef.current.parentElement?.appendChild(placeAuto);
            // Forward typed text to the element
            inputRef.current.addEventListener("input", () => {
              placeAuto.value = inputRef.current?.value ?? "";
            });
            placeAuto.addEventListener("gmp-placeselect", async (event: any) => {
              const place = event.place;
              await place.fetchFields({ fields: ["location", "displayName", "formattedAddress"] });
              if (!place.location) return;
              const lat = place.location.lat();
              const lng = place.location.lng();
              map.setCenter({ lat, lng });
              map.setZoom(17);
              marker.position = { lat, lng };
              setPickedLat(lat);
              setPickedLon(lng);
              const name = place.displayName || place.formattedAddress || "";
              setPickedName(name);
              if (inputRef.current) inputRef.current.value = name;
            });
          }

          setMapError("");
          setMapReady(true);
        })
        .catch((error) => {
          setMapReady(false);
          setMapError(
            error instanceof Error
              ? error.message
              : "The map could not be loaded.",
          );
        });
    }, 100);
    return () => clearTimeout(timer);
  }, [visible, initialLat, initialLon, initialName, loadAttempt]);

  // Update marker if initialLat/Lon changes while open
  useEffect(() => {
    if (!mapReady || !markerRef.current || !mapInstanceRef.current) return;
    const pos = { lat: initialLat, lng: initialLon };
    markerRef.current.position = pos;
    mapInstanceRef.current.setCenter(pos);
  }, [initialLat, initialLon, mapReady]);

  const useLiveLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("This browser does not support location access.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setPickedLat(lat);
        setPickedLon(lng);
        setPickedName(
          `Current location (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
        );
        markerRef.current?.setPosition({ lat, lng });
        mapInstanceRef.current?.setCenter({ lat, lng });
        mapInstanceRef.current?.setZoom(17);
        void fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
          { headers: { Accept: "application/json" } },
        )
          .then((r) => r.json())
          .then((json) => {
            if (typeof json?.display_name === "string") setPickedName(json.display_name);
          })
          .catch(() => {});
        setLocationError("");
        setLocating(false);
      },
      (error) => {
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Allow it in browser settings."
            : "Live location could not be obtained. Check GPS and try again.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={s.container}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <Feather name="x" size={20} color="#374151" />
          </TouchableOpacity>
          <ThemedText style={s.title}>Pin Location on Map</ThemedText>
          <TouchableOpacity
            style={[s.confirmBtn, !mapReady && s.disabledBtn]}
            disabled={!mapReady}
            onPress={() =>
              onConfirm({
                latitude: pickedLat,
                longitude: pickedLon,
                displayName: pickedName,
              })
            }
          >
            <Feather name="check" size={16} color="#fff" />
            <ThemedText style={s.confirmBtnText}>Confirm</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Search input — rendered as native HTML input for Places Autocomplete */}
        <View style={s.searchRow}>
          <Feather
            name="search"
            size={15}
            color="#9CA3AF"
            style={{ marginRight: 8 }}
          />
          {/* @ts-ignore */}
          <input
            ref={inputRef}
            type="text"
            placeholder="Search city, area or landmark…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 14,
              background: "transparent",
              color: "#111827",
              fontFamily: "inherit",
            }}
          />
          <TouchableOpacity
            style={s.liveBtn}
            onPress={useLiveLocation}
            disabled={!mapReady || locating}
          >
            {locating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="crosshair" size={14} color="#fff" />
            )}
            <ThemedText style={s.liveBtnText}>Live</ThemedText>
          </TouchableOpacity>
        </View>
        {!!locationError && (
          <ThemedText style={s.locationError}>{locationError}</ThemedText>
        )}

        {/* Map */}
        <View style={{ flex: 1, position: "relative" }}>
          {!mapReady && (
            <View style={[StyleSheet.absoluteFill, s.loader]}>
              <ActivityIndicator color="#60045d" size="large" />
              <ThemedText style={s.loaderText}>Loading map…</ThemedText>
            </View>
          )}
          {!!mapError && (
            <View style={[StyleSheet.absoluteFill, s.loader]}>
              <Feather name="alert-circle" size={28} color="#B91C1C" />
              <ThemedText style={s.errorText}>{mapError}</ThemedText>
              <TouchableOpacity
                style={s.retryBtn}
                onPress={() => {
                  setMapError("");
                  setLoadAttempt((value) => value + 1);
                }}
              >
                <ThemedText style={s.retryBtnText}>Retry Map</ThemedText>
              </TouchableOpacity>
            </View>
          )}
          {/* @ts-ignore */}
          <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Feather name="map-pin" size={13} color="#60045d" />
          <ThemedText style={s.footerText}>
            {pickedLat.toFixed(6)}, {pickedLon.toFixed(6)}
          </ThemedText>
          <ThemedText style={s.footerHint}>
            Tap map or drag pin to adjust
          </ThemedText>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  closeBtn: { padding: 4, width: 44 },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#60045d",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  confirmBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  disabledBtn: { opacity: 0.45 },
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
  liveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#60045d",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  liveBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  locationError: {
    color: "#B91C1C",
    fontSize: 12,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  loader: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F9FAFB",
    zIndex: 10,
  },
  loaderText: { marginTop: 10, color: "#6B7280", fontSize: 13 },
  errorText: {
    marginTop: 8,
    color: "#B91C1C",
    fontSize: 13,
    textAlign: "center",
    maxWidth: 360,
  },
  retryBtn: {
    marginTop: 12,
    backgroundColor: "#60045d",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#F9FAFB",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  footerText: { fontSize: 12, color: "#60045d", fontWeight: "600" },
  footerHint: { fontSize: 11, color: "#9CA3AF", marginLeft: "auto" },
});
