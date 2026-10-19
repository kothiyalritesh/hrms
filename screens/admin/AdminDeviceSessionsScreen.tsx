import React, { useState, useCallback } from "react";
import { View, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Pressable } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { supabase } from "@/lib/supabase";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { useTheme } from "@/hooks/useTheme";

type DuplicateDevice = {
  device_identifier?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  platform?: string | null;
  app_version?: string | null;
  users_count?: number | null;
  last_used?: string | null;
  first_seen?: string | null;
};

export default function AdminDeviceSessionsScreen() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [devices, setDevices] = useState<DuplicateDevice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: loadError } = await supabase
        .from("v_duplicate_device_usage")
        .select("*");

      if (loadError) {
        setError("Could not load device sessions: " + loadError.message);
      } else {
        setError(null);
        setDevices((data || []) as DuplicateDevice[]);
      }
    } catch (e: any) {
      setError("Could not load device sessions: " + (e?.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Group by device identifier
  const grouped = devices.reduce((acc, curr) => {
    const key = curr?.device_identifier || "unknown";
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(curr);
    return acc;
  }, {} as Record<string, DuplicateDevice[]>);

  return (
    <ThemedView style={s.root}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ThemedText style={s.title}>Duplicate Device Detection</ThemedText>
        <ThemedText style={[s.subtitle, { color: theme.textSecondary }]}>
          Identifies devices that have been used by multiple employees for attendance check-ins. This can flag potential buddy-punching or shared device usage.
        </ThemedText>

        {loading && !refreshing && devices.length === 0 && (
          <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
        )}

        {error && !loading && (
          <View style={s.empty}>
            <Feather name="alert-circle" size={40} color="#EF4444" style={{ marginBottom: 16 }} />
            <ThemedText style={{ color: theme.textSecondary, textAlign: "center", marginBottom: 12 }}>{error}</ThemedText>
            <Pressable onPress={() => void loadData()} style={[s.retry, { borderColor: theme.primary }]}>
              <ThemedText style={{ color: theme.primary, fontWeight: "700" }}>Retry</ThemedText>
            </Pressable>
          </View>
        )}

        {Object.keys(grouped).length === 0 && !loading && !error && (
          <View style={s.empty}>
            <Feather name="check-circle" size={40} color="#10B981" style={{ marginBottom: 16 }} />
            <ThemedText style={{ color: theme.textSecondary }}>No duplicate device usage detected.</ThemedText>
          </View>
        )}

        {!error && Object.entries(grouped).map(([fingerprint, rows]) => {
          const first = rows[0];
          return (
            <View key={fingerprint} style={[s.card, { backgroundColor: theme.backgroundDefault, borderColor: "#EF4444", borderWidth: 1 }]}>
              <View style={[s.cardHeader, { backgroundColor: "#FEF2F2" }]}>
                <Feather name="smartphone" size={18} color="#DC2626" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <ThemedText style={{ fontWeight: "700", color: "#991B1B" }}>
                    {first?.device_identifier ? `Device ${first.device_identifier.slice(0, 12)}` : "Unknown Device"}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: "#DC2626" }}>
                    {first?.platform || "Unknown platform"}{first?.app_version ? ` v${first.app_version}` : ""} · {first?.users_count ?? rows.length} users associated
                  </ThemedText>
                </View>
              </View>

              <View style={s.userList}>
                {rows.map((row, index) => (
                  <View key={row?.user_id || index} style={s.userRow}>
                    <Feather name="user" size={14} color={theme.textSecondary} />
                    <View style={{ marginLeft: 8, flex: 1 }}>
                      <ThemedText style={{ fontWeight: "600", fontSize: 14 }}>
                        {row?.user_name || "Unknown employee"}
                      </ThemedText>
                      <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
                        Last used: {row?.last_used ? new Date(row.last_used).toLocaleDateString() : "-"}
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </ThemedView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 4 },
  subtitle: { fontSize: 14, marginBottom: 20 },
  empty: { alignItems: "center", justifyContent: "center", marginTop: 40, padding: 20 },
  card: { borderRadius: 12, marginBottom: 16, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: "#FEE2E2" },
  userList: { padding: 14 },
  userRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  retry: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 20, minHeight: 40, justifyContent: "center" },
});
