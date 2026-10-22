import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useAuth } from "@/contexts/AuthContext";
import { DurableWriteOutbox, type OutboxItem } from "@/services/outbox/DurableWriteOutbox";
import { OfflineAttendanceService } from "@/services/offline-attendance.service";

const label = (item: OutboxItem) =>
  item.operationType === "ATTENDANCE_CHECKOUT" ? "check-out" : "check-in";

const timeOf = (item: OutboxItem) => {
  const at = item.payload?.location?.capturedAt;
  return at
    ? new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })
    : "";
};

/**
 * Shows attendance saved offline: waiting / retrying, then the server's
 * answer (applied, already done, or not applied with the reason).
 */
export default function OfflineAttendanceStatus() {
  const { user } = useAuth();
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [finished, setFinished] = useState<OutboxItem[]>([]);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setPending([]);
      setFinished([]);
      return;
    }
    setPending(await OfflineAttendanceService.pending(user.id));
    setFinished(await OfflineAttendanceService.finished(user.id));
  }, [user?.id]);

  useEffect(() => {
    void refresh();
    return DurableWriteOutbox.subscribe(() => void refresh());
  }, [refresh]);

  const first = finished[0];
  if (!pending.length && !first) return null;

  if (pending.length) {
    const retrying = pending.find((item) => item.status === "FAILED" && item.lastError);
    return (
      <View style={[styles.card, styles.pending]} accessibilityRole="alert">
        <Feather name="upload-cloud" size={16} color="#FFFFFF" />
        <View style={styles.body}>
          <Text style={styles.title}>
            {pending.length === 1
              ? `Offline ${label(pending[0])} (${timeOf(pending[0])}) saved on this phone`
              : `${pending.length} attendance actions saved on this phone`}
          </Text>
          <Text style={styles.text}>
            {retrying
              ? `Not sent yet: ${retrying.lastError}. Retrying automatically.`
              : "It will be sent automatically when the internet is back. Not confirmed by the server yet."}
          </Text>
        </View>
      </View>
    );
  }

  const rejected = first.status === "DEAD_LETTER";
  const superseded = first.result?.offline_status === "SUPERSEDED";
  return (
    <View style={[styles.card, rejected ? styles.rejected : styles.synced]} accessibilityRole="alert">
      <Feather name={rejected ? "alert-triangle" : "check-circle"} size={16} color="#FFFFFF" />
      <View style={styles.body}>
        <Text style={styles.title}>
          {rejected
            ? `Offline ${label(first)} (${timeOf(first)}) was NOT applied`
            : superseded
              ? `Offline ${label(first)} (${timeOf(first)}): already recorded, nothing changed`
              : `Offline ${label(first)} (${timeOf(first)}) confirmed by the server`}
        </Text>
        {rejected ? (
          <Text style={styles.text}>{String(first.lastError ?? "").replace(/^Terminal error or max retries: /, "")}</Text>
        ) : superseded && first.result?.message ? (
          <Text style={styles.text}>{first.result.message}</Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => void OfflineAttendanceService.markSeen(first)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={10}
      >
        <Feather name="x" size={18} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 88,
    zIndex: 1000,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    elevation: 6,
  },
  pending: { backgroundColor: "#92400E" },
  synced: { backgroundColor: "#166534" },
  rejected: { backgroundColor: "#991B1B" },
  body: { flex: 1 },
  title: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  text: { color: "#FFFFFF", fontSize: 12, marginTop: 2 },
});
