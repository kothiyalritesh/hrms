import React, { useState, useCallback, useEffect } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  TextInput,
  Modal,
  Alert,
  RefreshControl,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { useAuth } from "@/contexts/AuthContext";
import { LeaveService } from "@/services/leave.service";
import { LeaveBalanceService } from "@/services/leave-balance.service";
import { supabase } from "@/lib/supabase";

type LeaveType = "sick" | "casual" | "earned" | "wfh";

interface LeaveRequest {
  id: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  appliedOn: string;
}

const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  sick: "Sick Leave",
  casual: "Casual Leave",
  earned: "Earned Leave",
  wfh: "Work From Home",
};

const STATUS_COLORS = {
  pending: { bg: Colors.light.warningBg, text: Colors.light.warningText },
  approved: { bg: Colors.light.successBg, text: Colors.light.successText },
  rejected: { bg: Colors.light.errorBg, text: Colors.light.errorText },
};

interface LeaveCardProps {
  leave: LeaveRequest;
}

function LeaveCard({ leave }: LeaveCardProps) {
  const { theme } = useTheme();
  const statusColor = STATUS_COLORS[leave.status];
  const startDate = new Date(leave.startDate);
  const endDate = new Date(leave.endDate);
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  return (
    <View style={[styles.leaveCard, { backgroundColor: theme.backgroundDefault }]}>
      <View style={styles.leaveHeader}>
        <View>
          <ThemedText type="body" style={styles.leaveType}>
            {LEAVE_TYPE_LABELS[leave.type]}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {startDate.toLocaleDateString()} - {endDate.toLocaleDateString()} ({days} day{days > 1 ? "s" : ""})
          </ThemedText>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
          <ThemedText type="caption" style={{ color: statusColor.text, fontWeight: "600" }}>
            {leave.status.toUpperCase()}
          </ThemedText>
        </View>
      </View>

      <ThemedText type="small" style={[styles.leaveReason, { color: theme.textSecondary }]} numberOfLines={2}>
        {leave.reason}
      </ThemedText>

      {leave.status === "rejected" && (leave as any).rejectionReason ? (
        <View style={[styles.rejectionBanner, { backgroundColor: Colors.light.errorBg }]}>
          <Feather name="alert-circle" size={13} color={Colors.light.error} />
          <ThemedText type="caption" style={{ color: Colors.light.errorText, flex: 1, lineHeight: 18 }}>
            Rejected: {(leave as any).rejectionReason}
          </ThemedText>
        </View>
      ) : null}

      <View style={styles.leaveFooter}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Applied: {new Date(leave.appliedOn).toLocaleDateString()}
        </ThemedText>
      </View>
    </View>
  );
}

