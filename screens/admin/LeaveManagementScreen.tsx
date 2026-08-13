import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  Alert,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { useAuth } from "@/contexts/AuthContext";
import { LeaveService } from "@/services/leave.service";
import { BusinessClockService } from "@/services/business-clock.service";

interface LeaveRequest {
  id: string;
  employee_name: string;
  type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  requested_days: number;
}

interface Employee {
  id: string;
  name: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: Colors.light.warning,
  approved: Colors.light.success,
  rejected: Colors.light.error,
};

export default function LeaveManagementScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isHRD = ["HRD", "HR", "HR_MANAGER", "SYSTEM_ADMIN", "ADMIN"].includes(
    String(user?.role).toUpperCase(),
  );

  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">(
    "pending",
  );
  const [rejectModal, setRejectModal] = useState<{
    visible: boolean;
    id: string;
    employeeName: string;
  }>({ visible: false, id: "", employeeName: "" });
  const [rejectReason, setRejectReason] = useState("");

  // Comp Off state
  const [compOffModal, setCompOffModal] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null,
  );
  const [compOffDate, setCompOffDate] = useState("");
  const [compOffReason, setCompOffReason] = useState("");
  const [compOffLoading, setCompOffLoading] = useState(false);
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);

  const loadLeaves = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("leave_requests")
      .select(
        "id, leave_type, start_date, end_date, reason, status, rejection_reason, requested_days, created_at, user_id",
      )
      .eq("status", filter)
      .order("created_at", { ascending: false });

    if (error) {
      setLoading(false);
      return;
    }

    const rows = data || [];
    const userIds = [...new Set(rows.map((l: any) => l.user_id))];
    let nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", userIds);
      (profiles || []).forEach((p: any) => {
        nameMap[p.id] = p.name;
      });
    }

    setLeaves(
      rows.map((l: any) => ({
        id: l.id,
        employee_name: nameMap[l.user_id] || "Unknown",
        type: l.leave_type,
        start_date: l.start_date,
        end_date: l.end_date,
        reason: l.reason,
        status: l.status,
        rejection_reason: l.rejection_reason || null,
        created_at: l.created_at,
        requested_days: Number(l.requested_days || 0),
      })),
    );
    setLoading(false);
  }, [filter]);

  const loadEmployees = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, name, role")
      .eq("is_active", true)
      .order("name");
    setEmployees(
      (data || []).filter(
        (e: any) => !["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"].includes(e.role),
      ),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLeaves();
    }, [loadLeaves]),
  );

  const handleApprove = async (id: string) => {
    setActionLoading(id + "_approve");
    const result = await LeaveService.review(id, user!.id, true);
    setActionLoading(null);
    if (!result.success)
      Alert.alert("Approval failed", result.message || "Please try again.");
    else await loadLeaves();
  };

  const handleRejectOpen = (id: string, employeeName: string) => {
    setRejectReason("");
    setRejectModal({ visible: true, id, employeeName });
  };

  const handleRejectConfirm = async () => {
    if (!rejectReason.trim()) {
      Alert.alert("Required", "Please enter a reason for rejection.");
      return;
    }
    setActionLoading(rejectModal.id + "_reject");
    const result = await LeaveService.review(
      rejectModal.id,
      user!.id,
      false,
      rejectReason,
    );
    setActionLoading(null);
    if (!result.success)
      Alert.alert("Rejection failed", result.message || "Please try again.");
    else {
      setRejectModal({ visible: false, id: "", employeeName: "" });
      await loadLeaves();
    }
  };

  const openCompOffModal = async () => {
    const [, businessDate] = await Promise.all([
      loadEmployees(),
      BusinessClockService.getDate(true),
    ]);
    setSelectedEmployee(null);
    setCompOffDate(businessDate);
    setCompOffReason("");
    setCompOffModal(true);
  };

  const handleAddCompOff = async () => {
    if (!selectedEmployee) {
      Alert.alert("Required", "Please select an employee.");
      return;
    }
    if (!compOffDate.trim()) {
      Alert.alert("Required", "Please enter a date.");
      return;
    }
    setCompOffLoading(true);
    try {
      const { data, error } = await supabase.rpc("rpc_grant_comp_off_credit", {
        p_user_id: selectedEmployee.id,
        p_admin_id: user!.id,
        p_days: 1,
        p_reason:
          compOffReason.trim() || `Compensatory off earned on ${compOffDate}`,
      });
      if (error) throw error;
      const response = firstRpcRow<any>(data);
      if (response?.success !== true)
        throw new Error(response?.message || "Failed to grant comp off");

      Alert.alert("Success", `Comp Off added for ${selectedEmployee.name}`);
      setCompOffModal(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to add comp off");
    } finally {
      setCompOffLoading(false);
    }
  };

  if (!isHRD) {
    return (
      <View
        style={[
          styles.container,
          { alignItems: "center", justifyContent: "center" },
        ]}
      >
        <Feather name="lock" size={40} color={theme.textSecondary} />
        <Spacer height={Spacing.md} />
        <ThemedText style={{ color: theme.textSecondary, textAlign: "center" }}>
          Only HRD and Admin can manage leaves.
        </ThemedText>
      </View>
    );
  }

  const renderItem = ({ item }: { item: LeaveRequest }) => {
    const days =
      item.requested_days ||
      Math.ceil(
        (new Date(item.end_date).getTime() -
          new Date(item.start_date).getTime()) /
          (1000 * 60 * 60 * 24),
      ) + 1;
    const isApprovingThis = actionLoading === item.id + "_approve";
    const isRejectingThis = actionLoading === item.id + "_reject";

    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {item.employee_name}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.type.toUpperCase()} • {days} day{days > 1 ? "s" : ""}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {formatDate(item.start_date)} – {formatDate(item.end_date)}
            </ThemedText>
          </View>
          <View
            style={[
              styles.badge,
              { backgroundColor: STATUS_COLORS[item.status] + "20" },
            ]}
          >
            <ThemedText
              type="caption"
              style={{ color: STATUS_COLORS[item.status], fontWeight: "600" }}
            >
              {item.status.toUpperCase()}
            </ThemedText>
          </View>
        </View>

        <ThemedText
          type="small"
          style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
        >
          {item.reason}
        </ThemedText>

        {item.status === "rejected" && item.rejection_reason ? (
          <View
            style={[
              styles.rejectionNote,
              { backgroundColor: Colors.light.errorBg },
            ]}
          >
            <Feather name="alert-circle" size={13} color={Colors.light.error} />
            <ThemedText
              type="caption"
              style={{ color: Colors.light.errorText, flex: 1 }}
            >
              Reason: {item.rejection_reason}
            </ThemedText>
          </View>
        ) : null}

        {item.status === "pending" && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                { backgroundColor: Colors.light.success + "20" },
              ]}
              onPress={() => handleApprove(item.id)}
              disabled={!!actionLoading}
            >
              {isApprovingThis ? (
                <ActivityIndicator size="small" color={Colors.light.success} />
              ) : (
                <>
                  <Feather
                    name="check"
                    size={16}
                    color={Colors.light.success}
                  />
                  <ThemedText
                    type="caption"
                    style={{ color: Colors.light.success, fontWeight: "600" }}
                  >
                    Approve
                  </ThemedText>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                { backgroundColor: Colors.light.error + "20" },
              ]}
              onPress={() => handleRejectOpen(item.id, item.employee_name)}
              disabled={!!actionLoading}
            >
              {isRejectingThis ? (
                <ActivityIndicator size="small" color={Colors.light.error} />
              ) : (
                <>
                  <Feather name="x" size={16} color={Colors.light.error} />
                  <ThemedText
                    type="caption"
                    style={{ color: Colors.light.error, fontWeight: "600" }}
                  >
                    Reject
                  </ThemedText>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Reject Modal */}
      <Modal
        visible={rejectModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setRejectModal({ visible: false, id: "", employeeName: "" })
        }
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <ThemedText type="h3" style={{ marginBottom: 4 }}>
              Reject Leave
            </ThemedText>
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}
            >
              For: {rejectModal.employeeName}
            </ThemedText>
            <ThemedText
              type="small"
              style={{ fontWeight: "600", marginBottom: Spacing.sm }}
            >
              Reason *
            </ThemedText>
            <TextInput
              style={[
                styles.reasonInput,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              placeholder="Enter reason for rejection..."
              placeholderTextColor={theme.textSecondary}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
                onPress={() =>
                  setRejectModal({ visible: false, id: "", employeeName: "" })
                }
              >
                <ThemedText
                  type="small"
                  style={{ color: theme.text, fontWeight: "600" }}
                >
                  Cancel
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: Colors.light.error },
                ]}
                onPress={handleRejectConfirm}
                disabled={!!actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <ThemedText
                    type="small"
                    style={{ color: "#FFFFFF", fontWeight: "600" }}
                  >
                    Reject
                  </ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Comp Off Modal */}
      <Modal
        visible={compOffModal}
        transparent
        animationType="slide"
        onRequestClose={() => setCompOffModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: theme.backgroundDefault, maxHeight: "85%" },
            ]}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: Spacing.lg,
              }}
            >
              <ThemedText type="h3">Add Comp Off</ThemedText>
              <Pressable onPress={() => setCompOffModal(false)}>
                <Feather name="x" size={22} color={theme.text} />
              </Pressable>
            </View>

            <ThemedText
              type="small"
              style={{ fontWeight: "600", marginBottom: Spacing.sm }}
            >
              Employee *
            </ThemedText>
            <TouchableOpacity
              style={[
                styles.reasonInput,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: Spacing.md,
                },
              ]}
              onPress={() => setShowEmployeePicker(true)}
            >
              <ThemedText
                style={{
                  color: selectedEmployee ? theme.text : theme.textSecondary,
                }}
              >
                {selectedEmployee?.name || "Select employee..."}
              </ThemedText>
              <Feather
                name="chevron-down"
                size={16}
                color={theme.textSecondary}
              />
            </TouchableOpacity>

            <Spacer height={Spacing.md} />
            <ThemedText
              type="small"
              style={{ fontWeight: "600", marginBottom: Spacing.sm }}
            >
              Date *
            </ThemedText>
            <TextInput
              style={[
                styles.reasonInput,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              value={compOffDate}
              onChangeText={setCompOffDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
            />

            <Spacer height={Spacing.md} />
            <ThemedText
              type="small"
              style={{ fontWeight: "600", marginBottom: Spacing.sm }}
            >
              Reason
            </ThemedText>
            <TextInput
              style={[
                styles.reasonInput,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              value={compOffReason}
              onChangeText={setCompOffReason}
              placeholder="Reason for comp off (optional)"
              placeholderTextColor={theme.textSecondary}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />

            <Spacer height={Spacing.lg} />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
                onPress={() => setCompOffModal(false)}
              >
                <ThemedText
                  type="small"
                  style={{ color: theme.text, fontWeight: "600" }}
                >
                  Cancel
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: theme.primary }]}
                onPress={handleAddCompOff}
                disabled={compOffLoading}
              >
                {compOffLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <ThemedText
                    type="small"
                    style={{ color: "#fff", fontWeight: "600" }}
                  >
                    Add Comp Off
                  </ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Employee Picker Modal */}
      <Modal
        visible={showEmployeePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEmployeePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: theme.backgroundDefault, maxHeight: "70%" },
            ]}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: Spacing.md,
              }}
            >
              <ThemedText type="h3">Select Employee</ThemedText>
              <Pressable onPress={() => setShowEmployeePicker(false)}>
                <Feather name="x" size={22} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView>
              {employees.map((emp) => (
                <TouchableOpacity
                  key={emp.id}
                  style={[
                    styles.empRow,
                    {
                      borderColor:
                        selectedEmployee?.id === emp.id
                          ? theme.primary
                          : theme.border,
                      backgroundColor:
                        selectedEmployee?.id === emp.id
                          ? theme.primary + "10"
                          : "transparent",
                    },
                  ]}
                  onPress={() => {
                    setSelectedEmployee(emp);
                    setShowEmployeePicker(false);
                  }}
                >
                  <ThemedText style={{ color: theme.text }}>
                    {emp.name}
                  </ThemedText>
                  {selectedEmployee?.id === emp.id && (
                    <Feather name="check" size={16} color={theme.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Header with Comp Off button */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: Spacing.md,
        }}
      >
        <View style={styles.filters}>
          {(["pending", "approved", "rejected"] as const).map((f) => (
            <Pressable
              key={f}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    filter === f ? theme.primary : theme.backgroundDefault,
                },
              ]}
              onPress={() => setFilter(f)}
            >
              <ThemedText
                type="caption"
                style={{
                  color: filter === f ? "#FFF" : theme.text,
                  fontWeight: filter === f ? "600" : "400",
                }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.compOffBtn, { backgroundColor: theme.primary }]}
          onPress={openCompOffModal}
        >
          <Feather name="plus" size={14} color="#fff" />
          <ThemedText
            type="caption"
            style={{ color: "#fff", fontWeight: "600" }}
          >
            Comp Off
          </ThemedText>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : leaves.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="calendar" size={40} color={theme.textSecondary} />
          <Spacer height={Spacing.md} />
          <ThemedText style={{ color: theme.textSecondary }}>
            No {filter} leave requests
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={leaves}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ gap: Spacing.md }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg },
  filters: { flexDirection: "row", gap: Spacing.sm, flex: 1 },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  compOffBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { padding: Spacing.lg, borderRadius: BorderRadius.md },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  rejectionNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.xs,
  },
  actions: { flexDirection: "row", gap: Spacing.md, marginTop: Spacing.md },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  modalBox: {
    width: "100%",
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
  },
  reasonInput: {
    borderWidth: 1.5,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    fontSize: 14,
    minHeight: 44,
    marginBottom: 0,
  },
  modalActions: { flexDirection: "row", gap: Spacing.md },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
  empRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
});
