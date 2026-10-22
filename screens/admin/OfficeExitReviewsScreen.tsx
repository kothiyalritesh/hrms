import React, { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { GeofenceReviewPanel } from "@/components/GeofenceReviewPanel";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";

const PERIODS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
] as const;

/**
 * Office exits to regularize: employees who stayed outside the office radius
 * for over 10 minutes. Shows the reason (or that none was given yet); the
 * reviewer accepts, rejects (compliance deduction) or waives each one.
 * Lists only employees the viewer can track (live_tracking.view scope).
 */
export default function OfficeExitReviewsScreen() {
  const { theme } = useTheme();
  const [days, setDays] = useState<number>(7);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => setReloadKey((k) => k + 1), []));
  const onLoaded = useCallback(() => setRefreshing(false), []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            setReloadKey((k) => k + 1);
          }}
          tintColor={theme.primary}
        />
      }
    >
      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
        Staying outside the office radius for more than 10 minutes during working hours asks the employee for a reason.
        Accept it, reject it with a comment (compliance points are deducted) or waive it.
      </ThemedText>
      <View style={styles.periods}>
        {PERIODS.map((p) => {
          const active = p.days === days;
          return (
            <Pressable
              key={p.days}
              onPress={() => setDays(p.days)}
              style={[
                styles.period,
                { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.primary + "14" : "transparent" },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <ThemedText style={{ fontWeight: "700", color: active ? theme.primary : theme.text }}>{p.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
      <GeofenceReviewPanel standalone days={days} reloadKey={reloadKey} onLoaded={onLoaded} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48, width: "100%", maxWidth: 820, alignSelf: "center" },
  periods: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  period: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