export default function LeaveScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [balance, setBalance] = useState({ sick: 12, casual: 12, earned: 15, wfh: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [newLeave, setNewLeave] = useState({
    type: "casual" as LeaveType,
    startDate: new Date().toISOString().split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
    reason: "",
  });

  const loadData = useCallback(async () => {
    if (!user?.id) return;

    const { data, error } = await supabase
      .from("leaves")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      const mapped: LeaveRequest[] = data.map((l: any) => ({
        id: l.id,
        type: l.type,
        startDate: l.start_date,
        endDate: l.end_date,
        reason: l.reason,
        status: l.status,
        rejectionReason: l.rejection_reason || null,
        appliedOn: l.created_at,
      }));
      setLeaves(mapped);
    }

    // Load balance from leave_balances table (auto-initialized if missing)
    const lb = await LeaveBalanceService.getOrCreate(user.id);
    const rem = LeaveBalanceService.remaining(lb);
    setBalance({ sick: rem.sick, casual: rem.casual, earned: rem.earned, wfh: rem.wfh });
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // Live balance update — re-fetch when leave_balances changes for this user
  useEffect(() => {
    if (!user?.id) return;
    const sub = supabase
      .channel("leave_balance_" + user.id)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leave_balances", filter: `user_id=eq.${user.id}` },
        () => { loadData(); },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leaves", filter: `user_id=eq.${user.id}` },
        () => { loadData(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [user?.id, loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleApplyLeave = async () => {
    if (!newLeave.startDate.trim() || !newLeave.endDate.trim()) {
      Alert.alert("Required Fields", "Please fill in start and end dates.");
      return;
    }
    if (!newLeave.reason.trim()) {
      Alert.alert("Required Fields", "Please enter a reason for leave.");
      return;
    }
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to apply for leave.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("leaves").insert({
      user_id: user.id,
      type: newLeave.type,
      start_date: newLeave.startDate,
      end_date: newLeave.endDate,
      reason: newLeave.reason,
      status: "pending",
    });
    setSubmitting(false);

    if (error) {
      Alert.alert("Error", "Failed to submit leave: " + error.message);
      return;
    }

    setShowApplyModal(false);
    setNewLeave({
      type: "casual",
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date().toISOString().split("T")[0],
      reason: "",
    });
    await loadData();
    Alert.alert("✅ Leave Applied!", `Your ${LEAVE_TYPE_LABELS[newLeave.type]} request has been submitted and is pending approval.`);
  };

  const totalBalance = balance.sick + balance.casual + balance.earned + balance.wfh;

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScreenScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
          />
        }
      >
        <View style={[styles.balanceCard, { backgroundColor: theme.primary }]}>
          <ThemedText type="h1" style={{ color: "#FFFFFF" }}>
            {totalBalance}
          </ThemedText>
          <ThemedText type="small" style={{ color: "#FFFFFF", opacity: 0.8 }}>
            Total Leave Balance
          </ThemedText>

          <Spacer height={Spacing.lg} />

          <View style={styles.balanceRow}>
            <View style={styles.balanceItem}>
              <ThemedText type="h3" style={{ color: "#FFFFFF" }}>
                {balance.sick}
              </ThemedText>
              <ThemedText
                type="caption"
                style={{ color: "#FFFFFF", opacity: 0.8 }}
              >
                Sick
              </ThemedText>
            </View>
            <View
              style={[
                styles.balanceDivider,
                { backgroundColor: "rgba(255,255,255,0.3)" },
              ]}
            />
            <View style={styles.balanceItem}>
              <ThemedText type="h3" style={{ color: "#FFFFFF" }}>
                {balance.casual}
              </ThemedText>
              <ThemedText
                type="caption"
                style={{ color: "#FFFFFF", opacity: 0.8 }}
              >
                Casual
              </ThemedText>
            </View>
            <View
              style={[
                styles.balanceDivider,
                { backgroundColor: "rgba(255,255,255,0.3)" },
              ]}
            />
            <View style={styles.balanceItem}>
              <ThemedText type="h3" style={{ color: "#FFFFFF" }}>
                {balance.earned}
              </ThemedText>
              <ThemedText
                type="caption"
                style={{ color: "#FFFFFF", opacity: 0.8 }}
              >
                Earned
              </ThemedText>
            </View>
            <View
              style={[
                styles.balanceDivider,
                { backgroundColor: "rgba(255,255,255,0.3)" },
              ]}
            />
            <View style={styles.balanceItem}>
              <ThemedText type="h3" style={{ color: "#FFFFFF" }}>
                {balance.wfh}
              </ThemedText>
              <ThemedText
                type="caption"
                style={{ color: "#FFFFFF", opacity: 0.8 }}
              >
                WFH
              </ThemedText>
            </View>
          </View>
        </View>

        <Spacer height={Spacing.xl} />

        <Button onPress={() => setShowApplyModal(true)}>Apply for Leave</Button>

        <Spacer height={Spacing.xl} />

        <View style={styles.sectionHeader}>
          <ThemedText type="h3">Leave History</ThemedText>
        </View>

        <Spacer height={Spacing.md} />

        {leaves.length > 0 ? (
          <View style={styles.leavesList}>
            {leaves.map((leave) => (
              <LeaveCard key={leave.id} leave={leave} />
            ))}
          </View>
        ) : (
          <View
            style={[
              styles.emptyState,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <Feather name="calendar" size={48} color={theme.textSecondary} />
            <Spacer height={Spacing.md} />
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              No leave applications yet
            </ThemedText>
          </View>
        )}

        <Spacer height={Spacing["2xl"]} />
      </ScreenScrollView>

      <Modal
        visible={showApplyModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowApplyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContainer,
              { paddingBottom: insets.bottom + Spacing.lg },
            ]}
          >
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Apply for Leave</ThemedText>
              <Pressable onPress={() => setShowApplyModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalContent}
              keyboardShouldPersistTaps="handled"
            >
              <ThemedText type="small" style={styles.inputLabel}>
                Leave Type
              </ThemedText>
              <View style={styles.typeSelector}>
                {(["sick", "casual", "earned", "wfh"] as LeaveType[]).map(
                  (type) => (
                    <Pressable
                      key={type}
                      style={[
                        styles.typeOption,
                        {
                          backgroundColor:
                            newLeave.type === type
                              ? theme.primary
                              : theme.backgroundSecondary,
                        },
                      ]}
                      onPress={() => setNewLeave({ ...newLeave, type })}
                    >
                      <ThemedText
                        type="caption"
                        style={{
                          color:
                            newLeave.type === type ? "#FFFFFF" : theme.text,
                          fontWeight: "500",
                        }}
                      >
                        {type === "wfh"
                          ? "WFH"
                          : type.charAt(0).toUpperCase() + type.slice(1)}
                      </ThemedText>
                    </Pressable>
                  ),
                )}
              </View>

              <Spacer height={Spacing.lg} />

              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="small" style={styles.inputLabel}>
                    Start Date
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.modalInput,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        color: theme.text,
                      },
                    ]}
                    value={newLeave.startDate}
                    onChangeText={(text) =>
                      setNewLeave({ ...newLeave, startDate: text })
                    }
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={theme.textSecondary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="small" style={styles.inputLabel}>
                    End Date
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.modalInput,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        color: theme.text,
                      },
                    ]}
                    value={newLeave.endDate}
                    onChangeText={(text) =>
                      setNewLeave({ ...newLeave, endDate: text })
                    }
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={theme.textSecondary}
                  />
                </View>
              </View>

              <Spacer height={Spacing.lg} />

              <ThemedText type="small" style={styles.inputLabel}>
                Reason
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  styles.textArea,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={newLeave.reason}
                onChangeText={(text) =>
                  setNewLeave({ ...newLeave, reason: text })
                }
                placeholder="Enter reason for leave"
                placeholderTextColor={theme.textSecondary}
                multiline
                numberOfLines={4}
              />

              <Spacer height={Spacing.xl} />

              <Button onPress={handleApplyLeave} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Application"}
              </Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  balanceCard: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
  balanceRow: {
    flexDirection: "row",
    width: "100%",
  },
  balanceItem: {
    flex: 1,
    alignItems: "center",
  },
  balanceDivider: {
    width: 1,
    height: "100%",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  leavesList: {
    gap: Spacing.md,
  },
  leaveCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  leaveHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
  },
  leaveType: {
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  leaveReason: { marginBottom: Spacing.sm },
  rejectionBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: Spacing.xs,
    padding: Spacing.sm, borderRadius: BorderRadius.xs, marginBottom: Spacing.sm,
  },
  leaveFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  emptyState: {
    alignItems: "center",
    padding: Spacing["3xl"],
    borderRadius: BorderRadius.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "88%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128, 128, 128, 0.2)",
  },
  modalContent: {
    padding: Spacing.lg,
  },
  inputLabel: {
    marginBottom: Spacing.xs,
    fontWeight: "600",
  },
  typeSelector: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  typeOption: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
  dateRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  modalInput: {
    height: Spacing.inputHeight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    fontSize: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: "top",
    paddingTop: Spacing.md,
  },
});
