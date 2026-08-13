import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, Pressable, TextInput,
  Alert, ActivityIndicator, Switch, RefreshControl,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { AttendanceService, AttendancePolicy } from "@/services/attendance.service";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface PolicyRow extends AttendancePolicy {
  id: string;
  updated_at?: string;
  offices?: { name: string };
}

function PolicyCard({
  policy,
  onSave,
}: {
  policy: PolicyRow;
  onSave: (id: string, updates: Record<string, any>) => Promise<void>;
}) {
  const { theme } = useTheme();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    min_work_duration_minutes: String(policy.min_work_duration_minutes ?? 240),
    earliest_checkout_time: policy.earliest_checkout_time ?? "14:00",
    auto_close_time: policy.auto_close_time ?? "23:59",
    allow_night_shift: policy.allow_night_shift ?? false,
    require_early_checkout_reason: policy.require_early_checkout_reason ?? true,
    undo_checkout_minutes: String(policy.undo_checkout_minutes ?? 5),
  });

  const handleSave = async () => {
    const minWork = parseInt(form.min_work_duration_minutes, 10);
    const undoMin = parseInt(form.undo_checkout_minutes, 10);
    if (isNaN(minWork) || minWork < 0) {
      Alert.alert("Invalid", "Minimum work duration must be a positive number.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(form.earliest_checkout_time)) {
      Alert.alert("Invalid", "Earliest checkout time must be HH:MM (e.g. 14:00).");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(form.auto_close_time)) {
      Alert.alert("Invalid", "Auto-close time must be HH:MM (e.g. 23:59).");
      return;
    }
    setSaving(true);
    try {
      await onSave(policy.id, {
        min_work_duration_minutes: minWork,
        earliest_checkout_time: form.earliest_checkout_time,
        auto_close_time: form.auto_close_time,
        allow_night_shift: form.allow_night_shift,
        require_early_checkout_reason: form.require_early_checkout_reason,
        undo_checkout_minutes: isNaN(undoMin) ? 5 : undoMin,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const officeName = (policy as any).offices?.name ?? policy.office_name ?? "Default Policy";

  return (
    <View style={[s.card, { backgroundColor: theme.backgroundDefault }]}>
      <View style={s.cardHeader}>
        <View style={s.officeIcon}>
          <Feather name="briefcase" size={16} color="#60045d" />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText style={s.officeName}>{officeName}</ThemedText>
          {policy.updated_at && (
            <ThemedText style={[s.meta, { color: theme.textSecondary }]}>
              Updated {new Date(policy.updated_at).toLocaleDateString("en-IN")}
            </ThemedText>
          )}
        </View>
        <Pressable
          onPress={() => setEditing((e) => !e)}
          style={[s.editBtn, { backgroundColor: editing ? "#FEE2E2" : "#F5EEF5" }]}
        >
          <Feather name={editing ? "x" : "edit-2"} size={14} color={editing ? "#EF4444" : "#60045d"} />
        </Pressable>
      </View>

      {!editing ? (
        <View style={s.readView}>
          <PolicyRow icon="clock" label="Min Work Duration" value={`${form.min_work_duration_minutes} min (${Math.floor(parseInt(form.min_work_duration_minutes) / 60)}h ${parseInt(form.min_work_duration_minutes) % 60}m)`} />
          <PolicyRow icon="log-out" label="Earliest Checkout" value={form.earliest_checkout_time} />
          <PolicyRow icon="moon" label="Auto-Close Time" value={form.auto_close_time} />
          <PolicyRow icon="rotate-ccw" label="Undo Window" value={`${form.undo_checkout_minutes} min`} />
          <PolicyRow icon="sun" label="Night Shift" value={form.allow_night_shift ? "Enabled" : "Disabled"} />
          <PolicyRow icon="alert-circle" label="Require Early Reason" value={form.require_early_checkout_reason ? "Yes" : "No"} />
        </View>
      ) : (
        <View style={s.editView}>
          <Field
            label="Min Work Duration (minutes)"
            value={form.min_work_duration_minutes}
            onChangeText={(v) => setForm((f) => ({ ...f, min_work_duration_minutes: v }))}
            keyboardType="numeric"
            hint="e.g. 240 = 4 hours"
          />
          <Field
            label="Earliest Checkout Time (HH:MM)"
            value={form.earliest_checkout_time}
            onChangeText={(v) => setForm((f) => ({ ...f, earliest_checkout_time: v }))}
            hint="e.g. 14:00 = 2 PM"
          />
          <Field
            label="Auto-Close Time (HH:MM)"
            value={form.auto_close_time}
            onChangeText={(v) => setForm((f) => ({ ...f, auto_close_time: v }))}
            hint="Missed checkouts auto-closed at this time"
          />
          <Field
            label="Undo Checkout Window (minutes)"
            value={form.undo_checkout_minutes}
            onChangeText={(v) => setForm((f) => ({ ...f, undo_checkout_minutes: v }))}
            keyboardType="numeric"
            hint="0 = disabled"
          />
          <ToggleRow
            label="Allow Night Shift"
            hint="Checkout allowed next day"
            value={form.allow_night_shift}
            onToggle={(v) => setForm((f) => ({ ...f, allow_night_shift: v }))}
          />
          <ToggleRow
            label="Require Early Checkout Reason"
            hint="Employee must explain early checkout"
            value={form.require_early_checkout_reason}
            onToggle={(v) => setForm((f) => ({ ...f, require_early_checkout_reason: v }))}
          />
          <Pressable
            style={[s.saveBtn, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Feather name="check" size={15} color="#fff" />
                <ThemedText style={s.saveBtnText}>Save Policy</ThemedText>
              </>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function PolicyRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={s.policyRow}>
      <Feather name={icon} size={13} color="#6B7280" />
      <ThemedText style={s.policyLabel}>{label}</ThemedText>
      <ThemedText style={s.policyValue}>{value}</ThemedText>
    </View>
  );
}

function Field({
  label, value, onChangeText, keyboardType, hint,
}: {
  label: string; value: string;
  onChangeText: (v: string) => void;
  keyboardType?: "numeric" | "default";
  hint?: string;
}) {
  return (
    <View style={s.fieldWrap}>
      <ThemedText style={s.fieldLabel}>{label}</ThemedText>
      {hint && <ThemedText style={s.fieldHint}>{hint}</ThemedText>}
      <TextInput
        style={s.fieldInput}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        placeholderTextColor="#9CA3AF"
      />
    </View>
  );
}

function ToggleRow({
  label, hint, value, onToggle,
}: {
  label: string; hint: string; value: boolean; onToggle: (v: boolean) => void;
}) {
  return (
    <View style={s.toggleRow}>
      <View style={{ flex: 1 }}>
        <ThemedText style={s.fieldLabel}>{label}</ThemedText>
        <ThemedText style={s.fieldHint}>{hint}</ThemedText>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: "#D1D5DB", true: "#60045d" }}
        thumbColor="#fff"
      />
    </View>
  );
}

export default function AttendanceControlScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPolicies = useCallback(async () => {
    try {
      const { data } = await AttendanceService.getAllPolicies();
      setPolicies((data as PolicyRow[]) ?? []);
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Failed to load policies.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadPolicies(); }, [loadPolicies]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPolicies();
    setRefreshing(false);
  };

  const handleSave = async (id: string, updates: Record<string, any>) => {
    await AttendanceService.updatePolicy(id, updates);
    await loadPolicies();
    Alert.alert("✅ Saved", "Attendance policy updated successfully.");
  };

  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: theme.backgroundRoot }]}>
        <ActivityIndicator color="#60045d" size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40, paddingHorizontal: Spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60045d" />}
    >
      <ThemedText style={s.title}>Attendance Policies</ThemedText>
      <ThemedText style={[s.subtitle, { color: theme.textSecondary }]}>
        Configure per-office checkout rules. These are enforced server-side by the checkout RPC.
      </ThemedText>

      <View style={[s.infoBox, { backgroundColor: "#F5EEF5" }]}>
        <Feather name="info" size={14} color="#60045d" />
        <ThemedText style={s.infoText}>
          Changes take effect immediately for all new checkouts. Existing sessions are not affected.
        </ThemedText>
      </View>

      {policies.length === 0 ? (
        <View style={[s.empty, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="inbox" size={28} color={theme.textSecondary} />
          <ThemedText style={{ color: theme.textSecondary, marginTop: 8 }}>
            No policies found. Run the attendance_checkout_protection.sql migration first.
          </ThemedText>
        </View>
      ) : (
        policies.map((p) => (
          <PolicyCard key={p.id} policy={p} onSave={handleSave} />
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 4 },
  subtitle: { fontSize: 13, lineHeight: 18, marginBottom: 16 },
  infoBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 10, marginBottom: 16,
  },
  infoText: { fontSize: 12, color: "#60045d", flex: 1, lineHeight: 17 },
  empty: {
    alignItems: "center", padding: 32, borderRadius: 14,
    gap: 8,
  },
  card: {
    borderRadius: 14, padding: 16, marginBottom: 14,
    shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  officeIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: "#F5EEF5", alignItems: "center", justifyContent: "center",
  },
  officeName: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 11, marginTop: 1 },
  editBtn: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  readView: { gap: 8 },
  policyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  policyLabel: { fontSize: 12, color: "#6B7280", flex: 1 },
  policyValue: { fontSize: 12, fontWeight: "700", color: "#374151" },
  editView: { gap: 12 },
  fieldWrap: { gap: 3 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151" },
  fieldHint: { fontSize: 11, color: "#9CA3AF" },
  fieldInput: {
    borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: "#111827", backgroundColor: "#F9FAFB",
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#60045d", borderRadius: 12,
    paddingVertical: 13, marginTop: 4,
  },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
