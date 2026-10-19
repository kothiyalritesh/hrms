import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { ThemedText } from "@/components/ThemedText";
import { AttendanceService } from "@/services/attendance.service";
import { stopAttendanceTrackingAfterCheckout } from "@/services/location/attendanceTrackingLifecycle";
import { getBestFreshGPS, type GPSCoords } from "@/utils/gps";

export type AttendanceNextAction = "site" | "meeting" | "office";

interface Props {
  visible: boolean;
  userId: string;
  onCancel: () => void;
  onCheckedOut: () => void | Promise<void>;
  onStartVisit: (type: AttendanceNextAction) => void;
}

const OPTIONS: {
  type: "home" | AttendanceNextAction;
  label: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
}[] = [
  {
    type: "home",
    label: "Going Home",
    description: "End today's attendance after GPS confirmation",
    icon: "home",
  },
  {
    type: "site",
    label: "Site Visit",
    description: "Attendance stays active while you travel",
    icon: "map-pin",
  },
  {
    type: "meeting",
    label: "Client Meeting",
    description: "Create a meeting destination; do not check out",
    icon: "users",
  },
  {
    type: "office",
    label: "Office Stop",
    description: "Create an office stop; do not check out",
    icon: "briefcase",
  },
];

function showMessage(title: string, message: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function AttendanceCheckoutFlow({
  visible,
  userId,
  onCancel,
  onCheckedOut,
  onStartVisit,
}: Props) {
  const [step, setStep] = useState<"action" | "confirm">("action");
  const [loading, setLoading] = useState(false);
  const [attendanceId, setAttendanceId] = useState<string | null>(null);
  const [location, setLocation] = useState<GPSCoords | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (visible) {
      setStep("action");
      setLoading(false);
      setAttendanceId(null);
      setLocation(null);
      setIdempotencyKey(null);
    }
    return () => {
      mounted.current = false;
    };
  }, [visible]);

  const chooseAction = async (type: "home" | AttendanceNextAction) => {
    if (loading) return;
    if (type !== "home") {
      onCancel();
      onStartVisit(type);
      return;
    }

    setLoading(true);
    try {
      const current = await AttendanceService.getToday(userId);
      if (!current.data?.id || !current.data?.checkin_time) {
        showMessage(
          "Not Checked In",
          "You do not have an active attendance check-in for today.",
        );
        return;
      }
      if (current.data.checkout_time) {
        await stopAttendanceTrackingAfterCheckout(
          current.data.id,
          "AUTHORITATIVE_ATTENDANCE_CLOSED",
        );
        await Promise.resolve(onCheckedOut()).catch(() => undefined);
        showMessage(
          "Already Checked Out",
          `Your attendance was already completed at ${new Date(
            current.data.checkout_time,
          ).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Kolkata",
          })}.`,
        );
        onCancel();
        return;
      }

      const freshLocation = await getBestFreshGPS({
        maxSamples: 3,
        preferredAccuracyM: 30,
        maxAccuracyM: 100,
        maxAgeMs: 120_000,
      });
      if (!mounted.current) return;
      setAttendanceId(current.data.id);
      setLocation(freshLocation);
      setIdempotencyKey(Crypto.randomUUID());
      setStep("confirm");
    } catch (error) {
      showMessage(
        "Checkout Location Required",
        error instanceof Error
          ? error.message
          : "A fresh, accurate GPS location could not be obtained.",
      );
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const confirmCheckout = async () => {
    if (loading || !attendanceId || !location || !idempotencyKey) return;
    setLoading(true);
    try {
      const result = await AttendanceService.rpcCheckOut({
        userId,
        attendanceId,
        location,
        reason: "GOING_HOME",
        idempotencyKey,
      });
      if (!result.success || !result.checkout_time) {
        const connectivityFailure = /network|fetch|timeout|connect/i.test(
          `${result.error ?? ""} ${result.message ?? ""}`,
        );
        showMessage(
          "Checkout could not be confirmed",
          connectivityFailure
            ? "Your attendance is still active. Reconnect and try again."
            : result.message ||
                "The server did not commit the checkout. Your attendance is still active.",
        );
        return;
      }

      // The RPC stops the server tracking session transactionally. This local
      // cleanup stops the native task immediately and is safe to retry.
      await stopAttendanceTrackingAfterCheckout(attendanceId, "GOING_HOME");
      await Promise.resolve(onCheckedOut()).catch(() => undefined);
      onCancel();
      showMessage(
        "Checked Out Successfully",
        "You selected Going Home. Your attendance for today is complete.",
      );
    } catch {
      showMessage(
        "Checkout could not be confirmed",
        "Your attendance is still active. Reconnect and try again.",
      );
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={loading ? undefined : onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {step === "action" ? (
            <>
              <ThemedText style={styles.title}>
                What are you doing next?
              </ThemedText>
              <ThemedText style={styles.help}>
                Only Going Home ends attendance.
              </ThemedText>
              {OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.type}
                  style={styles.option}
                  disabled={loading}
                  onPress={() => void chooseAction(option.type)}
                >
                  <View style={styles.optionIcon}>
                    <Feather name={option.icon} size={19} color="#6D1B6D" />
                  </View>
                  <View style={styles.optionText}>
                    <ThemedText style={styles.optionTitle}>
                      {option.label}
                    </ThemedText>
                    <ThemedText style={styles.optionDescription}>
                      {option.description}
                    </ThemedText>
                  </View>
                  {loading && option.type === "home" ? (
                    <ActivityIndicator color="#6D1B6D" />
                  ) : (
                    <Feather name="chevron-right" size={18} color="#9CA3AF" />
                  )}
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.cancel}
                disabled={loading}
                onPress={onCancel}
              >
                <ThemedText style={styles.cancelText}>Cancel</ThemedText>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.confirmIcon}>
                <Feather name="map-pin" size={24} color="#047857" />
              </View>
              <ThemedText style={[styles.title, styles.center]}>
                End your attendance for today?
              </ThemedText>
              <ThemedText style={[styles.help, styles.center]}>
                Your current location will be saved as your checkout location.
              </ThemedText>
              {location ? (
                <View style={styles.accuracyCard}>
                  <ThemedText style={styles.accuracyText}>
                    GPS accuracy: ±{Math.round(Number(location.accuracy))} m
                  </ThemedText>
                  <ThemedText style={styles.coordinateText}>
                    {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                  </ThemedText>
                </View>
              ) : null}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.action, styles.secondary]}
                  disabled={loading}
                  onPress={onCancel}
                >
                  <ThemedText style={styles.secondaryText}>Cancel</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.action, styles.primary]}
                  disabled={loading}
                  onPress={() => void confirmCheckout()}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <ThemedText style={styles.primaryText}>
                      Confirm Check Out
                    </ThemedText>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(15,23,42,0.55)",
  },
  card: {
    width: "100%",
    maxWidth: 480,
    padding: 20,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
  },
  title: { fontSize: 20, fontWeight: "800", color: "#111827" },
  help: { marginTop: 5, marginBottom: 16, color: "#6B7280", lineHeight: 19 },
  center: { textAlign: "center" },
  option: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 9,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
  },
  optionIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "#F5EEF5",
  },
  optionText: { flex: 1, marginHorizontal: 11 },
  optionTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  optionDescription: { marginTop: 2, fontSize: 12, color: "#6B7280" },
  cancel: { alignItems: "center", paddingVertical: 11 },
  cancelText: { fontWeight: "700", color: "#6B7280" },
  confirmIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 12,
    borderRadius: 26,
    backgroundColor: "#D1FAE5",
  },
  accuracyCard: {
    padding: 12,
    marginBottom: 18,
    borderRadius: 10,
    backgroundColor: "#F0FDF4",
  },
  accuracyText: { textAlign: "center", fontWeight: "700", color: "#047857" },
  coordinateText: { marginTop: 3, textAlign: "center", fontSize: 12, color: "#475569" },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  secondary: { borderWidth: 1, borderColor: "#D1D5DB" },
  primary: { backgroundColor: "#6D1B6D" },
  secondaryText: { fontWeight: "700", color: "#374151" },
  primaryText: { fontWeight: "800", color: "#FFFFFF", textAlign: "center" },
});
