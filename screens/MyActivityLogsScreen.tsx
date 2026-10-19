import React, { useState, useCallback, useRef } from "react";
import {
  View, StyleSheet, ScrollView, Pressable,
  RefreshControl, ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import Spacer from "@/components/Spacer";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius } from "@/constants/theme";
import { getBusinessDateIST } from "@/utils/attendanceTimestamp";

const PAGE_SIZE = 25;

type Category = "all" | "attendance" | "leave" | "field_visit";

const CATEGORIES: { key: Category; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "all", label: "All", icon: "layers" },
  { key: "attendance", label: "Attendance", icon: "clock" },
  { key: "leave", label: "Leave", icon: "calendar" },
  { key: "field_visit", label: "Field visits", icon: "map-pin" },
];

const CATEGORY_META: Record<string, { color: string; icon: keyof typeof Feather.glyphMap; label: string }> = {
  attendance: { color: "#10B981", icon: "clock", label: "Attendance" },
  leave: { color: "#F59E0B", icon: "calendar", label: "Leave" },
  field_visit: { color: "#3B82F6", icon: "map-pin", label: "Field visit" },
};
const OTHER_META = { color: "#9CA3AF", icon: "activity" as const, label: "Activity" };

const TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
});
const DAY_FMT = new Intl.DateTimeFormat("en-IN", {
  weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
});
const IST_KEY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata",
});

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string, today: string) {
  if (key === today) return "Today";
  if (key === addDays(today, -1)) return "Yesterday";
  return DAY_FMT.format(new Date(`${key}T12:00:00+05:30`));
}

