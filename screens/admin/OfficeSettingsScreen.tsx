import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  TextInput,
  Alert,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";

interface Office {
  id: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  attendance_radius: number;
  is_active: boolean;
}

export default function OfficeSettingsScreen() {
  const { theme } = useTheme();
  const [offices, setOffices] = useState<Office[]>([]);  const [teamSchedules, setTeamSchedules] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configurationIssues, setConfigurationIssues] = useState<any[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newOffice, setNewOffice] = useState({
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    attendance_radius: "100",
  });

  const loadOffices = useCallback(async () => {
    
    const [{ data, error }, { data: issues, error: issuesError }, { data: schedules }] = await Promise.all([
      supabase.from("offices").select("*").order("name"),
      supabase.rpc("rpc_admin_attendance_configuration_issues"),
      supabase.from("work_schedule_configs").select("*").order("team")
    ]);
    if (schedules) setTeamSchedules(schedules);


    if (error) {
      console.error("Error loading offices:", error);
      setLoadError(error.message);
    } else {
      setOffices(data || []);
      setLoadError(issuesError?.message ?? null);
    }
    setConfigurationIssues(issues ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOffices();
    }, [loadOffices]),
  );

  const addOffice = async () => {
    if (!newOffice.name.trim() || !newOffice.address.trim()) {
      Alert.alert("Error", "Please enter office name and address");
      return;
    }
    const lat = parseFloat(newOffice.latitude);
    const lon = parseFloat(newOffice.longitude);
    if (!newOffice.latitude || isNaN(lat) || lat < -90 || lat > 90) {
      Alert.alert("Error", "Latitude must be between -90 and 90");
      return;
    }
    if (!newOffice.longitude || isNaN(lon) || lon < -180 || lon > 180) {
      Alert.alert("Error", "Longitude must be between -180 and 180");
      return;
    }
    const radius = parseInt(newOffice.attendance_radius, 10);
    if (!Number.isInteger(radius) || radius < 10 || radius > 1000) {
      Alert.alert("Error", "Attendance radius must be between 10 and 1000 metres");
      return;
    }

    const { data, error } = await supabase.rpc(
      "rpc_admin_mutate_configuration",
      {
        p_entity: "OFFICE",
        p_action: "CREATE",
        p_id: null,
        p_values: {
        name: newOffice.name,
        address: newOffice.address,
        latitude: lat,
        longitude: lon,
        attendance_radius: radius,
        },
      },
    );
    const response = firstRpcRow<any>(data);

    if (error || response?.success !== true || !response?.id) {
      Alert.alert("Error", error?.message || response?.message || "Server did not confirm office creation");
    } else {
      Alert.alert("Success", "Office added successfully");
      setNewOffice({ name: "", address: "", latitude: "", longitude: "", attendance_radius: "100" });
      setShowAddForm(false);
      loadOffices();
    }
  };

  const toggleOfficeStatus = async (
    officeId: string,
    currentStatus: boolean,
  ) => {
    const newStatus = !currentStatus;
    const action = newStatus ? "activate" : "deactivate";

    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} Office`,
      `Are you sure you want to ${action} this office?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: action.charAt(0).toUpperCase() + action.slice(1),
          onPress: async () => {
            const target = offices.find((office) => office.id === officeId);
            if (
              newStatus &&
              (!target?.latitude ||
                !target?.longitude ||
                !Number.isFinite(Number(target.attendance_radius)))
            ) {
              Alert.alert(
                "Cannot activate office",
                "Add valid coordinates and an attendance radius before activation.",
              );
              return;
            }
            const { data, error } = await supabase.rpc(
              "rpc_admin_mutate_configuration",
              {
                p_entity: "OFFICE",
                p_action: "SET_ACTIVE",
                p_id: officeId,
                p_values: { is_active: newStatus },
              },
            );
            const response = firstRpcRow<any>(data);

            if (error || response?.success !== true || response?.id !== officeId) {
              Alert.alert(
                "Error",
                error?.message || response?.message || `Server did not confirm office ${action}`,
              );
            } else {
              loadOffices();
            }
          },
        },
      ],
    );
  };

  const updateAttendanceRadius = async (
    officeId: string,
    newRadius: string,
  ) => {
    const radius = parseInt(newRadius);
    if (isNaN(radius) || radius < 10 || radius > 1000) {
      Alert.alert(
        "Error",
        "Attendance radius must be between 10 and 1000 meters",
      );
      return;
    }

    const { data, error } = await supabase.rpc(
      "rpc_admin_mutate_configuration",
      {
        p_entity: "OFFICE",
        p_action: "SET_RADIUS",
        p_id: officeId,
        p_values: { attendance_radius: radius },
      },
    );
    const response = firstRpcRow<any>(data);

    if (error || response?.success !== true || response?.id !== officeId) {
      Alert.alert("Error", error?.message || response?.message || "Server did not confirm radius update");
    } else {
      loadOffices();
    }
  };

  const renderOffice = ({ item }: { item: Office }) => (
    <View
      style={[styles.officeCard, { backgroundColor: theme.backgroundDefault }]}
    >
      <View style={styles.officeHeader}>
        <View style={styles.officeInfo}>
          <ThemedText type="body" style={styles.officeName}>
            {item.name}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {item.address}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Radius: {item.attendance_radius}m
          </ThemedText>
          {item.latitude && item.longitude ? (
            <ThemedText type="caption" style={{ color: Colors.light.success }}>
              📍 Geo-tagged ({item.latitude.toFixed(4)}, {item.longitude.toFixed(4)})
            </ThemedText>
          ) : (
            <ThemedText type="caption" style={{ color: Colors.light.warning }}>
              ⚠️ No GPS coordinates — geo-fence inactive
            </ThemedText>
          )}
        </View>

        <View style={styles.officeActions}>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: item.is_active
                  ? Colors.light.success + "20"
                  : Colors.light.error + "20",
              },
            ]}
          >
            <ThemedText
              type="caption"
              style={{
                color: item.is_active
                  ? Colors.light.success
                  : Colors.light.error,
                fontWeight: "600",
              }}
            >
              {item.is_active ? "Active" : "Inactive"}
            </ThemedText>
          </View>

          <Pressable
            style={[
              styles.actionButton,
              { backgroundColor: theme.backgroundRoot },
            ]}
            onPress={() => toggleOfficeStatus(item.id, item.is_active)}
          >
            <Feather
              name={item.is_active ? "eye-off" : "eye"}
              size={16}
              color={item.is_active ? Colors.light.error : Colors.light.success}
            />
          </Pressable>
        </View>
      </View>

      <Spacer height={Spacing.md} />

      <View style={styles.radiusSection}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Update Attendance Radius (meters):
        </ThemedText>
        <View style={styles.radiusInput}>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="100"
            placeholderTextColor={theme.textSecondary}
            defaultValue={item.attendance_radius.toString()}
            keyboardType="numeric"
            onSubmitEditing={(e) =>
              updateAttendanceRadius(item.id, e.nativeEvent.text)
            }
          />
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="h3">Office Management</ThemedText>
        <Pressable
          style={[styles.addButton, { backgroundColor: Colors.light.primary }]}
          onPress={() => setShowAddForm(!showAddForm)}
        >
          <Feather name="plus" size={20} color="#FFFFFF" />
          <ThemedText type="caption" style={styles.addButtonText}>
            Add Office
          </ThemedText>
        </Pressable>
      </View>

      {loadError ? (
        <View
          style={{
            padding: Spacing.md,
            borderRadius: BorderRadius.md,
            borderWidth: 1,
            borderColor: Colors.light.error,
            backgroundColor: `${Colors.light.error}10`,
            marginBottom: Spacing.md,
          }}
        >
          <ThemedText style={{ color: Colors.light.error, fontWeight: "600" }}>
            Offices could not be loaded: {loadError}
          </ThemedText>
          <Pressable onPress={() => void loadOffices()}>
            <ThemedText style={{ color: Colors.light.error, fontWeight: "700", marginTop: 4 }}>
              Retry
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.officeCard, { backgroundColor: configurationIssues.length ? "#FEF3C7" : "#D1FAE5" }]}>
        <ThemedText style={{ fontWeight: "800", color: configurationIssues.length ? "#92400E" : "#065F46" }}>
          Attendance configuration validation
        </ThemedText>
        <ThemedText type="caption" style={{ color: configurationIssues.length ? "#92400E" : "#065F46", marginTop: 4 }}>
          {configurationIssues.length ? `${configurationIssues.length} issue(s) require attention.` : "All active employee assignments and office policies are valid."}
        </ThemedText>
        {configurationIssues.slice(0, 10).map((issue, index) => (
          <ThemedText key={`${issue.issue_type}-${issue.user_id || issue.office_id || index}`} type="caption" style={{ color: "#92400E", marginTop: 4 }}>
            {issue.issue_type.replaceAll("_", " ")} · {issue.employee_name || issue.office_name || issue.role || "Unassigned"}: {issue.detail}
          </ThemedText>
        ))}
      </View>

      {showAddForm && (
        <View
          style={[styles.addForm, { backgroundColor: theme.backgroundDefault }]}
        >
          <ThemedText type="body" style={styles.formTitle}>
            Add New Office
          </ThemedText>

          <TextInput
            style={[
              styles.formInput,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="Office Name"
            placeholderTextColor={theme.textSecondary}
            value={newOffice.name}
            onChangeText={(text) => setNewOffice({ ...newOffice, name: text })}
          />

          <TextInput
            style={[
              styles.formInput,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="Office Address"
            placeholderTextColor={theme.textSecondary}
            value={newOffice.address}
            onChangeText={(text) =>
              setNewOffice({ ...newOffice, address: text })
            }
            multiline
          />

          <TextInput
            style={[
              styles.formInput,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="Latitude (e.g. 28.6139)"
            placeholderTextColor={theme.textSecondary}
            value={newOffice.latitude}
            onChangeText={(text) => setNewOffice({ ...newOffice, latitude: text })}
            keyboardType="decimal-pad"
          />

          <TextInput
            style={[
              styles.formInput,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="Longitude (e.g. 77.2090)"
            placeholderTextColor={theme.textSecondary}
            value={newOffice.longitude}
            onChangeText={(text) => setNewOffice({ ...newOffice, longitude: text })}
            keyboardType="decimal-pad"
          />

          <TextInput
            style={[
              styles.formInput,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="Attendance Radius (meters, default 100)"
            placeholderTextColor={theme.textSecondary}
            value={newOffice.attendance_radius}
            onChangeText={(text) =>
              setNewOffice({ ...newOffice, attendance_radius: text })
            }
            keyboardType="numeric"
          />

          <View style={styles.formButtons}>
            <Pressable
              style={[
                styles.formButton,
                { backgroundColor: Colors.light.error },
              ]}
              onPress={() => setShowAddForm(false)}
            >
              <ThemedText type="caption" style={styles.formButtonText}>
                Cancel
              </ThemedText>
            </Pressable>

            <Pressable
              style={[
                styles.formButton,
                { backgroundColor: Colors.light.success },
              ]}
              onPress={addOffice}
            >
              <ThemedText type="caption" style={styles.formButtonText}>
                Add Office
              </ThemedText>
            </Pressable>
          </View>
        </View>
      )}

      <Spacer height={Spacing.md} />

      {loading ? (
        <View style={styles.centered}>
          <ThemedText>Loading offices...</ThemedText>
        </View>
      ) : (
        <FlatList
          data={offices}
          keyExtractor={(item) => item.id}
          renderItem={renderOffice}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}

          ListFooterComponent={() => (
            <View style={{ marginTop: Spacing.xl, marginBottom: Spacing['2xl'] }}>
              <ThemedText type="h3">Team Schedules & Policies</ThemedText>
              <Spacer height={Spacing.md} />
              {teamSchedules.length === 0 ? <ThemedText>No team schedules configured.</ThemedText> : null}
              {teamSchedules.map(t => (
                <View key={t.id} style={[styles.officeCard, { backgroundColor: theme.backgroundDefault }]}>
                  <ThemedText type="body" style={{ fontWeight: '700', color: theme.text, marginBottom: 4 }}>{t.team} Team</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>Saturday: {t.saturday_policy}</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>Sunday: {t.sunday_policy}</ThemedText>
                  {t.monday_credit_bonus && <ThemedText type="caption" style={{ color: Colors.light.success, marginTop: 4 }}>ś +1 Monday Biometric Compliance Credit</ThemedText>}
                </View>
              ))}
            </View>
          )}

        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  addForm: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
  },
  formTitle: {
    marginBottom: Spacing.md,
  },
  formInput: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
    fontSize: 16,
  },
  formButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  formButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
  formButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    gap: Spacing.md,
  },
  officeCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  officeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  officeInfo: {
    flex: 1,
  },
  officeName: {
    marginBottom: Spacing.xs,
  },
  officeActions: {
    alignItems: "flex-end",
    gap: Spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  radiusSection: {
    gap: Spacing.xs,
  },
  radiusInput: {
    flexDirection: "row",
  },
  input: {
    flex: 1,
    padding: Spacing.sm,
    borderRadius: BorderRadius.xs,
    fontSize: 14,
  },
});
