import React, { useState } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Alert,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { EmployeeMonthlyReportService } from "@/services/employee-monthly-report.service";
import { useAttendanceUpdate } from "@/contexts/AttendanceUpdateContext";

export default function EmployeeMonthlyReportScreen() {
  const { theme } = useTheme();
  const { user: authUser } = useAuth();
  const { onAttendanceUpdate } = useAttendanceUpdate();
  const [availableMonths, setAvailableMonths] = useState<{ month: number; year: number }[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<number>(0);
  const [selectedYear, setSelectedYear] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  // Get current user and load months
  useFocusEffect(
    React.useCallback(() => {
      const init = async () => {
        try {
          const userId = authUser?.id;
          console.log("[REPORT] Auth user ID:", userId);
          
          if (!userId) {
            console.error("[REPORT] No user ID available");
            setInitialLoading(false);
            return;
          }

          const months = await EmployeeMonthlyReportService.getAvailableMonths(userId);
          console.log("[REPORT] Available months:", months);
          setAvailableMonths(months);
          
          if (months.length > 0) {
            console.log("[REPORT] Setting first month:", months[0]);
            setSelectedMonth(months[0].month);
            setSelectedYear(months[0].year);
          } else {
            const now = new Date();
            setSelectedMonth(now.getMonth() + 1);
            setSelectedYear(now.getFullYear());
          }
        } catch (error) {
          console.error("[REPORT] Error initializing:", error);
        } finally {
          setInitialLoading(false);
        }
      };
      init();
      
      const unsubscribe = onAttendanceUpdate(() => {
        console.log("[REPORT] Attendance updated, reloading report");
        loadReport();
      });
      
      return unsubscribe;
    }, [authUser?.id, onAttendanceUpdate])
  );

  // Load report when month/year changes
  React.useEffect(() => {
    if (authUser?.id && selectedMonth && selectedYear) {
      console.log("[REPORT] Loading report for", selectedMonth, "/", selectedYear);
      loadReport();
    }
  }, [authUser?.id, selectedMonth, selectedYear]);

  const loadReport = React.useCallback(async () => {
    if (!authUser?.id || !selectedMonth || !selectedYear) {
      console.log("[REPORT] Missing params:", { userId: authUser?.id, selectedMonth, selectedYear });
      return;
    }
    
    setLoading(true);
    try {
      console.log("[REPORT] Fetching report for", selectedMonth, "/", selectedYear);
      const data = await EmployeeMonthlyReportService.getEmployeeMonthlyReport(
        authUser.id,
        selectedMonth,
        selectedYear
      );
      console.log("[REPORT] Report loaded, daily_details count:", data.daily_details?.length);
      setReport(data);
    } catch (error: any) {
      console.error("[REPORT] Error loading report:", error);
      Alert.alert("Error", error?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [authUser?.id, selectedMonth, selectedYear]);

  const handleExport = React.useCallback(async () => {
    setExporting(true);
    try {
      const csv = await EmployeeMonthlyReportService.generateEmployeeMonthlyCSV(
        authUser!.id,
        selectedMonth,
        selectedYear
      );
      const filename = `monthly_report_${selectedYear}-${String(selectedMonth).padStart(2, "0")}.csv`;
      EmployeeMonthlyReportService.downloadCSV(csv, filename);
      Alert.alert("✅ Success", `Report exported as ${filename}`);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }, [authUser?.id, selectedMonth, selectedYear]);

  const getMonthName = React.useCallback((month: number) => {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return months[month - 1];
  }, []);

  const getStatusColor = React.useCallback((status: string) => {
    switch (status) {
      case "present": return Colors.light.success;
      case "absent": return Colors.light.error;
      case "on_duty": return Colors.light.info;
      default: return theme.textSecondary;
    }
  }, [theme]);

  if (initialLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Spacer height={12} />
          <ThemedText>Loading...</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
        {/* Header */}
        <View style={[s.header, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText type="h3">Monthly Report</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
            Detailed daily attendance breakdown
          </ThemedText>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
          {/* Month Selector */}
          {availableMonths.length > 0 ? (
            <View style={[s.card, { backgroundColor: theme.backgroundDefault }]}>
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 10 }}>
                Select Month
              </ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {availableMonths.map((m) => (
                    <TouchableOpacity
                      key={`${m.year}-${m.month}`}
                      style={[
                        s.monthChip,
                        selectedMonth === m.month && selectedYear === m.year && {
                          backgroundColor: theme.primary,
                          borderColor: theme.primary,
                        },
                      ]}
                      onPress={() => {
                        setSelectedMonth(m.month);
                        setSelectedYear(m.year);
                      }}
                    >
                      <ThemedText
                        style={[
                          s.monthChipText,
                          selectedMonth === m.month && selectedYear === m.year && { color: "#fff" },
                        ]}
                      >
                        {getMonthName(m.month)} {m.year}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}

          <Spacer height={12} />

          {loading ? (
            <View style={s.centerContainer}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Spacer height={12} />
              <ThemedText style={{ color: theme.textSecondary }}>Loading report...</ThemedText>
            </View>
          ) : report && report.daily_details && report.daily_details.length > 0 ? (
            <>
              {/* Employee Info */}
              <View style={[s.card, { backgroundColor: theme.backgroundDefault }]}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={[s.avatar, { backgroundColor: theme.primary + "20" }]}>
                    <Feather name="user" size={20} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <ThemedText style={s.empName}>{report.employee_name}</ThemedText>
                    <ThemedText style={[s.meta, { color: theme.textSecondary }]}>
                      {report.employee_id} • {report.office}
                    </ThemedText>
                    <ThemedText style={[s.meta, { color: theme.textSecondary }]}>
                      {report.phone}
                    </ThemedText>
                  </View>
                </View>
              </View>

              <Spacer height={12} />

              {/* Summary Stats */}
              <View style={[s.card, { backgroundColor: theme.backgroundDefault }]}>
                <ThemedText type="h4" style={{ marginBottom: 12 }}>
                  📊 Summary
                </ThemedText>
                <View style={s.statsGrid}>
                  <View style={s.statBox}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Present
                    </ThemedText>
                    <ThemedText style={[s.statValue, { color: Colors.light.success }]}>
                      {report.present_days}
                    </ThemedText>
                  </View>
                  <View style={s.statBox}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Late
                    </ThemedText>
                    <ThemedText style={[s.statValue, { color: Colors.light.warning }]}>
                      {report.late_days}
                    </ThemedText>
                  </View>
                  <View style={s.statBox}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Absent
                    </ThemedText>
                    <ThemedText style={[s.statValue, { color: Colors.light.error }]}>
                      {report.absent_days}
                    </ThemedText>
                  </View>
                  <View style={s.statBox}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      On Duty
                    </ThemedText>
                    <ThemedText style={[s.statValue, { color: Colors.light.info }]}>
                      {report.on_duty_days}
                    </ThemedText>
                  </View>
                </View>

                <View style={[s.divider, { backgroundColor: theme.border }]} />

                <View style={s.statsGrid}>
                  <View style={s.statBox}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Leave
                    </ThemedText>
                    <ThemedText style={s.statValue}>{report.leave_days}</ThemedText>
                  </View>
                  <View style={s.statBox}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Sunday
                    </ThemedText>
                    <ThemedText style={s.statValue}>{report.sunday_days}</ThemedText>
                  </View>
                  <View style={s.statBox}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Holiday
                    </ThemedText>
                    <ThemedText style={s.statValue}>{report.holiday_days}</ThemedText>
                  </View>
                  <View style={s.statBox}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Attendance
                    </ThemedText>
                    <ThemedText style={s.statValue}>{report.attendance_percentage.toFixed(1)}%</ThemedText>
                  </View>
                </View>

                <View style={[s.divider, { backgroundColor: theme.border }]} />

                <View style={s.statsGrid}>
                  <View style={s.statBox}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Total Hours
                    </ThemedText>
                    <ThemedText style={s.statValue}>{report.total_working_hours.toFixed(1)}h</ThemedText>
                  </View>
                  <View style={s.statBox}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Overtime
                    </ThemedText>
                    <ThemedText style={[s.statValue, { color: "#8B5CF6" }]}>
                      {report.total_overtime_hours.toFixed(1)}h
                    </ThemedText>
                  </View>
                </View>
              </View>

              <Spacer height={12} />

              {/* Export Button */}
              <TouchableOpacity
                style={[s.exportBtn, { backgroundColor: theme.primary }, exporting && { opacity: 0.6 }]}
                onPress={handleExport}
                disabled={exporting}
              >
                <Feather name="download" size={16} color="#fff" />
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                  {exporting ? "Exporting..." : "Download CSV"}
                </ThemedText>
              </TouchableOpacity>

              <Spacer height={16} />

              {/* Daily Details */}
              {report.daily_details && report.daily_details.length > 0 ? (
                <View>
                  <ThemedText type="h4" style={{ marginBottom: 12 }}>
                    📅 Daily Details
                  </ThemedText>
                  <FlatList
                    data={report.daily_details}
                    keyExtractor={(_, idx) => idx.toString()}
                    scrollEnabled={false}
                    renderItem={({ item }) => (
                      <View style={[s.dayCard, { backgroundColor: theme.backgroundDefault }]}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <ThemedText style={s.dateText}>{item.date}</ThemedText>
                              <ThemedText style={[s.dayName, { color: theme.textSecondary }]}>
                                {item.day_name}
                              </ThemedText>
                            </View>

                            {item.punch_in_time !== "—" && (
                              <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                                <View style={s.timeChip}>
                                  <Feather name="log-in" size={11} color="#10B981" />
                                  <ThemedText style={s.timeText}>{item.punch_in_time}</ThemedText>
                                </View>
                                {item.punch_out_time !== "—" && (
                                  <View style={s.timeChip}>
                                    <Feather name="log-out" size={11} color="#EF4444" />
                                    <ThemedText style={s.timeText}>{item.punch_out_time}</ThemedText>
                                  </View>
                                )}
                                {item.working_hours > 0 && (
                                  <View style={s.timeChip}>
                                    <Feather name="clock" size={11} color="#8B5CF6" />
                                    <ThemedText style={[s.timeText, { color: "#8B5CF6" }]}>
                                      {item.working_hours.toFixed(1)}h
                                    </ThemedText>
                                  </View>
                                )}
                              </View>
                            )}
                          </View>

                          <View style={{ alignItems: "flex-end", gap: 4 }}>
                            <View style={[s.statusBadge, { backgroundColor: getStatusColor(item.status) + "20" }]}>
                              <ThemedText style={[s.statusText, { color: getStatusColor(item.status) }]}>
                                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                              </ThemedText>
                            </View>

                            {item.is_late && (
                              <View style={[s.badge, { backgroundColor: Colors.light.warning + "20" }]}>
                                <ThemedText style={[s.badgeText, { color: Colors.light.warning }]}>
                                  Late {item.late_minutes}m
                                </ThemedText>
                              </View>
                            )}

                            {item.is_overtime && (
                              <View style={[s.badge, { backgroundColor: "#8B5CF6" + "20" }]}>
                                <ThemedText style={[s.badgeText, { color: "#8B5CF6" }]}>
                                  OT {item.overtime_minutes}m
                                </ThemedText>
                              </View>
                            )}

                            {item.is_on_duty && (
                              <View style={[s.badge, { backgroundColor: Colors.light.info + "20" }]}>
                                <ThemedText style={[s.badgeText, { color: Colors.light.info }]}>
                                  On Duty
                                </ThemedText>
                              </View>
                            )}

                            {item.is_leave && (
                              <View style={[s.badge, { backgroundColor: Colors.light.info + "20" }]}>
                                <ThemedText style={[s.badgeText, { color: Colors.light.info }]}>
                                  {item.leave_type}
                                </ThemedText>
                              </View>
                            )}

                            {item.is_sunday && (
                              <View style={[s.badge, { backgroundColor: "#6B7280" + "20" }]}>
                                <ThemedText style={[s.badgeText, { color: "#6B7280" }]}>
                                  Sunday
                                </ThemedText>
                              </View>
                            )}
                          </View>
                        </View>
                      </View>
                    )}
                  />
                </View>
              ) : null}

              <Spacer height={80} />
            </>
          ) : (
            <View style={s.centerContainer}>
              <Feather name="inbox" size={40} color={theme.textSecondary} />
              <Spacer height={12} />
              <ThemedText style={{ color: theme.textSecondary, textAlign: "center", fontSize: 14, fontWeight: "600" }}>
                No Attendance Data for {selectedMonth > 0 ? getMonthName(selectedMonth) : ""} {selectedYear}
              </ThemedText>
              <Spacer height={8} />
              <ThemedText style={{ color: theme.textSecondary, textAlign: "center", fontSize: 12 }}>
                Available months: {availableMonths.length > 0 ? availableMonths.map(m => `${getMonthName(m.month)} ${m.year}`).join(", ") : "None found"}
              </ThemedText>
              <Spacer height={4} />
              <ThemedText style={{ color: theme.textSecondary, textAlign: "center", fontSize: 12 }}>
                Go to Dashboard and tap "Check In" to create attendance records.
              </ThemedText>
            </View>
          )}}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  container: { padding: 16 },
  card: { borderRadius: 12, padding: 14, marginBottom: 0 },
  monthChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  monthChipText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  centerContainer: { alignItems: "center", paddingTop: 60 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  empName: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 12, marginTop: 2 },
  statsGrid: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  statBox: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "800", marginTop: 4 },
  divider: { height: 1, marginVertical: 12 },
  exportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 8, gap: 8 },
  dayCard: { padding: 12, borderRadius: 10, marginBottom: 8 },
  dateText: { fontSize: 13, fontWeight: "700" },
  dayName: { fontSize: 11, fontWeight: "600" },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: { fontSize: 11, color: "#374151", fontWeight: "600" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: "700" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: "700" },
});
