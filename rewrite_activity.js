const fs = require('fs');
const path = require('path');
const p = path.resolve('screens/MyActivityLogsScreen.tsx');
let content = fs.readFileSync(p, 'utf-8');

const newContent = `import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Alert, Platform, ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { PageHeader } from "@/components/PageHeader";
import { useTheme } from "@/hooks/useTheme";
import Spacer from "@/components/Spacer";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import { PaginationControls } from "@/components/PaginationControls";

const PRIMARY = "#6D1B6D";
const PAGE_SIZE = 25;

const CATEGORIES = ["All", "Attendance", "Leave", "Field Visit", "System"];

const CATEGORY_COLORS: Record<string, string> = {
  attendance: "#10B981", // Emerald
  leave: "#F59E0B",      // Amber
  field_visit: "#3B82F6", // Blue
  system: "#6B7280",      // Gray
};

export default function MyActivityLogsScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation();
  const { user } = useAuth();

  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Pagination state
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const formatTime = (isoString?: string) => {
    if (!isoString) return "";
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const loadLogs = async (requestedPage = page, currentFilter = filter) => {
    if (!user?.id) return;
    try {
      const dbFilter = currentFilter === "All" ? "all" : 
                       currentFilter === "Field Visit" ? "field_visit" : 
                       currentFilter.toLowerCase();
      
      const { data, error } = await supabase.rpc("rpc_my_unified_activity_log", {
        p_category: dbFilter,
        p_limit: PAGE_SIZE,
        p_offset: requestedPage * PAGE_SIZE
      });
      if (error) throw error;
      setLogs(data || []);
      setTotal((requestedPage * PAGE_SIZE) + ((data?.length === PAGE_SIZE) ? PAGE_SIZE + 1 : (data?.length || 0)));
      setPage(requestedPage);
      setFilter(currentFilter);
    } catch (err: any) {
      console.warn("Error fetching logs", err);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { setLoading(true); void loadLogs(0, filter); }, [user?.id, filter]));
  const onRefresh = async () => { setRefreshing(true); await loadLogs(); setRefreshing(false); };

  // Group by local date
  const grouped: Record<string, any[]> = {};
  logs.forEach((log) => {
    const d = new Date(log.log_time);
    const key = \`\${d.getFullYear()}-\${String(d.getMonth()+1).padStart(2,"0")}-\${String(d.getDate()).padStart(2,"0")}\`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(log);
  });
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <PageHeader
        title="Unified Activity"
        subtitle="Timeline of your actions across the system"
      />

      <View style={[styles.headerCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
        <View style={styles.headerTitleRow}>
          <Feather name="info" size={16} color={PRIMARY} />
          <ThemedText style={{ marginLeft: 8, fontSize: 13, fontWeight: "600", color: theme.text }}>
            What you see here
          </ThemedText>
        </View>
        <ThemedText style={{ fontSize: 13, color: theme.textSecondary, lineHeight: 20, marginTop: 4 }}>
          Showing: Check-ins, Check-outs, Field Visits, Leave Applications, System Actions
        </ThemedText>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
        {CATEGORIES.map(c => {
          const isActive = filter === c;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => { setLoading(true); void loadLogs(0, c); }}
              style={[
                styles.filterChip,
                { backgroundColor: isActive ? PRIMARY : theme.backgroundSecondary, borderColor: isActive ? PRIMARY : theme.border }
              ]}
            >
              <ThemedText style={{ color: isActive ? "#fff" : theme.textSecondary, fontWeight: "600", fontSize: 13 }}>
                {c}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

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
            {sortedDates.length === 0
              ? <View style={[styles.empty, { backgroundColor: theme.backgroundDefault }]}>
                  <Feather name="clipboard" size={44} color={theme.textSecondary} />
                  <Spacer height={Spacing.md} />
                  <ThemedText type="body" style={{ color: theme.text, fontWeight: "700", textAlign: "center" }}>No activities found</ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4, lineHeight: 19 }}>
                    Try changing your filter or check back later.
                  </ThemedText>
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
                        const color = CATEGORY_COLORS[log.category] || "#9CA3AF";
                        const isExpanded = expandedId === log.id;
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
                                  {log.title}
                                </ThemedText>
                              </View>
                              <View style={styles.logMeta}>
                                <View style={[styles.typePill, { backgroundColor: color + "20" }]}>
                                  <ThemedText style={{ color, fontWeight: "700", fontSize: 10, textTransform: "capitalize" }}>
                                    {(log.category || "Other").replace(/_/g, " ")}
                                  </ThemedText>
                                </View>
                                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                                  {formatTime(log.log_time)}
                                </ThemedText>
                              </View>

                              {isExpanded && log.description ? (
                                <View style={[styles.expanded, { borderTopColor: theme.border }]}>
                                  <ThemedText type="small" style={{ color: theme.textSecondary, lineHeight: 19 }}>
                                    {log.description}
                                  </ThemedText>
                                </View>
                              ) : null}
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
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  headerCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  filterScroll: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: 60 },
  empty: {
    alignItems: "center",
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.xl,
  },
  dateGroup: { marginBottom: Spacing.xl },
  dateHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  logCard: {
    flexDirection: "row",
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  logBar: { width: 4 },
  logBody: { flex: 1, padding: Spacing.md },
  logTitleRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  logMeta: { flexDirection: "row", alignItems: "center", gap: 12 },
  typePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  expanded: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  }
});
`;

fs.writeFileSync(p, newContent, 'utf-8');
console.log("Rewrote MyActivityLogsScreen.tsx for Item 6!");
