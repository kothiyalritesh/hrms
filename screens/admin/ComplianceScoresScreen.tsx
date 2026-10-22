import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { getBusinessDateIST } from "@/utils/businessDate";

type Row = {
  user_id: string;
  name: string;
  employee_number: string | null;
  office_name: string | null;
  score: number;
  deductions: number;
  last_reason: string | null;
};

function monthStart(offset: number) {
  const [y, m] = getBusinessDateIST().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function monthLabel(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function scoreColor(score: number) {
  if (score >= 90) return "#059669";
  if (score >= 75) return "#D97706";
  return "#DC2626";
}

/** Monthly compliance score of the employees the viewer can see (lowest first). */
export default function ComplianceScoresScreen() {
  const { theme } = useTheme();
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const month = monthStart(offset);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("rpc_compliance_scores", { p_month: month });
    if (rpcError) setError("Could not load scores. Pull down to retry.");
    else setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [month]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    void load();
  }, [load]));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.name} ${r.employee_number ?? ""} ${r.office_name ?? ""}`.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
  const below = rows.filter((r) => r.score < 90).length;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
      data={loading ? [] : visible}
      keyExtractor={(r) => r.user_id}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 4 }}>
          <View style={styles.monthRow}>
            <Pressable onPress={() => setOffset((o) => o - 1)} style={[styles.iconBtn, { borderColor: theme.border }]} accessibilityLabel="Previous month">
              <Feather name="chevron-left" size={18} color={theme.text} />
            </Pressable>
            <ThemedText style={styles.month}>{monthLabel(month)}</ThemedText>
            <Pressable
              onPress={() => setOffset((o) => Math.min(0, o + 1))}
              disabled={offset === 0}
              style={[styles.iconBtn, { borderColor: theme.border, opacity: offset === 0 ? 0.4 : 1 }]}
              accessibilityLabel="Next month"
            >
              <Feather name="chevron-right" size={18} color={theme.text} />
            </Pressable>
          </View>
          <ThemedText style={{ color: theme.textSecondary }}>
            Everyone starts the month at 100. Points are deducted for rejected office exits, rejected site visits and
            confirmed fake GPS / shared phones. {below} employee{below === 1 ? "" : "s"} below 90.
          </ThemedText>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search employee or office"
            placeholderTextColor={theme.textSecondary}
            style={[styles.search, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
          />
          {error ? <ThemedText style={{ color: theme.error }}>{error}</ThemedText> : null}
          {loading ? <ActivityIndicator color={theme.primary} style={{ marginTop: 20 }} /> : null}
        </View>
      }
      ListEmptyComponent={loading ? null : (
        <ThemedText style={{ color: theme.textSecondary, textAlign: "center", marginTop: 30 }}>No employees to show.</ThemedText>
      )}
      renderItem={({ item }) => (
        <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <View style={[styles.badge, { borderColor: scoreColor(item.score) }]}>
            <ThemedText style={{ color: scoreColor(item.score), fontWeight: "900", fontSize: 16 }}>{item.score}</ThemedText>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText style={{ fontWeight: "800" }} numberOfLines={1}>{item.name}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {[item.employee_number, item.office_name].filter(Boolean).join(" · ") || "—"}
            </ThemedText>
            {item.last_reason ? (
              <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={2}>
                {item.deductions} deduction{item.deductions === 1 ? "" : "s"} · latest: {item.last_reason}
              </ThemedText>
            ) : null}
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  month: { fontSize: 17, fontWeight: "800" },
  iconBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  badge: { width: 52, height: 52, borderRadius: 26, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
});
