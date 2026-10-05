import React, { useState, useCallback } from "react";
import { View, StyleSheet, ScrollView, RefreshControl, Alert } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { supabase } from "@/lib/supabase";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { useTheme } from "@/hooks/useTheme";

type DuplicateDevice = {
  device_fingerprint: string;
  device_name: string;
  platform: string;
  app_version: string;
  user_id: string;
  employee_name: string;
  employee_number: string;
  last_used: string;
  users_count: number;
};

export default function AdminDeviceSessionsScreen() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [devices, setDevices] = useState<DuplicateDevice[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("v_duplicate_device_usage")
      .select("*");
    
    if (error) {
      Alert.alert("Error", "Could not load device sessions: " + error.message);
    } else {
      setDevices((data || []) as DuplicateDevice[]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Group by fingerprint
  const grouped = devices.reduce((acc, curr) => {
    if (!acc[curr.device_fingerprint]) {
      acc[curr.device_fingerprint] = [];
    }
    acc[curr.device_fingerprint].push(curr);
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

        {Object.keys(grouped).length === 0 && !loading && (
          <View style={s.empty}>
            <Feather name="check-circle" size={40} color="#10B981" style={{ marginBottom: 16 }} />
            <ThemedText style={{ color: theme.textSecondary }}>No duplicate device usage detected.</ThemedText>
          </View>
        )}

        {Object.entries(grouped).map(([fingerprint, rows]) => {
          const first = rows[0];
          return (
            <View key={fingerprint} style={[s.card, { backgroundColor: theme.backgroundDefault, borderColor: "#EF4444", borderWidth: 1 }]}>
              <View style={[s.cardHeader, { backgroundColor: "#FEF2F2" }]}>
                <Feather name="smartphone" size={18} color="#DC2626" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <ThemedText style={{ fontWeight: "700", color: "#991B1B" }}>
                    {first.device_name || "Unknown Device"}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: "#DC2626" }}>
                    {first.platform} v{first.app_version} A {first.users_count} users associated
                  </ThemedText>
                </View>
              </View>

              <View style={s.userList}>
                {rows.map((row) => (
                  <View key={row.user_id} style={s.userRow}>
                    <Feather name="user" size={14} color={theme.textSecondary} />
                    <View style={{ marginLeft: 8, flex: 1 }}>
                      <ThemedText style={{ fontWeight: "600", fontSize: 14 }}>
                        {row.employee_name}
                      </ThemedText>
                      <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
                        {row.employee_number ? `Emp ID: ${row.employee_number} - ` : ""}
                        Last used: {new Date(row.last_used).toLocaleDateString()}
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
});
