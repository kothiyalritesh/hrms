import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, Pressable, TextInput,
  RefreshControl, Platform,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { formatDate, toTitleCase } from "@/utils/format";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
import { addBusinessDays } from "@/utils/businessDate";

interface CheckedInUser {
  id: string;
  user_name: string;
  user_role: string;
  checkin_time: string;
  latitude: number | null;
  longitude: number | null;
  distance_from_office: number | null;
}

interface BlockedUser {
  id: string;
  user_name: string;
  user_role: string;
  attempted_at: string;
  latitude: number | null;
  longitude: number | null;
  nearest_office_name: string | null;
  nearest_office_distance_m: number | null;
  status: "blocked" | "failed";
  failure_reason: string | null;
}

function toUTC(iso: string | null): Date | null {
  if (!iso) return null;
  return new Date(iso.includes("Z") || iso.includes("+") ? iso : iso + "Z");
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return toUTC(iso)!.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MiniMap({ lat, lon, name }: { lat: number; lon: number; name: string }) {
  if (Platform.OS !== "web") {
    return (
      <View style={styles.noMapBox}>
        <Feather name="map-pin" size={12} color="#9CA3AF" />
        <ThemedText type="caption" style={{ color: "#9CA3AF", marginLeft: 4, fontSize: 10 }}>
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </ThemedText>
      </View>
    );
  }
  const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const mapUrl = `https://www.google.com/maps/embed/v1/view?key=${GMAPS_KEY}&center=${lat},${lon}&zoom=16`;
  // @ts-ignore
  return <iframe src={mapUrl} style={{ width: "100%", height: 150, border: "none", borderRadius: 6, display: "block", marginTop: 6 }} title={name} allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade" />;
}

function CheckedInCard({ item }: { item: CheckedInUser }) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const hasCoords = item.latitude != null && item.longitude != null;

  return (
    <Pressable
      style={[styles.rowCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: "#10B981" }]}
      onPress={() => setExpanded(e => !e)}
    >
      <View style={styles.rowCardTop}>
        <View style={{ flex: 1 }}>
          <ThemedText type="small" style={{ fontWeight: "700" }} numberOfLines={1}>{item.user_name}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>{item.user_role}</ThemedText>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <ThemedText type="caption" style={{ color: "#10B981", fontWeight: "700" }}>{fmtTime(item.checkin_time)}</ThemedText>
          {item.distance_from_office != null && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>{item.distance_from_office}m</ThemedText>
          )}
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={12} color={theme.textSecondary} />
        </View>
      </View>
      {expanded && hasCoords && (
        <View style={{ marginTop: 4 }}>
          <View style={styles.coordRow}>
            <Feather name="map-pin" size={11} color="#10B981" />
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: 3, flex: 1, fontSize: 10 }}>
              {item.latitude!.toFixed(6)}, {item.longitude!.toFixed(6)}
            </ThemedText>
            {Platform.OS === "web" && (
              <Pressable onPress={() => window.open(`https://www.google.com/maps?q=${item.latitude},${item.longitude}`, "_blank")}>
                <ThemedText type="caption" style={{ color: "#3B82F6", fontSize: 10 }}>Maps ↗</ThemedText>
              </Pressable>
            )}
          </View>
          <MiniMap lat={item.latitude!} lon={item.longitude!} name={item.user_name} />
        </View>
      )}
      {expanded && !hasCoords && (
        <ThemedText type="caption" style={{ color: "#9CA3AF", marginTop: 4, fontSize: 10 }}>No GPS coords stored</ThemedText>
      )}
    </Pressable>
  );
}

