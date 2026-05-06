import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Colors, Spacing } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { LocationLog, LocationService } from "@/services/location.service";

const STATUS_META = {
  IN_ZONE: { label: "In Zone", color: Colors.light.success, icon: "check-circle" as const },
  OUT_OF_BOUND: { label: "Out of Bound", color: Colors.light.error, icon: "alert-triangle" as const },
  WARNING: { label: "Warning", color: Colors.light.warning, icon: "alert-circle" as const },
};

function formatTime(ts?: string) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function LiveTrackingScreen() {
  const { theme } = useTheme();
  const [liveLocations, setLiveLocations] = useState<LocationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<"ALL" | "IN_ZONE" | "OUT_OF_BOUND" | "WARNING">("ALL");

  const loadData = useCallback(async () => {
    try {
      const live = await LocationService.getLiveLocations();
      setLiveLocations(live);
      setLastUpdated(new Date());
    } catch (e) {
      console.warn("[LiveTracking] error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      const timer = setInterval(loadData, 30_000); // refresh every 30s
      return () => clearInterval(timer);
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const filtered = useMemo(
    () => filter === "ALL" ? liveLocations : liveLocations.filter((l) => l.status === filter),
    [liveLocations, filter]
  );

  const summary = useMemo(() => ({
    total: liveLocations.length,
    inZone: liveLocations.filter((l) => l.status === "IN_ZONE" && !(l as any)._noGps).length,
    out: liveLocations.filter((l) => l.status === "OUT_OF_BOUND").length,
    warning: liveLocations.filter((l) => l.status === "WARNING").length,
    noGps: liveLocations.filter((l) => (l as any)._noGps).length,
  }), [liveLocations]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
        <Spacer height={Spacing.md} />
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Loading live GPS data...
        </ThemedText>
      </View>
    );
  }

  return (
    <ScreenScrollView
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
      }
    >
      {/* Live indicator */}
      <View style={styles.liveRow}>
        <View style={styles.liveDot} />
        <ThemedText type="caption" style={{ color: Colors.light.success, fontWeight: "700" }}>
          LIVE
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: Spacing.sm }}>
          Auto-refreshes every 30s
          {lastUpdated ? `  ·  Updated ${formatTime(lastUpdated.toISOString())}` : ""}
        </ThemedText>
        <Pressable onPress={loadData} style={styles.refreshBtn}>
          <Feather name="refresh-cw" size={14} color={theme.primary} />
        </Pressable>
      </View>

      <Spacer height={Spacing.md} />

      {/* Summary tiles */}
      <View style={styles.summaryRow}>
        <SummaryTile label="Checked In" value={summary.total} color={Colors.light.info} icon="radio" />
        <SummaryTile label="In Zone" value={summary.inZone} color={Colors.light.success} icon="check-circle" />
        <SummaryTile label="Out" value={summary.out} color={Colors.light.error} icon="alert-triangle" />
        <SummaryTile label="No GPS" value={summary.noGps} color={Colors.light.warning} icon="clock" />
      </View>

      <Spacer height={Spacing.lg} />

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(["ALL", "IN_ZONE", "OUT_OF_BOUND", "WARNING"] as const).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[
              styles.filterTab,
              { backgroundColor: filter === f ? theme.primary : theme.backgroundSecondary },
            ]}
          >
            <ThemedText
              type="caption"
              style={{ color: filter === f ? "#FFFFFF" : theme.text, fontWeight: "600" }}
            >
              {f === "ALL" ? "All" : f === "IN_ZONE" ? "In Zone" : f === "OUT_OF_BOUND" ? "Out" : "Warning"}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <Spacer height={Spacing.lg} />

      {/* Employee list */}
      {filtered.length === 0 ? (
        <View style={[styles.emptyBox, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="map-pin" size={36} color={theme.textSecondary} />
          <Spacer height={Spacing.sm} />
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            No employees checked in today
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
            Employees appear here once they check in
          </ThemedText>
        </View>
      ) : (
        filtered.map((loc) => {
          const meta = STATUS_META[loc.status];
          const noGps = (loc as any)._noGps === true;
          return (
            <View
              key={loc.id}
              style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
            >
              <View style={[styles.statusIcon, { backgroundColor: meta.color + "22" }]}>
                <Feather name={meta.icon} size={20} color={meta.color} />
              </View>
              <View style={styles.cardBody}>
                <ThemedText type="body" style={{ fontWeight: "700", color: theme.text }}>
                  {loc.employee?.name || "Unknown"}
                </ThemedText>
                {noGps ? (
                  <ThemedText type="caption" style={{ color: Colors.light.warning }}>
                    ⏳ Checked in · waiting for GPS ping
                  </ThemedText>
                ) : (
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {meta.label} · {loc.distance_m}m from zone · {formatTime(loc.timestamp)}
                  </ThemedText>
                )}
                {!noGps && loc.address ? (
                  <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
                    📍 {loc.address}
                  </ThemedText>
                ) : !noGps && loc.latitude !== 0 ? (
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    📍 {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                  </ThemedText>
                ) : null}
              </View>
              <View style={[styles.badge, { backgroundColor: (noGps ? Colors.light.warning : meta.color) + "22" }]}>
                <ThemedText
                  type="caption"
                  style={{ color: noGps ? Colors.light.warning : meta.color, fontWeight: "700", fontSize: 10 }}
                >
                  {noGps ? "NO GPS" : loc.status === "IN_ZONE" ? "ACTIVE" : loc.status}
                </ThemedText>
              </View>
            </View>
          );
        })
      )}

      <Spacer height={Spacing["2xl"]} />
    </ScreenScrollView>
  );
}

function SummaryTile({
  label, value, color, icon,
}: {
  label: string; value: number; color: string; icon: keyof typeof Feather.glyphMap;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.backgroundDefault }]}>
      <View style={[styles.tileIcon, { backgroundColor: color + "22" }]}>
        <Feather name={icon} size={16} color={color} />
      </View>
      <ThemedText type="h3" style={{ color: theme.text }}>{value}</ThemedText>
      <ThemedText type="caption" style={{ color: theme.textSecondary }}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xl },
  liveRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  liveDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.light.success,
  },
  refreshBtn: { marginLeft: "auto", padding: Spacing.sm },
  summaryRow: { flexDirection: "row", gap: Spacing.sm },
  tile: {
    flex: 1, alignItems: "center", padding: Spacing.md,
    borderRadius: BorderRadius.md, gap: 2,
  },
  tileIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center", marginBottom: 2,
  },
  filterRow: { flexDirection: "row", gap: Spacing.sm, flexWrap: "wrap" },
  filterTab: {
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: BorderRadius.full,
  },
  emptyBox: {
    alignItems: "center", padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
  },
  card: {
    flexDirection: "row", alignItems: "center", gap: Spacing.md,
    padding: Spacing.md, borderRadius: BorderRadius.md, marginBottom: Spacing.sm,
  },
  statusIcon: {
    width: 40, height: 40, borderRadius: BorderRadius.sm,
    alignItems: "center", justifyContent: "center",
  },
  cardBody: { flex: 1, gap: 2 },
  badge: {
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
});
