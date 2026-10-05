import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";

const SECTIONS = [
  {
    title: "ATTENDANCE ANALYTICS",
    items: [
      { title: "Monthly Attendance Register", description: "Printable traditional attendance sheet (P/A/L/WO)", route: "ReportsAttendanceRegister", icon: "calendar" },
      { title: "Late Arrival Report", description: "Who is consistently late, pattern analysis", route: "ReportsLateArrival", icon: "clock" },
      { title: "Attendance Intelligence", description: "Punctuality scores, anomalies, hours worked & AI insights", route: "ReportsIntelligence", icon: "cpu" },
      { title: "Activity Analysis", description: "Attendance-aligned daily app & location activity", route: "ReportsActivity", icon: "activity" },
      { title: "GPS & Suspicious", description: "Stale, mocked and out-of-range GPS evidence", route: "ReportsGps", icon: "alert-triangle" },
      { title: "Live Tracking Report", description: "Latest native pings and real-time tracking health", route: "ReportsTracking", icon: "navigation" },
      { title: "Geofence & Tracking Events", description: "Audit trail for office and field geofence violations", route: "ReportsGeofenceEvents", icon: "map" },
      { title: "Check-In Location Log", description: "Full GPS log of every check-in attempt and block", route: "ReportsCheckInLogs", icon: "map-pin" },
    ]
  },
  {
    title: "LEAVE & HR",
    items: [
      { title: "Leave Usage Report", description: "Read-only: leaves taken, pending, rejected per employee", route: "ReportsLeaveUsage", icon: "briefcase" },
      { title: "Leave Balance Summary", description: "Read-only balance table (casual, sick, earned & comp-off)", route: "ReportsLeaveBalance", icon: "pie-chart" },
      { title: "Overtime & Comp-Off Report", description: "Who worked on weekends/holidays, units earned, expiry", route: "ReportsOvertime", icon: "award" },
    ]
  },
  {
    title: "PEOPLE & ORGANISATION",
    items: [
      { title: "Team Hierarchy & Headcount", description: "Org chart, team structure and reporting lines", route: "ReportsTeamHierarchy", icon: "users" },
      { title: "Audit Trail Report", description: "System-wide action log and admin change history", route: "ReportsAuditLogs", icon: "file-text" },
    ]
  },
  {
    title: "EXPORTS",
    items: [
      { title: "Download Centre", description: "Export attendance, leave and activity as Excel / CSV", route: "ReportsDownloadCentre", icon: "download" },
    ]
  }
];

export default function ReportsHubScreen({ navigation }: any) {
  const { theme } = useTheme();
  return (
    <ScreenScrollView contentContainerStyle={styles.wrap}>
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <Feather name="file-text" size={28} color="#fff" />
        <View style={styles.flex}>
          <ThemedText type="h2" style={styles.white}>Reports</ThemedText>
          <ThemedText type="small" style={styles.subtitle}>
            Analytics, audit trails and data exports
          </ThemedText>
        </View>
      </View>

      {SECTIONS.map((section, idx) => (
        <View key={idx} style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>{section.title}</ThemedText>
          <View style={styles.grid}>
            {section.items.map((item, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                onPress={() => navigation.navigate(item.route as any)}
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
                  <Feather name={item.icon as any} size={20} color={theme.primary} />
                </View>
                <View style={styles.flex}>
                  <ThemedText style={styles.title}>{item.title}</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {item.description}
                  </ThemedText>
                </View>
                <Feather name="chevron-right" size={18} color={theme.textSecondary} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 96, gap: 24 },
  hero: { borderRadius: 18, padding: 20, flexDirection: "row", gap: 14, alignItems: "center" },
  flex: { flex: 1 },
  white: { color: "#fff" },
  subtitle: { color: "rgba(255,255,255,0.8)", marginTop: 3 },
  section: { gap: 12 },
  sectionTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 0.5, marginLeft: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: { minWidth: 280, flexGrow: 1, flexBasis: "46%", borderWidth: 1, borderRadius: 14, padding: 15, flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800", marginBottom: 3 },
});
