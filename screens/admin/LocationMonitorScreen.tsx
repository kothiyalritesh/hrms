import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { formatHrmsTime } from "@/utils/attendanceTimestamp";
import { googleMapsDeepLink } from "@/utils/googleGeolocation";
import { minutesAgo } from "@/utils/locationFreshness";
import { callPhone, formatPhone } from "@/utils/phoneCall";

export type MonitorStatus =
  | "OUTSIDE"
  | "NO_RECENT_LOCATION"
  | "NO_LOCATION"
  | "NEAR"
  | "TRAVELLING"
  | "INSIDE"
  | "NO_REFERENCE";

export type MonitorRow = {
  user_id: string;
  name: string;
  employee_number: string | null;
  phone: string | null;
  status: MonitorStatus;
  reference_kind: "OFFICE" | "SITE";
  reference_name: string | null;
  visit_status: string | null;
  place_state: string | null;
  distance_m: number | null;
  radius_m: number | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  location_at: string | null;
  last_seen_at: string | null;
  checkin_time: string | null;
  exit_event_id: string | null;
  exit_status: string | null;
  exit_detected_at: string | null;
  exit_returned_at: string | null;
  exit_has_reason: boolean;
};

const FRESH_MINUTES = 15;

export const STATUS_UI: Record<MonitorStatus, { label: string; color: string; icon: keyof typeof Feather.glyphMap; help: string }> = {
  OUTSIDE: {
    label: "Outside radius",
    color: "#DC2626",
    icon: "alert-octagon",
    help: "Recent GPS (under 15 min old) puts them clearly beyond the allowed radius.",
  },
  NO_RECENT_LOCATION: {
    label: "No recent location",
    color: "#D97706",
    icon: "clock",
    help: "No good GPS update for over 15 minutes, so where they are now is unknown. The last known place is shown.",
  },
  NO_LOCATION: {
    label: "No location today",
    color: "#6B7280",
    icon: "slash",
    help: "Checked in, but the phone has not sent any good GPS location today.",
  },
  NEAR: {
    label: "At the edge",
    color: "#CA8A04",
    icon: "minus-circle",
    help: "Just beyond the radius, or GPS is too inaccurate to be sure. Not treated as outside.",
  },
  TRAVELLING: {
    label: "Travelling to visit",
    color: "#0284C7",
    icon: "navigation",
    help: "On the way to an assigned field-visit site.",
  },
  INSIDE: { label: "Inside radius", color: "#059669", icon: "check-circle", help: "Within the allowed radius." },
  NO_REFERENCE: {
    label: "No location set for the place",
    color: "#6B7280",
    icon: "help-circle",
    help: "The office or site has no coordinates, so inside / outside cannot be checked.",
  },
};

const ORDER: MonitorStatus[] = ["OUTSIDE", "NO_RECENT_LOCATION", "NO_LOCATION", "NEAR", "TRAVELLING", "INSIDE", "NO_REFERENCE"];
const ATTENTION = new Set<MonitorStatus>(["OUTSIDE", "NO_RECENT_LOCATION", "NO_LOCATION"]);

type Filter = "ATTENTION" | "ALL" | MonitorStatus;

