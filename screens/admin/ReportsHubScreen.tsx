import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { usePermissions } from "@/hooks/usePermissions";
import { BorderRadius, Spacing } from "@/constants/theme";
import type { ReportsStackParamList } from "@/navigation/ReportsStackNavigator";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

type ReportEntry = {
  title: string;
  description: string;
  route: keyof ReportsStackParamList;
  icon: FeatherName;
};

type ReportSection = {
  key: string;
  title: string;
  icon: FeatherName;
  items: ReportEntry[];
};

// One entry per report. Each route is permission-gated twice: hidden here via
// canOpenScreen (SCREEN_PERMISSIONS) and guarded again in the navigator.
// Management screens that also live under the Reports stack (attendance
// control, leave approvals, regularization, biometric matching, field-visit
// admin) are intentionally not listed — they belong to the Admin tab.
const SECTIONS: ReportSection[] = [
  {
    key: "attendance",
    title: "Attendance",
    icon: "calendar",
    items: [
      { title: "Monthly register", description: "P / A / L / WO grid for every employee, one month at a time", route: "ReportsAttendanceRegister", icon: "grid" },
      { title: "Attendance report", description: "Daily records and exceptions with office, team and status filters", route: "ReportsAdvancedAttendance", icon: "bar-chart-2" },
      { title: "Late arrivals", description: "Late check-ins, minutes late and repeat late-comers", route: "ReportsLateArrival", icon: "clock" },
      { title: "Attendance intelligence", description: "Punctuality scores, anomalies and hours worked", route: "ReportsIntelligence", icon: "cpu" },
      { title: "Today's check-in log", description: "Today's successful and blocked check-in attempts with GPS", route: "ReportsCheckInLogs", icon: "log-in" },
    ],
  },
  {
    key: "field",
    title: "Field & tracking",
    icon: "navigation",
    items: [
      { title: "Live tracking", description: "Latest location pings and tracking health", route: "ReportsTracking", icon: "navigation" },
      { title: "Activity analysis", description: "Daily app and location activity, aligned to attendance", route: "ReportsActivity", icon: "activity" },
      { title: "Geofence events", description: "Office and field geofence exits with reasons and reviews", route: "ReportsGeofenceEvents", icon: "map" },
    ],
  },
  {
    key: "leave",
    title: "Leave",
    icon: "briefcase",
    items: [
      { title: "Leave usage", description: "Leave taken, pending and rejected per employee", route: "ReportsLeaveUsage", icon: "briefcase" },
      { title: "Leave balances", description: "Current casual, sick, earned and comp-off balances", route: "ReportsLeaveBalance", icon: "pie-chart" },
      { title: "Overtime & comp-off", description: "Weekend / holiday work, comp-off earned and expiry", route: "ReportsOvertime", icon: "award" },
    ],
  },
  {
    key: "compliance",
    title: "People & compliance",
    icon: "shield",
    items: [
      { title: "Suspicious attendance", description: "Stale, mocked or out-of-range GPS evidence to review", route: "ReportsGps", icon: "alert-triangle" },
      { title: "Audit trail", description: "Who changed what, across the whole system", route: "ReportsAuditLogs", icon: "file-text" },
      { title: "Team hierarchy & headcount", description: "Teams, reporting lines and headcount", route: "ReportsTeamHierarchy", icon: "users" },
    ],
  },
  {
    key: "downloads",
    title: "Downloads",
    icon: "download",
    items: [
      { title: "Download centre", description: "Monthly Excel exports: register, late, leave, comp-off, field visits, geofence", route: "ReportsDownloadCentre", icon: "download" },
    ],
  },
];

const GAP = Spacing.md;

export default function ReportsHubScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { canOpenScreen, loading } = usePermissions();
  const [width, setWidth] = useState(0);

  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canOpenScreen(item.route)),
  })).filter((section) => section.items.length > 0);
  const total = sections.reduce((n, s) => n + s.items.length, 0);

  // Measured, so the grid follows the real content width (sidebar, web max width).
  const columns = width >= 640 ? 2 : 1;
  const cardWidth = width > 0 ? Math.floor((width - GAP * (columns - 1)) / columns) : undefined;

  return (
    <ScreenScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.intro}>
        <ThemedText type="h2">Reports</ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {total > 0
            ? `${total} report${total === 1 ? "" : "s"} available to you. Times are in IST.`
            : "Analytics, audit trails and data exports."}
        </ThemedText>
      </View>

      {loading && total === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : total === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <Feather name="lock" size={22} color={theme.textSecondary} />
          <ThemedText type="h4" style={{ marginTop: Spacing.sm, textAlign: "center" }}>No reports available</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4 }}>
            Your role does not include access to any report yet. Ask HR to grant the report permissions you need.
          </ThemedText>
        </View>
      ) : (
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.sections}>
          {sections.map((section) => (
            <View key={section.key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Feather name={section.icon} size={14} color={theme.textSecondary} />
                <ThemedText type="caption" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
                  {section.title.toUpperCase()}
                </ThemedText>
                <View style={[styles.sectionRule, { backgroundColor: theme.border }]} />
              </View>
              <View style={styles.grid}>
                {section.items.map((item) => (
                  <Pressable
                    key={item.route}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    accessibilityHint={item.description}
                    onPress={() => navigation.navigate(item.route)}
                    style={({ pressed }) => [
                      styles.card,
                      cardWidth ? { width: cardWidth } : styles.cardFull,
                      {
                        backgroundColor: pressed ? theme.backgroundSecondary : theme.backgroundDefault,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <View style={[styles.icon, { backgroundColor: theme.primary + "18" }]}>
                      <Feather name={item.icon} size={18} color={theme.primary} />
                    </View>
                    <View style={styles.cardText}>
                      <ThemedText style={styles.title} numberOfLines={1}>{item.title}</ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={2}>
                        {item.description}
                      </ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color={theme.textSecondary} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.lg, paddingBottom: 96 },
  intro: { gap: 4, marginTop: Spacing.sm, marginBottom: Spacing.xl },
  sections: { gap: Spacing.xl },
  section: { gap: Spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  sectionTitle: { fontWeight: "700", letterSpacing: 0.6 },
  sectionRule: { flex: 1, height: StyleSheet.hairlineWidth, marginLeft: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  card: {
    minHeight: 72,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  cardFull: { width: "100%" },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardText: { flex: 1, minWidth: 0 },
  title: { fontWeight: "700", marginBottom: 2 },
  center: { paddingVertical: 48, alignItems: "center" },
  empty: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.xl, alignItems: "center" },
});
