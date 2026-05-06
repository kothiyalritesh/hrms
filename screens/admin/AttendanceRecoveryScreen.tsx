import React, { useState, useCallback } from "react";
import {
  StyleSheet, View, FlatList, Pressable,
  Alert, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { AttendanceRecoveryService } from "@/services/attendance-recovery.service";

interface DeletedRecord {
  backup_id: string;
  original_id: string;
  user_id: string;
  employee_name: string;
  date: string;
  checkin_time: string;
  checkout_time: string;
  status: string;
  deleted_at: string;
  deleted_by_name: string;
  deletion_reason: string;
  backup_created_at: string;
}

export default function AttendanceRecoveryScreen() {
  const { theme } = useTheme();
  const [deletedRecords, setDeletedRecords] = useState<DeletedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<any>(null);
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterReason, setFilterReason] = useState("");
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Load current user
  useFocusEffect(
    useCallback(() => {
      const loadCurrentUser = async () => {
        const { data } = await supabase.auth.getUser();
        if (data?.user?.id) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", data.user.id)
            .single();
          setCurrentUser(profile);
        }
      };
      loadCurrentUser();
    }, [])
  );

  // Load deleted records
  const loadDeletedRecords = useCallback(async () => {
    setLoading(true);
    try {
      const records = await AttendanceRecoveryService.getDeletedAttendanceView();
      let filtered = records;

      if (filterEmployee) {
        filtered = filtered.filter((r: any) =>
          r.employee_name?.toLowerCase().includes(filterEmployee.toLowerCase())
        );
      }

      if (filterReason) {
        filtered = filtered.filter((r: any) =>
          r.deletion_reason?.toLowerCase().includes(filterReason.toLowerCase())
        );
      }

      setDeletedRecords(filtered);

      // Get stats
      const summary = await AttendanceRecoveryService.getDeletedAttendanceSummary();
      setStats(summary);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to load deleted records");
    } finally {
      setLoading(false);
    }
  }, [filterEmployee, filterReason]);

  useFocusEffect(useCallback(() => {
    loadDeletedRecords();
  }, [loadDeletedRecords]));

  // Toggle record selection
  const toggleSelection = (backupId: string) => {
    const newSelected = new Set(selectedRecords);
    if (newSelected.has(backupId)) {
      newSelected.delete(backupId);
    } else {
      newSelected.add(backupId);
    }
    setSelectedRecords(newSelected);
  };

  // Restore single record
  const handleRestoreSingle = async (backupId: string, employeeName: string) => {
    Alert.alert(
      "Restore Attendance",
      `Restore attendance for ${employeeName}?`,
      [
        { text: "Cancel", onPress: () => {} },
        {
          text: "Restore",
          onPress: async () => {
            try {
              if (!currentUser?.id) {
                Alert.alert("Error", "Current user not found");
                return;
              }

              const result = await AttendanceRecoveryService.restoreAttendance(
                backupId,
                currentUser.id,
                "Restored from recovery screen"
              );

              if (result.success) {
                Alert.alert("Success", result.message);
                loadDeletedRecords();
              } else {
                Alert.alert("Error", result.message);
              }
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Restoration failed");
            }
          },
        },
      ]
    );
  };

  // Restore multiple records
  const handleRestoreMultiple = async () => {
    if (selectedRecords.size === 0) {
      Alert.alert("No Selection", "Please select records to restore");
      return;
    }

    Alert.alert(
      "Restore Multiple",
      `Restore ${selectedRecords.size} attendance record(s)?`,
      [
        { text: "Cancel", onPress: () => {} },
        {
          text: "Restore All",
          onPress: async () => {
            try {
              if (!currentUser?.id) {
                Alert.alert("Error", "Current user not found");
                return;
              }

              const results = await AttendanceRecoveryService.restoreMultipleAttendance(
                Array.from(selectedRecords),
                currentUser.id,
                "Batch restoration from recovery screen"
              );

              const successful = results.filter((r) => r.success).length;
              Alert.alert(
                "Restoration Complete",
                `${successful}/${results.length} records restored successfully`
              );

              setSelectedRecords(new Set());
              loadDeletedRecords();
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Batch restoration failed");
            }
          },
        },
      ]
    );
  };

  // Export deleted records
  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await AttendanceRecoveryService.exportDeletedAttendanceCSV();
      const filename = `deleted_attendance_${new Date().toISOString().split("T")[0]}.csv`;

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert("✅ Downloaded", `Exported as ${filename}`);
      }
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const formatTime = (isoTime?: string) => {
    if (!isoTime) return "—";
    return new Date(isoTime).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.headerRow}>
          <View>
            <ThemedText type="h3">🔄 Attendance Recovery</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {deletedRecords.length} deleted records
            </ThemedText>
          </View>
        </View>

        <Spacer height={16} />

        {/* Statistics */}
        {stats && (
          <View style={[s.statsCard, { backgroundColor: theme.backgroundDefault }]}>
            <View style={s.statRow}>
              <View style={s.statItem}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  Total Deleted
                </ThemedText>
                <ThemedText type="h4" style={{ color: Colors.light.error }}>
                  {stats.total_deleted}
                </ThemedText>
              </View>
              <View style={s.statItem}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  Employees
                </ThemedText>
                <ThemedText type="h4">
                  {Object.keys(stats.by_employee).length}
                </ThemedText>
              </View>
              <View style={s.statItem}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  Reasons
                </ThemedText>
                <ThemedText type="h4">
                  {Object.keys(stats.by_reason).length}
                </ThemedText>
              </View>
            </View>
          </View>
        )}

        <Spacer height={12} />

        {/* Filters */}
        <View style={[s.filterCard, { backgroundColor: theme.backgroundDefault }]}>
          <TextInput
            style={[s.input, { backgroundColor: theme.backgroundRoot, color: theme.text }]}
            placeholder="Filter by employee name"
            placeholderTextColor={theme.textSecondary}
            value={filterEmployee}
            onChangeText={setFilterEmployee}
          />
          <Spacer height={8} />
          <TextInput
            style={[s.input, { backgroundColor: theme.backgroundRoot, color: theme.text }]}
            placeholder="Filter by deletion reason"
            placeholderTextColor={theme.textSecondary}
            value={filterReason}
            onChangeText={setFilterReason}
          />
        </View>

        <Spacer height={12} />

        {/* Action Buttons */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: theme.primary, flex: 1 }]}
            onPress={handleRestoreMultiple}
            disabled={selectedRecords.size === 0}
          >
            <Feather name="refresh-cw" size={16} color="#fff" />
            <ThemedText style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
              Restore ({selectedRecords.size})
            </ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: Colors.light.info, flex: 1 }]}
            onPress={handleExport}
            disabled={exporting}
          >
            <Feather name="download" size={16} color="#fff" />
            <ThemedText style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
              {exporting ? "Exporting..." : "Export"}
            </ThemedText>
          </TouchableOpacity>
        </View>

        <Spacer height={16} />

        {/* Records List */}
        {loading ? (
          <View style={s.centerContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Spacer height={12} />
            <ThemedText style={{ color: theme.textSecondary }}>Loading deleted records...</ThemedText>
          </View>
        ) : deletedRecords.length === 0 ? (
          <View style={s.centerContainer}>
            <Feather name="check-circle" size={40} color={Colors.light.success} />
            <Spacer height={12} />
            <ThemedText style={{ color: theme.textSecondary }}>No deleted records found</ThemedText>
          </View>
        ) : (
          <FlatList
            data={deletedRecords}
            keyExtractor={(item) => item.backup_id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={[s.recordCard, { backgroundColor: theme.backgroundDefault }]}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <TouchableOpacity
                    style={[
                      s.checkbox,
                      selectedRecords.has(item.backup_id) && { backgroundColor: theme.primary },
                    ]}
                    onPress={() => toggleSelection(item.backup_id)}
                  >
                    {selectedRecords.has(item.backup_id) && (
                      <Feather name="check" size={14} color="#fff" />
                    )}
                  </TouchableOpacity>

                  <View style={{ flex: 1 }}>
                    <ThemedText style={s.empName}>{item.employee_name}</ThemedText>
                    <ThemedText style={[s.meta, { color: theme.textSecondary }]}>
                      {formatDate(item.date)}
                    </ThemedText>

                    <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
                      <View style={s.timeChip}>
                        <Feather name="log-in" size={11} color="#10B981" />
                        <ThemedText style={s.timeText}>{formatTime(item.checkin_time)}</ThemedText>
                      </View>
                      {item.checkout_time && (
                        <View style={s.timeChip}>
                          <Feather name="log-out" size={11} color="#EF4444" />
                          <ThemedText style={s.timeText}>{formatTime(item.checkout_time)}</ThemedText>
                        </View>
                      )}
                    </View>

                    <View style={{ marginTop: 8 }}>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                        Deleted: {new Date(item.deleted_at).toLocaleString("en-IN")}
                      </ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                        By: {item.deleted_by_name || "Unknown"}
                      </ThemedText>
                      {item.deletion_reason && (
                        <ThemedText type="caption" style={{ color: Colors.light.warning }}>
                          Reason: {item.deletion_reason}
                        </ThemedText>
                      )}
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[s.restoreBtn, { backgroundColor: Colors.light.success + "20" }]}
                    onPress={() => handleRestoreSingle(item.backup_id, item.employee_name)}
                  >
                    <Feather name="refresh-cw" size={16} color={Colors.light.success} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}

        <Spacer height={80} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statsCard: { borderRadius: 12, padding: 14 },
  statRow: { flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center" },
  filterCard: { borderRadius: 12, padding: 14 },
  input: { padding: 10, borderRadius: 8, fontSize: 14 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  centerContainer: { alignItems: "center", paddingTop: 60 },
  recordCard: { padding: 14, borderRadius: 10, marginBottom: 8 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  empName: { fontSize: 14, fontWeight: "700" },
  meta: { fontSize: 12, marginTop: 2 },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  restoreBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
});
