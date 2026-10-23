import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";

type Device = {
  serial: string;
  device_name: string | null;
  status: string | null;
  linked_office_id: string | null;
  linked_office_name: string | null;
  suggested_office_id: string | null;
  suggested_office_name: string | null;
  punches_30_days: number;
  punches_without_office: number;
  last_punch_day: string | null;
};
type Office = { id: string; name: string };

function friendlyError(message: string) {
  if (message.includes("PERMISSION_REQUIRED") || message.includes("42501")) return "You need the Biometric sync permission.";
  if (message.includes("OFFICE_NOT_FOUND")) return "That office is not active.";
  return "Could not save. Check your connection and try again.";
}

/**
 * Which office each biometric machine is in. A punch proves the employee was
 * at an office only when its machine is linked here; office return (a site
 * visit ended by a later office punch) depends on it.
 */
export default function BiometricDevicesScreen() {
  const { theme } = useTheme();
  const [devices, setDevices] = useState<Device[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [devRes, offRes] = await Promise.all([
      supabase.rpc("rpc_biometric_device_overview"),
      supabase.from("offices").select("id, name").eq("is_active", true).order("name"),
    ]);
    if (devRes.error) {
      setError(
        ["PGRST202", "42883"].includes(String(devRes.error.code))
          ? "Biometric devices are not installed on the server yet (migration 20261022110000)."
          : friendlyError(devRes.error.message || ""),
      );
    } else {
      setError(null);
      setDevices((devRes.data as Device[]) ?? []);
    }
    if (!offRes.error) setOffices((offRes.data as Office[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));

  const link = (device: Device, officeId: string) => {
    const office = offices.find((o) => o.id === officeId);
    if (!office) return;
    Alert.alert(
      `Link to ${office.name}?`,
      `Punches from ${device.serial} will count as being at ${office.name}. ` +
        "Its earlier punches without an office get this office, and today's site visits that a later punch here proves ended are closed (the workday stays open).",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Link",
          onPress: async () => {
            setBusy(device.serial);
            const { data, error: rpcError } = await supabase.rpc("rpc_link_biometric_device", {
              p_serial: device.serial,
              p_office_id: office.id,
              p_device_name: device.device_name,
              p_active: true,
            });
            setBusy(null);
            if (rpcError) {
              Alert.alert("Not linked", friendlyError(rpcError.message || ""));
              return;
            }
            const r = data as { punches_given_office?: number; visits_closed?: number };
            Alert.alert(
              "Device linked",
              `${device.serial} → ${office.name}. ${r?.punches_given_office ?? 0} earlier punch(es) got the office; ` +
                `${r?.visits_closed ?? 0} site visit(s) ended.`,
            );
            void load();
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.backgroundRoot }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  const unlinked = devices.filter((d) => !d.linked_office_id).length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={styles.content}
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
    >
      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
        Link every machine to the office where it is installed. Only punches from a linked machine prove an employee is
        at that office (for example, back from a site visit). The suggestion is the office most of its users belong to,
        not proof of where the machine is.
      </ThemedText>
      {unlinked > 0 ? (
        <View style={[styles.banner, { borderColor: theme.warning ?? "#D97706" }]}>
          <Feather name="alert-triangle" size={16} color={theme.warning ?? "#D97706"} />
          <ThemedText style={{ flex: 1 }}>{unlinked} machine(s) not linked to an office.</ThemedText>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.banner, { borderColor: theme.error }]}>
          <Feather name="alert-circle" size={16} color={theme.error} />
          <ThemedText style={{ flex: 1, color: theme.error }}>{error}</ThemedText>
        </View>
      ) : null}
      {!error && devices.length === 0 ? (
        <ThemedText style={{ color: theme.textSecondary, textAlign: "center", marginTop: 24 }}>
          No biometric machine has sent punches in the last 60 days.
        </ThemedText>
      ) : null}

      {devices.map((d) => {
        const selected = choice[d.serial] ?? d.linked_office_id ?? d.suggested_office_id ?? "";
        const linked = Boolean(d.linked_office_id);
        const changed = selected && selected !== d.linked_office_id;
        return (
          <View key={d.serial} style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <View style={styles.row}>
              <Feather name="cpu" size={18} color={theme.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <ThemedText style={{ fontWeight: "800" }} numberOfLines={1}>{d.serial}</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {d.punches_30_days} punches in 30 days{d.last_punch_day ? ` · last ${d.last_punch_day}` : ""}
                </ThemedText>
              </View>
              <View style={[styles.badge, { backgroundColor: (linked ? theme.success : theme.error) + "18" }]}>
                <ThemedText style={{ color: linked ? theme.success : theme.error, fontWeight: "800", fontSize: 12 }}>
                  {linked ? d.linked_office_name : "Not linked"}
                </ThemedText>
              </View>
            </View>
            {d.suggested_office_name && d.suggested_office_id !== d.linked_office_id ? (
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Suggested: {d.suggested_office_name} (where most of its users work)
              </ThemedText>
            ) : null}
            {d.punches_without_office > 0 ? (
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {d.punches_without_office} stored punch(es) have no office yet.
              </ThemedText>
            ) : null}
            <View style={styles.offices}>
              {offices.map((o) => {
                const active = o.id === selected;
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => setChoice((prev) => ({ ...prev, [d.serial]: o.id }))}
                    style={[styles.office, { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.primary + "14" : "transparent" }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <ThemedText style={{ color: active ? theme.primary : theme.text, fontWeight: active ? "800" : "500" }}>{o.name}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              disabled={!changed || busy === d.serial}
              onPress={() => link(d, selected)}
              style={[styles.save, { backgroundColor: theme.primary, opacity: !changed || busy === d.serial ? 0.45 : 1 }]}
              accessibilityRole="button"
            >
              {busy === d.serial ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={{ color: "#fff", fontWeight: "800" }}>
                  {changed
                    ? `Link to ${offices.find((o) => o.id === selected)?.name ?? "office"}`
                    : linked
                      ? "Linked"
                      : "Choose an office"}
                </ThemedText>
              )}
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 48, width: "100%", maxWidth: 820, alignSelf: "center" },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, maxWidth: "45%" },
  offices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  office: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  save: { minHeight: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
