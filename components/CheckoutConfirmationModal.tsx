import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttendancePolicy } from "@/services/attendance.service";

export type CheckoutAction = "checkout" | "cancel";

interface Props {
  visible: boolean;
  checkinTime: string;
  policy: AttendancePolicy | null;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return "--:--";
  }
}

export default function CheckoutConfirmationModal({
  visible,
  checkinTime,
  policy,
  loading,
  onConfirm,
  onCancel,
}: Props) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");
  const [workedMinutes, setWorkedMinutes] = useState(0);
  const [isEarly, setIsEarly] = useState(false);
  const [isTimeBlocked, setIsTimeBlocked] = useState(false);

  useEffect(() => {
    if (visible) {
      setReason("");
      const checkin = new Date(checkinTime).getTime();
      const now = Date.now();
      const diff = Math.floor((now - checkin) / 60000);
      setWorkedMinutes(Math.max(0, diff));

      const minWork = policy?.min_work_duration_minutes ?? 240;
      const earliestTime = policy?.earliest_checkout_time ?? "14:00";

      // IST wall-clock time as HH:MM (24h) for comparison
      const nowTimeIST = new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Kolkata",
      });

      // Hard block: before earliest_checkout_time — no reason can bypass this
      const isBeforeEarliest = nowTimeIST < earliestTime;
      // Soft block: under minimum duration — bypassable with reason
      const isUnderMinDuration = diff < minWork;

      setIsEarly(isBeforeEarliest || isUnderMinDuration);
      setIsTimeBlocked(isBeforeEarliest);
    }
  }, [visible, checkinTime, policy]);

  const handleConfirm = () => {
    onConfirm(reason);
  };

  const minWork = policy?.min_work_duration_minutes ?? 240;
  const earliestTime = policy?.earliest_checkout_time ?? "14:00";
  const remainingMinutes = Math.max(0, minWork - workedMinutes);
  // Confirm is disabled when: loading, time-blocked (hard), or early with no reason
  const confirmDisabled = loading || isTimeBlocked || (isEarly && !isTimeBlocked && !reason.trim());

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={s.handle} />

          <ScrollView
            style={s.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={s.header}>
              <View style={[s.iconCircle, isTimeBlocked ? s.blockedCircle : isEarly ? s.warningCircle : s.successCircle]}>
                <Feather
                  name={isTimeBlocked ? "slash" : isEarly ? "clock" : "check-circle"}
                  size={28}
                  color={isTimeBlocked ? "#EF4444" : isEarly ? "#F59E0B" : "#10B981"}
                />
              </View>
              <ThemedText style={s.title}>
                {isTimeBlocked ? "Checkout Not Allowed Yet" : isEarly ? "Early Checkout" : "Confirm Checkout"}
              </ThemedText>
              <ThemedText style={s.subtitle}>
                {isTimeBlocked
                  ? `Checkout is only allowed from ${earliestTime} IST onwards.`
                  : isEarly
                  ? "You haven't completed the minimum work duration yet."
                  : "You've completed your minimum work hours for today."}
              </ThemedText>
            </View>

            {/* Time Summary */}
            <View style={s.timeSummary}>
              <View style={s.timeRow}>
                <View style={s.timeLabel}>
                  <Feather name="log-in" size={14} color="#6B7280" />
                  <ThemedText style={s.timeLabelText}>Checked In</ThemedText>
                </View>
                <ThemedText style={s.timeValue}>{formatTime(checkinTime)}</ThemedText>
              </View>
              <View style={s.timeRow}>
                <View style={s.timeLabel}>
                  <Feather name="clock" size={14} color="#6B7280" />
                  <ThemedText style={s.timeLabelText}>Current Time</ThemedText>
                </View>
                <ThemedText style={s.timeValue}>
                  {new Date().toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                    timeZone: "Asia/Kolkata",
                  })}
                </ThemedText>
              </View>
              <View style={s.divider} />
              <View style={s.timeRow}>
                <View style={s.timeLabel}>
                  <Feather name="bar-chart-2" size={14} color="#6B7280" />
                  <ThemedText style={s.timeLabelText}>Worked Duration</ThemedText>
                </View>
                <ThemedText
                  style={[
                    s.timeValue,
                    s.timeValueBold,
                    { color: isEarly ? "#F59E0B" : "#10B981" },
                  ]}
                >
                  {formatDuration(workedMinutes)}
                </ThemedText>
              </View>
              {isEarly && (
                <View style={s.timeRow}>
                  <View style={s.timeLabel}>
                    <Feather name="alert-triangle" size={14} color="#EF4444" />
                    <ThemedText style={s.timeLabelText}>Minimum Required</ThemedText>
                  </View>
                  <ThemedText style={[s.timeValue, { color: "#EF4444" }]}>
                    {formatDuration(minWork)}
                  </ThemedText>
                </View>
              )}
            </View>

            {/* Hard time-block warning */}
            {isTimeBlocked && (
              <View style={[s.warningBox, { backgroundColor: "#FEE2E2", borderColor: "#FECACA" }]}>
                <Feather name="slash" size={16} color="#991B1B" />
                <View style={s.warningContent}>
                  <ThemedText style={[s.warningTitle, { color: "#991B1B" }]}>Checkout Blocked</ThemedText>
                  <ThemedText style={[s.warningText, { color: "#B91C1C" }]}>
                    Checkout is not allowed before {earliestTime} IST. This rule cannot be bypassed.
                    Please wait until {earliestTime} to check out.
                  </ThemedText>
                </View>
              </View>
            )}

            {/* Early Checkout Warning (duration only, not time-blocked) */}
            {isEarly && !isTimeBlocked && (
              <View style={s.warningBox}>
                <Feather name="alert-triangle" size={16} color="#92400E" />
                <View style={s.warningContent}>
                  <ThemedText style={s.warningTitle}>Early Checkout Notice</ThemedText>
                  <ThemedText style={s.warningText}>
                    You need {formatDuration(remainingMinutes)} more to reach the minimum
                    work duration. Early checkout will be flagged and may require manager
                    approval.
                  </ThemedText>
                </View>
              </View>
            )}

            {/* Reason Input — only for soft duration block, not hard time block */}
            {isEarly && !isTimeBlocked && (
              <View style={s.reasonSection}>
                <ThemedText style={s.reasonLabel}>
                  Reason for Early Checkout <ThemedText style={s.required}>*</ThemedText>
                </ThemedText>
                <TextInput
                  style={s.reasonInput}
                  placeholder="e.g., Medical appointment, personal emergency, etc."
                  placeholderTextColor="#9CA3AF"
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  maxLength={500}
                  autoFocus
                />
              </View>
            )}

            {/* Action Buttons */}
            <View style={s.actions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={onCancel}
                disabled={loading}
              >
                <ThemedText style={s.cancelBtnText}>Cancel</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  s.confirmBtn,
                  confirmDisabled && s.confirmBtnDisabled,
                  loading && { opacity: 0.7 },
                ]}
                onPress={handleConfirm}
                disabled={confirmDisabled}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Feather name="log-out" size={16} color="#fff" />
                    <ThemedText style={s.confirmBtnText}>
                      {isEarly ? "Check Out Early" : "Check Out"}
                    </ThemedText>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Undo Info */}
            {policy && policy.undo_checkout_minutes > 0 && (
              <View style={s.undoInfo}>
                <Feather name="info" size={12} color="#6B7280" />
                <ThemedText style={s.undoInfoText}>
                  You can undo this checkout within {policy.undo_checkout_minutes} minutes
                  if done accidentally.
                </ThemedText>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "92%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E5E7EB",
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  header: {
    alignItems: "center",
    paddingVertical: 12,
    gap: 8,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  successCircle: {
    backgroundColor: "#D1FAE5",
  },
  warningCircle: {
    backgroundColor: "#FEF3C7",
  },
  blockedCircle: {
    backgroundColor: "#FEE2E2",
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 10,
  },
  timeSummary: {
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    gap: 10,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timeLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  timeLabelText: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
  },
  timeValue: {
    fontSize: 13,
    color: "#374151",
    fontWeight: "600",
  },
  timeValueBold: {
    fontSize: 15,
    fontWeight: "800",
  },
  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 2,
  },
  warningBox: {
    flexDirection: "row",
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    gap: 10,
    alignItems: "flex-start",
  },
  warningContent: {
    flex: 1,
    gap: 4,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#92400E",
  },
  warningText: {
    fontSize: 12,
    color: "#A16207",
    lineHeight: 17,
  },
  reasonSection: {
    marginTop: 16,
  },
  reasonLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#374151",
    marginBottom: 8,
  },
  required: {
    color: "#EF4444",
  },
  reasonInput: {
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
    minHeight: 90,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#6B7280",
  },
  confirmBtn: {
    flex: 1.5,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#60045d",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  confirmBtnDisabled: {
    backgroundColor: "#9CA3AF",
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  undoInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    marginBottom: 8,
    justifyContent: "center",
  },
  undoInfoText: {
    fontSize: 11,
    color: "#6B7280",
  },
});
