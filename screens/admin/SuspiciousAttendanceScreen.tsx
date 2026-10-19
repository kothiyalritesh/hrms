import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { PaginationControls } from "@/components/PaginationControls";
import { formatDateTime } from "@/utils/format";

const PAGE_SIZE = 50;

type FraudEvent = {
  id: string; user_id: string; event_type: string; score: number;
  severity: "NORMAL" | "WARNING" | "SUSPICIOUS"; reasons: string[];
  accuracy_m?: number; ip_gps_distance_m?: number; is_mocked?: boolean;
  reviewed_at?: string; review_notes?: string | null; review_decision?: "CONFIRMED" | "DISMISSED" | null;
  created_at: string;
  profiles?: { name?: string; employee_number?: string };
};

const TYPE_LABELS: Record<string, string> = {
  OUTSIDE_OFFICE_RADIUS: "Check-in attempted outside the office area",
  MOCK_LOCATION: "Fake GPS app",
  IMPOSSIBLE_SPEED: "Impossible GPS jump",
  SHARED_DEVICE: "Phone shared with another employee",
};

type Filter = "OPEN" | "SUSPICIOUS" | "WARNING" | "ALL";

function friendlyError(message: string) {
  if (message.includes("NOTES_REQUIRED")) return "Write a short note for this decision.";
  if (message.includes("CANNOT_REVIEW_OWN_EVENT")) return "You cannot review your own record.";
  if (message.includes("PERMISSION_REQUIRED") || message.includes("42501")) return "You do not have access to this employee.";
  return "Could not save the decision. Try again.";
}

