import React, { useState, useCallback } from "react";
import { StyleSheet, View, FlatList, Pressable, Alert, Modal, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { LeaveBalanceService } from "@/services/leave-balance.service";

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
}

const STATUS_COLORS: Record<string, string> = {
  pending: Colors.light.warning,
  approved: Colors.light.success,
  rejected: Colors.light.error,
};

export default function LeaveManagementScreen() {
  const { theme } = useTheme();
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [rejectModal, setRejectModal] = useState<{ visible: boolean; id: string; employeeName: string }>({ visible: false, id: "", employeeName: "" });
  const [rejectReason, setRejectReason] = useState("");

  const loadLeaves = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("leaves")
      .select("id, type, start_date, end_date, reason, status, rejection_reason, created_at, user_id")
      .eq("status", filter)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Load error:", error.message);
      setLoading(false);
      return;
    }

    const rows = data || [];

    // Fetch employee names separately to avoid FK ambiguity
    const userIds = [...new Set(rows.map((l: any) => l.user_id))];
    let nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", userIds);
      (profiles || []).forEach((p: any) => { nameMap[p.id] = p.name; });
    }

    setLeaves(
      rows.map((l: any) => ({
        id: l.id,
        employee_name: nameMap[l.user_id] || "Unknown",
        type: l.type,
        start_date: l.start_date,
        end_date: l.end_date,
        reason: l.reason,
        status: l.status,
        rejection_reason: l.rejection_reason || null,
        created_at: l.created_at,
      }))
    );
    setLoading(false);
  }, [filter]);

  useFocusEffect(useCallback(() => { loadLeaves(); }, [loadLeaves]));

  const handleApprove = async (id: string, employeeName: string) => {
    setActionLoading(id + "_approve");
    try {
      const { error } = await supabase
        .from("leaves")
        .update({ status: "approved", rejection_reason: null })
        .eq("id", id);
      if (error) throw error;
      // Update balance — await it so it completes before showing success
      await LeaveBalanceService.updateOnApproval(id);
      // Remove from list immediately
      setLeaves((prev) => prev.filter((l) => l.id !== id));
      setActionLoading(null);
      Alert.alert("✅ Approved", `${employeeName}'s leave has been approved and balance updated.`);
    } catch (e: any) {
      setActionLoading(null);
      Alert.alert("Error", e.message || "Failed to approve leave.");
    }
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
    try {
      const { error } = await supabase
        .from("leaves")
        .update({ status: "rejected", rejection_reason: rejectReason.trim() })
        .eq("id", rejectModal.id);
      if (error) throw error;
      const name = rejectModal.employeeName;
      // Remove from list immediately
      setLeaves((prev) => prev.filter((l) => l.id !== rejectModal.id));
      setActionLoading(null);
      setRejectModal({ visible: false, id: "", employeeName: "" });
      Alert.alert("❌ Leave Rejected", `${name}'s leave has been rejected.`);
    } catch (e: any) {
      setActionLoading(null);
      Alert.alert("Error", e.message || "Failed to reject leave.");
    }
  };

  const renderItem = ({ item }: { item: LeaveRequest }) => {
    const days = Math.ceil((new Date(item.end_date).getTime() - new Date(item.start_date).getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const isApprovingThis = actionLoading === item.id + "_approve";
    const isRejectingThis = actionLoading === item.id + "_reject";

    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>{item.employee_name}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.type.toUpperCase()} • {days} day{days > 1 ? "s" : ""}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {new Date(item.start_date).toLocaleDateString()} – {new Date(item.end_date).toLocaleDateString()}
            </ThemedText>
          </View>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] + "20" }]}>
            <ThemedText type="caption" style={{ color: STATUS_COLORS[item.status], fontWeight: "600" }}>
              {item.status.toUpperCase()}
            </ThemedText>
          </View>
        </View>

        <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: Spacing.xs }}>
          {item.reason}
        </ThemedText>

        {item.status === "rejected" && item.rejection_reason ? (
          <View style={[styles.rejectionNote, { backgroundColor: Colors.light.errorBg }]}>
            <Feather name="alert-circle" size={13} color={Colors.light.error} />
            <ThemedText type="caption" style={{ color: Colors.light.errorText, flex: 1 }}>
              Reason: {item.rejection_reason}
            </ThemedText>
          </View>
        ) : null}

        {item.status === "pending" && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: Colors.light.success + "20" }]}
              onPress={() => handleApprove(item.id, item.employee_name)}
              disabled={!!actionLoading}
            >
              {isApprovingThis
                ? <ActivityIndicator size="small" color={Colors.light.success} />
                : <>
                    <Feather name="check" size={16} color={Colors.light.success} />
                    <ThemedText type="caption" style={{ color: Colors.light.success, fontWeight: "600" }}>Approve</ThemedText>
                  </>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: Colors.light.error + "20" }]}
              onPress={() => handleRejectOpen(item.id, item.employee_name)}
              disabled={!!actionLoading}
            >
              {isRejectingThis
                ? <ActivityIndicator size="small" color={Colors.light.error} />
                : <>
                    <Feather name="x" size={16} color={Colors.light.error} />
                    <ThemedText type="caption" style={{ color: Colors.light.error, fontWeight: "600" }}>Reject</ThemedText>
                  </>
              }
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Reject Modal */}
      <Modal visible={rejectModal.visible} transparent animationType="fade" onRequestClose={() => setRejectModal({ visible: false, id: "", employeeName: "" })}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h3" style={{ marginBottom: 4 }}>Reject Leave</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
              For: {rejectModal.employeeName}
            </ThemedText>
            <ThemedText type="small" style={{ fontWeight: "600", marginBottom: Spacing.sm }}>Reason *</ThemedText>
            <TextInput
              style={[styles.reasonInput, { backgroundColor: theme.backgroundSecondary, color: theme.text, borderColor: theme.border }]}
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
                style={[styles.modalBtn, { backgroundColor: theme.backgroundSecondary }]}
                onPress={() => setRejectModal({ visible: false, id: "", employeeName: "" })}
              >
                <ThemedText type="small" style={{ color: theme.text, fontWeight: "600" }}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: Colors.light.error }]}
                onPress={handleRejectConfirm}
                disabled={!!actionLoading}
              >
                {actionLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <ThemedText type="small" style={{ color: "#FFFFFF", fontWeight: "600" }}>Reject</ThemedText>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Filter Tabs */}
      <View style={styles.filters}>
        {(["pending", "approved", "rejected"] as const).map((f) => (
          <Pressable
            key={f}
            style={[styles.filterChip, { backgroundColor: filter === f ? theme.primary : theme.backgroundDefault }]}
            onPress={() => setFilter(f)}
          >
            <ThemedText type="caption" style={{ color: filter === f ? "#FFF" : theme.text, fontWeight: filter === f ? "600" : "400" }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <Spacer height={Spacing.md} />

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={theme.primary} /></View>
      ) : leaves.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="calendar" size={40} color={theme.textSecondary} />
          <Spacer height={Spacing.md} />
          <ThemedText style={{ color: theme.textSecondary }}>No {filter} leave requests</ThemedText>
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
  filters: { flexDirection: "row", gap: Spacing.sm },
  filterChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { padding: Spacing.lg, borderRadius: BorderRadius.md },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.md },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: BorderRadius.xs },
  rejectionNote: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.xs, marginTop: Spacing.sm, padding: Spacing.sm, borderRadius: BorderRadius.xs },
  actions: { flexDirection: "row", gap: Spacing.md, marginTop: Spacing.md },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.xs, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: Spacing.xl },
  modalBox: { width: "100%", borderRadius: BorderRadius.lg, padding: Spacing.xl, maxHeight: "80%" },
  reasonInput: { borderWidth: 1.5, borderRadius: BorderRadius.sm, padding: Spacing.md, fontSize: 14, minHeight: 80, marginBottom: Spacing.lg },
  modalActions: { flexDirection: "row", gap: Spacing.md },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: BorderRadius.sm, alignItems: "center" },
});
