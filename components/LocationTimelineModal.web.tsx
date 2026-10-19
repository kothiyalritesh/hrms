// Web version — Google Maps rendered directly (no iframe, no data: URI)
import React, { useEffect, useMemo, useRef } from "react";
import {
  Modal,
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import Spacer from "@/components/Spacer";
import { useTheme } from "@/hooks/useTheme";
import { loadGoogleMaps } from "@/utils/googleMapsLoader";
import {
  advancedMapOptions,
  loadAdvancedMarkerLibrary,
} from "@/utils/googleAdvancedMarkers";
import { parseDatabaseTimestamp } from "@/utils/businessDate";
import LocationDayStory, { LocationStory } from "@/components/LocationDayStory";

export interface PingPoint {
  latitude: number | null;
  longitude: number | null;
  recorded_at: string;
  gps_available: boolean;
  status: string;
  source?: string;
  /** Server quality of the point (RELIABLE, STALE, LOW_ACCURACY, IMPOSSIBLE_SPEED, MOCKED). */
  quality?: string;
  accuracy?: number | null;
}

interface Props {
  visible: boolean;
  employeeName: string;
  date: string;
  pings: PingPoint[];
  loading: boolean;
  onClose: () => void;
  /** The day as stays / trips / gaps (rpc_location_timeline). */
  story?: LocationStory | null;
}

function toIST(recorded_at: string) {
  if (!recorded_at) return new Date(NaN);
  try {
    return parseDatabaseTimestamp(recorded_at);
  } catch {
    return new Date(NaN);
  }
}

const QUALITY_LABELS: Record<string, { label: string; color: string }> = {
  RELIABLE: { label: "Good GPS", color: "#10B981" },
  STALE: { label: "Sent late", color: "#0284C7" },
  LOW_ACCURACY: { label: "Weak GPS", color: "#F59E0B" },
  IMPOSSIBLE_SPEED: { label: "GPS jump", color: "#DC2626" },
  MOCKED: { label: "Fake GPS", color: "#DC2626" },
  OUTSIDE_ALLOWED_REGION: { label: "Outside India", color: "#DC2626" },
};

function pingStatusLabel(p: PingPoint): { label: string; color: string } {
  if (p.quality && QUALITY_LABELS[p.quality]) {
    const q = QUALITY_LABELS[p.quality];
    return p.accuracy != null ? { label: `${q.label} ±${Math.round(p.accuracy)}m`, color: q.color } : q;
  }
  if (!p.gps_available) return { label: "GPS OFF", color: "#DC2626" };
  if (!p.latitude || !p.longitude)
    return { label: "No Coords", color: "#9CA3AF" };
  switch (p.status) {
    case "GREEN":
      return { label: "In Range", color: "#10B981" };
    case "YELLOW":
      return { label: "Near Edge", color: "#F59E0B" };
    case "ORANGE":
      return { label: "Far", color: "#F97316" };
    case "RED_RANGE":
      return { label: "Out of Range", color: "#DC2626" };
    case "RED_GPS_OFF":
      return { label: "GPS OFF", color: "#DC2626" };
    default:
      return { label: p.status, color: "#6B7280" };
  }
}

function GoogleMapView({ pings }: { pings: PingPoint[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  // Only use pings with real coordinates (not 0,0 default)
  const validPings = useMemo(
    () =>
      pings.filter(
        (p) =>
          p.latitude != null &&
          p.longitude != null &&
          Math.abs(p.latitude) > 0.1 &&
          Math.abs(p.longitude) > 0.1,
      ),
    [pings],
  );

  useEffect(() => {
    if (!mapRef.current || validPings.length === 0) return;

    void loadGoogleMaps()
      .then(async () => {
        if (!mapRef.current) return;
        const google = (window as any).google;
        const center =
          validPings.length > 0
            ? { lat: validPings[0].latitude!, lng: validPings[0].longitude! }
            : { lat: 28.6139, lng: 77.209 }; // India fallback

        const map = new google.maps.Map(mapRef.current, advancedMapOptions({
          center,
          zoom: 14,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "greedy",
        }));
        mapInstanceRef.current = map;
        const { AdvancedMarkerElement, PinElement } =
          await loadAdvancedMarkerLibrary(google);

        // Draw polyline
        new google.maps.Polyline({
          map,
          path: validPings.map((p) => ({
            lat: p.latitude!,
            lng: p.longitude!,
          })),
          strokeColor: "#3B82F6",
          strokeWeight: 2,
        });

        // Draw markers
        validPings.forEach((p, i) => {
          const color =
            i === 0
              ? "#10B981"
              : i === validPings.length - 1
                ? "#EF4444"
                : "#3B82F6";
          const time = toIST(p.recorded_at);
          const timeStr = isNaN(time.getTime())
            ? ""
            : time.toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              });
          const src = p.source === "app" ? "📱" : "🖥️";

          const pin = new PinElement({
            background: color,
            borderColor: "#ffffff",
            glyphColor: "#ffffff",
            scale: 0.85,
          });
          new AdvancedMarkerElement({
            map,
            position: { lat: p.latitude!, lng: p.longitude! },
            content: pin.element,
            title: `${src} ${timeStr}`,
          });
        });

        // Fit bounds
        if (validPings.length > 1) {
          const bounds = new google.maps.LatLngBounds();
          validPings.forEach((p) =>
            bounds.extend({ lat: p.latitude!, lng: p.longitude! }),
          );
          map.fitBounds(bounds);
        }
      })
      .catch(() => undefined);

    return () => {
      mapInstanceRef.current = null;
    };
  }, [validPings]);

  if (validPings.length === 0) return null;

  // @ts-ignore
  return (
    <div
      ref={mapRef}
      style={{
        width: "100%",
        height: 240,
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 8,
      }}
    />
  );
}

export default function LocationTimelineModal({
  visible,
  employeeName,
  date,
  pings,
  loading,
  onClose,
  story,
}: Props) {
  const { theme } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: theme.backgroundDefault }]}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: "700", fontSize: 15 }}>
                📍 {employeeName}
              </ThemedText>
              <ThemedText style={{ color: theme.textSecondary, fontSize: 12 }}>
                Location timeline — {date}
              </ThemedText>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Feather name="x" size={22} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ThemedText
              style={{
                textAlign: "center",
                color: theme.textSecondary,
                marginTop: 40,
              }}
            >
              Loading...
            </ThemedText>
          ) : pings.length === 0 && !story?.events?.length ? (
            <View style={{ alignItems: "center", paddingTop: 40 }}>
              <Feather name="map-pin" size={32} color={theme.textSecondary} />
              <Spacer height={12} />
              <ThemedText style={{ color: theme.textSecondary }}>
                No location pings for this day
              </ThemedText>
            </View>
          ) : (
            <>
              {/* @ts-ignore */}
              <GoogleMapView pings={pings} />
              {story ? (
                <ScrollView style={{ maxHeight: 260 }}>
                  <LocationDayStory story={story} />
                </ScrollView>
              ) : null}
              <ThemedText
                style={{
                  fontSize: 11,
                  color: theme.textSecondary,
                  marginBottom: 4,
                  fontWeight: "600",
                }}
              >
                PING LOG ({pings.length} events)
              </ThemedText>
              <ScrollView style={{ maxHeight: 220 }}>
                {pings.map((p, i) => {
                  const { label, color } = pingStatusLabel(p);
                  const time = toIST(p.recorded_at);
                  const timeStr = isNaN(time.getTime())
                    ? p.recorded_at
                    : time.toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true,
                      });
                  const srcIcon =
                    p.source === "app"
                      ? "📱"
                      : p.source === "web"
                        ? "🖥️"
                        : "";
                  const isCheckin = (p as any).is_checkin;
                  return (
                    <View
                      key={i}
                      style={[
                        s.pingRow,
                        {
                          backgroundColor: !p.gps_available
                            ? "#FEF2F2"
                            : isCheckin
                              ? "#F0FDF4"
                              : "transparent",
                        },
                      ]}
                    >
                      <View style={[s.dot, { backgroundColor: color }]} />
                      <ThemedText
                        style={{
                          fontSize: 12,
                          fontWeight: "700",
                          width: 52,
                          color: "#111",
                        }}
                      >
                        {timeStr}
                      </ThemedText>
                      <View style={{ flex: 1 }}>
                        {p.latitude && p.longitude ? (
                          <ThemedText
                            style={{ fontSize: 11, color: theme.textSecondary }}
                          >
                            {isCheckin ? "🏢 Check-in (event, not GPS) · " : ""}
                            {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                          </ThemedText>
                        ) : (
                          <ThemedText
                            style={{ fontSize: 11, color, fontWeight: "600" }}
                          >
                            {label}
                          </ThemedText>
                        )}
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <ThemedText style={{ fontSize: 10 }}>
                          {srcIcon}
                        </ThemedText>
                        <View
                          style={[
                            s.statusChip,
                            { backgroundColor: color + "20" },
                          ]}
                        >
                          <ThemedText
                            style={{ fontSize: 10, color, fontWeight: "700" }}
                          >
                            {label}
                          </ThemedText>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 32,
    maxHeight: "85%",
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  pingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
    borderRadius: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  statusChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
});
