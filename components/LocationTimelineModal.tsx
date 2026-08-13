// Native version — uses react-native-maps
import React from "react";
import {
  Modal,
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import Spacer from "@/components/Spacer";
import { useTheme } from "@/hooks/useTheme";
import { parseDatabaseTimestamp } from "@/utils/businessDate";

export interface PingPoint {
  latitude: number | null;
  longitude: number | null;
  recorded_at: string;
  gps_available: boolean;
  status: string;
  source?: string;
}

type ValidPingPoint = PingPoint & { latitude: number; longitude: number };

interface Props {
  visible: boolean;
  employeeName: string;
  date: string;
  pings: PingPoint[];
  loading: boolean;
  onClose: () => void;
}

function toIST(recorded_at: string) {
  if (!recorded_at) return new Date(NaN);
  try {
    return parseDatabaseTimestamp(recorded_at);
  } catch {
    return new Date(NaN);
  }
}

export default function LocationTimelineModal({
  visible,
  employeeName,
  date,
  pings,
  loading,
  onClose,
}: Props) {
  const { theme } = useTheme();
  const validPings = pings.filter(
    (ping): ping is ValidPingPoint =>
      Number.isFinite(ping.latitude) && Number.isFinite(ping.longitude),
  );

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
                Hourly location timeline — {date}
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
          ) : validPings.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 40 }}>
              <Feather name="map-pin" size={32} color={theme.textSecondary} />
              <Spacer height={12} />
              <ThemedText style={{ color: theme.textSecondary }}>
                No location pings for this day
              </ThemedText>
            </View>
          ) : (
            <>
              <MapView
                style={s.map}
                initialRegion={{
                  latitude: validPings[0].latitude,
                  longitude: validPings[0].longitude,
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02,
                }}
              >
                <Polyline
                  coordinates={validPings.map((p) => ({
                    latitude: p.latitude,
                    longitude: p.longitude,
                  }))}
                  strokeColor="#3B82F6"
                  strokeWidth={2}
                />
                {validPings.map((p, i) => (
                  <Marker
                    key={i}
                    coordinate={{
                      latitude: p.latitude,
                      longitude: p.longitude,
                    }}
                    title={toIST(p.recorded_at).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    pinColor={
                      i === 0
                        ? "#10B981"
                        : i === validPings.length - 1
                          ? "#EF4444"
                          : "#3B82F6"
                    }
                  />
                ))}
              </MapView>
              <PingList pings={validPings} theme={theme} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function PingList({
  pings,
  theme,
}: {
  pings: ValidPingPoint[];
  theme: any;
}) {
  return (
    <ScrollView style={{ maxHeight: 140, marginTop: 10 }}>
      {pings.map((p, i) => (
        <View key={i} style={s.pingRow}>
          <View
            style={[
              s.dot,
              {
                backgroundColor:
                  i === 0
                    ? "#10B981"
                    : i === pings.length - 1
                      ? "#EF4444"
                      : "#3B82F6",
              },
            ]}
          />
          <ThemedText style={{ fontSize: 12, fontWeight: "600", width: 50 }}>
            {toIST(p.recorded_at).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </ThemedText>
          <ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>
            {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
          </ThemedText>
        </View>
      ))}
    </ScrollView>
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
  map: { height: 280, borderRadius: 12 },
  pingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
