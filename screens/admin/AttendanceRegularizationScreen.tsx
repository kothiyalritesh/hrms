import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { AttendanceRegularizationService } from "@/services/attendance-regularization.service";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { formatHrmsDateTime } from "@/utils/attendanceTimestamp";
import { usePermissions } from "@/hooks/usePermissions";

type Status = "PENDING" | "APPROVED" | "REJECTED";
function AttendanceRegularizationScreenContent() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState<Status>("PENDING");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [modal, setModal] = useState<{ row: any; approve: boolean } | null>(
    null,
  );
  const [notes, setNotes] = useState("");
  const { getScopedPermission, hasPermission } = usePermissions();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded: any[] = [];
      const pageSize = 200;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase.rpc(
          "rpc_admin_list_attendance_regularization",
          {
            p_status: filter,
            p_offset: offset,
            p_limit: pageSize,
              p_office_id: (getScopedPermission('attendance.approve')?.scope === 'GLOBAL' || hasPermission('SYSTEM_ADMIN')) ? null : getScopedPermission('attendance.approve')?.scope_id,
          },
        );
        if (error) throw error;
        const response = firstRpcRow<any>(data);
        if (response?.success !== true || !Array.isArray(response?.records)) {
          throw new Error(
            "The server did not confirm the regularization list.",
          );
        }
        loaded.push(...response.records);
        hasMore = response.has_more === true;
        offset += response.records.length;
        if (hasMore && response.records.length === 0) {
          throw new Error("Regularization pagination did not advance.");
        }
      }
      setRows(loaded);
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.message || "Regularization requests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  const openReview = (row: any, approve: boolean) => {
    setNotes(approve ? "Attendance evidence verified by HR" : "");
    setModal({ row, approve });
  };
  const submitReview = async () => {
    if (!user || !modal || reviewing) return;
    if (!modal.approve && notes.trim().length < 3)
      return Alert.alert(
        "Reason required",
        "Enter why this request is rejected.",
      );
    setReviewing(true);
    try {
      const { data, error } = await AttendanceRegularizationService.review(
        modal.row.id,
        user.id,
        modal.approve,
        notes,
      );
      if (error || !data?.success) {
        return Alert.alert(
          "Review failed",
          error?.message || data?.message || data?.error || "Please try again.",
        );
      }
      setModal(null);
      await load();
      Alert.alert(
        "Completed",
        data.message || `Request ${data.status.toLowerCase()}.`,
      );
    } catch (error: any) {
      Alert.alert(
        "Review failed",
        error?.message || "The server did not complete this review.",
      );
    } finally {
      setReviewing(false);
    }
  };
  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={[styles.filters, { backgroundColor: theme.backgroundDefault }]}>
        {(["PENDING", "APPROVED", "REJECTED"] as Status[]).map((value) => (
          <Pressable
            key={value}
            style={[styles.filter, filter === value && styles.active]}
            onPress={() => setFilter(value)}
          >
            <ThemedText
              type="caption"
              style={filter === value ? styles.white : undefined}
            >
              {value}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator color="#6D1B6D" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.wrap}>
          <ThemedText style={[styles.title, { color: theme.text }]}>
            Attendance Regularization
          </ThemedText>
          {loadError ? (
            <View style={styles.errorBox}>
              <Feather name="alert-triangle" size={20} color="#B91C1C" />
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.errorTitle}>
                  Regularization requests unavailable
                </ThemedText>
                <ThemedText type="caption" style={styles.errorText}>
                  {loadError}
                </ThemedText>
              </View>
              <Pressable onPress={() => void load()}>
                <ThemedText style={styles.retryText}>Retry</ThemedText>
              </Pressable>
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="check-circle" size={36} color="#9CA3AF" />
              <ThemedText style={[styles.muted, { color: theme.textSecondary }]}>
                No {filter.toLowerCase()} requests
              </ThemedText>
            </View>
          ) : (
            rows.map((row) => (
              <View key={row.id} style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.name, { color: theme.text }]}>
                      {row.profiles?.name || "Unknown employee"}
                    </ThemedText>
                    <ThemedText type="caption" style={[styles.muted, { color: theme.textSecondary }]}>
                      {row.profiles?.employee_number || ""}
                    </ThemedText>
                  </View>
                  <View style={[styles.badge, { backgroundColor: theme.primary + "15" }]}>
                    <ThemedText type="caption" style={[styles.badgeText, { color: theme.primary }]}>
                      {row.request_type.replaceAll("_", " ")}
                    </ThemedText>
                  </View>
                </View>
                <ThemedText type="small" style={styles.line}>
                  Attendance date: {row.attendance_logs?.date || "-"}
                </ThemedText>
                <ThemedText type="small" style={styles.line}>
                  Official first-in ({row.first_in_source || "Unknown / Needs review"}):{" "}
                  {formatHrmsDateTime(
                    row.official_first_in ?? row.attendance_logs?.checkin_time,
                    "No check-in",
                  )}
                </ThemedText>
                <ThemedText type="small" style={styles.line}>
                  Current official last-out ({row.last_out_source || "NO_DATA"}):{" "}
                  {formatHrmsDateTime(row.current_official_last_out, "No checkout")}
                </ThemedText>
                <ThemedText type="small" style={styles.line}>
                  Attendance status:{" "}
                  <ThemedText
                    type="small"
                    style={{
                      fontWeight: "800",
                      color: row.attendance_logs?.is_late
                        ? "#D97706"
                        : row.attendance_logs?.checkin_time
                          ? "#059669"
                          : "#DC2626",
                    }}
                  >
                    {row.attendance_logs?.is_late
                      ? "Late"
                      : row.attendance_logs?.checkin_time
                        ? "On Time"
                        : "Not Present"}
                  </ThemedText>
                </ThemedText>
                <ThemedText type="small" style={styles.line}>
                  Requested checkout:{" "}
                  {formatHrmsDateTime(
                    row.requested_checkout,
                    "No checkout requested",
                  )}
                </ThemedText>
                <ThemedText type="small" style={styles.line}>
                  Final approved checkout: {formatHrmsDateTime(row.final_approved_checkout, "Not approved")}
                </ThemedText>
                <ThemedText type="small" style={styles.line}>
                  Team: {row.team_name || "Unassigned"} · Office: {row.office_name || "Unassigned"}
                </ThemedText>
                <View style={[styles.reasonBox, { backgroundColor: theme.backgroundSecondary }]}>
                  <ThemedText type="caption" style={[styles.muted, { color: theme.textSecondary }]}>
                    EMPLOYEE REASON
                  </ThemedText>
                  <ThemedText>{row.reason}</ThemedText>
                </View>
                {row.review_notes ? (
                  <View style={[styles.reasonBox, { backgroundColor: theme.backgroundSecondary }]}>
                    <ThemedText type="caption" style={[styles.muted, { color: theme.textSecondary }]}>
                      HR NOTES
                    </ThemedText>
                    <ThemedText>{row.review_notes}</ThemedText>
                  </View>
                ) : null}
                {row.status === "PENDING" ? (
                  <View style={styles.actions}>
                    <Pressable
                      style={[styles.button, { backgroundColor: "#10B981" }]}
                      onPress={() => openReview(row, true)}
                    >
                      <Feather name="check" color="#fff" />
                      <ThemedText style={styles.white}>Approve</ThemedText>
                    </Pressable>
                    <Pressable
                      style={[styles.button, { backgroundColor: "#EF4444" }]}
                      onPress={() => openReview(row, false)}
                    >
                      <Feather name="x" color="#fff" />
                      <ThemedText style={styles.white}>Reject</ThemedText>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}
      <Modal
        transparent
        visible={!!modal}
        animationType="fade"
        onRequestClose={() => setModal(null)}
      >
        <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
          <View style={[styles.modal, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={[styles.title, { color: theme.text }]}>
              {modal?.approve
                ? "Approve regularization"
                : "Reject regularization"}
            </ThemedText>
            <ThemedText style={[styles.muted, { color: theme.textSecondary }]}>
              {modal?.row?.profiles?.name} · {modal?.row?.attendance_logs?.date}
            </ThemedText>
            <ThemedText type="small" style={styles.notesLabel}>
              HR notes {modal?.approve ? "" : "*"}
            </ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundRoot }]}
              multiline
              value={notes}
              onChangeText={setNotes}
              placeholder={
                modal?.approve ? "Verification notes" : "Reason for rejection"
              }
              textAlignVertical="top"
            />
            <View style={styles.actions}>
              <Pressable
                style={[styles.button, styles.cancel, { backgroundColor: theme.backgroundSecondary }]}
                onPress={() => setModal(null)}
              >
                <ThemedText>Cancel</ThemedText>
              </Pressable>
              <Pressable
                style={[
                  styles.button,
                  { backgroundColor: modal?.approve ? "#10B981" : "#EF4444" },
                ]}
                onPress={submitReview}
                disabled={reviewing}
              >
                {reviewing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={styles.white}>Confirm</ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F6F8" },
  filters: {
    flexDirection: "row",
    gap: 7,
    padding: 14,
    backgroundColor: "#fff",
  },
  filter: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  active: { backgroundColor: "#6D1B6D", borderColor: "#6D1B6D" },
  white: { color: "#fff", fontWeight: "700" },
  wrap: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 12 },
  empty: { alignItems: "center", marginTop: 60, gap: 10 },
  muted: { color: "#6B7280" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEE2E2",
  },
  errorTitle: { color: "#991B1B", fontWeight: "800" },
  errorText: { color: "#991B1B", marginTop: 2 },
  retryText: { color: "#991B1B", fontWeight: "800" },
  card: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  cardTop: { flexDirection: "row", gap: 8, marginBottom: 8 },
  name: { fontWeight: "800", fontSize: 16 },
  badge: {
    backgroundColor: "#F5EAF5",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    alignSelf: "flex-start",
  },
  badgeText: { color: "#6D1B6D", fontWeight: "700" },
  line: { marginTop: 3 },
  reasonBox: {
    backgroundColor: "#F9FAFB",
    padding: 9,
    borderRadius: 8,
    marginTop: 9,
    gap: 3,
  },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  button: {
    flex: 1,
    padding: 11,
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,.5)",
    padding: 20,
  },
  modal: { backgroundColor: "#fff", borderRadius: 14, padding: 18 },
  notesLabel: { fontWeight: "700", marginTop: 16, marginBottom: 6 },
  input: {
    height: 100,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 9,
    padding: 10,
  },
  cancel: { backgroundColor: "#F3F4F6" },
});

export default function AttendanceRegularizationScreen() {
  return (
    <ModuleErrorBoundary moduleName="Attendance Regularization">
      <AttendanceRegularizationScreenContent />
    </ModuleErrorBoundary>
  );
}
