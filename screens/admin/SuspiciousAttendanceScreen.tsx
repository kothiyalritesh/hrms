import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import { TrackingAdminService } from "@/services/tracking-admin.service";
import { useAuth } from "@/contexts/AuthContext";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { PaginationControls } from "@/components/PaginationControls";

const PAGE_SIZE = 50;

type FraudEvent = {
  id: string; user_id: string; event_type: string; score: number;
  severity: "NORMAL" | "WARNING" | "SUSPICIOUS"; reasons: string[];
  accuracy_m?: number; ip_gps_distance_m?: number; is_mocked?: boolean;
  reviewed_at?: string; created_at: string;
  profiles?: { name?: string; employee_number?: string };
};

export default function SuspiciousAttendanceScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [events, setEvents] = useState<FraudEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "WARNING" | "SUSPICIOUS">("SUSPICIOUS");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("attendance_fraud_events")
        .select("*, profiles:user_id(name,employee_number)", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id");
    if (filter !== "ALL") query = query.eq("severity", filter);
    const from = page * PAGE_SIZE;
    const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) Alert.alert("Unable to load", error.message);
    setEvents((data ?? []) as unknown as FraudEvent[]);
    setTotal(count ?? 0);
    setLoading(false);
  }, [filter, page]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const review = async (event: FraudEvent) => {
    if (!user?.id) return;
    const { error } = await TrackingAdminService.reviewFraudEvent(
      event.id,
      "Reviewed by admin",
    );
    if (error) return Alert.alert("Review failed", error.message);
    await load();
  };

  const colors = { NORMAL: "#10B981", WARNING: "#F59E0B", SUSPICIOUS: "#EF4444" };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ThemedText style={s.title}>Suspicious Attendance</ThemedText>
      <ThemedText style={[s.subtitle, { color: theme.textSecondary }]}>GPS evidence and fraud score. Scores above 60 require review.</ThemedText>
      <View style={s.filters}>{(["SUSPICIOUS", "WARNING", "ALL"] as const).map((item) => (
        <Pressable key={item} onPress={() => { setPage(0); setFilter(item); }} style={[s.filter, filter === item && { backgroundColor: theme.primary }]}>
          <ThemedText style={{ color: filter === item ? "#fff" : theme.text, fontWeight: "700", fontSize: 12 }}>{item}</ThemedText>
        </Pressable>
      ))}</View>
      <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      {loading ? <ActivityIndicator color={theme.primary} /> : events.length === 0 ? <ThemedText style={s.empty}>No matching fraud events.</ThemedText> : events.map((event) => {
        const color = colors[event.severity];
        return <View key={event.id} style={[s.card, { backgroundColor: theme.backgroundDefault, borderLeftColor: color }]}>
          <View style={s.row}><View style={{ flex: 1 }}>
            <ThemedText style={s.name}>{event.profiles?.name || "Employee"}</ThemedText>
            <ThemedText style={{ color: theme.textSecondary, fontSize: 12 }}>{event.event_type} · {new Date(event.created_at).toLocaleString("en-IN")}</ThemedText>
          </View><View style={[s.score, { backgroundColor: color }]}><ThemedText style={s.scoreText}>{event.score}</ThemedText></View></View>
          {(event.reasons ?? []).map((reason, index) => <View key={index} style={s.reason}><Feather name="alert-triangle" size={12} color={color} /><ThemedText style={{ fontSize: 12, flex: 1 }}>{reason}</ThemedText></View>)}
          <ThemedText style={{ color: theme.textSecondary, fontSize: 11, marginTop: 6 }}>Accuracy: {event.accuracy_m == null ? "Unknown" : `±${Math.round(event.accuracy_m)}m`} · IP/GPS: {event.ip_gps_distance_m == null ? "Unavailable" : `${Math.round(event.ip_gps_distance_m / 1000)}km`}</ThemedText>
          {event.reviewed_at ? <ThemedText style={s.reviewed}>✓ Reviewed</ThemedText> : <Pressable style={s.reviewButton} onPress={() => review(event)}><ThemedText style={s.reviewText}>Mark Reviewed</ThemedText></Pressable>}
        </View>;
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 }, title: { fontSize: 22, fontWeight: "800" }, subtitle: { marginTop: 4, marginBottom: 14 },
  filters: { flexDirection: "row", gap: 8, marginBottom: 14 }, filter: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7 },
  card: { borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4 }, row: { flexDirection: "row", alignItems: "center" }, name: { fontSize: 15, fontWeight: "800" },
  score: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" }, scoreText: { color: "#fff", fontWeight: "900" },
  reason: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }, reviewButton: { alignSelf: "flex-end", backgroundColor: "#6D1B6D", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, marginTop: 10 },
  reviewText: { color: "#fff", fontSize: 12, fontWeight: "700" }, reviewed: { color: "#10B981", fontWeight: "700", marginTop: 9, textAlign: "right" }, empty: { textAlign: "center", marginTop: 40 },
});