export default function MyActivityLogsScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();

  const [logs, setLogs] = useState<any[]>([]);
  const [filter, setFilter] = useState<Category>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const fetchPage = useCallback(
    async (category: Category, offset: number) => {
      const { data, error: rpcError } = await supabase.rpc("rpc_my_unified_activity_log", {
        p_category: category,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      });
      if (rpcError) throw rpcError;
      return Array.isArray(data) ? data : [];
    },
    [],
  );

  const load = useCallback(
    async (category: Category, mode: "initial" | "refresh" = "initial") => {
      if (!user?.id) return;
      const request = ++requestRef.current;
      if (mode === "initial") setLoading(true);
      setError(null);
      try {
        const rows = await fetchPage(category, 0);
        if (request !== requestRef.current) return; // a newer filter won
        setLogs(rows);
        setHasMore(rows.length === PAGE_SIZE);
      } catch (err: any) {
        if (request !== requestRef.current) return;
        setError(err?.message || "Activity could not be loaded.");
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [user?.id, fetchPage],
  );

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    const request = requestRef.current;
    setLoadingMore(true);
    try {
      const rows = await fetchPage(filter, logs.length);
      if (request !== requestRef.current) return;
      setLogs((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...rows.filter((row: any) => !seen.has(row.id))];
      });
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err: any) {
      setError(err?.message || "More activity could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      void load(filter, logs.length ? "refresh" : "initial");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]),
  );

  const selectFilter = (category: Category) => {
    if (category === filter) return;
    setFilter(category);
    setExpandedId(null);
    setLogs([]);
    void load(category, "initial");
  };

  const onRefresh = () => {
    setRefreshing(true);
    void load(filter, "refresh");
  };

  // Group by IST calendar day, newest first
  const today = getBusinessDateIST();
  const groups: { key: string; items: any[] }[] = [];
  for (const log of logs) {
    if (!log.log_time) continue;
    const date = new Date(log.log_time);
    if (Number.isNaN(date.getTime())) continue;
    const key = IST_KEY.format(date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(log);
    else groups.push({ key, items: [log] });
  }

  const filterLabel = CATEGORIES.find((c) => c.key === filter)?.label ?? "All";

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      {/* Filter bar: fixed height (a horizontal ScrollView otherwise stretches on web) */}
      <View style={[styles.filterBar, { backgroundColor: theme.backgroundRoot, borderBottomColor: theme.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.filterScroll}
        >
          {CATEGORIES.map((c) => {
            const active = filter === c.key;
            return (
              <Pressable
                key={c.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => selectFilter(c.key)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: active ? theme.primary : theme.backgroundDefault,
                    borderColor: active ? theme.primary : theme.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Feather name={c.icon} size={13} color={active ? "#fff" : theme.textSecondary} />
                <ThemedText style={[styles.chipText, { color: active ? "#fff" : theme.text }]}>
                  {c.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.content}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.skeleton, { backgroundColor: theme.backgroundDefault }]}>
              <View style={[styles.skeletonDot, { backgroundColor: theme.backgroundSecondary }]} />
              <View style={{ flex: 1, gap: 8 }}>
                <View style={[styles.skeletonLine, { width: "60%", backgroundColor: theme.backgroundSecondary }]} />
                <View style={[styles.skeletonLine, { width: "35%", backgroundColor: theme.backgroundSecondary }]} />
              </View>
            </View>
          ))}
        </View>
      ) : error && logs.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="alert-circle" size={36} color="#EF4444" />
          <Spacer height={12} />
          <ThemedText style={{ color: theme.text, fontWeight: "700" }}>Activity could not be loaded</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4, marginHorizontal: 32 }}>
            {error}
          </ThemedText>
          <Pressable style={[styles.primaryBtn, { backgroundColor: theme.primary }]} onPress={() => void load(filter)}>
            <Feather name="refresh-cw" size={14} color="#fff" />
            <ThemedText style={{ color: "#fff", fontWeight: "700" }}>Try again</ThemedText>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {groups.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: theme.backgroundDefault }]}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.primary + "14" }]}>
                <Feather name="activity" size={28} color={theme.primary} />
              </View>
              <Spacer height={Spacing.md} />
              <ThemedText style={{ color: theme.text, fontWeight: "700", textAlign: "center", fontSize: 15 }}>
                {filter === "all" ? "No activity yet" : `No ${filterLabel.toLowerCase()} activity yet`}
              </ThemedText>
              <ThemedText style={{ color: theme.textSecondary, textAlign: "center", marginTop: 6, lineHeight: 20, fontSize: 13 }}>
                Your check-ins, field visits and leave requests appear here as they happen.
              </ThemedText>
            </View>
          ) : (
            groups.map((group) => (
              <View key={group.key} style={styles.dateGroup}>
                <View style={styles.dateHeader}>
                  <ThemedText style={[styles.dateLabel, { color: theme.text }]}>
                    {dayLabel(group.key, today)}
                  </ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {group.items.length} {group.items.length === 1 ? "entry" : "entries"}
                  </ThemedText>
                </View>

                <View style={[styles.timeline, { backgroundColor: theme.backgroundDefault }]}>
                  {group.items.map((log, index) => {
                    const meta = CATEGORY_META[log.category] ?? OTHER_META;
                    const expanded = expandedId === log.id;
                    const description = String(log.description ?? "").trim();
                    const expandable = description.length > 70;
                    const last = index === group.items.length - 1;
                    return (
                      <Pressable
                        key={log.id}
                        disabled={!expandable}
                        onPress={() => setExpandedId(expanded ? null : log.id)}
                        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.85 : 1 }]}
                      >
                        <View style={styles.rail}>
                          <View style={[styles.dot, { backgroundColor: meta.color + "1F" }]}>
                            <Feather name={meta.icon} size={14} color={meta.color} />
                          </View>
                          {!last ? <View style={[styles.railLine, { backgroundColor: theme.border }]} /> : null}
                        </View>
                        <View style={[styles.body, !last && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                          <View style={styles.titleRow}>
                            <ThemedText style={[styles.title, { color: theme.text }]} numberOfLines={expanded ? undefined : 2}>
                              {log.title || meta.label}
                            </ThemedText>
                            <ThemedText style={[styles.time, { color: theme.textSecondary }]}>
                              {TIME_FMT.format(new Date(log.log_time))}
                            </ThemedText>
                          </View>
                          <View style={styles.metaRow}>
                            <View style={[styles.typePill, { backgroundColor: meta.color + "1A" }]}>
                              <ThemedText style={[styles.typeText, { color: meta.color }]}>{meta.label}</ThemedText>
                            </View>
                          </View>
                          {description ? (
                            <ThemedText
                              style={[styles.description, { color: theme.textSecondary }]}
                              numberOfLines={expanded ? undefined : 2}
                            >
                              {description}
                            </ThemedText>
                          ) : null}
                          {expandable ? (
                            <ThemedText style={[styles.more, { color: theme.primary }]}>
                              {expanded ? "Show less" : "Show more"}
                            </ThemedText>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))
          )}

          {groups.length > 0 ? (
            hasMore ? (
              <Pressable
                onPress={() => void loadMore()}
                disabled={loadingMore}
                style={({ pressed }) => [
                  styles.moreBtn,
                  { borderColor: theme.border, backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                {loadingMore ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <ThemedText style={{ color: theme.primary, fontWeight: "700" }}>Load older activity</ThemedText>
                )}
              </Pressable>
            ) : (
              <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4 }}>
                You've reached the beginning of your activity.
              </ThemedText>
            )
          ) : null}
          {error && logs.length > 0 ? (
            <ThemedText type="caption" style={{ color: "#EF4444", textAlign: "center", marginTop: 8 }}>{error}</ThemedText>
          ) : null}
          <Spacer height={48} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  filterBar: { borderBottomWidth: StyleSheet.hairlineWidth },
  filterScroll: { paddingHorizontal: Spacing.lg, paddingVertical: 10, gap: 8, alignItems: "center" },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, height: 34, borderRadius: 17, borderWidth: 1,
  },
  chipText: { fontWeight: "600", fontSize: 13 },
  content: { padding: Spacing.lg, width: "100%", maxWidth: 760, alignSelf: "center" },
  skeleton: { flexDirection: "row", gap: 12, alignItems: "center", padding: 14, borderRadius: BorderRadius.md, marginBottom: 10 },
  skeletonDot: { width: 32, height: 32, borderRadius: 16 },
  skeletonLine: { height: 10, borderRadius: 5 },
  empty: { alignItems: "center", padding: 32, borderRadius: BorderRadius.lg, marginTop: Spacing.lg },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  primaryBtn: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  dateGroup: { marginBottom: Spacing.lg },
  dateHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 4 },
  dateLabel: { fontSize: 14, fontWeight: "800" },
  timeline: { borderRadius: BorderRadius.lg, paddingHorizontal: 12, overflow: "hidden" },
  row: { flexDirection: "row", gap: 12 },
  rail: { width: 32, alignItems: "center", paddingTop: 12 },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  railLine: { width: 2, flex: 1, marginTop: 4, borderRadius: 1 },
  body: { flex: 1, minWidth: 0, paddingVertical: 12 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  time: { fontSize: 12, lineHeight: 20 },
  metaRow: { flexDirection: "row", marginTop: 4 },
  typePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  typeText: { fontSize: 11, fontWeight: "700" },
  description: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  more: { fontSize: 12, fontWeight: "700", marginTop: 4 },
  moreBtn: { alignItems: "center", justifyContent: "center", height: 44, borderRadius: 10, borderWidth: 1, marginTop: 4 },
});
