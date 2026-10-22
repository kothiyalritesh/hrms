import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { supabase } from "@/lib/supabase";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { formatHrmsDateTime, formatHrmsTime } from "@/utils/attendanceTimestamp";
import { callPhone, formatPhone } from "@/utils/phoneCall";

type QueueItem = {
  id: string;
  user_id: string;
  employee_name: string;
  phone?: string | null;
  office_name: string | null;
  status: "PENDING_REASON" | "REASON_SUBMITTED";
  detected_at: string;
  returned_at?: string | null;
  distance_m: number | null;
  reason: string | null;
  reason_at: string | null;
};

type Decision = "ACCEPTED" | "REJECTED" | "WAIVED";

function friendlyError(message: string) {
  if (message.includes("COMMENT_REQUIRED")) return "Write a short comment to reject.";
  if (message.includes("CANNOT_REVIEW_OWN_EVENT")) return "You cannot review your own alert.";
  if (message.includes("PERMISSION_REQUIRED") || message.includes("42501")) return "You do not have access to this employee.";
  return "Could not save the decision. Try again.";
}

/**
 * Office exits confirmed by the server (> 10 min outside the office radius).
 * Reviewer accepts, rejects (−5 compliance points) or waives each one.
 * Embedded (Live Tracking header) it hides itself when there is nothing to
 * review; standalone (Office Exits screen) it shows empty and error states.
 */
export function GeofenceReviewPanel({
  standalone = false,
  days = 7,
  reloadKey = 0,
  onLoaded,
}: {
  standalone?: boolean;
  days?: number;
  reloadKey?: number;
  onLoaded?: () => void;
} = {}) {
  const { theme } = useTheme();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("rpc_geofence_review_queue", { p_days: days });
    if (error) setLoadError("Could not load office exits. Pull down to retry.");
    else {
      setLoadError(null);
      setItems(Array.isArray(data) ? (data as QueueItem[]) : []);
    }
    setLoading(false);
    onLoaded?.();
  }, [days, onLoaded]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load, reloadKey]);

  const decide = async (item: QueueItem, decision: Decision) => {
    const comment = (comments[item.id] || "").trim();
    if (decision === "REJECTED" && comment.length < 3) {
      setErrors((prev) => ({ ...prev, [item.id]: "Write a short comment to reject." }));
      return;
    }
    setBusyId(item.id);
    setErrors((prev) => ({ ...prev, [item.id]: "" }));
    const { error } = await supabase.rpc("rpc_review_geofence_event", {
      p_event_id: item.id,
      p_decision: decision,
      p_comment: comment || null,
    });
    setBusyId(null);
    if (error) {
      setErrors((prev) => ({ ...prev, [item.id]: friendlyError(error.message || "") }));
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }
  if (items.length === 0) {
    if (!standalone) return null;
    return (
      <View style={[styles.empty, { borderColor: theme.border }]}>
        <Feather name={loadError ? "alert-circle" : "check-circle"} size={28} color={loadError ? theme.error : theme.success} />
        <ThemedText style={{ fontWeight: "800", textAlign: "center" }}>
          {loadError ?? "Nothing to review"}
        </ThemedText>
        {loadError ? null : (
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
            Employees who stay outside the office radius for over 10 minutes during working hours appear here.
          </ThemedText>
        )}
      </View>
    );
  }

  const waiting = items.filter((i) => i.status === "PENDING_REASON").length;

  return (
    <View style={{ gap: 10, marginBottom: 12 }}>
      <ThemedText style={[styles.heading, { color: theme.textSecondary }]}>
        LEFT THE OFFICE · {items.length} TO REVIEW{waiting ? ` · ${waiting} WAITING FOR A REASON` : ""}
      </ThemedText>
      {loadError ? <ThemedText style={{ color: theme.error, fontSize: 13 }}>{loadError}</ThemedText> : null}
      {items.map((item) => {
        const busy = busyId === item.id;
        return (
          <View key={item.id} style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: theme.error + "1A" }]}>
                <Feather name="map-pin" size={16} color={theme.error} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <ThemedText style={{ fontWeight: "800" }} numberOfLines={1}>{item.employee_name}</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {Math.round(Number(item.distance_m) || 0)} m from {item.office_name || "office"} · {formatHrmsDateTime(item.detected_at)}
                </ThemedText>
                {item.returned_at !== undefined ? (
                  <ThemedText type="caption" style={{ color: item.returned_at ? theme.success : theme.textSecondary }}>
                    {item.returned_at ? `Back inside at ${formatHrmsTime(item.returned_at)}` : "Not back inside yet"}
                  </ThemedText>
                ) : null}
              </View>
              {item.phone ? (
                <Pressable
                  onPress={() => void callPhone(item.phone, item.employee_name)}
                  style={[styles.call, { borderColor: theme.success }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${item.employee_name} on ${formatPhone(item.phone)}`}
                >
                  <Feather name="phone" size={16} color={theme.success} />
                  <ThemedText style={{ color: theme.success, fontWeight: "800" }}>Call</ThemedText>
                </Pressable>
              ) : null}
            </View>
            <View style={[styles.reason, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={{ color: item.reason ? theme.text : theme.textSecondary, fontStyle: item.reason ? "normal" : "italic" }}>
                {item.reason || "No reason submitted yet"}
              </ThemedText>
            </View>
            <TextInput
              value={comments[item.id] || ""}
              onChangeText={(text) => setComments((prev) => ({ ...prev, [item.id]: text }))}
              placeholder="Comment (required to reject)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, borderColor: errors[item.id] ? theme.error : theme.border }]}
              editable={!busy}
            />
            {errors[item.id] ? <ThemedText style={{ color: theme.error, fontSize: 13 }}>{errors[item.id]}</ThemedText> : null}
            <View style={styles.actions}>
              {([
                ["ACCEPTED", "Accept", theme.success],
                ["REJECTED", "Reject", theme.error],
                ["WAIVED", "Waive", theme.textSecondary],
              ] as const).map(([decision, label, color]) => (
                <Pressable
                  key={decision}
                  disabled={busy}
                  onPress={() => void decide(item, decision)}
                  style={[styles.action, { borderColor: color, opacity: busy ? 0.6 : 1 }]}
                >
                  <ThemedText style={{ color, fontWeight: "800" }}>{label}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { padding: 12, alignItems: "center" },
  empty: { borderWidth: 1, borderStyle: "dashed", borderRadius: 12, padding: 24, alignItems: "center", gap: 8 },
  heading: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  reason: { borderRadius: 8, padding: 10 },
  call: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1.5 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, minHeight: 44, fontSize: 16 },
  actions: { flexDirection: "row", gap: 8 },
  action: { flex: 1, minHeight: 44, borderWidth: 1.5, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});

export default GeofenceReviewPanel;
