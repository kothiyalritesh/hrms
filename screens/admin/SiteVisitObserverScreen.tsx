/**
 * SiteVisitObserverScreen.tsx
 * Site Visit Observer Panel (Live + Historical Intelligence Map)
 *
 * Provides a unified Site Visit Intelligence map:
 * - Date selection: Today (Live realtime) or Past date (Historical)
 * - Realtime Postgres changes streaming for active visits (selective updates)
 * - Summary KPI cards (Total Visits, At Site, In Transit, Completed, Signal Lost)
 * - Multi-criteria filter bar (Search, Status quick filters, Department)
 * - Snapchat-style labeled markers with accessibility icons and status text
 * - Detail drawer with live telemetry, route quality summary, and chronological visit list
 * - Route breadcrumb cleanup (filters mocked & invalid coords) and timestamp-driven playback
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  FlatList,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import SiteVisitObserverMap from "@/components/SiteVisitObserverMap";
import ObserverSummaryCards from "@/components/observer/ObserverSummaryCards";
import ObserverFilterBar from "@/components/observer/ObserverFilterBar";
import ObserverDetailDrawer from "@/components/observer/ObserverDetailDrawer";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
import { addBusinessDays, getBusinessDateIST } from "@/utils/businessDate";
import { toTitleCase } from "@/utils/format";
import {
  SiteVisitObserverData,
  SiteVisitObserverEmployee,
  SiteVisitObserverVisit,
} from "@/types/location-database";
import { useSiteVisitBreadcrumbs } from "@/hooks/useSiteVisitBreadcrumbs";
import { cleanRouteBreadcrumbs } from "@/utils/routeCleanup";
import { computeRouteQuality } from "@/utils/gpsQuality";
import { useRoutePlayback } from "@/hooks/useRoutePlayback";

import { freshnessOf, minutesAgo } from "@/utils/locationFreshness";
function getTodayISTString(): string {
  return getBusinessDateIST();
}

function SiteVisitObserverScreenContent() {
  const { theme } = useTheme();

  const [todayStr, setTodayStr] = useState<string>(getTodayISTString());
  const [selectedDate, setSelectedDate] = useState<string>(getTodayISTString());
  const [loading, setLoading] = useState(false);
  const [observerData, setObserverData] = useState<SiteVisitObserverData | null>(null);

  const [selectedEmployee, setSelectedEmployee] = useState<SiteVisitObserverEmployee | null>(null);
  const [selectedVisit, setSelectedVisit] = useState<SiteVisitObserverVisit | null>(null);

  // Filters
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedDepartment, setSelectedDepartment] = useState("");

  const isLiveMode = selectedDate === todayStr;

  // Breadcrumbs for selected visit
  const { breadcrumbs: rawBreadcrumbs } = useSiteVisitBreadcrumbs(
    selectedVisit?.visit_id ?? null,
  );

  // Route Cleanup (Excludes mocked, deduplicates, flags jumps)
  const cleanedBreadcrumbs = useMemo(() => {
    return cleanRouteBreadcrumbs(rawBreadcrumbs);
  }, [rawBreadcrumbs]);

  // Route Quality Metrics (Distance, Duration, Points, Accuracy)
  const routeQuality = useMemo(() => {
    return computeRouteQuality(cleanedBreadcrumbs);
  }, [cleanedBreadcrumbs]);

  // Timestamp-Driven Route Playback Engine
  const {
    isPlaying,
    playbackSpeed,
    currentIndex: playbackIndex,
    activePoint: activePlaybackPoint,
    progress: playbackProgress,
    elapsedTimeStr,
    totalTimeStr,
    togglePlay,
    restart,
    setPlaybackSpeed,
    scrubToProgress,
  } = useRoutePlayback({ points: cleanedBreadcrumbs });

  // Polyline coordinates from cleaned breadcrumbs
  const polylineCoords = useMemo(() => {
    return cleanedBreadcrumbs.map((b) => ({ latitude: b.latitude, longitude: b.longitude }));
  }, [cleanedBreadcrumbs]);

  // Initial date load
  useEffect(() => {
    void BusinessClockService.getDate(true).then((d) => {
      if (d) {
        setTodayStr(d);
        setSelectedDate(d);
      }
    });
  }, []);

  // Fetch observer data
  const loadObserverData = useCallback(async (date: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_site_visit_observer_data", { p_date: date, p_employee_id: null, p_visit_id: null });
      if (error) throw error;
      if (data?.error === "PERMISSION_DENIED") {
        if (!silent) Alert.alert("Access Denied", "You do not have permission to view Site Visit Observer.");
        return;
      }
      setObserverData(data as SiteVisitObserverData);
    } catch (err: any) {
      console.error("[SiteVisitObserver] load error:", err);
      if (!silent) Alert.alert("Error", err?.message || "Failed to load observer data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadObserverData(selectedDate);
  }, [selectedDate, loadObserverData]);

  // Realtime can be suspended on mobile networks: refresh live data every minute.
  useEffect(() => {
    if (selectedDate !== todayStr) return;
    const timer = setInterval(() => void loadObserverData(selectedDate, true), 60_000);
    return () => clearInterval(timer);
  }, [selectedDate, todayStr, loadObserverData]);

  // Keep the open employee / visit in step with refreshed data (e.g. after a review).
  useEffect(() => {
    if (!observerData || !selectedEmployee) return;
    const fresh = (observerData.employees as any[]).find(
      (e) => e.employee_id === (selectedEmployee as any).employee_id,
    );
    if (!fresh) return;
    setSelectedEmployee(fresh);
    if (selectedVisit) {
      const freshVisit = (fresh.visits || []).find((v: any) => v.visit_id === selectedVisit.visit_id);
      if (freshVisit) setSelectedVisit(freshVisit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observerData]);

  // Realtime subscription in live mode (selective updates without full-page re-fetch)
  // Ages keep moving between updates: live -> recent -> no signal without a reload.
  useEffect(() => {
    if (!isLiveMode) return;
    const timer = setInterval(() => {
      setObserverData((prev: any) => {
        if (!prev?.employees) return prev;
        let changed = false;
        const employees = prev.employees.map((emp: any) => {
          const t = emp.tracking;
          if (!t || t.signal_status === "ENDED") return emp;
          const fresh = freshnessOf(minutesAgo(t.last_location_at || t.updated_at));
          const signal = fresh === "LIVE" ? "LIVE" : fresh === "RECENT" ? "DELAYED" : "SIGNAL_LOST";
          if (signal === t.signal_status) return emp;
          changed = true;
          return {
            ...emp,
            tracking: {
              ...t,
              signal_status: signal,
              tracking_health: signal === "LIVE" ? "ACTIVE" : signal === "DELAYED" ? "DELAYED" : "STALE",
            },
          };
        });
        if (!changed) return prev;
        return {
          ...prev,
          employees,
          summary: prev.summary
            ? {
                ...prev.summary,
                signal_lost: employees.filter((e: any) => e.tracking?.signal_status === "SIGNAL_LOST").length,
              }
            : prev.summary,
        };
      });
    }, 60_000);
    return () => clearInterval(timer);
  }, [isLiveMode]);

  useEffect(() => {
    if (!isLiveMode) return;

    const channel = supabase
      .channel("observer-live-feed")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "site_visit_live_locations",
        },
        (payload) => {
          const updated = payload.new as any;
          if (!updated || !updated.user_id) return;

          setObserverData((prev: any) => {
            if (!prev || !prev.employees) return prev;

            const nextEmployees = prev.employees.map((emp: any) => {
              if (emp.employee_id === updated.user_id) {
                // Same rule as every location screen: LIVE <= 5, RECENT <= 15 min.
                const fresh = freshnessOf(
                  minutesAgo(updated.last_location_at || updated.recorded_at || updated.updated_at),
                );
                const signalStatus: "LIVE" | "DELAYED" | "SIGNAL_LOST" =
                  fresh === "LIVE" ? "LIVE" : fresh === "RECENT" ? "DELAYED" : "SIGNAL_LOST";

                const newTracking = {
                  ...emp.tracking,
                  signal_status: signalStatus,
                  tracking_health: signalStatus === "LIVE" ? "ACTIVE" : signalStatus === "DELAYED" ? "DELAYED" : "STALE",
                  latitude: updated.latitude,
                  longitude: updated.longitude,
                  accuracy: updated.accuracy_m,
                  battery_level: updated.battery_level,
                  speed_mps: updated.speed_mps,
                  updated_at: updated.recorded_at || updated.updated_at,
                  last_location_at: updated.last_location_at || updated.recorded_at,
                };

                return {
                  ...emp,
                  tracking: newTracking,
                  latest_lat: updated.latitude,
                  latest_lon: updated.longitude,
                  updated_at: updated.recorded_at || updated.updated_at,
                };
              }
              return emp;
            });

            return { ...prev, employees: nextEmployees };
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isLiveMode]);


  const { width, height: windowHeight } = useWindowDimensions();
  const isDesktop = width >= 768;
  // Phones / small tablets: one vertical column with a fixed-height map.
  const mobileMapHeight = Math.round(Math.min(320, Math.max(260, Math.min(width * 0.8, windowHeight * 0.4))));
  const mobileListRef = useRef<FlatList<any>>(null);

  const allEmployees = (observerData?.employees ?? []) as any[];

  // Extract unique departments for filter dropdown
  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEmployees) {
      if (e.department) set.add(e.department);
    }
    return Array.from(set);
  }, [allEmployees]);

  // Apply search & status filters
  const filteredEmployees = useMemo(() => {
    return allEmployees.filter((emp: any) => {
      // 1. Text Search
      if (searchText.trim()) {
        const q = searchText.toLowerCase().trim();
        const matchName = emp.name.toLowerCase().includes(q);
        const matchNo = (emp.employee_no ?? "").toLowerCase().includes(q);
        const matchProject = emp.visits?.some((v: any) =>
          (v.project_name || v.location_name || "").toLowerCase().includes(q),
        );
        if (!matchName && !matchNo && !matchProject) return false;
      }

      // 2. Department Filter
      if (selectedDepartment && emp.department !== selectedDepartment) {
        return false;
      }

      // 3. Status Filter
      if (statusFilter === "SIGNAL_LOST") {
        if (emp.tracking?.signal_status !== "SIGNAL_LOST") return false;
      } else if (statusFilter === "FLAGGED") {
        if (!(Number(emp.flagged_count) > 0)) return false;
      } else if (statusFilter !== "ALL") {
        const trackingStatus = emp.tracking?.status ?? emp.tracking_status;
        if (trackingStatus !== statusFilter) return false;
      }

      return true;
    });
  }, [allEmployees, searchText, statusFilter, selectedDepartment]);

  const summary = observerData?.summary ?? {
    total_visits: 0,
    in_transit: 0,
    at_site: 0,
    completed: 0,
    signal_lost: 0,
    flagged: 0,
  };

  const selectEmployee = (emp: any) => {
    setSelectedEmployee(emp);
    if (emp.visits && emp.visits.length > 0) {
      setSelectedVisit(emp.visits[0]);
    } else {
      setSelectedVisit(null);
    }
  };
  const clearSelection = () => {
    setSelectedEmployee(null);
    setSelectedVisit(null);
  };

  const selectedBg = theme.primary + "1A";

  const renderEmployeeCard = (emp: any) => {
    const isSelected = (selectedEmployee as any)?.employee_id === emp.employee_id;
    const trackingStatus = emp.tracking?.status ?? emp.tracking_status;
    const statusColor =
      trackingStatus === "IN_TRANSIT" ? "#6366F1" : trackingStatus === "AT_SITE" ? "#10B981" : "#6B7280";
    const visitCount = emp.visits?.length ?? 0;
    const currentVisit = emp.visits?.[0];
    const place = currentVisit ? currentVisit.project_name || currentVisit.location_name : null;
    return (
      <TouchableOpacity
        key={`emp-${emp.employee_id}`}
        style={[
          s.empCard,
          { backgroundColor: theme.backgroundDefault, borderColor: theme.border },
          isSelected && { borderColor: theme.primary, backgroundColor: selectedBg },
        ]}
        onPress={() => {
          selectEmployee(emp);
          // On phones the map sits above the list: bring it into view.
          if (!isDesktop) mobileListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }}
        accessibilityRole="button"
        accessibilityLabel={`Show ${toTitleCase(emp.name)} on the map`}
      >
        <View style={s.empCardRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText style={[s.empCardName, isSelected && { color: theme.primary }]} numberOfLines={1}>
              {toTitleCase(emp.name)}
            </ThemedText>
            <ThemedText style={[s.empCardMeta, { color: theme.textSecondary }]} numberOfLines={1}>
              {[emp.employee_no, emp.department || "No Dept"].filter(Boolean).join(" · ")} · {visitCount} visit
              {visitCount !== 1 ? "s" : ""}
            </ThemedText>
            {place ? (
              <ThemedText style={[s.empCardMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                📍 {place}
              </ThemedText>
            ) : null}
          </View>
          {trackingStatus ? (
            <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
              <ThemedText style={[s.statusBadgeText, { color: statusColor }]} numberOfLines={1}>
                {String(trackingStatus).replace("_", " ")}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const header = (
    <View style={[s.headerBar, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
      <View style={s.headerTitleRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText type={isDesktop ? "h3" : "h4"} numberOfLines={1}>Site Visit Observer</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
            Date: {selectedDate}
          </ThemedText>
        </View>
        <View style={s.headerBadges}>
          <View
            style={[
              s.modeBadge,
              { backgroundColor: isLiveMode ? theme.successBg : theme.backgroundSecondary },
            ]}
          >
            <View style={[s.dot, { backgroundColor: isLiveMode ? "#10B981" : "#6B7280" }]} />
            <ThemedText
              style={[s.modeText, { color: isLiveMode ? theme.successText : theme.textSecondary }]}
              numberOfLines={1}
            >
              {isLiveMode ? (isDesktop ? "LIVE REALTIME" : "LIVE") : "HISTORICAL"}
            </ThemedText>
          </View>
          <TouchableOpacity
            style={s.refreshHit}
            onPress={() => void loadObserverData(selectedDate)}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Refresh"
          >
            <View style={[s.refreshBtn, { backgroundColor: theme.primary || "#7C3AED" }]}>
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="refresh-cw" size={15} color="#fff" />
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Date Quick Switcher */}
      <View style={s.dateSwitcherRow}>
        {[
          { key: "today", label: "Today", active: selectedDate === todayStr, date: () => todayStr },
          {
            key: "yesterday",
            label: "Yesterday",
            active: selectedDate !== todayStr,
            date: () => addBusinessDays(getBusinessDateIST(), -1),
          },
        ].map((d) => (
          <TouchableOpacity
            key={d.key}
            style={[
              s.dateBtn,
              { backgroundColor: d.active ? theme.primary : theme.backgroundSecondary },
            ]}
            onPress={() => {
              setSelectedDate(d.date());
              clearSelection();
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: d.active }}
          >
            <ThemedText style={[s.dateBtnText, { color: d.active ? "#fff" : theme.textSecondary }]}>
              {d.label}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const filters = (
    <>
      {/* Summary KPI Cards */}
      <ObserverSummaryCards
        summary={summary}
        selectedFilter={statusFilter}
        onSelectFilter={setStatusFilter}
      />

      {/* Filter Controls Bar */}
      <ObserverFilterBar
        searchText={searchText}
        onSearchChange={setSearchText}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        departments={departments}
        selectedDepartment={selectedDepartment}
        onDepartmentChange={setSelectedDepartment}
      />
    </>
  );

  const map = (
    <SiteVisitObserverMap
      employees={filteredEmployees}
      selectedEmployee={selectedEmployee}
      selectedVisit={selectedVisit}
      onSelectEmployee={(emp: any) => selectEmployee(emp)}
      polylineCoords={polylineCoords}
      breadcrumbs={cleanedBreadcrumbs}
      isPlaying={isPlaying}
      activePlaybackPoint={activePlaybackPoint}
      playbackIndex={playbackIndex}
      playbackSpeed={playbackSpeed}
      playbackProgress={playbackProgress}
      elapsedTimeStr={elapsedTimeStr}
      totalTimeStr={totalTimeStr}
      onTogglePlay={togglePlay}
      onRestart={restart}
      onSetSpeed={setPlaybackSpeed}
      onScrub={scrubToProgress}
    />
  );

  const emptyList = (
    <View style={s.emptyState}>
      <Feather name="users" size={26} color={theme.textTertiary} />
      <ThemedText style={{ color: theme.textSecondary, textAlign: "center", marginTop: 8 }}>
        {loading
          ? "Loading field employees…"
          : allEmployees.length
            ? "No employee matches the current search / filters."
            : "No field employees for this date."}
      </ThemedText>
    </View>
  );

  // ── Phones / small screens: vertical stack ─────────────────────────────────
  if (!isDesktop) {
    return (
      <ThemedView style={s.container}>
        <FlatList
          ref={mobileListRef}
          data={selectedEmployee ? [] : filteredEmployees}
          keyExtractor={(e: any) => e.employee_id}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: Spacing.xl }}
          ListHeaderComponent={
            <View>
              {header}
              {filters}
              <View style={[s.mobileMap, { height: mobileMapHeight, borderColor: theme.border }]}>
                {map}
              </View>
              {selectedEmployee ? (
                <View style={s.mobileSectionHead}>
                  <TouchableOpacity
                    style={[s.backBtn, { borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
                    onPress={clearSelection}
                    accessibilityRole="button"
                  >
                    <Feather name="arrow-left" size={16} color={theme.primary} />
                    <ThemedText style={[s.backBtnText, { color: theme.primary }]}>
                      All employees ({filteredEmployees.length})
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={s.mobileSectionHead}>
                  <ThemedText style={[s.panelTitle, { color: theme.textSecondary }]}>
                    ACTIVE FIELD EMPLOYEES ({filteredEmployees.length})
                  </ThemedText>
                </View>
              )}
            </View>
          }
          renderItem={({ item }: any) => <View style={s.mobileCardWrap}>{renderEmployeeCard(item)}</View>}
          ListEmptyComponent={selectedEmployee ? null : emptyList}
          ListFooterComponent={
            selectedEmployee ? (
              <View style={[s.mobileDrawer, { borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}>
                <ObserverDetailDrawer
                  embedded
                  employee={selectedEmployee}
                  selectedVisit={selectedVisit}
                  onSelectVisit={setSelectedVisit}
                  onClose={clearSelection}
                  routeQuality={routeQuality}
                  onReviewed={() => void loadObserverData(selectedDate, true)}
                />
              </View>
            ) : null
          }
        />
      </ThemedView>
    );
  }

  // ── Desktop / tablets: map left, list or details right ─────────────────────
  return (
    <ThemedView style={s.container}>
      {header}
      {filters}

      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ flex: 0.6, position: "relative" }}>{map}</View>

        <View style={{ flex: 0.4, minWidth: 320, borderLeftWidth: 1, borderColor: theme.border, backgroundColor: theme.backgroundDefault }}>
          {selectedEmployee ? (
            <ObserverDetailDrawer
              employee={selectedEmployee}
              selectedVisit={selectedVisit}
              onSelectVisit={setSelectedVisit}
              onClose={clearSelection}
              routeQuality={routeQuality}
              onReviewed={() => void loadObserverData(selectedDate, true)}
            />
          ) : (
            <View style={{ flex: 1 }}>
              <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <ThemedText type="h3">Active Field Employees</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {filteredEmployees.length} matching result{filteredEmployees.length !== 1 ? "s" : ""}
                </ThemedText>
              </View>
              <FlatList
                data={filteredEmployees}
                keyExtractor={(e: any) => e.employee_id}
                contentContainerStyle={{ padding: 16, gap: 12 }}
                ListEmptyComponent={emptyList}
                renderItem={({ item }: any) => renderEmployeeCard(item)}
              />
            </View>
          )}
        </View>
      </View>
    </ThemedView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerBar: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    gap: 8,
  },
  headerTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  headerBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  modeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  modeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  refreshHit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dateSwitcherRow: {
    flexDirection: "row",
    gap: 8,
  },
  dateBtn: {
    paddingHorizontal: 16,
    minHeight: 40,
    justifyContent: "center",
    borderRadius: BorderRadius.md,
  },
  dateBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  panelTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  mobileMap: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  mobileSectionHead: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  mobileCardWrap: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  mobileDrawer: {
    marginHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  backBtnText: { fontSize: 14, fontWeight: "700" },
  empCard: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: BorderRadius.md, borderWidth: 1, minHeight: 56 },
  empCardRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  empCardName: { fontWeight: "700", fontSize: 15 },
  empCardMeta: { fontSize: 13, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, maxWidth: 110, flexShrink: 0 },
  statusBadgeText: { fontSize: 11, fontWeight: "800" },
  emptyState: { alignItems: "center", justifyContent: "center", padding: Spacing.xl },
});

export default function SiteVisitObserverScreen() {
  return (
    <ModuleErrorBoundary moduleName="Site Visit Observer">
      <SiteVisitObserverScreenContent />
    </ModuleErrorBoundary>
  );
}