function BlockedCard({ item }: { item: BlockedUser }) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const hasCoords = item.latitude != null && item.longitude != null;
  const isBlocked = item.status === "blocked";
  const color = isBlocked ? "#EF4444" : "#F59E0B";

  return (
    <Pressable
      style={[styles.rowCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: color }]}
      onPress={() => setExpanded(e => !e)}
    >
      <View style={styles.rowCardTop}>
        <View style={{ flex: 1 }}>
          <ThemedText type="small" style={{ fontWeight: "700" }} numberOfLines={1}>{item.user_name}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>{item.user_role}</ThemedText>
          {item.nearest_office_name && (
            <ThemedText type="caption" style={{ color, fontSize: 10, marginTop: 2 }} numberOfLines={1}>
              {item.nearest_office_distance_m != null ? `${item.nearest_office_distance_m}m` : ""} from {item.nearest_office_name}
            </ThemedText>
          )}
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <ThemedText type="caption" style={{ color, fontWeight: "700" }}>{fmtTime(item.attempted_at)}</ThemedText>
          {hasCoords && Platform.OS === "web" && (
            <Pressable onPress={(e) => { e.stopPropagation?.(); window.open(`https://www.google.com/maps?q=${item.latitude},${item.longitude}`, "_blank"); }}>
              <ThemedText type="caption" style={{ color: "#3B82F6", fontSize: 10, fontWeight: "600" }}>📍 View Location</ThemedText>
            </Pressable>
          )}
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={12} color={theme.textSecondary} />
        </View>
      </View>
      {expanded && (
        <View style={{ marginTop: 6, gap: 4 }}>
          {item.failure_reason ? (
            <View style={[styles.reasonBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-triangle" size={11} color="#EF4444" />
              <ThemedText type="caption" style={{ color: "#EF4444", marginLeft: 4, flex: 1, fontSize: 10 }}>
                {item.failure_reason}
              </ThemedText>
            </View>
          ) : null}
          {hasCoords ? (
            <View style={{ marginTop: 2 }}>
              <View style={styles.coordRow}>
                <Feather name="map-pin" size={11} color={color} />
                <ThemedText type="caption" style={{ color: "#6B7280", marginLeft: 3, flex: 1, fontSize: 10 }}>
                  {item.latitude!.toFixed(6)}, {item.longitude!.toFixed(6)}
                </ThemedText>
                {Platform.OS === "web" && (
                  <Pressable onPress={() => window.open(`https://www.google.com/maps?q=${item.latitude},${item.longitude}`, "_blank")}>
                    <ThemedText type="caption" style={{ color: "#3B82F6", fontSize: 10 }}>Maps ↗</ThemedText>
                  </Pressable>
                )}
              </View>
              <MiniMap lat={item.latitude!} lon={item.longitude!} name={item.user_name} />
            </View>
          ) : (
            <ThemedText type="caption" style={{ color: "#9CA3AF", fontSize: 10 }}>No GPS coords — location access was denied</ThemedText>
          )}
        </View>
      )}
    </Pressable>
  );
}

