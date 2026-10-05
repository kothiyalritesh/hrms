import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { DeviceSessionService, type UserDeviceSession } from "@/services/device-session.service";

export default function DeviceSessionsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [sessions, setSessions] = useState<UserDeviceSession[]>([]);
  const [currentIdentifier, setCurrentIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await DeviceSessionService.listMine();
      setSessions(result.sessions);
      setCurrentIdentifier(result.currentIdentifier);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Device sessions could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) void load();
  }, [visible]);

  const revoke = (session: UserDeviceSession) => {
    Alert.alert("Revoke device session?", "This device will need to sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: async () => {
          try {
            await DeviceSessionService.revoke(session.id);
            await load();
          } catch (value) {
            Alert.alert("Revocation failed", value instanceof Error ? value.message : "Try again.");
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <ThemedText style={styles.title}>Device Sessions</ThemedText>
              <ThemedText style={styles.help}>Review where your account is active.</ThemedText>
            </View>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color="#475569" /></TouchableOpacity>
          </View>
          
          {loading ? <ActivityIndicator color="#6D1B6D" style={{ margin: 24 }} /> : null}
          {!!error ? (
            <TouchableOpacity style={styles.error} onPress={() => void load()}>
              <ThemedText style={styles.errorText}>{error} Tap to retry.</ThemedText>
            </TouchableOpacity>
          ) : null}
          
          {sessions.find(s => s.device_identifier === currentIdentifier) && (
            <View style={[styles.session, { backgroundColor: "#F0FDF4", padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "#BBF7D0", marginBottom: 16, borderTopWidth: 1, borderTopColor: "#BBF7D0" }]}>
              <View style={[styles.deviceIcon, { backgroundColor: "#DCFCE7" }]}><Feather name={sessions.find(s => s.device_identifier === currentIdentifier)?.platform === "web" ? "monitor" : "smartphone"} size={20} color="#16A34A" /></View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.deviceName, { color: "#166534" }]}>{sessions.find(s => s.device_identifier === currentIdentifier)?.device_name || "Current Device"}</ThemedText>
                <ThemedText style={[styles.meta, { color: "#15803D" }]}>ID: {currentIdentifier}</ThemedText>
                <ThemedText style={[styles.meta, { color: "#16A34A", marginTop: 4, fontWeight: "600" }]}>You are checked in from this device</ThemedText>
              </View>
            </View>
          )}

          <ThemedText style={{ fontSize: 16, fontWeight: "700", marginBottom: 12, marginTop: 8 }}>Other Devices</ThemedText>

          {sessions.filter(s => s.device_identifier !== currentIdentifier).map((session) => {
            const current = session.device_identifier === currentIdentifier;
            return (
              <View key={session.id} style={styles.session}>
                <View style={styles.deviceIcon}><Feather name={session.platform === "web" ? "monitor" : "smartphone"} size={18} color="#6D1B6D" /></View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.deviceName}>{session.device_name || session.platform}{current ? " · This device" : ""}</ThemedText>
                  <ThemedText style={styles.meta}>Last activity: {new Date(session.last_active_at).toLocaleString("en-IN")}</ThemedText>
                  {!session.is_active ? <ThemedText style={styles.revoked}>Revoked</ThemedText> : null}
                </View>
                {!current && session.is_active ? (
                  <TouchableOpacity onPress={() => revoke(session)}><ThemedText style={styles.revoke}>Revoke</ThemedText></TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.55)" },
  card: { maxHeight: "80%", padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: "#FFFFFF" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  title: { fontSize: 19, fontWeight: "800", color: "#111827" },
  help: { marginTop: 3, fontSize: 12, color: "#64748B" },
  session: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  deviceIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#F5EEF5" },
  deviceName: { fontWeight: "700", color: "#1F2937" },
  meta: { marginTop: 2, fontSize: 11, color: "#64748B" },
  revoked: { marginTop: 2, fontSize: 11, color: "#B91C1C" },
  revoke: { padding: 8, fontWeight: "800", color: "#B91C1C" },
  error: { padding: 10, borderRadius: 8, backgroundColor: "#FEF2F2" },
  errorText: { fontSize: 12, color: "#991B1B" },
});
