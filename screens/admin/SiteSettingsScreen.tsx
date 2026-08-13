import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";

interface ManagedSite {
  id: string;
  project_name: string;
  site_label: string;
  address: string | null;
  latitude: number;
  longitude: number;
  checkin_radius_m: number;
  site_type: "site" | "office" | "meeting";
  is_active: boolean;
}

const emptySite = {
  project_name: "",
  site_label: "",
  address: "",
  latitude: "",
  longitude: "",
  checkin_radius_m: "100",
};

export default function SiteSettingsScreen() {
  const { theme } = useTheme();
  const [sites, setSites] = useState<ManagedSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSite, setNewSite] = useState(emptySite);

  const loadSites = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("predefined_sites")
      .select(
        "id,project_name,site_label,address,latitude,longitude,checkin_radius_m,site_type,is_active",
      )
      .order("project_name")
      .order("site_label")
      .limit(1000);
    setLoadError(error?.message ?? null);
    setSites((data ?? []) as ManagedSite[]);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSites();
    }, [loadSites]),
  );

  const addSite = async () => {
    const latitude = Number(newSite.latitude);
    const longitude = Number(newSite.longitude);
    const radius = Number(newSite.checkin_radius_m);
    if (!newSite.project_name.trim() || !newSite.site_label.trim()) {
      return Alert.alert("Required", "Enter the project and site names.");
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return Alert.alert("Invalid latitude", "Latitude must be between -90 and 90.");
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return Alert.alert("Invalid longitude", "Longitude must be between -180 and 180.");
    }
    if (!Number.isInteger(radius) || radius < 10 || radius > 5000) {
      return Alert.alert("Invalid radius", "Site radius must be 10–5000 metres.");
    }
    const { data, error } = await supabase.rpc("rpc_admin_mutate_configuration", {
      p_entity: "SITE",
      p_action: "CREATE",
      p_id: null,
      p_values: {
        project_name: newSite.project_name.trim(),
        site_label: newSite.site_label.trim(),
        address: newSite.address.trim(),
        latitude,
        longitude,
        checkin_radius_m: radius,
        site_type: "site",
      },
    });
    const response = firstRpcRow<any>(data);
    if (error || response?.success !== true) {
      return Alert.alert(
        "Site not added",
        error?.message || response?.message || "The server did not confirm creation.",
      );
    }
    setNewSite(emptySite);
    setShowAddForm(false);
    await loadSites();
  };

  const setActive = (site: ManagedSite) => {
    const next = !site.is_active;
    Alert.alert(
      `${next ? "Activate" : "Deactivate"} site?`,
      site.site_label,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: next ? "Activate" : "Deactivate",
          style: next ? "default" : "destructive",
          onPress: async () => {
            const { data, error } = await supabase.rpc(
              "rpc_admin_mutate_configuration",
              {
                p_entity: "SITE",
                p_action: "SET_ACTIVE",
                p_id: site.id,
                p_values: { is_active: next },
              },
            );
            const response = firstRpcRow<any>(data);
            if (error || response?.success !== true) {
              Alert.alert(
                "Site not updated",
                error?.message || response?.message || "The server did not confirm the change.",
              );
            } else {
              await loadSites();
            }
          },
        },
      ],
    );
  };

  const updateRadius = async (site: ManagedSite, raw: string) => {
    const radius = Number(raw);
    if (!Number.isInteger(radius) || radius < 10 || radius > 5000) {
      return Alert.alert("Invalid radius", "Site radius must be 10–5000 metres.");
    }
    const { data, error } = await supabase.rpc("rpc_admin_mutate_configuration", {
      p_entity: "SITE",
      p_action: "SET_RADIUS",
      p_id: site.id,
      p_values: { checkin_radius_m: radius },
    });
    const response = firstRpcRow<any>(data);
    if (error || response?.success !== true) {
      Alert.alert(
        "Radius not updated",
        error?.message || response?.message || "The server did not confirm the change.",
      );
    } else {
      await loadSites();
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.backgroundRoot }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={styles.wrap}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <ThemedText type="h3">Site Management</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Saved projects used for site visits, automatic proximity matching and geofences.
          </ThemedText>
        </View>
        <Pressable
          style={[styles.primary, { backgroundColor: theme.primary }]}
          onPress={() => setShowAddForm((value) => !value)}
        >
          <Feather name="plus" size={17} color="#fff" />
          <ThemedText style={styles.white}>Add Site</ThemedText>
        </Pressable>
      </View>

      {loadError ? (
        <View style={[styles.notice, { borderColor: "#EF4444" }]}>
          <ThemedText style={{ color: "#B91C1C" }}>{loadError}</ThemedText>
          <Pressable onPress={() => void loadSites()}>
            <ThemedText style={{ color: theme.primary, fontWeight: "800" }}>Retry</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {showAddForm ? (
        <View style={[styles.panel, { backgroundColor: theme.backgroundDefault }]}>
          {([
            ["project_name", "Project name"],
            ["site_label", "Site name"],
            ["address", "Address"],
            ["latitude", "Latitude"],
            ["longitude", "Longitude"],
            ["checkin_radius_m", "Check-in radius (metres)"],
          ] as const).map(([field, label]) => (
            <View key={field}>
              <ThemedText style={styles.label}>{label}</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                value={newSite[field]}
                onChangeText={(value) => setNewSite((old) => ({ ...old, [field]: value }))}
                keyboardType={
                  ["latitude", "longitude", "checkin_radius_m"].includes(field)
                    ? "numeric"
                    : "default"
                }
                placeholder={label}
                placeholderTextColor={theme.textSecondary}
              />
            </View>
          ))}
          <Pressable
            style={[styles.primary, { backgroundColor: theme.primary, alignSelf: "flex-start" }]}
            onPress={() => void addSite()}
          >
            <ThemedText style={styles.white}>Save Site</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {sites.map((site) => (
        <View key={site.id} style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={[styles.icon, { backgroundColor: site.is_active ? "#D1FAE5" : "#F3F4F6" }]}>
              <Feather name="map-pin" size={19} color={site.is_active ? "#059669" : "#6B7280"} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: "800" }}>{site.site_label}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {site.project_name}{site.address ? ` · ${site.address}` : ""}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)} · {site.checkin_radius_m}m
              </ThemedText>
            </View>
            <Pressable style={styles.status} onPress={() => setActive(site)}>
              <ThemedText style={{ color: site.is_active ? "#047857" : "#B91C1C", fontWeight: "800" }}>
                {site.is_active ? "Active" : "Inactive"}
              </ThemedText>
            </Pressable>
          </View>
          <View style={styles.radiusRow}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Update radius:
            </ThemedText>
            <TextInput
              style={[styles.radiusInput, { color: theme.text, borderColor: theme.border }]}
              defaultValue={String(site.checkin_radius_m)}
              keyboardType="numeric"
              onSubmitEditing={(event) => void updateRadius(site, event.nativeEvent.text)}
            />
          </View>
        </View>
      ))}

      {!sites.length && !loadError ? (
        <ThemedText style={{ color: theme.textSecondary }}>No sites configured.</ThemedText>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  wrap: { padding: 16, paddingBottom: 48, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  primary: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  white: { color: "#fff", fontWeight: "800" },
  notice: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  panel: { borderRadius: 14, padding: 14 },
  label: { fontWeight: "700", marginBottom: 5 },
  input: { borderWidth: 1, borderRadius: 9, padding: 11, marginBottom: 11 },
  card: { borderRadius: 14, padding: 14, gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  status: { paddingHorizontal: 10, paddingVertical: 7 },
  radiusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  radiusInput: { width: 110, borderWidth: 1, borderRadius: 8, padding: 8 },
});
