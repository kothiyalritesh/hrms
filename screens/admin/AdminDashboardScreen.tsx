import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  RefreshControl,
  Platform,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardSummaryService } from "@/services/dashboard-summary.service";

type Props = { navigation: NativeStackNavigationProp<any> };

interface MetricCardProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
  onPress?: () => void;
  wide?: boolean;
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  accent,
  onPress,
  wide,
}: MetricCardProps) {
  const { theme } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        s.metricCard,
        wide && s.metricCardWide,
        {
          backgroundColor: theme.backgroundDefault,
          opacity: pressed ? 0.85 : 1,
          borderLeftColor: accent,
          ...(Platform.OS === "web"
            ? { boxShadow: `0 2px 8px ${accent}18` }
            : {
                shadowColor: accent,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 8,
                elevation: 2,
              }),
        },
      ]}
      onPress={onPress}
    >
      <View style={[s.metricIconBg, { backgroundColor: accent + "18" }]}>
        <Feather name={icon} size={22} color={accent} />
      </View>
      <ThemedText
        type="h2"
        style={{ color: theme.text, marginTop: Spacing.sm }}
      >
        {value}
      </ThemedText>
      <ThemedText
        type="caption"
        style={{ color: theme.textSecondary, marginTop: 2, fontWeight: "600" }}
      >
        {label}
      </ThemedText>
      {sub ? (
        <ThemedText
          type="caption"
          style={{ color: accent, fontSize: 10, marginTop: 2 }}
        >
          {sub}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

interface ActionCardProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  desc: string;
  accent: string;
  onPress: () => void;
}

function ActionCard({ icon, label, desc, accent, onPress }: ActionCardProps) {
  const { theme } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        s.actionCard,
        {
          backgroundColor: theme.backgroundDefault,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={[s.actionIconBg, { backgroundColor: accent + "18" }]}>
        <Feather name={icon} size={18} color={accent} />
      </View>
      <ThemedText
        type="small"
        style={{ fontWeight: "700", color: theme.text, flex: 1 }}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
      <Feather name="chevron-right" size={14} color={theme.textSecondary} />
    </Pressable>
  );
}

export default function AdminDashboardScreen({ navigation }: Props) {
  const { theme } = useTheme();
  const { user, isHR, isHRD } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverDate, setServerDate] = useState("");
  const [serverHour, setServerHour] = useState(12);
  const [stats, setStats] = useState({
    totalEmployees: 0,
    activeEmployees: 0,
    todayAttendance: 0,
    pendingLeaves: 0,
    overdueTasks: 0,
    openTickets: 0,
    liveTracking: 0,
  });

  const loadAdminData = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const summary = await DashboardSummaryService.getAdmin(force);
      const countFields = [
        "total_employees",
        "active_employees",
        "today_attendance",
        "pending_leaves",
        "overdue_tasks",
        "open_tickets",
        "live_tracking",
      ];
      if (
        summary?.success !== true ||
        !summary?.business_date ||
        !summary?.server_now ||
        countFields.some((field) => !Number.isFinite(Number(summary[field])))
      ) {
        throw new Error("The server returned an incomplete dashboard summary.");
      }

      setServerDate(String(summary.business_date));
      setServerHour(
        Number(
          new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            hourCycle: "h23",
          }).format(new Date(summary.server_now)),
        ),
      );
      setStats({
        totalEmployees: Number(summary.total_employees),
        activeEmployees: Number(summary.active_employees),
        todayAttendance: Number(summary.today_attendance),
        pendingLeaves: Number(summary.pending_leaves),
        overdueTasks: Number(summary.overdue_tasks),
        openTickets: Number(summary.open_tickets),
        liveTracking: Number(summary.live_tracking),
      });
      setHasLoaded(true);
      setLoadError(null);
    } catch (error: any) {
      setLoadError(
        error?.message ||
          "Dashboard data could not be loaded. Existing values were preserved.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadAdminData();
    }, [loadAdminData]),
  );
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      DashboardSummaryService.invalidateAdmin();
      await loadAdminData(true);
    } finally {
      setRefreshing(false);
    }
  };

  const panelTitle = user?.role === "HRD" ? "HRD Panel" : "HR Panel";

  return (
    <ScreenScrollView
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.primary}
        />
      }
    >
      {/* ── Hero Banner ── */}
      <View style={[s.hero, { backgroundColor: theme.primary }]}>
        <View>
          <ThemedText
            type="caption"
            style={{ color: "rgba(255,255,255,0.75)", letterSpacing: 1.5 }}
          >
            {panelTitle}
          </ThemedText>
          <ThemedText type="h2" style={{ color: "#fff", marginTop: 2 }}>
            Good {getGreeting(serverHour)},{" "}
            {user?.name?.split(" ")[0] ?? "Admin"}
          </ThemedText>
          <ThemedText
            type="caption"
            style={{ color: "rgba(255,255,255,0.65)", marginTop: 2 }}
          >
            {serverDate ||
              (loading ? "Loading server date…" : "Server date unavailable")}
          </ThemedText>
        </View>
        {/* TV Screen shortcut in hero */}
        <Pressable
          style={({ pressed }) => [s.tvBtn, { opacity: pressed ? 0.85 : 1 }]}
          onPress={() => navigation.navigate("TVDisplay")}
        >
          <Feather name="monitor" size={18} color="#fff" />
          <ThemedText
            type="caption"
            style={{
              color: "#fff",
              fontWeight: "700",
              marginTop: 3,
              fontSize: 10,
            }}
          >
            TV Board
          </ThemedText>
        </Pressable>
      </View>

      <View style={s.body}>
        {loadError ? (
          <View style={s.errorBanner}>
            <Feather name="alert-circle" size={16} color="#991B1B" />
            <ThemedText type="small" style={s.errorText}>
              {loadError}
            </ThemedText>
          </View>
        ) : null}
        {loading && !hasLoaded ? (
          <View style={s.loadingBanner}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Loading dashboard summary…
            </ThemedText>
          </View>
        ) : null}
        {/* ── Metrics Grid ── */}
        <View style={s.metricsGrid}>
          <MetricCard
            icon="users"
            label="Employees"
            value={hasLoaded ? stats.totalEmployees : "—"}
            sub={hasLoaded ? `${stats.activeEmployees} active` : "Loading"}
            accent={theme.primary}
            onPress={() => navigation.navigate("UserManagement")}
          />
          <MetricCard
            icon="clock"
            label="Today Present"
            value={hasLoaded ? stats.todayAttendance : "—"}
            sub="Checked in"
            accent={Colors.light.success}
            onPress={() => navigation.navigate("AttendanceControl")}
          />
          <MetricCard
            icon="calendar"
            label="Leave Requests"
            value={hasLoaded ? stats.pendingLeaves : "—"}
            sub="Need approval"
            accent={Colors.light.warning}
            onPress={() => navigation.navigate("LeaveManagement")}
          />
          <MetricCard
            icon="alert-triangle"
            label="Overdue Tasks"
            value={hasLoaded ? stats.overdueTasks : "—"}
            sub="Past deadline"
            accent={Colors.light.error}
            onPress={() => navigation.navigate("TaskProjectControl")}
          />
          <MetricCard
            icon="life-buoy"
            label="Open Tickets"
            value={hasLoaded ? stats.openTickets : "—"}
            sub="Support queue"
            accent="#7C3AED"
            onPress={() => navigation.navigate("TicketManagement")}
          />
          <MetricCard
            icon="radio"
            label="Live Tracking"
            value={hasLoaded ? stats.liveTracking : "—"}
            sub="Pinging now"
            accent="#DC2626"
            onPress={() => navigation.navigate("LiveTracking")}
          />
        </View>

        <Spacer height={Spacing.xl} />

        {/* ── TV Display Featured Card ── */}
        <Pressable
          style={({ pressed }) => [
            s.tvCard,
            {
              backgroundColor: theme.backgroundDefault,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
          onPress={() => navigation.navigate("TVDisplay")}
        >
          <View style={s.tvCardLeft}>
            <View style={[s.tvCardIcon, { backgroundColor: theme.primary }]}>
              <Feather name="monitor" size={28} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="h3" style={{ color: theme.text }}>
                Live TV Attendance Board
              </ThemedText>
              <ThemedText
                type="small"
                style={{ color: theme.textSecondary, marginTop: 3 }}
              >
                Office-wise · Team-head-wise · Real-time updates every 30s
              </ThemedText>
              <View style={s.tvTagRow}>
                {["LIVE", "Office Wise", "Team Wise"].map((tag) => (
                  <View
                    key={tag}
                    style={[s.tvTag, { backgroundColor: theme.primary + "18" }]}
                  >
                    <ThemedText
                      type="caption"
                      style={{
                        color: theme.primary,
                        fontSize: 10,
                        fontWeight: "700",
                      }}
                    >
                      {tag}
                    </ThemedText>
                  </View>
                ))}
              </View>
            </View>
          </View>
          <Feather name="chevron-right" size={22} color={theme.primary} />
        </Pressable>

        <Spacer height={Spacing.xl} />

        {/* ── Quick Actions ── */}
        <ThemedText type="h3" style={{ marginBottom: Spacing.md }}>
          Quick Actions
        </ThemedText>
        <View style={s.actionsGrid}>
          <ActionCard
            icon="user-plus"
            label={isHR ? "View / Edit Employees" : "Add Employee"}
            desc="Manage employee profiles"
            accent={theme.primary}
            onPress={() => navigation.navigate("UserManagement")}
          />
          <ActionCard
            icon="clock"
            label="Attendance Logs"
            desc="Today's check-ins & history"
            accent="#10B981"
            onPress={() => navigation.navigate("AttendanceControl")}
          />
          <ActionCard
            icon="map-pin"
            label="Field / Site Visits"
            desc="Team location log"
            accent="#3B82F6"
            onPress={() => navigation.navigate("FieldVisitAdmin")}
          />
          <ActionCard
            icon="git-branch"
            label="Team Hierarchy"
            desc="Teams & reporting structure"
            accent={theme.primary}
            onPress={() => navigation.navigate("TeamHierarchy")}
          />
          <ActionCard
            icon="map"
            label="Check-In Logs"
            desc="GPS locations & blocked attempts"
            accent="#3B82F6"
            onPress={() => navigation.navigate("CheckInLogs")}
          />
          <ActionCard
            icon="alert-triangle"
            label="Suspicious Attendance"
            desc="Fraud scores and GPS evidence"
            accent="#EF4444"
            onPress={() => navigation.navigate("SuspiciousAttendance")}
          />
          <ActionCard
            icon="calendar"
            label="Weekly Offs & Holidays"
            desc="Attendance calendar rules"
            accent="#8B5CF6"
            onPress={() => navigation.navigate("AttendanceCalendar")}
          />
          <ActionCard
            icon="check-square"
            label="Regularization"
            desc="Early and missed checkout approvals"
            accent="#F59E0B"
            onPress={() => navigation.navigate("AttendanceRegularization")}
          />
          <ActionCard
            icon="bar-chart-2"
            label="Advanced Attendance"
            desc="Reconciliation, filters and 7-sheet export"
            accent="#059669"
            onPress={() => navigation.navigate("AdvancedAttendanceReport")}
          />
          <ActionCard
            icon="calendar"
            label="Event Management"
            desc="Create & track events"
            accent="#F97316"
            onPress={() => navigation.navigate("EventManagement")}
          />
          <ActionCard
            icon="credit-card"
            label="Leave Balance"
            desc="Add or remove employee balance"
            accent="#10B981"
            onPress={() => navigation.navigate("LeaveBalance")}
          />
          <ActionCard
            icon="refresh-cw"
            label="Biometric Sync"
            desc="Fetch logs & update attendance"
            accent="#F97316"
            onPress={() => navigation.navigate("SmartOfficeIntegration")}
          />
          <ActionCard
            icon="users"
            label="Employee Match"
            desc="Link HRMS profiles to biometric identities"
            accent="#6B7280"
            onPress={() => navigation.navigate("BiometricUserMatch")}
          />
          <ActionCard
            icon="upload-cloud"
            label="Bulk Employee Import"
            desc="Import employee profiles from a spreadsheet"
            accent="#475569"
            onPress={() => navigation.navigate("SmartOfficeEmployeeImport")}
          />
          <ActionCard
            icon="database"
            label="Imported Data"
            desc="Review SmartOffice users and punch logs"
            accent="#0F766E"
            onPress={() => navigation.navigate("SmartOfficeImportedData")}
          />
          {isHRD && (
              <>
              <ActionCard
                icon="shield"
              label="Permissions Manager"
              desc="Role-based access control"
              accent="#8B5CF6"
              onPress={() => navigation.navigate("PermissionsManager")}
            />
            <ActionCard
              icon="eye"
              label="Site Visit Observer"
              desc="Monitor field visits"
              accent="#10B981"
              onPress={() => navigation.navigate("SiteVisitObserver")}
            />
            <ActionCard
              icon="map"
              label="In Transit Monitor"
              desc="Track employee commutes"
              accent="#F59E0B"
              onPress={() => navigation.navigate("InTransit")}
            />
            <ActionCard
              icon="smartphone"
              label="Duplicate Devices"
              desc="Detect buddy punching"
              accent="#EF4444"
              onPress={() => navigation.navigate("AdminDeviceSessions")}
            />
            <ActionCard
                icon="settings"
                label="Office Settings"
                desc="Offices, geofences and attendance rules"
                accent="#7C3AED"
                onPress={() => navigation.navigate("OfficeSettings")}
              />
              </>
            )}
          {isHRD && (
            <ActionCard
              icon="map-pin"
              label="Site Settings"
              desc="Projects, saved sites and geofences"
              accent="#059669"
              onPress={() => navigation.navigate("SiteSettings")}
            />
          )}
          {isHRD && (
            <ActionCard
              icon="activity"
              label="Activity Analysis"
              desc="Employee activity deep dive"
              accent={theme.primary}
              onPress={() => navigation.navigate("ActivityAnalysis")}
            />
          )}
          {isHRD && (
            <ActionCard
              icon="bell"
              label="Send Notification"
              desc="Push to all or specific users"
              accent="#3B82F6"
              onPress={() => navigation.navigate("NotificationManagement")}
            />
          )}
          {isHRD && (
            <ActionCard
              icon="file-text"
              label="Audit Logs"
              desc="System activity trail"
              accent="#F97316"
              onPress={() => navigation.navigate("AuditLogs")}
            />
          )}
        </View>

        <Spacer height={Spacing["2xl"]} />
      </View>
    </ScreenScrollView>
  );
}

function getGreeting(h: number) {
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}

const s = StyleSheet.create({
  hero: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing["2xl"] + 12,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  tvBtn: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    minWidth: 64,
  },
  body: {
    paddingHorizontal: Spacing.lg,
    marginTop: -16,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "#FEE2E2",
  },
  errorText: {
    flex: 1,
    color: "#991B1B",
  },
  loadingBanner: {
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "rgba(148,163,184,0.12)",
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  metricCard: {
    width: "48%",
    flexGrow: 1,
    minWidth: 140,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderLeftWidth: 4,
  },
  metricCardWide: {
    width: "100%",
  },
  metricIconBg: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  tvCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    gap: Spacing.md,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 20px rgba(96,4,93,0.12)" }
      : {
          shadowColor: "#60045d",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.12,
          shadowRadius: 20,
          elevation: 4,
        }),
  },
  tvCardLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  tvCardIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  tvTagRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
    flexWrap: "wrap",
  },
  tvTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    width: "48%",
    flexGrow: 1,
    minWidth: 150,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 1px 4px rgba(96,4,93,0.06)" }
      : {
          shadowColor: "#60045d",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
          elevation: 1,
        }),
  },
  actionIconBg: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});


