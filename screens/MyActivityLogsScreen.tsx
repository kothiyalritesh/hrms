import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Alert, Platform, ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { PageHeader } from "@/components/PageHeader";
import { useTheme } from "@/hooks/useTheme";
import Spacer from "@/components/Spacer";
import { ActivityService } from "@/services/activity.service";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import { PaginationControls } from "@/components/PaginationControls";

const PRIMARY = "#6D1B6D";
const PAGE_SIZE = 25;

const ACTIVITY_COLORS: Record<string, string> = {
  SITE_VISIT:               "#12966E",
  CLIENT_MEETING:           "#1A5FD4",
  CHANNEL_PARTNER_MEETING:  "#7C3AED",
  INTERNAL_MEETING:         "#D97706",
  TRAVEL:                   "#C8252D",
  OFFICE_WORK:              "#6B7280",
  OTHER:                    "#9CA3AF",
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function MyActivityLogsScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation();

  const [logs,       setLogs]       = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const loadLogs = async (requestedPage = page) => {
    if (!user?.id) return;
    try {
      const { data, error, count } = await ActivityService.getUserActivities(user.id, {
        page: requestedPage,
        pageSize: PAGE_SIZE,
      });
      if (error) throw error;
      setLogs(data || []);
      setTotal(count);
      setPage(requestedPage);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to load activity logs");
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { setLoading(true); void loadLogs(0); }, [user?.id]));
  const onRefresh = async () => { setRefreshing(true); await loadLogs(); setRefreshing(false); };

  // Group by local date
  const grouped: Record<string, any[]> = {};
  logs.forEach((log) => {
    const d = new Date(log.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(log);
  });
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <PageHeader
        title="Activity Logs"
        subtitle={total ? `Showing ${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}` : "No activities recorded"}
      />

      {loading
        ? <View style={styles.centered}>
            <ActivityIndicator size="large" color={PRIMARY} />
          </View>
        : <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />}
            showsVerticalScrollIndicator={false}
          >
            {/* Summary strip */}
            <View style={[styles.summaryStrip, { backgroundColor: PRIMARY }]}>
              {[
                { label: "All Records", val: total,                                                      color: "#FFFFFF"  },
                { label: "Billable",    val: logs.filter(l => l.is_billable_activity).length,            color: "#86EFAC"  },
                { label: "Low Quality", val: logs.filter(l => l.flag === "LOW_QUALITY_ENTRY").length,    color: "#FCA5A5"  },
                { label: "Site Visits", val: logs.filter(l => l.activity_type === "SITE_VISIT").length,  color: "#93C5FD"  },
              ].map((item, i, arr) => (
                <React.Fragment key={item.label}>
                  <View style={styles.summaryItem}>
                    <ThemedText style={{ fontSize: 22, fontWeight: "800", color: item.color }}>{item.val}</ThemedText>
                    <ThemedText style={{ fontSize: 10, color: "rgba(255,255,255,0.72)", marginTop: 3, textAlign: "center" }}>{item.label}</ThemedText>
                  </View>
                  {i < arr.length - 1
                    ? <View style={styles.summaryDivider} />
                    : null
                  }
                </React.Fragment>
              ))}
            </View>

            <Spacer height={Spacing.lg} />

            {sortedDates.length === 0
              ? <View style={[styles.empty, { backgroundColor: theme.backgroundDefault }]}>
                  <Feather name="clipboard" size={44} color={theme.textSecondary} />
                  <Spacer height={Spacing.md} />
                  <ThemedText type="body" style={{ color: theme.text, fontWeight: "700", textAlign: "center" }}>No activities yet</ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4, lineHeight: 19 }}>
                    Tap "Log Activity" on the dashboard to start tracking your work.
                  </ThemedText>
                  <Spacer height={Spacing.lg} />
                  <TouchableOpacity
                    style={[styles.logBtn, { backgroundColor: PRIMARY }]}
                    onPress={() => navigation.navigate("ActivityLogging" as never)}
                  >
                    <Feather name="plus" size={15} color="#fff" />
                    <ThemedText style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Log Activity</ThemedText>
                  </TouchableOpacity>
                </View>
              : sortedDates.map((dateKey) => {
                  const dayLogs = grouped[dateKey];
                  const displayDate = formatDate(new Date(dateKey + "T12:00:00"));
                  return (
                    <View key={dateKey} style={styles.dateGroup}>
                      <View style={styles.dateHeader}>
                        <ThemedText type="small" style={{ fontWeight: "700", color: theme.text }}>{displayDate}</ThemedText>
                        <View style={[styles.countBadge, { backgroundColor: PRIMARY + "18" }]}>
                          <ThemedText type="caption" style={{ color: PRIMARY, fontWeight: "700" }}>
                            {dayLogs.length}
                          </ThemedText>
                        </View>
                      </View>

                      {dayLogs.map((log) => {
                        const color     = ACTIVITY_COLORS[log.activity_type] || "#9CA3AF";
                        const isExpanded= expandedId === log.id;
                        return (
                          <TouchableOpacity
                            key={log.id}
                            style={[styles.logCard, { backgroundColor: theme.backgroundDefault }]}
                            onPress={() => setExpandedId(isExpanded ? null : log.id)}
                            activeOpacity={0.85}
                          >
                            <View style={[styles.logBar, { backgroundColor: color }]} />
                            <View style={styles.logBody}>
                              <View style={styles.logTitleRow}>
                                <ThemedText
                                  style={{ flex: 1, fontSize: 14, fontWeight: "600", color: theme.text, lineHeight: 20 }}
                                  numberOfLines={isExpanded ? undefined : 1}
                                >
                                  {log.summary || log.notes}
                                </ThemedText>
                                {log.flag === "LOW_QUALITY_ENTRY"
                                  ? <Feather name="alert-triangle" size={14} color={Colors.light.warning} style={{ marginLeft: 6 }} />
                                  : null
                                }
                              </View>
                              <View style={styles.logMeta}>
                                <View style={[styles.typePill, { backgroundColor: color + "20" }]}>
                                  <ThemedText style={{ color, fontWeight: "700", fontSize: 10 }}>
                                    {(log.activity_type || "OTHER").replace(/_/g, " ")}
                                  </ThemedText>
                                </View>
                                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                                  {formatTime(log.timestamp)}
                                </ThemedText>
                                {log.is_billable_activity
                                  ? <View style={[styles.typePill, { backgroundColor: Colors.light.successBg }]}>
                                      <ThemedText style={{ color: Colors.light.successText, fontWeight: "700", fontSize: 10 }}>Billable</ThemedText>
                                    </View>
                                  : null
                                }
                              </View>

                              {isExpanded && (
                                <View style={[styles.expanded, { borderTopColor: theme.border }]}>
                                  {log.location_name
                                    ? <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 3 }}>
                                        <Feather name="map-pin" size={12} color={theme.textSecondary} /> {log.location_name}
                                      </ThemedText>
                                    : null
                                  }
                                  {(log.client_name || log.company_name)
                                    ? <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 3 }}>
                                        <Feather name="briefcase" size={12} color={theme.textSecondary} /> {log.client_name || log.company_name}
                                      </ThemedText>
                                    : null
                                  }
                                  {log.notes
                                    ? <ThemedText type="small" style={{ color: theme.text, lineHeight: 19, marginTop: 4, fontStyle: "italic" }}>
                                        {log.notes}
                                      </ThemedText>
                                    : null
                                  }
                                  <View style={styles.confidenceRow}>
                                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>Confidence: </ThemedText>
                                    <ThemedText type="caption" style={{ color, fontWeight: "700" }}>{log.confidence_score}%</ThemedText>
                                  </View>
                                  {log.flag === "LOW_QUALITY_ENTRY"
                                    ? <View style={[styles.flagNote, { backgroundColor: Colors.light.warningBg }]}>
                                        <Feather name="alert-triangle" size={12} color={Colors.light.warning} />
                                        <ThemedText type="caption" style={{ color: Colors.light.warningText, flex: 1, lineHeight: 17 }}>
                                          Flagged as low quality — add more detail next time.
                                        </ThemedText>
                                      </View>
                                    : null
                                  }
                                </View>
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })
            }
            <PaginationControls
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={(nextPage) => { setLoading(true); void loadLogs(nextPage); }}
            />
            <Spacer height={Spacing["2xl"]} />
          </ScrollView>
      }
    </View>
  );
}

