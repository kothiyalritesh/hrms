import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { formatDate } from "@/utils/format";

type Entry = { points: number; reason: string; at: string };
type Score = { month: string; score: number; entries: Entry[] };

function color(score: number) {
  if (score >= 90) return "#059669";
  if (score >= 75) return "#D97706";
  return "#DC2626";
}

/** The employee's own compliance score for this month and why it changed. */
export function MyComplianceCard() {
  const { theme } = useTheme();
  const [data, setData] = useState<Score | null>(null);
  const [open, setOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      const { data: result, error } = await supabase.rpc("rpc_my_compliance_score");
      if (!cancelled && !error && result) setData(result as Score);
    })();
    return () => {
      cancelled = true;
    };
  }, []));

  if (!data) return null;
  const entries = Array.isArray(data.entries) ? data.entries : [];

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
      <Pressable style={styles.row} onPress={() => setOpen((v) => !v)} disabled={entries.length === 0}>
        <View style={[styles.badge, { borderColor: color(data.score) }]}>
          <ThemedText style={{ color: color(data.score), fontWeight: "900", fontSize: 18 }}>{data.score}</ThemedText>
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText style={{ fontWeight: "800" }}>Compliance score</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {entries.length === 0 ? "No deductions this month" : `${entries.length} change${entries.length === 1 ? "" : "s"} this month`}
          </ThemedText>
        </View>
        {entries.length > 0 ? <Feather name={open ? "chevron-up" : "chevron-down"} size={20} color={theme.textSecondary} /> : null}
      </Pressable>
      {open ? (
        <View style={{ gap: 8, marginTop: 10 }}>
          {entries.map((e, i) => (
            <View key={i} style={styles.entry}>
              <ThemedText style={{ fontWeight: "800", color: e.points < 0 ? theme.error : "#059669", width: 36 }}>
                {e.points > 0 ? `+${e.points}` : e.points}
              </ThemedText>
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontSize: 13 }}>{e.reason}</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>{formatDate(e.at)}</ThemedText>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  badge: { width: 52, height: 52, borderRadius: 26, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
  entry: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
});

export default MyComplianceCard;
