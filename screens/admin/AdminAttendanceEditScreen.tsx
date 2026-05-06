import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Alert,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
  TextInput,
  Modal,
  Pressable,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { AdminAttendanceEditService } from "@/services/admin-attendance-edit.service";
import { useAttendanceUpdate } from "@/contexts/AttendanceUpdateContext";

export default function AdminAttendanceEditScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { triggerAttendanceRefresh } = useAttendanceUpdate();
  const [loading, setLoading] = useState(false);
  const [allRecords, setAllRecords] = useState<any[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<any[]>([]);
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState<"all" | "late" | "edited">("all");
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [newCheckInTime, setNewCheckInTime] = useState("");
  const [editReason, setEditReason] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [updating, setUpdating] = useState(false);

  const isSystemAdmin = user?.role === "SYSTEM_ADMIN";

  useFocusEffect(
    useCallback(() => {
      if (isSystemAdmin) {
        loadAllAttendance();
      }
    }, [isSystemAdmin])
  );

  const loadAllAttendance = async () => {
    setLoading(true);
    try {
      console.log("[ADMIN SCREEN] Loading all attendance records...");
      const records = await AdminAttendanceEditService.getAllAttendance(1000);
      console.log("[ADMIN SCREEN] Loaded", records.length, "attendance records");
      setAllRecords(records);
      applyFilters(records, searchText, filterType);
    } catch (error: any) {
      console.error("[ADMIN SCREEN] Error:", error);
      Alert.alert("Error", error?.message || "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (records: any[], search: string, filter: string) => {
    let filtered = records;

    if (filter === "late") {
      filtered = filtered.filter((r) => r.is_late);
    } else if (filter === "edited") {
      filtered = filtered.filter((r) => r.admin_edited);
    }

    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.profiles?.name?.toLowerCase().includes(searchLower) ||
          r.profiles?.phone?.includes(search) ||
          r.date?.includes(search)
      );
    }

    setFilteredRecords(filtered);
  };

  const handleSearch = (text: string) => {
    setSearchText(text);
    applyFilters(allRecords, text, filterType);
  };

  const handleFilterChange = (filter: "all" | "late" | "edited") => {
    setFilterType(filter);
    applyFilters(allRecords, searchText, filter);
  };

  const handleMarkAsOnTime = async (record: any) => {
    Alert.alert(
      "Mark as On-Time?",
      `Mark ${record.profiles?.name} (${record.date}) as on-time (10:30 AM)?`,
      [
        { text: "Cancel", onPress: () => {} },
        {
          text: "Mark as On-Time",
          onPress: async () => {
            try {
              await AdminAttendanceEditService.markAsOnTime(
                record.id,
                "Marked as on-time by system admin"
              );
              Alert.alert("Success", "Marked as on-time");
              setTimeout(() => {
                loadAllAttendance();
                triggerAttendanceRefresh();
              }, 500);
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to update");
            }
          },
        },
      ]
    );
  };

  const handleEditCheckInTime = async () => {
    console.log("[ADMIN] Update button pressed");
    console.log("[ADMIN] Time:", newCheckInTime);
    console.log("[ADMIN] Reason:", editReason);
    console.log("[ADMIN] Selected record:", selectedRecord?.id);

    if (!newCheckInTime || !editReason) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    if (!selectedRecord) {
      Alert.alert("Error", "No record selected");
      return;
    }

    setUpdating(true);
    try {
      if (!newCheckInTime.match(/^\d{2}:\d{2}$/)) {
        Alert.alert("Error", "Invalid time format. Use HH:MM (e.g., 09:15)");
        setUpdating(false);
        return;
      }

      let [hours, minutes] = newCheckInTime.split(":").map(Number);

      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        Alert.alert("Error", "Invalid time. Hours: 0-23, Minutes: 0-59");
        setUpdating(false);
        return;
      }

      // Subtract 5.5 hours from the entered IST time
      let totalMinutes = hours * 60 + minutes - (5 * 60 + 30);
      if (totalMinutes < 0) {
        totalMinutes += 24 * 60; // Add 24 hours if negative
      }
      hours = Math.floor(totalMinutes / 60) % 24;
      minutes = totalMinutes % 60;

      const date = selectedRecord.date;
      const storedDateTime = `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`;

      console.log("[ADMIN SCREEN] Entered time:", newCheckInTime);
      console.log("[ADMIN SCREEN] Time to store (after -5.5h):", storedDateTime);

      await AdminAttendanceEditService.editCheckInTime(
        selectedRecord.id,
        storedDateTime,
        editReason
      );

      Alert.alert("Success", "Check-in time updated to " + newCheckInTime);
      
      setSelectedRecord({
        ...selectedRecord,
        checkin_time: storedDateTime,
      });
      
      setNewCheckInTime("");
      setEditReason("");
      
      setTimeout(() => {
        setEditModalVisible(false);
        setSelectedRecord(null);
        setTimeout(() => {
          loadAllAttendance();
          triggerAttendanceRefresh();
        }, 500);
      }, 800);
    } catch (error: any) {
      console.error("[ADMIN] Error:", error);
      Alert.alert("Error", error?.message || "Failed to update");
    } finally {
      setUpdating(false);
    }
  };

  const handleBulkMarkAsOnTime = async () => {
    if (selectedIds.size === 0) {
      Alert.alert("Error", "Please select records to update");
      return;
    }

    Alert.alert(
      "Bulk Mark as On-Time?",
      `Mark ${selectedIds.size} records as on-time?`,
      [
        { text: "Cancel", onPress: () => {} },
        {
          text: "Mark All",
          onPress: async () => {
            try {
              await AdminAttendanceEditService.bulkMarkAsOnTime(
                Array.from(selectedIds),
                "Bulk marked as on-time by system admin"
              );
              Alert.alert("Success", `${selectedIds.size} records updated`);
              setSelectedIds(new Set());
              setBulkEditMode(false);
              setTimeout(() => {
                loadAllAttendance();
                triggerAttendanceRefresh();
              }, 500);
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to update");
            }
          },
        },
      ]
    );
  };

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  if (!isSystemAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Feather name="lock" size={40} color={theme.textSecondary} />
          <Spacer height={12} />
          <ThemedText style={{ color: theme.textSecondary, textAlign: "center" }}>
            System Admin Access Only
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
        <View style={[s.header, { backgroundColor: theme.backgroundDefault }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <ThemedText type="h3">🔧 Attendance Editor</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
                System Admin Only
              </ThemedText>
            </View>
            <View style={{ alignItems: "center" }}>
              <ThemedText type="h4" style={{ color: theme.primary }}>
                {filteredRecords.length}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Records
              </ThemedText>
            </View>
          </View>
        </View>

        <View style={[s.searchContainer, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[s.searchBox, { borderColor: theme.border }]}>
            <Feather name="search" size={16} color={theme.textSecondary} />
            <TextInput
              style={[s.searchInput, { color: theme.text }]}
              value={searchText}
              onChangeText={handleSearch}
              placeholder="Search by name, phone, or date..."
              placeholderTextColor={theme.textSecondary}
            />
            {searchText ? (
              <Pressable onPress={() => handleSearch("")}>
                <Feather name="x" size={16} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>

          <Spacer height={10} />

          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              style={[
                s.filterBtn,
                filterType === "all" && { backgroundColor: theme.primary },
                filterType !== "all" && { backgroundColor: theme.border },
              ]}
              onPress={() => handleFilterChange("all")}
            >
              <ThemedText
                style={{
                  color: filterType === "all" ? "#fff" : theme.text,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                All
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.filterBtn,
                filterType === "late" && { backgroundColor: Colors.light.warning },
                filterType !== "late" && { backgroundColor: theme.border },
              ]}
              onPress={() => handleFilterChange("late")}
            >
              <ThemedText
                style={{
                  color: filterType === "late" ? "#fff" : theme.text,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                Late Only
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.filterBtn,
                filterType === "edited" && { backgroundColor: "#8B5CF6" },
                filterType !== "edited" && { backgroundColor: theme.border },
              ]}
              onPress={() => handleFilterChange("edited")}
            >
              <ThemedText
                style={{
                  color: filterType === "edited" ? "#fff" : theme.text,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                Edited
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.filterBtn,
                bulkEditMode && { backgroundColor: Colors.light.error },
                !bulkEditMode && { backgroundColor: theme.border },
              ]}
              onPress={() => {
                setBulkEditMode(!bulkEditMode);
                setSelectedIds(new Set());
              }}
            >
              <ThemedText
                style={{
                  color: bulkEditMode ? "#fff" : theme.text,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                Bulk
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        {bulkEditMode && selectedIds.size > 0 && (
          <View style={[s.bulkActionBar, { backgroundColor: Colors.light.error + "20" }]}>
            <ThemedText style={{ color: Colors.light.error, fontWeight: "700" }}>
              {selectedIds.size} selected
            </ThemedText>
            <TouchableOpacity
              style={[s.bulkActionBtn, { backgroundColor: Colors.light.success }]}
              onPress={handleBulkMarkAsOnTime}
            >
              <Feather name="check" size={14} color="#fff" />
              <ThemedText style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
                Mark On-Time
              </ThemedText>
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <View style={s.centerContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Spacer height={12} />
            <ThemedText style={{ color: theme.textSecondary }}>Loading records...</ThemedText>
          </View>
        ) : filteredRecords.length > 0 ? (
          <FlatList
            data={filteredRecords}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              let checkInTime = "—";
              if (item.checkin_time) {
                checkInTime = item.checkin_time.substring(11, 16);
              }

              const isSelected = selectedIds.has(item.id);

              return (
                <Pressable
                  style={[
                    s.recordCard,
                    { backgroundColor: theme.backgroundDefault },
                    isSelected && { backgroundColor: theme.primary + "20" },
                  ]}
                  onPress={() => {
                    if (bulkEditMode) {
                      toggleSelection(item.id);
                    }
                  }}
                >
                  {bulkEditMode && (
                    <Pressable
                      style={[
                        s.checkbox,
                        isSelected && { backgroundColor: theme.primary },
                        !isSelected && { borderColor: theme.border },
                      ]}
                      onPress={() => toggleSelection(item.id)}
                    >
                      {isSelected && <Feather name="check" size={12} color="#fff" />}
                    </Pressable>
                  )}

                  <View style={{ flex: 1 }}>
                    <ThemedText style={s.empName}>
                      {item.profiles?.name || "Unknown"}
                    </ThemedText>
                    <ThemedText style={[s.meta, { color: theme.textSecondary }]}>
                      {item.date} • {item.profiles?.phone}
                    </ThemedText>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      <View style={s.timeChip}>
                        <Feather name="log-in" size={12} color="#10B981" />
                        <ThemedText style={s.timeText}>{checkInTime}</ThemedText>
                      </View>
                      {item.is_late && (
                        <View style={[s.badge, { backgroundColor: Colors.light.warning + "20" }]}>
                          <ThemedText style={[s.badgeText, { color: Colors.light.warning }]}>
                            Late
                          </ThemedText>
                        </View>
                      )}
                      {item.admin_edited && (
                        <View style={[s.badge, { backgroundColor: "#8B5CF6" + "20" }]}>
                          <ThemedText style={[s.badgeText, { color: "#8B5CF6" }]}>
                            Edited
                          </ThemedText>
                        </View>
                      )}
                    </View>
                  </View>

                  {!bulkEditMode && (
                    <View style={{ gap: 8 }}>
                      <TouchableOpacity
                        style={[s.actionBtn, { backgroundColor: Colors.light.success + "20" }]}
                        onPress={() => handleMarkAsOnTime(item)}
                      >
                        <Feather name="check" size={14} color={Colors.light.success} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[s.actionBtn, { backgroundColor: theme.primary + "20" }]}
                        onPress={() => {
                          setSelectedRecord(item);
                          setNewCheckInTime(checkInTime);
                          setEditReason("");
                          setEditModalVisible(true);
                        }}
                      >
                        <Feather name="edit-2" size={14} color={theme.primary} />
                      </TouchableOpacity>
                    </View>
                  )}
                </Pressable>
              );
            }}
            contentContainerStyle={{ padding: 12, paddingBottom: 80 }}
          />
        ) : (
          <View style={s.centerContainer}>
            <Feather name="inbox" size={40} color={theme.textSecondary} />
            <Spacer height={12} />
            <ThemedText style={{ color: theme.textSecondary }}>
              No records found
            </ThemedText>
          </View>
        )}
      </View>

      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h4" style={{ marginBottom: 16 }}>
              ✏️ Edit Check-In Time
            </ThemedText>

            <View style={[s.infoBox, { backgroundColor: theme.backgroundRoot }]}>
              <ThemedText style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600" }}>
                Employee
              </ThemedText>
              <ThemedText style={{ fontSize: 14, fontWeight: "700", marginTop: 4 }}>
                {selectedRecord?.profiles?.name}
              </ThemedText>
              
              <ThemedText style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 12 }}>
                Date
              </ThemedText>
              <ThemedText style={{ fontSize: 14, fontWeight: "700", marginTop: 4 }}>
                {selectedRecord?.date}
              </ThemedText>
            </View>

            <Spacer height={12} />

            <View style={[s.currentTimeBox, { backgroundColor: Colors.light.info + "10", borderColor: Colors.light.info }]}>
              <Feather name="clock" size={16} color={Colors.light.info} />
              <View style={{ flex: 1 }}>
                <ThemedText style={{ color: theme.textSecondary, fontSize: 11 }}>
                  Current Check-In Time (IST)
                </ThemedText>
                <ThemedText style={{ fontSize: 18, fontWeight: "800", color: Colors.light.info, marginTop: 2 }}>
                  {newCheckInTime || "—"}
                </ThemedText>
              </View>
            </View>

            <Spacer height={12} />

            <ThemedText style={{ color: theme.textSecondary, marginBottom: 4, fontSize: 12, fontWeight: "600" }}>
              New Check-In Time (HH:MM IST)
            </ThemedText>
            <TextInput
              style={[s.input, { borderColor: theme.border, color: theme.text, fontSize: 16, fontWeight: "700" }]}
              value={newCheckInTime}
              onChangeText={setNewCheckInTime}
              placeholder="10:11"
              placeholderTextColor={theme.textSecondary}
              maxLength={5}
            />
            <ThemedText style={{ color: theme.textSecondary, fontSize: 11, marginTop: 4 }}>
              Format: HH:MM (Indian Standard Time, e.g., 10:11, 14:30)
            </ThemedText>

            <Spacer height={12} />

            <ThemedText style={{ color: theme.textSecondary, marginBottom: 4, fontSize: 12, fontWeight: "600" }}>
              Reason for Edit
            </ThemedText>
            <TextInput
              style={[s.input, { borderColor: theme.border, color: theme.text, height: 80 }]}
              value={editReason}
              onChangeText={setEditReason}
              placeholder="Enter reason..."
              placeholderTextColor={theme.textSecondary}
              multiline
            />

            <Spacer height={16} />

            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: theme.border, flex: 1 }]}
                onPress={() => setEditModalVisible(false)}
              >
                <ThemedText style={{ color: theme.text, fontWeight: "700" }}>
                  Cancel
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: theme.primary, flex: 1, opacity: updating ? 0.6 : 1 }]}
                onPress={handleEditCheckInTime}
                disabled={updating}
              >
                {updating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                    Update
                  </ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  searchContainer: { paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  searchBox: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14 },
  filterBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: "#E5E7EB" },
  bulkActionBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  bulkActionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  centerContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  recordCard: { borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  empName: { fontSize: 14, fontWeight: "700" },
  meta: { fontSize: 12, marginTop: 2 },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: { fontSize: 11, fontWeight: "600" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  actionBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  modalContent: { borderRadius: 12, padding: 20, width: "85%", maxWidth: 400 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 14 },
  modalBtn: { paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  infoBox: { borderRadius: 8, padding: 12, marginBottom: 8 },
  currentTimeBox: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 8, padding: 12, gap: 10 },
});