const styles = StyleSheet.create({
  scroll:  { flex: 1 },
  content: { padding: Spacing.lg },
  centered:{ flex: 1, alignItems: "center", justifyContent: "center" },
  summaryStrip: {
    flexDirection: "row", borderRadius: 16, padding: Spacing.lg,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 14px rgba(109,27,109,0.20)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.20, shadowRadius: 14, elevation: 6 }),
  },
  summaryItem:  { flex: 1, alignItems: "center" },
  summaryDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.25)", marginVertical: 4 },
  dateGroup:  { marginBottom: Spacing.xl },
  dateHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: Spacing.sm },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.full },
  logCard: {
    flexDirection: "row", borderRadius: 13, overflow: "hidden", marginBottom: Spacing.sm,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  logBar:      { width: 4 },
  logBody:     { flex: 1, padding: 12 },
  logTitleRow: { flexDirection: "row", alignItems: "flex-start" },
  logMeta:     { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 6 },
  typePill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  expanded:    { marginTop: 10, paddingTop: 10, borderTopWidth: 1, gap: 2 },
  confidenceRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  flagNote:    { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 8, borderRadius: 8, marginTop: 8 },
  empty:       { alignItems: "center", padding: Spacing["3xl"], borderRadius: 14 },
  logBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 10 },
});