export default function CheckInLogsScreen() {
  const { theme } = useTheme();
  const [checkedIn, setCheckedIn] = useState<CheckedInUser[]>([]);
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"checkedin" | "blocked">("checkedin");

  const loadLogs = useCallback(async () => {
    setLoading(true);

    try {
      const localDate = await BusinessClockService.getDate(true);
      const dayStart = new Date(`${localDate}T00:00:00+05:30`);
      const dayEnd = new Date(
        `${addBusinessDays(localDate, 1)}T00:00:00+05:30`,
      );
      // Profiles map
      const { data: profiles } = await supabase.from("profiles").select("id, name, role");
      const profileMap: Record<string, { name: string; role: string }> = {};
      for (const p of profiles ?? []) profileMap[p.id] = { name: toTitleCase(p.name) || "Unknown", role: p.role || "—" };

      // TODAY's successful check-ins from attendance_logs
      const { data: attLogs } = await supabase
        .from("attendance_logs")
        .select("id, user_id, checkin_time, checkin_location, distance_from_office, status")
        .eq("date", localDate)
        .in("status", ["CHECKED_IN", "CHECKED_OUT"])
        .order("checkin_time", { ascending: false });

      setCheckedIn((attLogs ?? []).map((a: any) => ({
        id: a.id,
        user_name: profileMap[a.user_id]?.name ?? "Unknown",
        user_role: profileMap[a.user_id]?.role ?? "—",
        checkin_time: a.checkin_time,
        latitude: a.checkin_location?.latitude ?? null,
        longitude: a.checkin_location?.longitude ?? null,
        distance_from_office: a.distance_from_office ?? null,
      })));

      // TODAY's blocked/failed attempts — fetch all non-success statuses, no status filter
      // so we catch "blocked", "failed", "geo_fence_blocked", or any variant
      const { data: attempts, error: attErr } = await supabase
        .from("checkin_attempts")
        .select("id, user_id, attempted_at, latitude, longitude, nearest_office_name, nearest_office_distance_m, status, failure_reason")
        .gte("attempted_at", dayStart.toISOString())
        .lt("attempted_at", dayEnd.toISOString())
        .neq("status", "success")
        .order("attempted_at", { ascending: false });

      if (attErr) {
        console.error("[CheckInLogs] checkin_attempts query error:", attErr.message);
      }
      setBlocked((attempts ?? []).map((a: any) => ({
        id: a.id,
        user_name: profileMap[a.user_id]?.name ?? "Unknown",
        user_role: profileMap[a.user_id]?.role ?? "—",
        attempted_at: a.attempted_at,
        latitude: a.latitude ?? null,
        longitude: a.longitude ?? null,
        nearest_office_name: a.nearest_office_name ?? null,
        nearest_office_distance_m: a.nearest_office_distance_m ?? null,
        status: a.status === "failed" ? "failed" : "blocked",
        failure_reason: a.failure_reason ?? null,
      })));
    } catch (err) {
      console.error("CheckInLogs error:", err);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadLogs(); }, [loadLogs]));
  const onRefresh = async () => { setRefreshing(true); await loadLogs(); setRefreshing(false); };

  const filteredCheckedIn = checkedIn.filter((u) =>
    !search.trim() ||
    u.user_name.toLowerCase().includes(search.toLowerCase()) ||
    u.user_role.toLowerCase().includes(search.toLowerCase())
  );

  const filteredBlocked = blocked.filter((u) =>
    !search.trim() ||
    u.user_name.toLowerCase().includes(search.toLowerCase()) ||
    u.user_role.toLowerCase().includes(search.toLowerCase()) ||
    (u.nearest_office_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const today = formatDate(new Date());

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
    >
      {/* Date header */}
      <View style={[styles.dateHeader, { backgroundColor: theme.backgroundDefault }]}>
        <Feather name="calendar" size={14} color={theme.primary} />
        <ThemedText type="small" style={{ color: theme.primary, fontWeight: "700", marginLeft: 6 }}>
          Today — {today}
        </ThemedText>
      </View>

      {/* Summary row */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: "#DCFCE7", flex: 1 }]}>
          <Feather name="check-circle" size={20} color="#10B981" />
          <ThemedText type="h3" style={{ color: "#10B981", marginTop: 4 }}>{checkedIn.length}</ThemedText>
          <ThemedText type="caption" style={{ color: "#065F46", fontWeight: "600" }}>Checked In Today</ThemedText>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: "#FEE2E2", flex: 1 }]}>
          <Feather name="x-circle" size={20} color="#EF4444" />
          <ThemedText type="h3" style={{ color: "#EF4444", marginTop: 4 }}>{blocked.filter(b => b.status === "blocked").length}</ThemedText>
          <ThemedText type="caption" style={{ color: "#991B1B", fontWeight: "600" }}>Geo-fence Blocked</ThemedText>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: "#FEF3C7", flex: 1 }]}>
          <Feather name="alert-circle" size={20} color="#F59E0B" />
          <ThemedText type="h3" style={{ color: "#F59E0B", marginTop: 4 }}>{blocked.filter(b => b.status === "failed").length}</ThemedText>
          <ThemedText type="caption" style={{ color: "#92400E", fontWeight: "600" }}>GPS Failed</ThemedText>
        </View>
      </View>

      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: theme.backgroundDefault }]}>
        <Feather name="search" size={14} color={theme.textSecondary} />
        <TextInput
          style={[{ flex: 1, fontSize: 14, color: theme.text }]}
          placeholder="Search by name or role..."
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
        {search ? <Pressable onPress={() => setSearch("")}><Feather name="x" size={14} color={theme.textSecondary} /></Pressable> : null}
      </View>

      {/* Tab switcher */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, activeTab === "checkedin" && { backgroundColor: "#10B981" }]}
          onPress={() => setActiveTab("checkedin")}
        >
          <Feather name="check-circle" size={14} color={activeTab === "checkedin" ? "#fff" : "#10B981"} />
          <ThemedText type="caption" style={{ color: activeTab === "checkedin" ? "#fff" : "#10B981", fontWeight: "700", marginLeft: 4 }}>
            Checked In ({filteredCheckedIn.length})
          </ThemedText>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === "blocked" && { backgroundColor: "#EF4444" }]}
          onPress={() => setActiveTab("blocked")}
        >
          <Feather name="x-circle" size={14} color={activeTab === "blocked" ? "#fff" : "#EF4444"} />
          <ThemedText type="caption" style={{ color: activeTab === "blocked" ? "#fff" : "#EF4444", fontWeight: "700", marginLeft: 4 }}>
            Blocked / Failed ({filteredBlocked.length})
          </ThemedText>
        </Pressable>
      </View>

      {loading ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 32 }}>Loading...</ThemedText>
      ) : activeTab === "checkedin" ? (
        filteredCheckedIn.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="users" size={28} color={theme.textSecondary} />
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 8 }}>
              {search ? "No matches" : "No check-ins recorded today yet"}
            </ThemedText>
          </View>
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {filteredCheckedIn.map((item) => <CheckedInCard key={item.id} item={item} />)}
          </View>
        )
      ) : (
        filteredBlocked.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: "#DCFCE7" }]}>
            <Feather name="shield" size={28} color="#10B981" />
            <ThemedText type="caption" style={{ color: "#065F46", marginTop: 8, fontWeight: "600" }}>
              {search ? "No matches" : "No blocked attempts today"}
            </ThemedText>
            {!search && (
              <ThemedText type="caption" style={{ color: "#6B7280", marginTop: 4, textAlign: "center" }}>
                Blocked attempts are logged when a user tries to check in from outside the geo-fence.
              </ThemedText>
            )}
          </View>
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {filteredBlocked.map((item) => <BlockedCard key={item.id} item={item} />)}
          </View>
        )
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dateHeader: {
    flexDirection: "row", alignItems: "center",
    padding: Spacing.md, borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  summaryRow: {
    flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md,
  },
  summaryCard: {
    alignItems: "center", padding: Spacing.md,
    borderRadius: BorderRadius.md, gap: 2,
  },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: Spacing.md, borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  tabRow: {
    flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md,
  },
  tab: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    padding: Spacing.md, borderRadius: BorderRadius.md,
    borderWidth: 1.5, borderColor: "transparent",
    gap: 4,
  },
  rowCard: {
    borderRadius: BorderRadius.md, borderLeftWidth: 4,
    padding: Spacing.md,
  },
  rowCardTop: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
  },
  coordRow: {
    flexDirection: "row", alignItems: "center", gap: 4,
  },
  reasonBox: {
    flexDirection: "row", alignItems: "flex-start",
    padding: 6, borderRadius: BorderRadius.sm,
  },
  noMapBox: {
    flexDirection: "row", alignItems: "center",
    padding: 6, backgroundColor: "#F3F4F6", borderRadius: BorderRadius.sm,
  },
  emptyCard: {
    alignItems: "center", padding: Spacing.xl,
    borderRadius: BorderRadius.md, marginTop: 16,
  },
});
