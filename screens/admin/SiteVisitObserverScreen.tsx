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

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import SiteVisitObserverMap from "@/components/SiteVisitObserverMap";
import ObserverSummaryCards from "@/components/observer/ObserverSummaryCards";
import ObserverFilterBar from "@/components/observer/ObserverFilterBar";
import ObserverDetailDrawer from "@/components/observer/ObserverDetailDrawer";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
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

function getTodayISTString(): string {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 3600000 * 5.5);
  return ist.toISOString().split("T")[0];
}

export default function SiteVisitObserverScreen() {
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
  const loadObserverData = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_site_visit_observer_data", {
        p_date: date,
      });
      if (error) throw error;
      if (data?.error === "PERMISSION_DENIED") {
        Alert.alert("Access Denied", "You do not have permission to view Site Visit Observer.");
        return;
      }
      setObserverData(data as SiteVisitObserverData);
    } catch (err: any) {
      console.error("[SiteVisitObserver] load error:", err);
      Alert.alert("Error", err?.message || "Failed to load observer data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadObserverData(selectedDate);
  }, [selectedDate, loadObserverData]);

  // Realtime subscription in live mode (selective updates without full-page re-fetch)
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

          setObserverData((prev) => {
            if (!prev || !prev.employees) return prev;

            const nextEmployees = prev.employees.map((emp) => {
              if (emp.employee_id === updated.user_id) {
                const recordedTime = new Date(updated.recorded_at || updated.updated_at).getTime();
                const nowTime = Date.now();
                const ageMinutes = (nowTime - recordedTime) / 60000;

                let signalStatus: "LIVE" | "DELAYED" | "SIGNAL_LOST" = "LIVE";
                if (ageMinutes > 5) signalStatus = "SIGNAL_LOST";
                else if (ageMinutes > 2) signalStatus = "DELAYED";

                const newTracking = {
                  ...emp.tracking,
                  status: updated.tracking_status || emp.tracking?.status || "AT_SITE",
                  signal_status: signalStatus,
                  latitude: updated.latitude,
                  longitude: updated.longitude,
                  accuracy: updated.accuracy_m,
                  battery_level: updated.battery_level,
                  speed_mps: updated.speed_mps,
                  updated_at: updated.recorded_at || updated.updated_at,
                };

                return {
                  ...emp,
                  tracking: newTracking,
                  latest_lat: updated.latitude,
                  latest_lon: updated.longitude,
                  tracking_status: updated.tracking_status,
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

  const allEmployees = observerData?.employees ?? [];

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
    return allEmployees.filter((emp) => {
      // 1. Text Search
      if (searchText.trim()) {
        const q = searchText.toLowerCase().trim();
        const matchName = emp.name.toLowerCase().includes(q);
        const matchNo = (emp.employee_no ?? "").toLowerCase().includes(q);
        const matchProject = emp.visits?.some((v) =>
          (v.project_name || v.location_name || "").toLowerCase().includes(q),
        );
        if (!matchName && !matchNo && !matchProject) return false;
      }

      // 2. Department Filter
      if (selectedDepartment && emp.department !== selectedDepartment) {
        return false;
      }

      // 3. Status Filter
      if (statusFilter !== "ALL") {
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
  };

  return (
    <ThemedView style={s.container}>
      {/* Top Header Bar */}
      <View style={[s.headerBar, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
        <View style={s.headerTitleRow}>
          <View>
            <ThemedText type="h3">Site Visit Observer</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Date: {selectedDate}
            </ThemedText>
          </View>
          <View style={s.headerBadges}>
            <View style={[s.modeBadge, isLiveMode ? s.liveBadge : s.historicalBadge]}>
              <View style={[s.dot, { backgroundColor: isLiveMode ? "#10B981" : "#6B7280" }]} />
              <ThemedText style={s.modeText}>{isLiveMode ? "LIVE REALTIME" : "HISTORICAL"}</ThemedText>
            </View>
            <TouchableOpacity
              style={[s.refreshBtn, { backgroundColor: theme.primary || "#7C3AED" }]}
              onPress={() => void loadObserverData(selectedDate)}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="refresh-cw" size={14} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Date Quick Switcher */}
        <View style={s.dateSwitcherRow}>
          <TouchableOpacity
            style={[s.dateBtn, selectedDate === todayStr && s.activeDateBtn]}
            onPress={() => {
              setSelectedDate(todayStr);
              setSelectedEmployee(null);
              setSelectedVisit(null);
            }}
          >
            <ThemedText style={[s.dateBtnText, selectedDate === todayStr && s.activeDateBtnText]}>
              Today
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.dateBtn, selectedDate !== todayStr && s.activeDateBtn]}
            onPress={() => {
              const y = new Date();
              y.setDate(y.getDate() - 1);
              const yStr = y.toISOString().split("T")[0];
              setSelectedDate(yStr);
              setSelectedEmployee(null);
              setSelectedVisit(null);
            }}
          >
            <ThemedText style={[s.dateBtnText, selectedDate !== todayStr && s.activeDateBtnText]}>
              Yesterday
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>

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

      {/* Map View */}
      <SiteVisitObserverMap
        employees={filteredEmployees}
        selectedEmployee={selectedEmployee}
        selectedVisit={selectedVisit}
        onSelectEmployee={(emp) => {
          setSelectedEmployee(emp);
          if (emp.visits && emp.visits.length > 0) {
            setSelectedVisit(emp.visits[0]);
          } else {
            setSelectedVisit(null);
          }
        }}
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

      {/* Bottom Panel: Detail Drawer if an employee is selected, else Horizontal Employee Chip selector */}
      {selectedEmployee ? (
        <ObserverDetailDrawer
          employee={selectedEmployee}
          selectedVisit={selectedVisit}
          onSelectVisit={setSelectedVisit}
          onClose={() => {
            setSelectedEmployee(null);
            setSelectedVisit(null);
          }}
          routeQuality={routeQuality}
        />
      ) : (
        <View style={[s.bottomPanel, { backgroundColor: theme.backgroundDefault, borderTopColor: theme.border }]}>
          <ThemedText type="caption" style={[s.panelTitle, { color: theme.textSecondary }]}>
            ACTIVE FIELD EMPLOYEES ({filteredEmployees.length})
          </ThemedText>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.employeeScroll}>
            {filteredEmployees.map((emp) => {
              const isSelected = selectedEmployee?.employee_id === emp.employee_id;
              return (
                <TouchableOpacity
                  key={`tab-${emp.employee_id}`}
                  style={[
                    s.employeeChip,
                    { backgroundColor: theme.backgroundRoot, borderColor: theme.border },
                    isSelected && { borderColor: theme.primary, backgroundColor: "#F3E8FF" },
                  ]}
                  onPress={() => {
                    setSelectedEmployee(emp);
                    if (emp.visits && emp.visits.length > 0) {
                      setSelectedVisit(emp.visits[0]);
                    } else {
                      setSelectedVisit(null);
                    }
                  }}
                >
                  <ThemedText style={[s.empChipName, isSelected && { color: theme.primary }]}>
                    {toTitleCase(emp.name)}
                  </ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {emp.visits?.length ?? 0} visit{emp.visits?.length !== 1 ? "s" : ""}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </ThemedView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerBar: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    gap: 8,
  },
  headerTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    gap: 6,
  },
  liveBadge: { backgroundColor: "#DCFCE7" },
  historicalBadge: { backgroundColor: "#F3F4F6" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  modeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  refreshBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dateSwitcherRow: {
    flexDirection: "row",
    gap: 8,
  },
  dateBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: BorderRadius.md,
    backgroundColor: "#F3F4F6",
  },
  activeDateBtn: {
    backgroundColor: "#7C3AED",
  },
  dateBtnText: {
    fontSize: 12,
    color: "#4B5563",
    fontWeight: "600",
  },
  activeDateBtnText: {
    color: "#fff",
  },
  bottomPanel: {
    maxHeight: 120,
    padding: Spacing.md,
    borderTopWidth: 1,
  },
  panelTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  employeeScroll: {
    flexGrow: 0,
    marginBottom: 8,
  },
  employeeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginRight: 8,
  },
  empChipName: {
    fontSize: 13,
    fontWeight: "700",
  },
});
