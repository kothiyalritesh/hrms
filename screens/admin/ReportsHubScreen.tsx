import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";

const REPORTS = [
  ["Attendance Summary", "Daily totals from canonical attendance", "ReportsAttendance", "calendar"],
  ["Advanced Attendance", "Filters, exceptions and reconciliation", "ReportsAdvancedAttendance", "bar-chart-2"],
  ["Field Visit Report", "Visits, destinations and evidence", "ReportsFieldVisits", "map-pin"],
  ["Leave Report", "Requests, usage and balances", "ReportsLeaves", "briefcase"],
  ["Regularization Report", "Checkout correction workflow", "ReportsRegularization", "check-square"],
  ["Biometric Reconciliation", "Device identities and historical punches", "ReportsBiometric", "users"],
  ["Activity Analysis", "Attendance-aligned daily activity", "ReportsActivity", "activity"],
  ["Live Tracking Report", "Latest native pings and tracking health", "ReportsTracking", "navigation"],
  ["GPS and Suspicious Attendance", "Stale, mocked and out-of-range evidence", "ReportsGps", "alert-triangle"],
  ["Download Centre", "Complete report exports", "ReportsDownloads", "download"],
] as const;

export default function ReportsHubScreen({ navigation }: any) {
  const { theme } = useTheme();
  return (
    <ScreenScrollView contentContainerStyle={styles.wrap}>
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <Feather name="file-text" size={28} color="#fff" />
        <View style={styles.flex}>
          <ThemedText type="h2" style={styles.white}>Reports</ThemedText>
          <ThemedText type="small" style={styles.subtitle}>
            Attendance, leave, biometric, field and tracking reports
          </ThemedText>
        </View>
      </View>
      <View style={styles.grid}>
        {REPORTS.map(([title, description, route, icon]) => (
          <Pressable
            key={route}
            accessibilityRole="button"
            accessibilityLabel={title}
            onPress={() => navigation.navigate(route)}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.border,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <View style={[styles.icon, { backgroundColor: theme.primary + "16" }]}>
              <Feather name={icon} size={20} color={theme.primary} />
            </View>
            <View style={styles.flex}>
              <ThemedText style={styles.title}>{title}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {description}
              </ThemedText>
            </View>
            <Feather name="chevron-right" size={18} color={theme.textSecondary} />
          </Pressable>
        ))}
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 96, gap: 16 },
  hero: { borderRadius: 18, padding: 20, flexDirection: "row", gap: 14, alignItems: "center" },
  flex: { flex: 1 },
  white: { color: "#fff" },
  subtitle: { color: "rgba(255,255,255,0.8)", marginTop: 3 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: { minWidth: 280, flexGrow: 1, flexBasis: "46%", borderWidth: 1, borderRadius: 14, padding: 15, flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800", marginBottom: 3 },
});