export default function SuspiciousAttendanceScreen() {
  const { theme } = useTheme();
  const [events, setEvents] = useState<FraudEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    let query = supabase.from("attendance_fraud_events")
      .select("*, profiles:user_id(name,employee_number)", { count: "exact" })
      // Old per-check-in scores (one row for every normal check-in) are not
      // suspicious activity; only real signals are listed.
      .not("event_type", "in", "(CHECKIN,CHECKOUT)")
      .order("created_at", { ascending: false })
      .order("id");
    if (filter === "OPEN") query = query.is("reviewed_at", null).eq("severity", "SUSPICIOUS");
    else if (filter !== "ALL") query = query.eq("severity", filter);
    const from = page * PAGE_SIZE;
    const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) setLoadError("Could not load the list. Pull down to retry.");
    setEvents((data ?? []) as unknown as FraudEvent[]);
    setTotal(count ?? 0);
    setLoading(false);
  }, [filter, page]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const decide = async (event: FraudEvent, decision: "CONFIRMED" | "DISMISSED") => {
    const note = (notes[event.id] || "").trim();
    if (note.length < 3) {
      setErrors((prev) => ({ ...prev, [event.id]: "Write a short note for this decision." }));
      return;
    }
    setBusyId(event.id);
    setErrors((prev) => ({ ...prev, [event.id]: "" }));
    const { error } = await supabase.rpc("rpc_review_fraud_event", {
      p_event_id: event.id,
      p_decision: decision,
      p_notes: note,
    });
    setBusyId(null);
    if (error) {
      setErrors((prev) => ({ ...prev, [event.id]: friendlyError(error.message || "") }));
      return;
    }
    await load();
  };

  const colors = { NORMAL: "#10B981", WARNING: "#F59E0B", SUSPICIOUS: "#EF4444" };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={s.container}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ThemedText style={s.title}>Suspicious Attendance</ThemedText>
      <ThemedText style={[s.subtitle, { color: theme.textSecondary }]}>
        A check-in is suspicious when it is attempted from outside the office area (100 m unless the office has its own limit) or with a fake-GPS app. Normal check-ins are not listed. Confirming deducts compliance points.
      </ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.filters}>
        {([["OPEN", "To review"], ["SUSPICIOUS", "Suspicious"], ["WARNING", "Warning"], ["ALL", "All"]] as const).map(([item, label]) => (
          <Pressable
            key={item}
            onPress={() => { setPage(0); setFilter(item); }}
            style={[s.filter, { borderColor: theme.border }, filter === item && { backgroundColor: theme.primary, borderColor: theme.primary }]}
          >
            <ThemedText style={{ color: filter === item ? "#fff" : theme.text, fontWeight: "700", fontSize: 13 }}>{label}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      {loadError ? <ThemedText style={{ color: theme.error, marginBottom: 10 }}>{loadError}</ThemedText> : null}
      {loading ? <ActivityIndicator color={theme.primary} /> : events.length === 0 ? (
        loadError ? null : <ThemedText style={[s.empty, { color: theme.textSecondary }]}>Nothing to show here.</ThemedText>
      ) : events.map((event) => {
        const color = colors[event.severity];
        const busy = busyId === event.id;
        return (
          <View key={event.id} style={[s.card, { backgroundColor: theme.backgroundDefault, borderLeftColor: color }]}>
            <View style={s.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <ThemedText style={s.name} numberOfLines={1}>{event.profiles?.name || "Employee"}</ThemedText>
                <ThemedText style={{ color: theme.textSecondary, fontSize: 12 }}>
                  {TYPE_LABELS[event.event_type] || event.event_type} · {formatDateTime(event.created_at)}
                </ThemedText>
              </View>
              <View style={[s.score, { backgroundColor: color }]}><ThemedText style={s.scoreText}>{event.score}</ThemedText></View>
            </View>
            {(event.reasons ?? []).map((reason, index) => (
              <View key={index} style={s.reason}>
                <Feather name="alert-triangle" size={12} color={color} />
                <ThemedText style={{ fontSize: 13, flex: 1 }}>{reason}</ThemedText>
              </View>
            ))}
            {event.accuracy_m != null ? (
              <ThemedText style={{ color: theme.textSecondary, fontSize: 12, marginTop: 6 }}>
                GPS accuracy ±{Math.round(event.accuracy_m)} m
              </ThemedText>
            ) : null}
            {event.reviewed_at ? (
              <View style={{ marginTop: 10, gap: 2 }}>
                <ThemedText style={{ color: event.review_decision === "CONFIRMED" ? theme.error : "#10B981", fontWeight: "800" }}>
                  {event.review_decision === "CONFIRMED" ? "Confirmed" : event.review_decision === "DISMISSED" ? "Dismissed" : "Reviewed"}
                </ThemedText>
                {event.review_notes ? <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>{event.review_notes}</ThemedText> : null}
              </View>
            ) : (
              <View style={{ marginTop: 10, gap: 8 }}>
                <TextInput
                  value={notes[event.id] || ""}
                  onChangeText={(text) => setNotes((prev) => ({ ...prev, [event.id]: text }))}
                  placeholder="Note (required)"
                  placeholderTextColor={theme.textSecondary}
                  editable={!busy}
                  style={[s.input, { color: theme.text, borderColor: errors[event.id] ? theme.error : theme.border }]}
                />
                {errors[event.id] ? <ThemedText style={{ color: theme.error, fontSize: 13 }}>{errors[event.id]}</ThemedText> : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable disabled={busy} onPress={() => void decide(event, "DISMISSED")} style={[s.action, { borderColor: "#10B981" }]}>
                    <ThemedText style={{ color: "#10B981", fontWeight: "800" }}>Dismiss</ThemedText>
                  </Pressable>
                  <Pressable disabled={busy} onPress={() => void decide(event, "CONFIRMED")} style={[s.action, { borderColor: theme.error }]}>
                    {busy ? <ActivityIndicator size="small" color={theme.error} /> : <ThemedText style={{ color: theme.error, fontWeight: "800" }}>Confirm</ThemedText>}
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: "800" },
  subtitle: { marginTop: 4, marginBottom: 14 },
  filters: { flexDirection: "row", gap: 8, marginBottom: 14 },
  filter: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, minHeight: 36, justifyContent: "center" },
  card: { borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { fontSize: 15, fontWeight: "800" },
  score: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  scoreText: { color: "#fff", fontWeight: "900" },
  reason: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, minHeight: 44, fontSize: 16 },
  action: { flex: 1, minHeight: 44, borderWidth: 1.5, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  empty: { textAlign: "center", marginTop: 40 },
});
