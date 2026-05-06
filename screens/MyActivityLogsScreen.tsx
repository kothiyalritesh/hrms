import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import Spacer from "@/components/Spacer";
import { ActivityService } from "@/services/activity.service";
import { useAuth } from "@/contexts/AuthContext";

const ACTIVITY_COLORS: Record<string, string> = {
  SITE_VISIT: "#10B981",
  CLIENT_MEETING: "#3B82F6",
  CHANNEL_PARTNER_MEETING: "#8B5CF6",
  INTERNAL_MEETING: "#F59E0B",
  TRAVEL: "#EF4444",
  OFFICE_WORK: "#6B7280",
  OTHER: "#9CA3AF",
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

export default function MyActivityLogsScreen() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = async () => {
    if (!user?.id) {
      console.warn("[MyActivityLogs] No user ID available");
      setLogs([]);
      setLoading(false);
      return;
    }
    try {
      console.log("[MyActivityLogs] Loading activities for user:", user.id);
      const { data, error } = await ActivityService.getUserActivities(user.id, { limit: 50 });
      console.log("[MyActivityLogs] Response:", { dataLength: data?.length, error, data });
      if (error) {
        console.error("[MyActivityLogs] Error:", error);
        setLogs([]);
      } else {
        console.log("[MyActivityLogs] Loaded", data?.length || 0, "activities");
        console.log("[MyActivityLogs] Data:", data);
        setLogs(data || []);
      }
    } catch (err: any) {
      console.error("[MyActivityLogs] Exception:", err);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log("[MyActivityLogs] useEffect triggered, user:", user?.id);
    if (user?.id) {
      setLoading(true);
      loadLogs();
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      console.log("[MyActivityLogs] useFocusEffect triggered");
      setLoading(true);
      loadLogs();
    }, [user?.id])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLogs();
    setRefreshing(false);
  };

  // Group logs by LOCAL date (not UTC)
  const grouped: Record<string, any[]> = {};
  logs.forEach((log) => {
    const d = new Date(log.timestamp);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(log);
  });
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.centerText}>Loading your logs...</ThemedText>
      </ThemedView>
    );
  }

  console.log("[MyActivityLogs] Render - logs count:", logs.length);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary strip */}
        <View style={styles.summaryRow}>
          {[
            { label: "Total",       val: logs.length,                                              color: "#fff" },
            { label: "Billable",    val: logs.filter((l) => l.is_billable_activity).length,        color: "#86EFAC" },
            { label: "Low Quality", val: logs.filter((l) => l.flag === "LOW_QUALITY_ENTRY").length, color: "#FCA5A5" },
            { label: "Site Visits", val: logs.filter((l) => l.activity_type === "SITE_VISIT").length, color: "#93C5FD" },
          ].map((item, i, arr) => (
            <React.Fragment key={item.label}>
              <View style={styles.summaryItem}>
                <ThemedText style={[styles.summaryValue, { color: item.color }]}>{item.val}</ThemedText>
                <ThemedText style={styles.summaryLabel}>{item.label}</ThemedText>
              </View>
              {i < arr.length - 1 && <View style={styles.summaryDivider} />}
            </React.Fragment>
          ))}
        </View>

        <Spacer height={16} />

        {sortedDates.length === 0 ? (
          <View style={styles.emptyState}>
            <ThemedText style={styles.emptyEmoji}>📋</ThemedText>
            <ThemedText style={styles.emptyTitle}>No activities yet</ThemedText>
            <ThemedText style={styles.emptySubtitle}>
              Tap "Log Activity" on the dashboard to start tracking your work.
            </ThemedText>
            <Spacer height={16} />
            <TouchableOpacity style={styles.logBtn} onPress={() => navigation.navigate("ActivityLogging" as never)}>
              <ThemedText style={styles.logBtnText}>+ Log Activity</ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          sortedDates.map((dateKey) => {
            const dayLogs = grouped[dateKey];
            const displayDate = new Date(dateKey).toLocaleDateString([], {
              weekday: "long", day: "2-digit", month: "short", year: "numeric",
            });

            return (
              <View key={dateKey} style={styles.dateGroup}>
                <View style={styles.dateHeader}>
                  <ThemedText style={styles.dateHeaderText}>{displayDate}</ThemedText>
                  <ThemedText style={styles.dateCount}>{dayLogs.length} activities</ThemedText>
                </View>

                {dayLogs.map((log) => {
                  const { time } = formatDateTime(log.timestamp);
                  const color = ACTIVITY_COLORS[log.activity_type] || "#9CA3AF";
                  const isExpanded = expandedId === log.id;

                  return (
                    <TouchableOpacity
                      key={log.id}
                      style={styles.logCard}
                      onPress={() => setExpandedId(isExpanded ? null : log.id)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.logCardHeader}>
                        <View style={[styles.colorDot, { backgroundColor: color }]} />
                        <View style={styles.logCardMain}>
                          <View style={styles.logCardTitleRow}>
                            <ThemedText style={styles.logCardTitle} numberOfLines={isExpanded ? undefined : 1}>
                              {log.summary || log.notes || log.location_name || "Activity"}
                            </ThemedText>
                            {log.flag === "LOW_QUALITY_ENTRY" && (
                              <ThemedText style={styles.flagBadge}>⚠️</ThemedText>
                            )}
                          </View>
                          <View style={styles.logCardMeta}>
                            <View style={[styles.typePill, { backgroundColor: color + "22" }]}>
                              <ThemedText style={[styles.typePillText, { color }]}>
                                {(log.activity_type || "OTHER").replace(/_/g, " ")}
                              </ThemedText>
                            </View>
                            <ThemedText style={styles.logTime}>{time}</ThemedText>
                            {log.is_billable_activity && (
                              <View style={styles.billablePill}>
                                <ThemedText style={styles.billablePillText}>Billable</ThemedText>
                              </View>
                            )}
                          </View>
                        </View>
                      </View>

                      {isExpanded && (
                        <View style={styles.expandedContent}>
                          {log.location_name ? (
                            <ThemedText style={styles.expandedRow}>📍 {log.location_name}</ThemedText>
                          ) : null}
                          {(log.client_name || log.company_name) ? (
                            <ThemedText style={styles.expandedRow}>🏢 {log.client_name || log.company_name}</ThemedText>
                          ) : null}
                          {log.meeting_purpose ? (
                            <ThemedText style={styles.expandedRow}>🎯 {log.meeting_purpose}</ThemedText>
                          ) : null}
                          {log.notes ? (
                            <ThemedText style={styles.expandedNotes}>{log.notes}</ThemedText>
                          ) : null}
                          <View style={styles.confidenceRow}>
                            <ThemedText style={styles.confidenceLabel}>Confidence: </ThemedText>
                            <ThemedText style={[styles.confidenceValue, { color }]}>{log.confidence_score || 0}%</ThemedText>
                          </View>
                          {log.flag === "LOW_QUALITY_ENTRY" && (
                            <View style={styles.lowQualityNote}>
                              <ThemedText style={styles.lowQualityNoteText}>
                                ⚠️ This entry was flagged as low quality. Add more detail next time.
                              </ThemedText>
                            </View>
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })
        )}

        <Spacer height={30} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1, padding: 16, paddingTop: 20 },
  centerText: { textAlign: "center", marginTop: 60, color: "#666", fontSize: 15 },
  summaryRow: {
    flexDirection: "row",
    backgroundColor: "#60045d",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#60045d",
    minHeight: 80,
  },
  summaryItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  summaryDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.3)", marginVertical: 4 },
  summaryValue: { fontSize: 22, fontWeight: "800", color: "#fff" },
  summaryLabel: { fontSize: 10, color: "rgba(255,255,255,0.75)", marginTop: 3, textAlign: "center" },
  emptyState: { alignItems: "center", paddingTop: 60 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 20, fontWeight: "700", marginTop: 12, color: "#111" },
  emptySubtitle: { fontSize: 14, color: "#6B7280", textAlign: "center", marginTop: 8, lineHeight: 20 },
  logBtn: { backgroundColor: "#007AFF", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  logBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  dateGroup: { marginBottom: 20 },
  dateHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  dateHeaderText: { fontSize: 14, fontWeight: "700", color: "#374151" },
  dateCount: { fontSize: 12, color: "#9CA3AF" },
  logCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  logCardHeader: { flexDirection: "row", alignItems: "flex-start" },
  colorDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5, marginRight: 10 },
  logCardMain: { flex: 1 },
  logCardTitleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  logCardTitle: { flex: 1, fontSize: 14, fontWeight: "600", color: "#111", lineHeight: 20 },
  flagBadge: { fontSize: 14, marginLeft: 6 },
  logCardMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 6 },
  typePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  typePillText: { fontSize: 11, fontWeight: "600" },
  logTime: { fontSize: 12, color: "#9CA3AF" },
  billablePill: { backgroundColor: "#D1FAE5", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  billablePillText: { fontSize: 11, color: "#065F46", fontWeight: "600" },
  expandedContent: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  expandedRow: { fontSize: 13, color: "#4B5563", marginBottom: 4 },
  expandedNotes: { fontSize: 13, color: "#374151", marginTop: 6, lineHeight: 20, fontStyle: "italic" },
  confidenceRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  confidenceLabel: { fontSize: 12, color: "#9CA3AF" },
  confidenceValue: { fontSize: 12, fontWeight: "700" },
  lowQualityNote: { backgroundColor: "#FEF3C7", padding: 10, borderRadius: 8, marginTop: 8 },
  lowQualityNoteText: { fontSize: 12, color: "#92400E" },
});
