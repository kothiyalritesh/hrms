import React from "react";
import { StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";

export type BiometricPunch = {
  /** Device time, IST "HH:MM[:SS]". */
  time: string;
  direction?: string | null;
  device?: string | null;
};

function fmt(time: string) {
  const m = /^(\d{1,2}):(\d{2})/.exec(time || "");
  if (!m) return time;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "pm" : "am"}`;
}

function directionLabel(direction: string | null | undefined, index: number, total: number) {
  const d = String(direction ?? "").trim().toLowerCase();
  if (d === "in" || d === "0") return "In";
  if (d === "out" || d === "1") return "Out";
  // Devices without a direction: first punch = in, last = out.
  if (index === 0) return "First punch";
  if (index === total - 1) return "Last punch";
  return "Punch";
}

/** The day's biometric device punches, shown in the attendance timeline. */
export default function BiometricPunchList({ punches }: { punches: BiometricPunch[] }) {
  const { theme } = useTheme();
  if (punches.length === 0) return null;
  return (
    <View style={[styles.box, { borderColor: "#7C3AED40", backgroundColor: "#7C3AED0D" }]}>
      <View style={styles.head}>
        <Feather name="cpu" size={13} color="#7C3AED" />
        <ThemedText style={styles.title}>BIOMETRIC PUNCHES ({punches.length})</ThemedText>
      </View>
      {punches.map((p, i) => (
        <View key={`${p.time}-${i}`} style={styles.row}>
          <ThemedText style={[styles.time, { color: theme.text }]}>{fmt(p.time)}</ThemedText>
          <ThemedText style={{ color: theme.textSecondary, fontSize: 12, flex: 1 }} numberOfLines={1}>
            {directionLabel(p.direction, i, punches.length)}
            {p.device ? ` · device ${p.device}` : ""}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10, gap: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  title: { fontSize: 11, fontWeight: "800", color: "#7C3AED", letterSpacing: 0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 22 },
  time: { fontWeight: "700", fontSize: 13, width: 72 },
});