function ageText(iso: string | null) {
  const mins = minutesAgo(iso);
  if (mins == null) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)} min ago`;
  const h = Math.floor(mins / 60);
  return `${h} h ${Math.floor(mins % 60)} min ago`;
}

function placeText(row: MonitorRow) {
  const place = row.reference_kind === "SITE" ? `site ${row.reference_name || ""}`.trim() : row.reference_name || "office";
  if (row.distance_m == null) return null;
  const allowed = row.radius_m != null ? ` · allowed ${Math.round(row.radius_m)} m` : "";
  return `${Math.round(row.distance_m)} m from ${place}${allowed}`;
}

const LAST_KNOWN: Record<string, string> = {
  INSIDE: "inside",
  AT_SITE: "at the site",
  NEAR: "at the edge",
  NEAR_SITE: "near the site",
  OUTSIDE: "outside",
  LEFT_SITE: "away from the site",
  APPROACHING: "on the way",
};

/**
 * Who is inside / outside the permitted radius of their office or active
 * field-visit site right now (server: rpc_location_monitor). "Outside" needs a
 * recent fix; people without one are listed separately as no recent / no
 * location, so a missing signal is never shown as a violation.
 */
export default function LocationMonitorScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ATTENTION");
  const [query, setQuery] = useState("");
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const { data, error: rpcError } = await supabase.rpc("rpc_location_monitor");
      if (rpcError) {
        setError(
          ["PGRST202", "42883"].includes(String(rpcError.code))
            ? "The location monitor is not installed on the server yet (migration 20261021120000)."
            : "Could not load locations. Pull down to retry.",
        );
        return;
      }
      setError(null);
      setRows(((data as any)?.employees ?? []) as MonitorRow[]);
      setGeneratedAt((data as any)?.generated_at ?? null);
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), 60_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  const counts = useMemo(() => {
    const c = new Map<MonitorStatus, number>();
    rows.forEach((r) => c.set(r.status, (c.get(r.status) ?? 0) + 1));
    return c;
  }, [rows]);
  const attentionCount = rows.filter((r) => ATTENTION.has(r.status)).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "ATTENTION" && !ATTENTION.has(r.status)) return false;
      if (filter !== "ATTENTION" && filter !== "ALL" && r.status !== filter) return false;
      if (!q) return true;
      return [r.name, r.employee_number, r.reference_name].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  const chips: { key: Filter; label: string; count: number; color: string }[] = [
    { key: "ATTENTION", label: "Needs attention", count: attentionCount, color: "#DC2626" },
    { key: "ALL", label: "All checked in", count: rows.length, color: theme.primary },
    ...ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({
      key: s as Filter,
      label: STATUS_UI[s].label,
      count: counts.get(s) ?? 0,
      color: STATUS_UI[s].color,
    })),
  ];

  const header = (
    <View style={{ gap: 12, marginBottom: 12 }}>
      <View style={styles.summary}>
        {(["OUTSIDE", "NO_RECENT_LOCATION", "NO_LOCATION", "INSIDE"] as MonitorStatus[]).map((s) => (
          <Pressable
            key={s}
            onPress={() => setFilter(s)}
            style={[styles.stat, { borderColor: STATUS_UI[s].color + "55", backgroundColor: STATUS_UI[s].color + "12" }]}
            accessibilityRole="button"
            accessibilityLabel={`${STATUS_UI[s].label}: ${counts.get(s) ?? 0}`}
          >
            <ThemedText style={[styles.statValue, { color: STATUS_UI[s].color }]}>{counts.get(s) ?? 0}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={2}>
              {STATUS_UI[s].label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <View style={[styles.search, { borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}>
        <Feather name="search" size={16} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, employee no. or place"
          placeholderTextColor={theme.textSecondary}
          style={[styles.searchInput, { color: theme.text }]}
        />
      </View>
      <View style={styles.chips}>
        {chips.map((c) => {
          const active = filter === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => setFilter(c.key)}
              style={[styles.chip, { borderColor: active ? c.color : theme.border, backgroundColor: active ? c.color + "18" : "transparent" }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <ThemedText style={{ fontWeight: "700", color: active ? c.color : theme.text }}>
                {c.label} · {c.count}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      {filter !== "ATTENTION" && filter !== "ALL" ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>{STATUS_UI[filter].help}</ThemedText>
      ) : (
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Outside = recent GPS beyond the allowed radius. No recent location = no GPS for {FRESH_MINUTES}+ min (whereabouts unknown,
          not counted as outside).{generatedAt ? ` Updated ${formatHrmsTime(generatedAt)}.` : ""}
        </ThemedText>
      )}
      {error ? (
        <View style={[styles.error, { borderColor: theme.error }]}>
          <Feather name="alert-circle" size={16} color={theme.error} />
          <ThemedText style={{ color: theme.error, flex: 1 }}>{error}</ThemedText>
        </View>
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: MonitorRow }) => {
    const ui = STATUS_UI[item.status] ?? STATUS_UI.NO_REFERENCE;
    const place = placeText(item);
    const hasFix = item.latitude != null && item.longitude != null && item.location_at;
    const seenNewer =
      item.last_seen_at &&
      (!item.location_at || (minutesAgo(item.location_at) ?? 0) - (minutesAgo(item.last_seen_at) ?? 0) >= 5);
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border, borderLeftColor: ui.color }]}>
        <View style={styles.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText style={{ fontWeight: "800" }} numberOfLines={1}>{item.name}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {[item.employee_number, item.phone ? formatPhone(item.phone) : null].filter(Boolean).join(" · ") || "—"}
            </ThemedText>
          </View>
          <View style={[styles.badge, { backgroundColor: ui.color + "18" }]}>
            <Feather name={ui.icon} size={13} color={ui.color} />
            <ThemedText style={{ color: ui.color, fontWeight: "800", fontSize: 12 }}>{ui.label}</ThemedText>
          </View>
        </View>

        <View style={styles.line}>
          <Feather name={item.reference_kind === "SITE" ? "briefcase" : "home"} size={14} color={theme.textSecondary} />
          <ThemedText style={{ flex: 1 }} numberOfLines={2}>
            {item.reference_kind === "SITE"
              ? `Field visit: ${item.reference_name || "site"}${item.visit_status === "IN_TRANSIT" ? " (on the way)" : ""}`
              : `Office: ${item.reference_name || "not set"}`}
          </ThemedText>
        </View>
        {place ? (
          <View style={styles.line}>
            <Feather name="map-pin" size={14} color={item.status === "OUTSIDE" ? ui.color : theme.textSecondary} />
            <ThemedText style={{ flex: 1, color: item.status === "OUTSIDE" ? ui.color : theme.text, fontWeight: item.status === "OUTSIDE" ? "700" : "400" }}>
              {item.status === "NO_RECENT_LOCATION" && item.place_state
                ? `Last known: ${LAST_KNOWN[item.place_state] ?? item.place_state.toLowerCase()}, ${place}`
                : place}
            </ThemedText>
          </View>
        ) : null}
        <View style={styles.line}>
          <Feather name="clock" size={14} color={theme.textSecondary} />
          <ThemedText style={{ flex: 1, color: item.status === "NO_RECENT_LOCATION" ? STATUS_UI.NO_RECENT_LOCATION.color : theme.text }}>
            {hasFix
              ? `Last location ${formatHrmsTime(item.location_at)} (${ageText(item.location_at)})${item.accuracy_m != null ? ` · ±${Math.round(item.accuracy_m)} m` : ""}`
              : "No GPS location received today"}
          </ThemedText>
        </View>
        {seenNewer ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Phone last reported {formatHrmsTime(item.last_seen_at)} without a usable GPS fix (GPS off, indoors or poor signal).
          </ThemedText>
        ) : null}
        {item.exit_event_id ? (
          <Pressable onPress={() => navigation.navigate("OfficeExitReviews")} style={[styles.exit, { backgroundColor: theme.backgroundSecondary }]}>
            <Feather name="log-out" size={14} color={theme.error} />
            <ThemedText type="caption" style={{ flex: 1 }}>
              Left the office {item.exit_detected_at ? `at ${formatHrmsTime(item.exit_detected_at)}` : ""}
              {item.exit_returned_at ? ` · back at ${formatHrmsTime(item.exit_returned_at)}` : ""}
              {" · "}
              {item.exit_has_reason ? "reason given, waiting for review" : item.exit_status === "POTENTIAL_EXIT" ? "under 10 min so far" : "waiting for the employee's reason"}
            </ThemedText>
            <Feather name="chevron-right" size={14} color={theme.textSecondary} />
          </Pressable>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            onPress={() => void callPhone(item.phone, item.name)}
            disabled={!item.phone}
            style={[styles.action, { borderColor: theme.success, opacity: item.phone ? 1 : 0.45 }]}
            accessibilityRole="button"
            accessibilityLabel={item.phone ? `Call ${item.name}` : `${item.name} has no phone number`}
          >
            <Feather name="phone" size={16} color={theme.success} />
            <ThemedText style={{ color: theme.success, fontWeight: "800" }}>{item.phone ? "Call" : "No phone"}</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => hasFix && void Linking.openURL(googleMapsDeepLink(Number(item.latitude), Number(item.longitude)))}
            disabled={!hasFix}
            style={[styles.action, { borderColor: theme.primary, opacity: hasFix ? 1 : 0.45 }]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}'s last location on the map`}
          >
            <Feather name="map" size={16} color={theme.primary} />
            <ThemedText style={{ color: theme.primary, fontWeight: "800" }}>Map</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.backgroundRoot }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={styles.content}
      data={visible}
      keyExtractor={(r) => r.user_id}
      renderItem={renderItem}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListEmptyComponent={
        error ? null : (
          <View style={[styles.empty, { borderColor: theme.border }]}>
            <Feather name="check-circle" size={26} color={theme.success} />
            <ThemedText style={{ fontWeight: "800", textAlign: "center" }}>
              {rows.length === 0 ? "No one you can track is checked in right now" : "No one in this group"}
            </ThemedText>
          </View>
        )
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={theme.primary}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 48, width: "100%", maxWidth: 860, alignSelf: "center" },
  summary: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  statValue: { fontSize: 22, fontWeight: "800" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 16, minHeight: 44 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  error: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  card: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, flexShrink: 0 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  exit: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, padding: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 2 },
  action: { flex: 1, minHeight: 44, borderWidth: 1.5, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  empty: { borderWidth: 1, borderStyle: "dashed", borderRadius: 12, padding: 24, alignItems: "center", gap: 8 },
});
