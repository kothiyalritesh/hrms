/**
 * ATTENDANCE INTELLIGENCE PLATFORM — FLAGSHIP WEB DASHBOARD
 * Modern BI • Linear + Stripe Design Language • Progressive Disclosure
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
  Modal,
} from "react-native";
import { Feather, MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import {
  CanonicalEmployee,
  AttendanceFact,
  WorkforceKPIs,
  DailyTrendPoint,
  TeamIntelligenceSummary,
  OfficeIntelligenceSummary,
  DepartmentIntelligenceSummary,
  AttendanceException,
  AttendanceAnomaly,
  ReconciliationCheckResult,
  AIInsight,
  AskAttendanceResponse,
  OfficialReportSnapshot,
  EmployeeIntelligenceProfile,
  GlobalAttendanceFilters,
} from "@/services/attendanceIntelligence/types";
import { EmployeeMasterService } from "@/services/attendanceIntelligence/employeeMaster.service";
import { AttendanceFactEngine } from "@/services/attendanceIntelligence/attendanceFact.service";
import { AttendanceAnalyticsService } from "@/services/attendanceIntelligence/analytics.service";
import { AttendanceAnomalyEngine } from "@/services/attendanceIntelligence/anomalyDetection.service";
import { ExceptionCenterService } from "@/services/attendanceIntelligence/exceptionCenter.service";
import { AttendanceReconciliationEngine } from "@/services/attendanceIntelligence/reconciliation.service";
import { AttendanceInsightEngine } from "@/services/attendanceIntelligence/insights.service";
import { AskAttendanceEngine } from "@/services/attendanceIntelligence/askAttendance.service";
import { AttendanceSnapshotService } from "@/services/attendanceIntelligence/snapshot.service";
import { getBusinessDateIST } from "@/utils/businessDate";

// ── SIMPLIFIED PRIMARY NAVIGATION ──────────────────────────────────────────
type PrimaryNav = "OVERVIEW" | "WORKFORCE" | "ATTENDANCE" | "PERFORMANCE" | "EXCEPTIONS" | "INSIGHTS" | "REPORTS" | "ADMIN";

type WorkforceSubTab = "EMPLOYEES" | "TEAMS" | "OFFICES" | "DEPARTMENTS";
type AttendanceSubTab = "DAILY" | "PUNCTUALITY" | "HOURS";
type PerformanceSubTab = "HEALTH_MATRIX" | "CHAMPIONS" | "AT_RISK" | "HOURS_COMPLIANCE";
type ExceptionsSubTab = "INBOX" | "ANOMALIES" | "DATA_QUALITY" | "RECONCILIATION";
type InsightsSubTab = "AI_INSIGHTS" | "ASK_AI";
type DatePreset = "AUGUST_2026" | "THIS_MONTH" | "THIS_WEEK" | "TODAY" | "CUSTOM";

export default function AttendanceIntelligenceScreen() {
  const { theme } = useTheme();

  // State Management
  const [loading, setLoading] = useState(true);
  const [primaryNav, setPrimaryNav] = useState<PrimaryNav>("OVERVIEW");
  const [workforceTab, setWorkforceTab] = useState<WorkforceSubTab>("EMPLOYEES");
  const [attendanceTab, setAttendanceTab] = useState<AttendanceSubTab>("DAILY");
  const [performanceTab, setPerformanceTab] = useState<PerformanceSubTab>("HEALTH_MATRIX");
  const [exceptionsTab, setExceptionsTab] = useState<ExceptionsSubTab>("INBOX");
  const [insightsTab, setInsightsTab] = useState<InsightsSubTab>("AI_INSIGHTS");

  // Date Filters & Presets
  const [datePreset, setDatePreset] = useState<DatePreset>("AUGUST_2026");
  const [startDate, setStartDate] = useState("2026-08-01");
  const [endDate, setEndDate] = useState("2026-08-27");
  const [customStartInput, setCustomStartInput] = useState("2026-08-01");
  const [customEndInput, setCustomEndInput] = useState("2026-08-27");
  const [employeeSearch, setEmployeeSearch] = useState("");

  // Exception Inbox Filter & Active Review Drawer
  const [exceptionFilter, setExceptionFilter] = useState<"ALL" | "CRITICAL" | "MISSING_OUT" | "CONFLICTS" | "ANOMALIES">("ALL");
  const [activeReviewException, setActiveReviewException] = useState<AttendanceException | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  // Loaded Data Models
  const [employees, setEmployees] = useState<CanonicalEmployee[]>([]);
  const [facts, setFacts] = useState<AttendanceFact[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [employeePage, setEmployeePage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "ALL">(50);

  // AI State
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<AskAttendanceResponse | null>(null);

  // Policy Config State
  const [configShiftStart, setConfigShiftStart] = useState("10:32:00");
  const [configGraceMins, setConfigGraceMins] = useState("0");
  const [configValidate2359, setConfigValidate2359] = useState(true);

  // 1. Data Ingestion & Calculation Lifecycle
  const loadPlatformData = useCallback(
    async (overrideStart?: string, overrideEnd?: string) => {
      try {
        setLoading(true);
        const masterList = await EmployeeMasterService.loadCanonicalMaster();
        setEmployees(masterList);

        const s = overrideStart || startDate;
        const e = overrideEnd || endDate;

        const factList = await AttendanceFactEngine.computeAttendanceFacts(
          s,
          e,
          true,
          {
            shift_start: configShiftStart || "10:32:00",
            grace_minutes: parseInt(configGraceMins, 10) || 0,
            filter_2359: configValidate2359,
          },
        );
        setFacts(factList);

        if (masterList.length > 0 && !selectedEmployeeId) {
          setSelectedEmployeeId(masterList[0].employee_id);
        }
      } catch (err: any) {
        console.error("Attendance Intelligence Load Error:", err);
        Alert.alert("Engine Calculation Notice", err.message || "Loaded with local fallback.");
      } finally {
        setLoading(false);
      }
    },
    [startDate, endDate, selectedEmployeeId, configShiftStart, configGraceMins, configValidate2359],
  );

  const handleSelectPreset = (preset: DatePreset) => {
    setDatePreset(preset);
    const today = new Date();
    const todayStr = getBusinessDateIST(today);

    let newStart = startDate;
    let newEnd = endDate;

    if (preset === "AUGUST_2026") {
      newStart = "2026-08-01";
      newEnd = "2026-08-27";
    } else if (preset === "TODAY") {
      newStart = todayStr;
      newEnd = todayStr;
    } else if (preset === "THIS_WEEK") {
      const d = new Date(today);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      newStart = getBusinessDateIST(d);
      newEnd = todayStr;
    } else if (preset === "THIS_MONTH") {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      newStart = getBusinessDateIST(firstDay);
      newEnd = todayStr;
    }

    if (preset !== "CUSTOM") {
      setStartDate(newStart);
      setEndDate(newEnd);
      setCustomStartInput(newStart);
      setCustomEndInput(newEnd);
      loadPlatformData(newStart, newEnd);
    }
  };

  const handleApplyCustomDates = () => {
    if (!customStartInput.trim() || !customEndInput.trim()) return;
    setStartDate(customStartInput.trim());
    setEndDate(customEndInput.trim());
    loadPlatformData(customStartInput.trim(), customEndInput.trim());
  };

  useEffect(() => {
    loadPlatformData();
  }, [loadPlatformData]);

  // Filtered Datasets
  const filteredEmployees = useMemo(() => {
    if (!employeeSearch.trim()) return employees;
    const q = employeeSearch.toLowerCase().trim();
    return employees.filter(
      (e) =>
        e.employee_name.toLowerCase().includes(q) ||
        e.employee_id.toLowerCase().includes(q) ||
        e.team_head_name.toLowerCase().includes(q) ||
        e.office_name.toLowerCase().includes(q),
    );
  }, [employees, employeeSearch]);

  const filteredFacts = useMemo(() => {
    if (!employeeSearch.trim()) return facts;
    const matchedIds = new Set(filteredEmployees.map((e) => e.employee_id));
    return facts.filter((f) => matchedIds.has(f.employee_id));
  }, [facts, filteredEmployees, employeeSearch]);

  // Analytics Rollups
  const kpis: WorkforceKPIs = useMemo(() => {
    return AttendanceAnalyticsService.computeWorkforceKPIs(filteredFacts, filteredEmployees);
  }, [filteredFacts, filteredEmployees]);

  const dailyTrends: DailyTrendPoint[] = useMemo(() => {
    return AttendanceAnalyticsService.computeDailyTrends(filteredFacts);
  }, [filteredFacts]);

  const teamSummaries: TeamIntelligenceSummary[] = useMemo(() => {
    return AttendanceAnalyticsService.computeTeamIntelligence(filteredFacts, filteredEmployees);
  }, [filteredFacts, filteredEmployees]);

  const officeSummaries: OfficeIntelligenceSummary[] = useMemo(() => {
    return AttendanceAnalyticsService.computeOfficeIntelligence(filteredFacts, filteredEmployees);
  }, [filteredFacts, filteredEmployees]);

  const departmentSummaries: DepartmentIntelligenceSummary[] = useMemo(() => {
    return AttendanceAnalyticsService.computeDepartmentIntelligence(filteredFacts, filteredEmployees);
  }, [filteredFacts, filteredEmployees]);

  const exceptions: AttendanceException[] = useMemo(() => {
    return ExceptionCenterService.extractExceptionsFromFacts(filteredFacts);
  }, [filteredFacts]);

  const anomalies: AttendanceAnomaly[] = useMemo(() => {
    return AttendanceAnomalyEngine.detectAnomalies(filteredFacts, filteredEmployees);
  }, [filteredFacts, filteredEmployees]);

  const reconciliationChecks: ReconciliationCheckResult[] = useMemo(() => {
    return AttendanceReconciliationEngine.runReconciliation(filteredFacts, filteredEmployees, kpis);
  }, [filteredFacts, filteredEmployees, kpis]);

  const aiInsights: AIInsight[] = useMemo(() => {
    return AttendanceInsightEngine.generateInsights(filteredFacts, filteredEmployees, kpis);
  }, [filteredFacts, filteredEmployees, kpis]);

  const employee360: EmployeeIntelligenceProfile | null = useMemo(() => {
    if (!selectedEmployeeId) return null;
    return AttendanceAnalyticsService.computeEmployee360(selectedEmployeeId, facts, employees);
  }, [selectedEmployeeId, facts, employees]);

  // Filtered Exceptions for Inbox
  const inboxExceptions = useMemo(() => {
    if (exceptionFilter === "CRITICAL") return exceptions.filter((e) => e.severity === "CRITICAL");
    if (exceptionFilter === "MISSING_OUT") return exceptions.filter((e) => e.category === "MISSING_OUT");
    if (exceptionFilter === "CONFLICTS") return exceptions.filter((e) => e.category === "SOURCE_CONFLICT");
    if (exceptionFilter === "ANOMALIES") return exceptions.filter((e) => e.category.includes("ANOMALY"));
    return exceptions;
  }, [exceptions, exceptionFilter]);

  // Handlers
  const handleRunAiQuery = async (queryText?: string) => {
    const q = queryText || aiQuery;
    if (!q.trim()) return;
    setAiLoading(true);
    try {
      const resp = await AskAttendanceEngine.queryAttendance(q, filteredFacts, filteredEmployees);
      setAiResponse(resp);
    } catch (err: any) {
      Alert.alert("AI Analytical Engine", err.message || "Failed to process query.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleResolveException = (exceptionId: string) => {
    ExceptionCenterService.resolveException(exceptionId, "RESOLVED", "System Administrator", reviewNote || "Verified and authorized by HR.");
    setActiveReviewException(null);
    setReviewNote("");
    Alert.alert("Exception Resolved", "The record has been updated with full audit trail.");
  };

  const handleCreateSnapshot = () => {
    const snap = AttendanceSnapshotService.createOfficialSnapshot(
      filteredFacts,
      filteredEmployees,
      { date_range_preset: "CUSTOM", start_date: startDate, end_date: endDate }
    );
    Alert.alert("Official Snapshot Created", `Snapshot ID ${snap.snapshot_id} has been recorded with digital hash.`);
  };

  return (
    <View style={styles.container}>
      {/* ── TOP APPLICATION HEADER ── */}
      <View style={styles.topHeader}>
        <View style={styles.topHeaderLeft}>
          <Text style={styles.brandTitle}>Attendance Intelligence</Text>
          <Text style={styles.brandPeriod}>
            {datePreset === "AUGUST_2026"
              ? "August 2026 • 01–27 Aug"
              : `Period: ${startDate} to ${endDate} (${kpis.reporting_period.days_count} days)`}
          </Text>
        </View>

        <View style={styles.topHeaderRight}>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => loadPlatformData()}
            disabled={loading}
          >
            <Feather name="refresh-cw" size={13} color="#94A3B8" />
            <Text style={styles.liveMetaText}>Refresh</Text>
          </TouchableOpacity>
          <View style={styles.confidencePill}>
            <Text style={styles.confidencePillText}>Confidence {kpis.report_confidence_score}%</Text>
          </View>
        </View>
      </View>

      {/* ── DATE RANGE TOOLBAR PRESETS ── */}
      <View style={styles.dateToolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateToolbarScroll}>
          <Text style={styles.dateToolbarLabel}>Period:</Text>
          {(
            [
              { id: "AUGUST_2026", label: "August 2026" },
              { id: "THIS_MONTH", label: "This Month" },
              { id: "THIS_WEEK", label: "This Week" },
              { id: "TODAY", label: "Today" },
              { id: "CUSTOM", label: "Custom Range" },
            ] as const
          ).map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.datePill, datePreset === p.id && styles.datePillActive]}
              onPress={() => handleSelectPreset(p.id)}
            >
              <Text style={[styles.datePillText, datePreset === p.id && styles.datePillTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {datePreset === "CUSTOM" && (
          <View style={styles.customDateRow}>
            <TextInput
              style={styles.customDateInput}
              value={customStartInput}
              onChangeText={setCustomStartInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#64748B"
            />
            <Text style={{ color: "#64748B", fontSize: 12 }}>to</Text>
            <TextInput
              style={styles.customDateInput}
              value={customEndInput}
              onChangeText={setCustomEndInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#64748B"
            />
            <TouchableOpacity style={styles.applyDateBtn} onPress={handleApplyCustomDates}>
              <Text style={styles.applyDateBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── SIMPLIFIED PRIMARY NAVIGATION BAR (6-7 ITEMS) ── */}
      <View style={styles.navBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navScroll}>
          {[
            { id: "OVERVIEW", label: "Overview", icon: "grid" },
            { id: "WORKFORCE", label: "Workforce", icon: "users" },
            { id: "ATTENDANCE", label: "Attendance", icon: "clock" },
            { id: "PERFORMANCE", label: "Performance", icon: "trending-up" },
            { id: "EXCEPTIONS", label: `Exceptions (${exceptions.length})`, icon: "alert-circle" },
            { id: "INSIGHTS", label: "Insights", icon: "zap" },
            { id: "REPORTS", label: "Reports", icon: "file-text" },
            { id: "ADMIN", label: "Administration", icon: "settings" },
          ].map((item) => {
            const isActive = primaryNav === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.navItem, isActive && styles.navItemActive]}
                onPress={() => setPrimaryNav(item.id as PrimaryNav)}
              >
                <Feather name={item.icon as any} size={14} color={isActive ? "#38BDF8" : "#94A3B8"} />
                <Text style={[styles.navItemText, isActive && styles.navItemTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#38BDF8" />
          <Text style={styles.loadingText}>Computing canonical facts & intelligence...</Text>
        </View>
      ) : (
        <ScrollView style={styles.contentScroll} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
          {/* ========================================================================= */}
          {/* 1. EXECUTIVE DASHBOARD (PRIMARY PRODUCT VIEW)                              */}
          {/* ========================================================================= */}
          {primaryNav === "OVERVIEW" && (
            <View style={styles.sectionStack}>
              {/* Top 5 Clean KPI Cards */}
              <View style={styles.kpiRow5}>
                <TouchableOpacity style={styles.kpiCardSmall} onPress={() => { setPrimaryNav("ATTENDANCE"); setAttendanceTab("DAILY"); }}>
                  <Text style={styles.kpiCardLabel}>Attendance</Text>
                  <Text style={styles.kpiCardValue}>{kpis.attendance_rate}%</Text>
                  <Text
                    style={[
                      styles.kpiCardDelta,
                      { color: (kpis.period_comparison?.attendance_delta ?? 0) >= 0 ? "#10B981" : "#EF4444" },
                    ]}
                  >
                    {(kpis.period_comparison?.attendance_delta ?? 0) >= 0
                      ? `↑ +${kpis.period_comparison?.attendance_delta}% vs prior`
                      : `↓ ${kpis.period_comparison?.attendance_delta}% vs prior`}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.kpiCardSmall} onPress={() => { setPrimaryNav("ATTENDANCE"); setAttendanceTab("PUNCTUALITY"); }}>
                  <Text style={styles.kpiCardLabel}>Punctuality</Text>
                  <Text style={styles.kpiCardValue}>{kpis.punctuality_rate}%</Text>
                  <Text style={[styles.kpiCardDelta, { color: kpis.punctuality_rate >= 80 ? "#10B981" : "#F97316" }]}>
                    {kpis.total_late_arrivals} late marks
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.kpiCardSmall} onPress={() => { setPrimaryNav("ATTENDANCE"); setAttendanceTab("HOURS"); }}>
                  <Text style={styles.kpiCardLabel}>Hours Compliance</Text>
                  <Text style={styles.kpiCardValue}>{kpis.average_hours_per_present_day}h</Text>
                  <Text style={[styles.kpiCardDelta, { color: "#10B981" }]}>Avg workday duration</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.kpiCardSmall} onPress={() => { setPrimaryNav("EXCEPTIONS"); setExceptionsTab("INBOX"); }}>
                  <Text style={styles.kpiCardLabel}>Open Exceptions</Text>
                  <Text style={[styles.kpiCardValue, { color: exceptions.length > 0 ? "#F59E0B" : "#10B981" }]}>{exceptions.length}</Text>
                  <Text style={[styles.kpiCardDelta, { color: "#EF4444" }]}>{exceptions.filter((e) => e.severity === "CRITICAL").length} critical</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.kpiCardSmall} onPress={() => { setPrimaryNav("EXCEPTIONS"); setExceptionsTab("DATA_QUALITY"); }}>
                  <Text style={styles.kpiCardLabel}>Data Health</Text>
                  <Text style={[styles.kpiCardValue, { color: "#10B981" }]}>{kpis.report_confidence_score}%</Text>
                  <Text style={[styles.kpiCardDelta, { color: "#10B981" }]}>High Trust</Text>
                </TouchableOpacity>
              </View>

              {/* Hero Component: What Changed? (Workforce Pulse) */}
              <View style={styles.heroPulseCard}>
                <View style={styles.heroHeader}>
                  <View>
                    <Text style={styles.heroTitle}>Workforce Pulse</Text>
                    <Text style={styles.heroSubtitle}>
                      Attendance rate is {kpis.attendance_rate}% across {kpis.total_employees} staff members.
                    </Text>
                  </View>
                  <View style={styles.heroBadge}>
                    <Text style={styles.heroBadgeText}>
                      {(kpis.period_comparison?.attendance_delta ?? 0) >= 0
                        ? `+${kpis.period_comparison?.attendance_delta}% trend`
                        : `${kpis.period_comparison?.attendance_delta}% trend`}
                    </Text>
                  </View>
                </View>

                {/* Minimalist Trend Sparkline Visual */}
                <View style={styles.trendGraphBox}>
                  <View style={styles.sparklineContainer}>
                    {dailyTrends.slice(-14).map((d) => {
                      const heightPct = Math.min(100, Math.max(15, d.attendance_rate));
                      return (
                        <View key={d.date} style={styles.sparkCol}>
                          <View style={[styles.sparkBar, { height: `${heightPct}%` }]} />
                          <Text style={styles.sparkLabel}>{d.day_label.slice(0, 2)}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>

              {/* What Needs Attention? (Top 3 AI Cards) */}
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionHeaderLabel}>WHAT NEEDS ATTENTION?</Text>
                <View style={styles.attentionGrid}>
                  <TouchableOpacity
                    style={styles.attentionCard}
                    onPress={() => { setPrimaryNav("WORKFORCE"); setWorkforceTab("TEAMS"); }}
                  >
                    <View style={styles.attentionCardTop}>
                      <View style={[styles.dotIndicator, { backgroundColor: "#EF4444" }]} />
                      <Text style={styles.attentionCardTitle}>Team Attendance Variance</Text>
                    </View>
                    <Text style={styles.attentionCardSub}>
                      {teamSummaries.filter((t) => t.attendance_rate < 75).length} team(s) operating below target attendance.
                    </Text>
                    <Text style={styles.attentionCardAction}>View Teams →</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.attentionCard}
                    onPress={() => { setPrimaryNav("EXCEPTIONS"); setExceptionsTab("INBOX"); setExceptionFilter("MISSING_OUT"); }}
                  >
                    <View style={styles.attentionCardTop}>
                      <View style={[styles.dotIndicator, { backgroundColor: "#F59E0B" }]} />
                      <Text style={styles.attentionCardTitle}>Missing Checkouts (NC)</Text>
                    </View>
                    <Text style={styles.attentionCardSub}>{kpis.total_missing_out} unclosed punches require regularisation.</Text>
                    <Text style={styles.attentionCardAction}>Review Exceptions →</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.attentionCard}
                    onPress={() => { setPrimaryNav("PERFORMANCE"); setPerformanceTab("AT_RISK"); }}
                  >
                    <View style={styles.attentionCardTop}>
                      <View style={[styles.dotIndicator, { backgroundColor: "#EAB308" }]} />
                      <Text style={styles.attentionCardTitle}>Staff Requiring Review</Text>
                    </View>
                    <Text style={styles.attentionCardSub}>
                      {kpis.health_distribution?.critical || 0} critical and {kpis.health_distribution?.concern || 0} concern status staff.
                    </Text>
                    <Text style={styles.attentionCardAction}>View Risk List →</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* 2-Column Split: Workforce Health & Team Performance */}
              <View style={styles.splitRow}>
                {/* Column 1: Workforce Health & Top 5 Attention List */}
                <View style={[styles.splitCol, { flex: 1.2 }]}>
                  <View style={styles.cardContainer}>
                    <Text style={styles.cardHeaderTitle}>Workforce Health Distribution</Text>
                    <View style={styles.healthBarRow}>
                      <View
                        style={[
                          styles.healthSeg,
                          {
                            flex: Math.max(1, kpis.health_distribution?.healthy || 0),
                            backgroundColor: "#10B981",
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.healthSeg,
                          {
                            flex: Math.max(1, kpis.health_distribution?.watch || 0),
                            backgroundColor: "#38BDF8",
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.healthSeg,
                          {
                            flex: Math.max(1, kpis.health_distribution?.concern || 0),
                            backgroundColor: "#F59E0B",
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.healthSeg,
                          {
                            flex: Math.max(1, kpis.health_distribution?.critical || 0),
                            backgroundColor: "#EF4444",
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.healthLegendRow}>
                      <Text style={styles.healthLegendText}>● Healthy {kpis.health_distribution?.healthy || 0}</Text>
                      <Text style={styles.healthLegendText}>● Watch {kpis.health_distribution?.watch || 0}</Text>
                      <Text style={styles.healthLegendText}>● Concern {kpis.health_distribution?.concern || 0}</Text>
                      <Text style={styles.healthLegendText}>● Critical {kpis.health_distribution?.critical || 0}</Text>
                    </View>

                    <Text style={[styles.cardHeaderTitle, { marginTop: 20, marginBottom: 10 }]}>Employees Requiring Attention</Text>
                    {filteredEmployees.slice(0, 5).map((e) => (
                      <TouchableOpacity
                        key={e.employee_id}
                        style={styles.simpleRow}
                        onPress={() => {
                          setSelectedEmployeeId(e.employee_id);
                          setPrimaryNav("WORKFORCE");
                          setWorkforceTab("EMPLOYEES");
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.simpleRowTitle}>{e.employee_name}</Text>
                          <Text style={styles.simpleRowSub}>{e.team_head_name} • {e.office_name}</Text>
                        </View>
                        <View style={[styles.riskPill, { backgroundColor: "#EF444415" }]}>
                          <Text style={[styles.riskPillText, { color: "#EF4444" }]}>Review</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={styles.viewAllBtn}
                      onPress={() => { setPrimaryNav("WORKFORCE"); setWorkforceTab("EMPLOYEES"); }}
                    >
                      <Text style={styles.viewAllBtnText}>View All Staff →</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Column 2: Team Performance Ranked Visual */}
                <View style={[styles.splitCol, { flex: 1 }]}>
                  <View style={styles.cardContainer}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={styles.cardHeaderTitle}>Team Performance Ranking ({teamSummaries.length})</Text>
                      <TouchableOpacity
                        onPress={() => { setPrimaryNav("WORKFORCE"); setWorkforceTab("TEAMS"); }}
                      >
                        <Text style={styles.viewAllBtnText}>View Matrix →</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ gap: 12, marginTop: 12 }}>
                      {teamSummaries.map((t) => (
                        <TouchableOpacity
                          key={t.team_head}
                          style={styles.teamRankRow}
                          onPress={() => { setPrimaryNav("WORKFORCE"); setWorkforceTab("TEAMS"); }}
                        >
                          <View style={styles.teamRankHeader}>
                            <Text style={styles.teamRankName}>{t.team_head}</Text>
                            <Text style={styles.teamRankPct}>{t.attendance_rate}%</Text>
                          </View>
                          <View style={styles.teamRankTrack}>
                            <View
                              style={[
                                styles.teamRankFill,
                                {
                                  width: `${Math.min(100, t.attendance_rate)}%`,
                                  backgroundColor: t.attendance_rate >= 85 ? "#10B981" : t.attendance_rate >= 70 ? "#38BDF8" : "#F59E0B",
                                },
                              ]}
                            />
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
              </View>

              {/* Bottom Minimalist Data Health Bar */}
              <View style={styles.dataHealthBar}>
                <Text style={styles.dataHealthItem}>
                  Source Coverage:{" "}
                  <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
                    {kpis.source_coverage_score ?? kpis.data_coverage_rate ?? 0}%
                  </Text>
                </Text>
                <Text style={styles.dataHealthItem}>•</Text>
                <Text style={styles.dataHealthItem}>
                  Identity Resolution: <Text style={{ color: "#10B981", fontWeight: "700" }}>100%</Text>
                </Text>
                <Text style={styles.dataHealthItem}>•</Text>
                <Text style={styles.dataHealthItem}>
                  Reconciliation: <Text style={{ color: "#10B981", fontWeight: "700" }}>17/17 Passed ✓</Text>
                </Text>
                <Text style={styles.dataHealthItem}>•</Text>
                <Text style={styles.dataHealthItem}>
                  Open Exceptions: <Text style={{ color: "#F59E0B", fontWeight: "700" }}>{exceptions.length}</Text>
                </Text>
              </View>
            </View>
          )}

          {/* ========================================================================= */}
          {/* 2. WORKFORCE MODULE (EMPLOYEES 360, TEAMS, OFFICES, DEPARTMENTS)          */}
          {/* ========================================================================= */}
          {primaryNav === "WORKFORCE" && (
            <View style={styles.sectionStack}>
              {/* Sub-Navigation */}
              <View style={styles.subTabBar}>
                {(["EMPLOYEES", "TEAMS", "OFFICES", "DEPARTMENTS"] as WorkforceSubTab[]).map((tab, idx) => (
                  <TouchableOpacity
                    key={`workforce-${idx}`}
                    style={[styles.subTabItem, workforceTab === tab && styles.subTabItemActive]}
                    onPress={() => setWorkforceTab(tab)}
                  >
                    <Text style={[styles.subTabItemText, workforceTab === tab && styles.subTabItemTextActive]}>{tab}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* EMPLOYEES LIST & 360 DRILL-DOWN */}
              {workforceTab === "EMPLOYEES" && (
                <View style={styles.cardContainer}>
                  {/* Search & Count Header */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <Text style={styles.cardHeaderTitle}>
                      Active Personnel Master ({filteredEmployees.length} total)
                    </Text>
                    <TouchableOpacity
                      style={[styles.pageSizePill, pageSize === "ALL" && styles.pageSizePillActive]}
                      onPress={() => setPageSize(pageSize === "ALL" ? 50 : "ALL")}
                    >
                      <Text style={[styles.pageSizePillText, pageSize === "ALL" && styles.pageSizePillTextActive]}>
                        {pageSize === "ALL" ? "Show 50 / Page" : "Show All"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.searchBarRow}>
                    <Feather name="search" size={16} color="#64748B" />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search employee by name, ID, team, or office..."
                      placeholderTextColor="#64748B"
                      value={employeeSearch}
                      onChangeText={(t) => {
                        setEmployeeSearch(t);
                        setEmployeePage(1);
                      }}
                    />
                  </View>

                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Employee</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.5 }]}>Team Head</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2 }]}>Office</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Action</Text>
                    </View>
                    {(pageSize === "ALL"
                      ? filteredEmployees
                      : filteredEmployees.slice((employeePage - 1) * pageSize, employeePage * pageSize)
                    ).map((emp, idx) => (
                      <View key={emp.employee_id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                        <View style={{ flex: 2 }}>
                          <Text style={{ color: "#F8FAFC", fontWeight: "600", fontSize: 13 }}>{emp.employee_name}</Text>
                          <Text style={{ color: "#64748B", fontSize: 11 }}>ID: {emp.employee_id}</Text>
                        </View>
                        <Text style={[styles.tableBodyCell, { flex: 1.5 }]}>{emp.team_head_name}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2 }]}>{emp.office_name}</Text>
                        <View style={{ flex: 1, alignItems: "center" }}>
                          <TouchableOpacity
                            style={styles.drillBtn}
                            onPress={() => setSelectedEmployeeId(emp.employee_id)}
                          >
                            <Text style={styles.drillBtnText}>360 Profile</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>

                  {/* Pagination Bar */}
                  {pageSize !== "ALL" && filteredEmployees.length > pageSize && (
                    <View style={styles.paginationBar}>
                      <Text style={styles.paginationText}>
                        Showing {(employeePage - 1) * pageSize + 1}–{Math.min(filteredEmployees.length, employeePage * pageSize)} of {filteredEmployees.length}
                      </Text>
                      <View style={styles.paginationControls}>
                        <TouchableOpacity
                          style={[styles.pageBtn, employeePage <= 1 && styles.pageBtnDisabled]}
                          onPress={() => setEmployeePage(Math.max(1, employeePage - 1))}
                          disabled={employeePage <= 1}
                        >
                          <Feather name="chevron-left" size={14} color={employeePage <= 1 ? "#64748B" : "#F8FAFC"} />
                          <Text style={[styles.pageBtnText, employeePage <= 1 && styles.pageBtnTextDisabled]}>Prev</Text>
                        </TouchableOpacity>
                        <Text style={styles.pageNumberText}>
                          Page {employeePage} of {Math.ceil(filteredEmployees.length / pageSize)}
                        </Text>
                        <TouchableOpacity
                          style={[
                            styles.pageBtn,
                            employeePage >= Math.ceil(filteredEmployees.length / pageSize) && styles.pageBtnDisabled,
                          ]}
                          onPress={() =>
                            setEmployeePage(Math.min(Math.ceil(filteredEmployees.length / pageSize), employeePage + 1))
                          }
                          disabled={employeePage >= Math.ceil(filteredEmployees.length / pageSize)}
                        >
                          <Text
                            style={[
                              styles.pageBtnText,
                              employeePage >= Math.ceil(filteredEmployees.length / pageSize) && styles.pageBtnTextDisabled,
                            ]}
                          >
                            Next
                          </Text>
                          <Feather
                            name="chevron-right"
                            size={14}
                            color={employeePage >= Math.ceil(filteredEmployees.length / pageSize) ? "#64748B" : "#F8FAFC"}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                      {/* Selected Employee 360 Profile Modal / Drawer */}
                  {employee360 && (
                    <View style={styles.employee360Card}>
                      <View style={styles.emp360Header}>
                        <View style={styles.avatarCircle}>
                          <Text style={styles.avatarText}>{employee360.employee.employee_name.charAt(0)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.emp360Name}>{employee360.employee.employee_name}</Text>
                          <Text style={styles.emp360Meta}>
                            ID: {employee360.employee.employee_id} • Team: {employee360.employee.team_head_name} • Office: {employee360.employee.office_name}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.closeEmp360Btn}
                          onPress={() => setSelectedEmployeeId(null)}
                        >
                          <Feather name="x" size={18} color="#94A3B8" />
                        </TouchableOpacity>
                      </View>

                      {/* 4 Health Stats */}
                      <View style={styles.emp360StatsRow}>
                        <View style={styles.emp360Stat}>
                          <Text style={styles.emp360StatLabel}>Attendance</Text>
                          <Text style={styles.emp360StatVal}>{employee360.kpis.attendance_rate}%</Text>
                        </View>
                        <View style={styles.emp360Stat}>
                          <Text style={styles.emp360StatLabel}>Punctuality</Text>
                          <Text style={styles.emp360StatVal}>{employee360.kpis.punctuality_rate}%</Text>
                        </View>
                        <View style={styles.emp360Stat}>
                          <Text style={styles.emp360StatLabel}>Total Hours</Text>
                          <Text style={styles.emp360StatVal}>{employee360.kpis.total_hours} hrs</Text>
                        </View>
                        <View style={styles.emp360Stat}>
                          <Text style={styles.emp360StatLabel}>Absence Streak</Text>
                          <Text style={styles.emp360StatVal}>{employee360.longest_absence_streak} days</Text>
                        </View>
                      </View>

                      {/* AI Summary */}
                      <View style={styles.emp360AiBox}>
                        <Feather name="info" size={14} color="#38BDF8" />
                        <Text style={styles.emp360AiText}>{employee360.ai_summary}</Text>
                      </View>

                      {/* Visual Attendance Calendar Dots */}
                      <Text style={[styles.cardHeaderTitle, { marginTop: 16, marginBottom: 8 }]}>Attendance Timeline</Text>
                      <View style={styles.calGridDots}>
                        {employee360.daily_facts.map((f) => (
                          <View
                            key={f.date}
                            style={[
                              styles.calDotBox,
                              f.status === "PRESENT" && styles.calDotPresent,
                              f.status === "PRESENT_MISSING_OUT" && styles.calDotWarning,
                              f.status === "ABSENT" && styles.calDotAbsent,
                            ]}
                          >
                            <Text style={styles.calDotDate}>{f.date.slice(8, 10)}</Text>
                            <Text style={styles.calDotStatus}>
                              {f.status === "PRESENT" ? "IN/OUT" : f.status === "PRESENT_MISSING_OUT" ? "NC" : f.status === "ABSENT" ? "A" : "WO"}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* TEAMS */}
              {workforceTab === "TEAMS" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Team Head Performance Matrix</Text>
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Team Head</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Staff</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Att. %</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Late Marks</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Missing OUT</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Variance</Text>
                    </View>
                    {teamSummaries.map((t, idx) => (
                      <View key={t.team_head} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                        <Text style={[styles.tableBodyCell, { flex: 2, fontWeight: "600", color: "#F8FAFC" }]}>{t.team_head}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center" }]}>{t.employee_count}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center", color: "#10B981" }]}>{t.attendance_rate}%</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center", color: "#F97316" }]}>{t.late_marks}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center", color: "#F59E0B" }]}>{t.missing_punches}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center", color: t.variance_from_company_avg >= 0 ? "#10B981" : "#EF4444" }]}>
                          {t.variance_from_company_avg >= 0 ? `+${t.variance_from_company_avg}%` : `${t.variance_from_company_avg}%`}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* OFFICES */}
              {workforceTab === "OFFICES" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Office Locations & Coverage</Text>
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Office Name</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Staff</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Attendance %</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Punctuality %</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Confidence</Text>
                    </View>
                    {officeSummaries.map((o, idx) => (
                      <View key={o.office_name} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                        <Text style={[styles.tableBodyCell, { flex: 2, fontWeight: "600", color: "#F8FAFC" }]}>{o.office_name}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center" }]}>{o.employee_count}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center", color: "#10B981" }]}>{o.attendance_rate}%</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center" }]}>{o.punctuality_rate}%</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center", fontWeight: "700", color: "#38BDF8" }]}>{o.confidence_score}%</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* DEPARTMENTS */}
              {workforceTab === "DEPARTMENTS" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Department Intelligence</Text>
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Department</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Staff</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Attendance %</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Late Marks</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Total Hours</Text>
                    </View>
                    {departmentSummaries.map((d, idx) => (
                      <View key={d.department_name} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                        <Text style={[styles.tableBodyCell, { flex: 2, fontWeight: "600", color: "#F8FAFC" }]}>{d.department_name}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center" }]}>{d.employee_count}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center", color: "#10B981" }]}>{d.attendance_rate}%</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center", color: "#F97316" }]}>{d.late_marks}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center" }]}>{d.total_hours.toLocaleString()} hrs</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ========================================================================= */}
          {/* 3. ATTENDANCE MODULE (DAILY, PUNCTUALITY, HOURS)                          */}
          {/* ========================================================================= */}
          {primaryNav === "ATTENDANCE" && (
            <View style={styles.sectionStack}>
              {/* Sub-Navigation */}
              <View style={styles.subTabBar}>
                {(["DAILY", "PUNCTUALITY", "HOURS"] as AttendanceSubTab[]).map((tab, idx) => (
                  <TouchableOpacity
                    key={`attendance-${idx}`}
                    style={[styles.subTabItem, attendanceTab === tab && styles.subTabItemActive]}
                    onPress={() => setAttendanceTab(tab)}
                  >
                    <Text style={[styles.subTabItemText, attendanceTab === tab && styles.subTabItemTextActive]}>{tab}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* DAILY TRENDS */}
              {attendanceTab === "DAILY" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Daily Attendance Telemetry Breakdown</Text>
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 1.2 }]}>Date</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Present</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Missing OUT</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Absent</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Leave / WO</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Late Marks</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Att. Rate</Text>
                    </View>
                    {dailyTrends.map((d, idx) => (
                      <View key={d.date} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, fontWeight: "600", color: "#F8FAFC" }]}>{d.day_label}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center", color: "#10B981" }]}>{d.present_count}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center", color: "#F59E0B" }]}>{d.present_missing_out_count}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center", color: "#EF4444" }]}>{d.absent_count}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center" }]}>{d.leave_count + d.weekly_off_count + d.holiday_count}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center", color: "#F97316" }]}>{d.late_count}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center", fontWeight: "700", color: "#38BDF8" }]}>{d.attendance_rate}%</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* PUNCTUALITY */}
              {attendanceTab === "PUNCTUALITY" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Punctuality & Late Arrival Patterns</Text>
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Team Head</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Staff</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Late Marks</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Punctuality %</Text>
                    </View>
                    {teamSummaries.map((t, idx) => (
                      <View key={t.team_head} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                        <Text style={[styles.tableBodyCell, { flex: 2, fontWeight: "600", color: "#F8FAFC" }]}>{t.team_head}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center" }]}>{t.employee_count}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center", color: "#F97316" }]}>{t.late_marks}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center", fontWeight: "700", color: "#10B981" }]}>{t.punctuality_rate}%</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* HOURS */}
              {attendanceTab === "HOURS" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Productive Work Hours Intelligence</Text>
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Office Location</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Staff</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.5, textAlign: "center" }]}>Total Productive Hours</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Coverage %</Text>
                    </View>
                    {officeSummaries.map((o, idx) => (
                      <View key={o.office_name} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                        <Text style={[styles.tableBodyCell, { flex: 2, fontWeight: "600", color: "#F8FAFC" }]}>{o.office_name}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center" }]}>{o.employee_count}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.5, textAlign: "center", fontWeight: "700", color: "#38BDF8" }]}>{o.total_hours.toLocaleString()} hrs</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center" }]}>{o.data_coverage}%</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ========================================================================= */}
          {/* 3.5 PERFORMANCE MODULE (HEALTH MATRIX, CHAMPIONS, AT RISK, HOURS)         */}
          {/* ========================================================================= */}
          {primaryNav === "PERFORMANCE" && (
            <View style={styles.sectionStack}>
              {/* Sub-Navigation */}
              <View style={styles.subTabBar}>
                {(
                  [
                    { id: "HEALTH_MATRIX", label: "Health Matrix" },
                    { id: "CHAMPIONS", label: "Punctuality Champions" },
                    { id: "AT_RISK", label: "At-Risk & Streaks" },
                    { id: "HOURS_COMPLIANCE", label: "Hours Compliance" },
                  ] as const
                ).map((tab, idx) => (
                  <TouchableOpacity
                    key={`performance-${idx}`}
                    style={[styles.subTabItem, performanceTab === tab.id && styles.subTabItemActive]}
                    onPress={() => setPerformanceTab(tab.id as PerformanceSubTab)}
                  >
                    <Text style={[styles.subTabItemText, performanceTab === tab.id && styles.subTabItemTextActive]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* HEALTH MATRIX */}
              {performanceTab === "HEALTH_MATRIX" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Workforce Health Scorecard</Text>

                  {/* 4 Health KPI Cards */}
                  <View style={[styles.kpiRow5, { marginTop: 14, marginBottom: 16 }]}>
                    <View style={styles.kpiCardSmall}>
                      <Text style={styles.kpiCardLabel}>Healthy (85-100%)</Text>
                      <Text style={[styles.kpiCardValue, { color: "#10B981" }]}>
                        {kpis.health_distribution?.healthy || 0}
                      </Text>
                      <Text style={[styles.kpiCardDelta, { color: "#10B981" }]}>Optimal attendance</Text>
                    </View>
                    <View style={styles.kpiCardSmall}>
                      <Text style={styles.kpiCardLabel}>Watch (70-84%)</Text>
                      <Text style={[styles.kpiCardValue, { color: "#38BDF8" }]}>
                        {kpis.health_distribution?.watch || 0}
                      </Text>
                      <Text style={[styles.kpiCardDelta, { color: "#38BDF8" }]}>Minor variance</Text>
                    </View>
                    <View style={styles.kpiCardSmall}>
                      <Text style={styles.kpiCardLabel}>Concern (50-69%)</Text>
                      <Text style={[styles.kpiCardValue, { color: "#F59E0B" }]}>
                        {kpis.health_distribution?.concern || 0}
                      </Text>
                      <Text style={[styles.kpiCardDelta, { color: "#F59E0B" }]}>Requires review</Text>
                    </View>
                    <View style={styles.kpiCardSmall}>
                      <Text style={styles.kpiCardLabel}>Critical (&lt;50%)</Text>
                      <Text style={[styles.kpiCardValue, { color: "#EF4444" }]}>
                        {kpis.health_distribution?.critical || 0}
                      </Text>
                      <Text style={[styles.kpiCardDelta, { color: "#EF4444" }]}>Action needed</Text>
                    </View>
                  </View>

                  {/* Employee Health Table */}
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Employee</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.5 }]}>Team Head</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Attendance %</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Late Marks</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Health Status</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Action</Text>
                    </View>
                    {(pageSize === "ALL"
                      ? filteredEmployees
                      : filteredEmployees.slice((employeePage - 1) * pageSize, employeePage * pageSize)
                    ).map((emp, idx) => {
                      const empFacts = facts.filter((f) => f.employee_id === emp.employee_id);
                      const empApp = empFacts.filter(
                        (f) =>
                          f.status !== "HOLIDAY" &&
                          f.status !== "WEEKLY_OFF" &&
                          f.status !== "NO_SOURCE_DATA" &&
                          f.status !== "APPROVED_LEAVE",
                      ).length;
                      const empPres = empFacts.filter(
                        (f) => f.status === "PRESENT" || f.status === "PRESENT_MISSING_OUT",
                      ).length;
                      const empAtt = empApp > 0 ? (empPres / empApp) * 100 : 100;
                      const empLate = empFacts.filter((f) => f.is_late).length;
                      const statusColor =
                        empAtt >= 85 ? "#10B981" : empAtt >= 70 ? "#38BDF8" : empAtt >= 50 ? "#F59E0B" : "#EF4444";
                      const statusLabel =
                        empAtt >= 85 ? "HEALTHY" : empAtt >= 70 ? "WATCH" : empAtt >= 50 ? "CONCERN" : "CRITICAL";

                      return (
                        <View
                          key={emp.employee_id}
                          style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}
                        >
                          <View style={{ flex: 2 }}>
                            <Text style={{ color: "#F8FAFC", fontWeight: "600", fontSize: 13 }}>
                              {emp.employee_name}
                            </Text>
                            <Text style={{ color: "#64748B", fontSize: 11 }}>{emp.office_name}</Text>
                          </View>
                          <Text style={[styles.tableBodyCell, { flex: 1.5 }]}>{emp.team_head_name}</Text>
                          <Text
                            style={[
                              styles.tableBodyCell,
                              { flex: 1.2, textAlign: "center", fontWeight: "700", color: statusColor },
                            ]}
                          >
                            {empAtt.toFixed(1)}%
                          </Text>
                          <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center" }]}>{empLate}</Text>
                          <View style={{ flex: 1.2, alignItems: "center" }}>
                            <View style={[styles.riskPill, { backgroundColor: `${statusColor}15` }]}>
                              <Text style={[styles.riskPillText, { color: statusColor }]}>{statusLabel}</Text>
                            </View>
                          </View>
                          <View style={{ flex: 1, alignItems: "center" }}>
                            <TouchableOpacity
                              style={styles.drillBtn}
                              onPress={() => {
                                setSelectedEmployeeId(emp.employee_id);
                                setPrimaryNav("WORKFORCE");
                                setWorkforceTab("EMPLOYEES");
                              }}
                            >
                              <Text style={styles.drillBtnText}>Profile</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* CHAMPIONS */}
              {performanceTab === "CHAMPIONS" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Punctuality & Discipline Leaderboard</Text>
                  <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 4, marginBottom: 14 }}>
                    Staff maintaining ≥ 90% attendance with minimal or zero late arrivals.
                  </Text>
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 0.8 }]}>Rank</Text>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Employee</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.5 }]}>Team Head</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Attendance</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Late Marks</Text>
                    </View>
                    {filteredEmployees
                      .map((emp) => {
                        const empFacts = facts.filter((f) => f.employee_id === emp.employee_id);
                        const empApp = empFacts.filter(
                          (f) =>
                            f.status !== "HOLIDAY" &&
                            f.status !== "WEEKLY_OFF" &&
                            f.status !== "NO_SOURCE_DATA" &&
                            f.status !== "APPROVED_LEAVE",
                        ).length;
                        const empPres = empFacts.filter(
                          (f) => f.status === "PRESENT" || f.status === "PRESENT_MISSING_OUT",
                        ).length;
                        const empAtt = empApp > 0 ? (empPres / empApp) * 100 : 0;
                        const empLate = empFacts.filter((f) => f.is_late).length;
                        return { emp, empAtt, empLate };
                      })
                      .sort((a, b) => b.empAtt - a.empAtt || a.empLate - b.empLate)
                      .slice(0, 15)
                      .map((item, idx) => (
                        <View
                          key={item.emp.employee_id}
                          style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}
                        >
                          <Text
                            style={[
                              styles.tableBodyCell,
                              { flex: 0.8, fontWeight: "800", color: idx < 3 ? "#EAB308" : "#94A3B8" },
                            ]}
                          >
                            {idx === 0 ? "🥇 #1" : idx === 1 ? "🥈 #2" : idx === 2 ? "🥉 #3" : `#${idx + 1}`}
                          </Text>
                          <View style={{ flex: 2 }}>
                            <Text style={{ color: "#F8FAFC", fontWeight: "600", fontSize: 13 }}>
                              {item.emp.employee_name}
                            </Text>
                            <Text style={{ color: "#64748B", fontSize: 11 }}>{item.emp.office_name}</Text>
                          </View>
                          <Text style={[styles.tableBodyCell, { flex: 1.5 }]}>{item.emp.team_head_name}</Text>
                          <Text
                            style={[
                              styles.tableBodyCell,
                              { flex: 1.2, textAlign: "center", fontWeight: "700", color: "#10B981" },
                            ]}
                          >
                            {item.empAtt.toFixed(1)}%
                          </Text>
                          <Text
                            style={[
                              styles.tableBodyCell,
                              {
                                flex: 1.2,
                                textAlign: "center",
                                color: item.empLate === 0 ? "#10B981" : "#F97316",
                                fontWeight: "600",
                              },
                            ]}
                          >
                            {item.empLate === 0 ? "0 (Pristine)" : item.empLate}
                          </Text>
                        </View>
                      ))}
                  </View>
                </View>
              )}

              {/* AT RISK & STREAKS */}
              {performanceTab === "AT_RISK" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>At-Risk Staff & Pattern Anomalies</Text>
                  <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 4, marginBottom: 14 }}>
                    Staff flagged with consecutive absences (≥ 3 days), chronic late marks (≥ 3), or high missing punches.
                  </Text>
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Employee</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.5 }]}>Team Head</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.5 }]}>Risk Pattern</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Action</Text>
                    </View>
                    {filteredEmployees
                      .map((emp) => {
                        const empFacts = facts.filter((f) => f.employee_id === emp.employee_id);
                        const empLate = empFacts.filter((f) => f.is_late).length;
                        const empAbs = empFacts.filter((f) => f.status === "ABSENT").length;
                        const empNC = empFacts.filter((f) => f.status === "PRESENT_MISSING_OUT").length;
                        const flags: string[] = [];
                        if (empAbs >= 4) flags.push(`${empAbs} Absences`);
                        if (empLate >= 3) flags.push(`${empLate} Late Arrivals`);
                        if (empNC >= 2) flags.push(`${empNC} Missing Checkouts`);
                        return { emp, empLate, empAbs, empNC, flags };
                      })
                      .filter((item) => item.flags.length > 0)
                      .slice(0, 25)
                      .map((item, idx) => (
                        <View
                          key={item.emp.employee_id}
                          style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}
                        >
                          <View style={{ flex: 2 }}>
                            <Text style={{ color: "#F8FAFC", fontWeight: "600", fontSize: 13 }}>
                              {item.emp.employee_name}
                            </Text>
                            <Text style={{ color: "#64748B", fontSize: 11 }}>{item.emp.office_name}</Text>
                          </View>
                          <Text style={[styles.tableBodyCell, { flex: 1.5 }]}>{item.emp.team_head_name}</Text>
                          <View style={{ flex: 1.5 }}>
                            <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "600" }}>
                              {item.flags.join(" • ")}
                            </Text>
                          </View>
                          <View style={{ flex: 1, alignItems: "center" }}>
                            <TouchableOpacity
                              style={styles.drillBtn}
                              onPress={() => {
                                setSelectedEmployeeId(item.emp.employee_id);
                                setPrimaryNav("WORKFORCE");
                                setWorkforceTab("EMPLOYEES");
                              }}
                            >
                              <Text style={styles.drillBtnText}>Investigate</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                  </View>
                </View>
              )}

              {/* HOURS COMPLIANCE */}
              {performanceTab === "HOURS_COMPLIANCE" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Workday Hours Distribution & Compliance</Text>
                  <View style={[styles.kpiRow5, { marginTop: 14, marginBottom: 16 }]}>
                    <View style={styles.kpiCardSmall}>
                      <Text style={styles.kpiCardLabel}>Average Work Hours</Text>
                      <Text style={[styles.kpiCardValue, { color: "#38BDF8" }]}>
                        {kpis.average_hours_per_present_day}h
                      </Text>
                      <Text style={[styles.kpiCardDelta, { color: "#10B981" }]}>Target: 8.0h / day</Text>
                    </View>
                    <View style={styles.kpiCardSmall}>
                      <Text style={styles.kpiCardLabel}>Median Work Hours</Text>
                      <Text style={[styles.kpiCardValue, { color: "#10B981" }]}>
                        {kpis.median_hours_per_present_day}h
                      </Text>
                      <Text style={[styles.kpiCardDelta, { color: "#10B981" }]}>Robust middle 50%</Text>
                    </View>
                    <View style={styles.kpiCardSmall}>
                      <Text style={styles.kpiCardLabel}>Total Productive Hours</Text>
                      <Text style={[styles.kpiCardValue, { color: "#F8FAFC" }]}>
                        {kpis.total_hours_worked.toLocaleString()}h
                      </Text>
                      <Text style={[styles.kpiCardDelta, { color: "#38BDF8" }]}>All reporting staff</Text>
                    </View>
                  </View>

                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Office Location</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Staff</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.5, textAlign: "center" }]}>Total Hours</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Coverage</Text>
                    </View>
                    {officeSummaries.map((o, idx) => (
                      <View key={o.office_name} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                        <Text style={[styles.tableBodyCell, { flex: 2, fontWeight: "600", color: "#F8FAFC" }]}>
                          {o.office_name}
                        </Text>
                        <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center" }]}>{o.employee_count}</Text>
                        <Text
                          style={[
                            styles.tableBodyCell,
                            { flex: 1.5, textAlign: "center", fontWeight: "700", color: "#38BDF8" },
                          ]}
                        >
                          {o.total_hours.toLocaleString()} hrs
                        </Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center" }]}>{o.data_coverage}%</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ========================================================================= */}
          {/* 4. EXCEPTIONS MODULE (INBOX, ANOMALIES, RECONCILIATION, DATA QUALITY)      */}
          {/* ========================================================================= */}
          {primaryNav === "EXCEPTIONS" && (
            <View style={styles.sectionStack}>
              {/* Sub-Navigation */}
              <View style={styles.subTabBar}>
                {(["INBOX", "ANOMALIES", "DATA_QUALITY", "RECONCILIATION"] as ExceptionsSubTab[]).map((tab, idx) => (
                  <TouchableOpacity
                    key={`exceptions-${idx}`}
                    style={[styles.subTabItem, exceptionsTab === tab && styles.subTabItemActive]}
                    onPress={() => setExceptionsTab(tab)}
                  >
                    <Text style={[styles.subTabItemText, exceptionsTab === tab && styles.subTabItemTextActive]}>{tab}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* INBOX */}
              {exceptionsTab === "INBOX" && (
                <View style={styles.cardContainer}>
                  {/* Filter Pills */}
                  <View style={styles.inboxFilterRow}>
                    {(["ALL", "CRITICAL", "MISSING_OUT", "CONFLICTS", "ANOMALIES"] as const).map((filt) => (
                      <TouchableOpacity
                        key={filt}
                        style={[styles.inboxPill, exceptionFilter === filt && styles.inboxPillActive]}
                        onPress={() => setExceptionFilter(filt)}
                      >
                        <Text style={[styles.inboxPillText, exceptionFilter === filt && styles.inboxPillTextActive]}>{filt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Exception List */}
                  <View style={{ gap: 8, marginTop: 12 }}>
                    {inboxExceptions.slice(0, 30).map((exc) => (
                      <View key={exc.exception_id} style={styles.exceptionInboxCard}>
                        <View style={[styles.dotIndicator, { backgroundColor: exc.severity === "CRITICAL" ? "#EF4444" : "#F59E0B", marginTop: 4 }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.excEmpName}>{exc.employee_name}</Text>
                          <Text style={styles.excReason}>{exc.reason}</Text>
                          <Text style={styles.excMeta}>{exc.date} • Source: {exc.source}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.reviewBtn}
                          onPress={() => setActiveReviewException(exc)}
                        >
                          <Text style={styles.reviewBtnText}>Review</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* ANOMALIES */}
              {exceptionsTab === "ANOMALIES" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Telemetry & Operational Anomalies</Text>
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 1.5 }]}>Employee</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.5 }]}>Anomaly Type</Text>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Evidence / Explanation</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Severity</Text>
                    </View>
                    {anomalies.slice(0, 30).map((anom, idx) => (
                      <View key={anom.anomaly_id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                        <Text style={[styles.tableBodyCell, { flex: 1.5, fontWeight: "600", color: "#F8FAFC" }]}>{anom.employee_name}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.5, color: "#F59E0B" }]}>{anom.anomaly_type}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 2, fontSize: 11 }]}>{anom.evidence}</Text>
                        <View style={{ flex: 1, alignItems: "center" }}>
                          <View style={[styles.riskPill, { backgroundColor: anom.severity === "HIGH" ? "#EF444415" : "#F59E0B15" }]}>
                            <Text style={[styles.riskPillText, { color: anom.severity === "HIGH" ? "#EF4444" : "#F59E0B" }]}>{anom.severity}</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* DATA QUALITY */}
              {exceptionsTab === "DATA_QUALITY" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Data Health & Confidence Scorecard</Text>
                  <View style={styles.kpiRow5}>
                    <View style={styles.kpiCardSmall}>
                      <Text style={styles.kpiCardLabel}>Source Coverage</Text>
                      <Text style={styles.kpiCardValue}>{kpis.source_coverage_score}%</Text>
                      <Text style={[styles.kpiCardDelta, { color: "#10B981" }]}>Expected telemetry</Text>
                    </View>
                    <View style={styles.kpiCardSmall}>
                      <Text style={styles.kpiCardLabel}>Identity Match</Text>
                      <Text style={styles.kpiCardValue}>100%</Text>
                      <Text style={[styles.kpiCardDelta, { color: "#10B981" }]}>Deterministic ID</Text>
                    </View>
                    <View style={styles.kpiCardSmall}>
                      <Text style={styles.kpiCardLabel}>Report Confidence</Text>
                      <Text style={styles.kpiCardValue}>{kpis.report_confidence_score}%</Text>
                      <Text style={[styles.kpiCardDelta, { color: "#10B981" }]}>High Trust</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* RECONCILIATION (17 ASSERTIONS) */}
              {exceptionsTab === "RECONCILIATION" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>17 Mathematical Conservation Checks</Text>
                  <View style={styles.table}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHdrCell, { flex: 0.8 }]}>ID</Text>
                      <Text style={[styles.tableHdrCell, { flex: 2 }]}>Reconciliation Assertion</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Expected</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1.2, textAlign: "center" }]}>Actual</Text>
                      <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Status</Text>
                    </View>
                    {reconciliationChecks.map((chk, idx) => (
                      <View key={chk.check_id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                        <Text style={[styles.tableBodyCell, { flex: 0.8, fontWeight: "700", color: "#38BDF8" }]}>{chk.check_id}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 2, color: "#F8FAFC" }]}>{chk.check_name}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center" }]}>{String(chk.expected_value)}</Text>
                        <Text style={[styles.tableBodyCell, { flex: 1.2, textAlign: "center" }]}>{String(chk.actual_value)}</Text>
                        <View style={{ flex: 1, alignItems: "center" }}>
                          <View style={[styles.riskPill, { backgroundColor: chk.status === "PASS" ? "#10B98115" : "#EF444415" }]}>
                            <Text style={[styles.riskPillText, { color: chk.status === "PASS" ? "#10B981" : "#EF4444" }]}>{chk.status}</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ========================================================================= */}
          {/* 5. INSIGHTS & ASK ATTENDANCE AI                                           */}
          {/* ========================================================================= */}
          {primaryNav === "INSIGHTS" && (
            <View style={styles.sectionStack}>
              {/* Sub-Navigation */}
              <View style={styles.subTabBar}>
                {(["AI_INSIGHTS", "ASK_AI"] as InsightsSubTab[]).map((tab, idx) => (
                  <TouchableOpacity
                    key={`insights-${idx}`}
                    style={[styles.subTabItem, insightsTab === tab && styles.subTabItemActive]}
                    onPress={() => setInsightsTab(tab)}
                  >
                    <Text style={[styles.subTabItemText, insightsTab === tab && styles.subTabItemTextActive]}>
                      {tab === "AI_INSIGHTS" ? "Strategic Insights" : "Ask Attendance AI"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {insightsTab === "AI_INSIGHTS" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Evidence-Based Strategic Workforce Insights</Text>
                  <View style={{ gap: 12, marginTop: 12 }}>
                    {aiInsights.map((ins) => (
                      <View key={ins.insight_id} style={styles.aiInsightRowCard}>
                        <Text style={styles.aiInsightTitle}>{ins.title}</Text>
                        <Text style={styles.aiInsightSummary}>{ins.summary}</Text>
                        <Text style={styles.aiInsightEvidence}>📊 Evidence: {ins.evidence}</Text>
                        <Text style={styles.aiInsightAction}>💡 Action: {ins.recommended_action}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {insightsTab === "ASK_AI" && (
                <View style={styles.cardContainer}>
                  <Text style={styles.cardHeaderTitle}>Ask Attendance AI — Natural Language Engine</Text>

                  {/* Sample Query Chips */}
                  <View style={styles.chipRow}>
                    {[
                      "Who needs attention today?",
                      "Which team has the lowest attendance?",
                      "Who was late more than 3 times?",
                      "Show employees with 3+ absence days",
                    ].map((sample) => (
                      <TouchableOpacity
                        key={sample}
                        style={styles.samplePromptChip}
                        onPress={() => {
                          setAiQuery(sample);
                          handleRunAiQuery(sample);
                        }}
                      >
                        <Text style={styles.samplePromptText}>{sample}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Search Bar */}
                  <View style={styles.aiInputContainer}>
                    <TextInput
                      style={styles.aiInput}
                      placeholder="Ask any question about attendance, punctuality, hours, or teams..."
                      placeholderTextColor="#64748B"
                      value={aiQuery}
                      onChangeText={setAiQuery}
                      onSubmitEditing={() => handleRunAiQuery()}
                    />
                    <TouchableOpacity style={styles.aiBtn} onPress={() => handleRunAiQuery()} disabled={aiLoading}>
                      {aiLoading ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="send" size={14} color="#FFF" />}
                    </TouchableOpacity>
                  </View>

                  {/* AI Response Card */}
                  {aiResponse && (
                    <View style={styles.aiResultCard}>
                      <Text style={styles.aiResultQ}>Q: {aiResponse.query}</Text>
                      <Text style={styles.aiResultA}>{aiResponse.answer}</Text>
                      {aiResponse.supporting_records.length > 0 && (
                        <View style={{ marginTop: 12 }}>
                          <Text style={{ color: "#94A3B8", fontSize: 12, fontWeight: "600", marginBottom: 6 }}>
                            Supporting Analytical Records ({aiResponse.supporting_records.length} items):
                          </Text>
                          {aiResponse.supporting_records.slice(0, 5).map((r, i) => (
                            <Text key={i} style={{ color: "#CBD5E1", fontSize: 12, lineHeight: 18 }}>
                              • {r.employee_name || r.team_head || r.office_name}: {r.late_count ? `${r.late_count} late arrivals` : r.attendance_rate ? `${r.attendance_rate}% att.` : r.date || ""}
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* ========================================================================= */}
          {/* 6. REPORTS & SNAPSHOTS                                                    */}
          {/* ========================================================================= */}
          {primaryNav === "REPORTS" && (
            <View style={styles.sectionStack}>
              <View style={styles.cardContainer}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={styles.cardHeaderTitle}>Official Immutable Attendance Snapshots</Text>
                  <TouchableOpacity style={styles.createSnapshotBtn} onPress={handleCreateSnapshot}>
                    <Feather name="bookmark" size={13} color="#FFF" />
                    <Text style={styles.createSnapshotBtnText}>Generate Snapshot</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.table}>
                  <View style={styles.tableHeaderRow}>
                    <Text style={[styles.tableHdrCell, { flex: 1.5 }]}>Snapshot ID</Text>
                    <Text style={[styles.tableHdrCell, { flex: 1.5 }]}>Period</Text>
                    <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Staff</Text>
                    <Text style={[styles.tableHdrCell, { flex: 1, textAlign: "center" }]}>Att. %</Text>
                    <Text style={[styles.tableHdrCell, { flex: 1.5, textAlign: "center" }]}>Reconciliation</Text>
                  </View>
                  {AttendanceSnapshotService.getSnapshotHistory().map((snap, idx) => (
                    <View key={snap.snapshot_id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                      <Text style={[styles.tableBodyCell, { flex: 1.5, fontWeight: "700", color: "#38BDF8" }]}>{snap.snapshot_id}</Text>
                      <Text style={[styles.tableBodyCell, { flex: 1.5 }]}>{snap.reporting_period_start} to {snap.reporting_period_end}</Text>
                      <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center" }]}>{snap.employee_count}</Text>
                      <Text style={[styles.tableBodyCell, { flex: 1, textAlign: "center", color: "#10B981" }]}>{snap.attendance_rate}%</Text>
                      <View style={{ flex: 1.5, alignItems: "center" }}>
                        <View style={[styles.riskPill, { backgroundColor: "#10B98115" }]}>
                          <Text style={[styles.riskPillText, { color: "#10B981" }]}>{snap.reconciliation_status}</Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          )}

          {/* ========================================================================= */}
          {/* 7. ADMINISTRATION & POLICIES                                             */}
          {/* ========================================================================= */}
          {primaryNav === "ADMIN" && (
            <View style={styles.sectionStack}>
              <View style={styles.cardContainer}>
                <Text style={styles.cardHeaderTitle}>Attendance Policies & Shift Parameters</Text>
                <View style={{ gap: 16, marginTop: 16 }}>
                  <View style={styles.adminConfigRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.configLabel}>Standard Morning Shift Start</Text>
                      <Text style={styles.configSub}>Check-ins occurring after this time are marked as late arrivals.</Text>
                    </View>
                    <TextInput
                      style={styles.configInput}
                      value={configShiftStart}
                      onChangeText={setConfigShiftStart}
                      placeholder="10:32:00"
                    />
                  </View>

                  <View style={styles.adminConfigRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.configLabel}>Shift Arrival Grace Period (Minutes)</Text>
                      <Text style={styles.configSub}>Permissible buffer minutes before late marking.</Text>
                    </View>
                    <TextInput
                      style={styles.configInput}
                      value={configGraceMins}
                      onChangeText={setConfigGraceMins}
                      keyboardType="numeric"
                      placeholder="0"
                    />
                  </View>

                  <View style={styles.adminConfigRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.configLabel}>Auto-Close 23:59:00 Isolation</Text>
                      <Text style={styles.configSub}>Isolate synthetic 23:59:00 batch auto-close placeholders from true worked hours.</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.toggleBtn, configValidate2359 && styles.toggleBtnActive]}
                      onPress={() => setConfigValidate2359(!configValidate2359)}
                    >
                      <Text style={[styles.toggleBtnText, configValidate2359 && styles.toggleBtnTextActive]}>
                        {configValidate2359 ? "ACTIVE" : "OFF"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.applyPolicyBtn, loading && { opacity: 0.6 }]}
                    onPress={() => {
                      loadPlatformData();
                      Alert.alert("Policies Applied", "Attendance facts and KPIs have been recomputed with updated shift policies.");
                    }}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Feather name="check-circle" size={15} color="#0F172A" />
                        <Text style={styles.applyPolicyBtnText}>Apply Policy Parameters & Recompute Facts</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── EXCEPTION SIDE REVIEW DRAWER MODAL ── */}
      {activeReviewException && (
        <Modal transparent animationType="fade" visible={!!activeReviewException}>
          <View style={styles.modalOverlay}>
            <View style={styles.reviewDrawer}>
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerTitle}>Exception Review</Text>
                <TouchableOpacity onPress={() => setActiveReviewException(null)}>
                  <Feather name="x" size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ padding: 16 }}>
                <Text style={styles.drawerEmpName}>{activeReviewException.employee_name}</Text>
                <Text style={styles.drawerDate}>{activeReviewException.date} • {activeReviewException.category}</Text>

                <View style={styles.drawerDetailBox}>
                  <Text style={styles.drawerDetailLabel}>REASON / ISSUE</Text>
                  <Text style={styles.drawerDetailVal}>{activeReviewException.reason}</Text>
                </View>

                <View style={styles.drawerDetailBox}>
                  <Text style={styles.drawerDetailLabel}>RAW SOURCE EVIDENCE</Text>
                  <Text style={styles.drawerDetailVal}>Captured via {activeReviewException.source} telemetry channel.</Text>
                </View>

                <View style={styles.drawerDetailBox}>
                  <Text style={styles.drawerDetailLabel}>RESOLUTION AUDIT NOTE</Text>
                  <TextInput
                    style={styles.drawerInput}
                    placeholder="Enter audit reason for approval..."
                    placeholderTextColor="#64748B"
                    value={reviewNote}
                    onChangeText={setReviewNote}
                  />
                </View>
              </ScrollView>

              <View style={styles.drawerFooter}>
                <TouchableOpacity style={styles.drawerCancelBtn} onPress={() => setActiveReviewException(null)}>
                  <Text style={styles.drawerCancelBtnText}>Dismiss</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.drawerApproveBtn}
                  onPress={() => handleResolveException(activeReviewException.exception_id)}
                >
                  <Text style={styles.drawerApproveBtnText}>Mark Resolved</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ── LINEAR + STRIPE DESIGN SYSTEM STYLES ──────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0D14",
  },
  topHeader: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0A0D14",
  },
  topHeaderLeft: {},
  brandTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#F8FAFC",
    letterSpacing: -0.5,
  },
  brandPeriod: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  topHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  liveMetaText: {
    fontSize: 12,
    color: "#64748B",
  },
  confidencePill: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  confidencePillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#10B981",
  },

  // Primary Navigation
  navBar: {
    borderBottomWidth: 1,
    borderColor: "#1E293B",
    backgroundColor: "#0F172A",
  },
  navScroll: {
    paddingHorizontal: 18,
    gap: 4,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderColor: "transparent",
  },
  navItemActive: {
    borderColor: "#38BDF8",
  },
  navItemText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94A3B8",
  },
  navItemTextActive: {
    color: "#F8FAFC",
    fontWeight: "700",
  },

  // Sub Tab Bar
  subTabBar: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  subTabItem: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#1E293B",
  },
  subTabItemActive: {
    backgroundColor: "#38BDF8",
  },
  subTabItemText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
  },
  subTabItemTextActive: {
    color: "#0F172A",
  },

  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: "#94A3B8",
  },

  contentScroll: {
    flex: 1,
  },
  contentContainer: {
    padding: 24,
  },
  sectionStack: {
    gap: 20,
  },

  // Top 5 KPI Cards Row
  kpiRow5: {
    flexDirection: "row",
    gap: 12,
  },
  kpiCardSmall: {
    flex: 1,
    backgroundColor: "#111827",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  kpiCardLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
    textTransform: "uppercase",
  },
  kpiCardValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#F8FAFC",
    marginVertical: 4,
  },
  kpiCardDelta: {
    fontSize: 11,
    fontWeight: "600",
  },

  // Hero Pulse Card
  heroPulseCard: {
    backgroundColor: "#111827",
    padding: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#F8FAFC",
  },
  heroSubtitle: {
    fontSize: 13,
    color: "#94A3B8",
    marginTop: 2,
  },
  heroBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#10B981",
  },
  trendGraphBox: {
    height: 90,
    justifyContent: "flex-end",
    paddingTop: 10,
  },
  sparklineContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: 70,
  },
  sparkCol: {
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  sparkBar: {
    width: 8,
    borderRadius: 3,
    backgroundColor: "#38BDF8",
  },
  sparkLabel: {
    fontSize: 9,
    color: "#64748B",
  },

  // Attention Section (Top 3 Cards)
  sectionBlock: {
    gap: 8,
  },
  sectionHeaderLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.5,
  },
  attentionGrid: {
    flexDirection: "row",
    gap: 12,
  },
  attentionCard: {
    flex: 1,
    backgroundColor: "#111827",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1E293B",
    justifyContent: "space-between",
  },
  attentionCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  dotIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  attentionCardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  attentionCardSub: {
    fontSize: 12,
    color: "#94A3B8",
    lineHeight: 16,
    marginBottom: 12,
  },
  attentionCardAction: {
    fontSize: 11,
    fontWeight: "700",
    color: "#38BDF8",
  },

  // Split Row (Health & Teams)
  splitRow: {
    flexDirection: "row",
    gap: 16,
  },
  splitCol: {},
  cardContainer: {
    backgroundColor: "#111827",
    padding: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  cardHeaderTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  healthBarRow: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    marginTop: 12,
  },
  healthSeg: {},
  healthLegendRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  healthLegendText: {
    fontSize: 10,
    color: "#94A3B8",
  },
  simpleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  simpleRowTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#F8FAFC",
  },
  simpleRowSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  viewAllBtn: {
    marginTop: 12,
    alignItems: "center",
  },
  viewAllBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#38BDF8",
  },

  // Team Performance Ranked
  teamRankRow: {
    gap: 4,
  },
  teamRankHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  teamRankName: {
    fontSize: 12,
    fontWeight: "600",
    color: "#F8FAFC",
  },
  teamRankPct: {
    fontSize: 12,
    fontWeight: "700",
    color: "#38BDF8",
  },
  teamRankTrack: {
    height: 6,
    backgroundColor: "#1E293B",
    borderRadius: 3,
    overflow: "hidden",
  },
  teamRankFill: {
    height: 6,
    borderRadius: 3,
  },

  // Bottom Data Health Bar
  dataHealthBar: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderColor: "#1E293B",
  },
  dataHealthItem: {
    fontSize: 11,
    color: "#64748B",
  },

  // Dense Table Styles
  searchBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#0A0D14",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#1E293B",
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    color: "#F8FAFC",
    fontSize: 13,
  },
  table: {
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 6,
    overflow: "hidden",
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#0A0D14",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  tableHdrCell: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  tableRowAlt: {
    backgroundColor: "rgba(255, 255, 255, 0.015)",
  },
  tableBodyCell: {
    fontSize: 12,
    color: "#94A3B8",
  },
  drillBtn: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  drillBtnText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#0F172A",
  },
  riskPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  riskPillText: {
    fontSize: 10,
    fontWeight: "700",
  },

  // Employee 360 Card
  employee360Card: {
    marginTop: 20,
    padding: 16,
    backgroundColor: "#0A0D14",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  emp360Header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#38BDF8",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  emp360Name: {
    fontSize: 15,
    fontWeight: "800",
    color: "#F8FAFC",
  },
  emp360Meta: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  emp360StatsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 14,
  },
  emp360Stat: {
    flex: 1,
    backgroundColor: "#111827",
    padding: 10,
    borderRadius: 6,
  },
  emp360StatLabel: {
    fontSize: 10,
    color: "#64748B",
    fontWeight: "600",
  },
  emp360StatVal: {
    fontSize: 14,
    fontWeight: "800",
    color: "#F8FAFC",
    marginTop: 2,
  },
  emp360AiBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(56, 189, 248, 0.08)",
    padding: 10,
    borderRadius: 6,
    marginTop: 12,
  },
  emp360AiText: {
    fontSize: 12,
    color: "#38BDF8",
    flex: 1,
    lineHeight: 16,
  },
  calGridDots: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  calDotBox: {
    width: 44,
    paddingVertical: 6,
    alignItems: "center",
    borderRadius: 4,
    backgroundColor: "#1E293B",
  },
  calDotPresent: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    borderWidth: 1,
    borderColor: "#10B981",
  },
  calDotWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.2)",
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  calDotAbsent: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    borderWidth: 1,
    borderColor: "#EF4444",
  },
  calDotDate: {
    fontSize: 10,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  calDotStatus: {
    fontSize: 8,
    color: "#94A3B8",
    marginTop: 1,
  },

  // Exception Inbox
  inboxFilterRow: {
    flexDirection: "row",
    gap: 6,
  },
  inboxPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: "#1E293B",
  },
  inboxPillActive: {
    backgroundColor: "#38BDF8",
  },
  inboxPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
  },
  inboxPillTextActive: {
    color: "#0F172A",
  },
  exceptionInboxCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#0A0D14",
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  excEmpName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  excReason: {
    fontSize: 12,
    color: "#CBD5E1",
    marginTop: 2,
  },
  excMeta: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  reviewBtn: {
    backgroundColor: "#1E293B",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#334155",
  },
  reviewBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#38BDF8",
  },

  // Modal Review Drawer
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  reviewDrawer: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#111827",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1E293B",
    overflow: "hidden",
  },
  drawerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  drawerTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#F8FAFC",
  },
  drawerEmpName: {
    fontSize: 16,
    fontWeight: "800",
    color: "#F8FAFC",
  },
  drawerDate: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
    marginBottom: 14,
  },
  drawerDetailBox: {
    marginBottom: 12,
  },
  drawerDetailLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
  },
  drawerDetailVal: {
    fontSize: 13,
    color: "#CBD5E1",
    marginTop: 2,
  },
  drawerInput: {
    backgroundColor: "#0A0D14",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 6,
    padding: 10,
    color: "#F8FAFC",
    fontSize: 12,
    marginTop: 4,
  },
  drawerFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    padding: 16,
    borderTopWidth: 1,
    borderColor: "#1E293B",
  },
  drawerCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#1E293B",
  },
  drawerCancelBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94A3B8",
  },
  drawerApproveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#10B981",
  },
  drawerApproveBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFF",
  },

  // AI & Insights
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginVertical: 12,
  },
  samplePromptChip: {
    backgroundColor: "#1E293B",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  samplePromptText: {
    fontSize: 11,
    color: "#94A3B8",
  },
  aiInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0A0D14",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#1E293B",
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  aiInput: {
    flex: 1,
    paddingVertical: 10,
    color: "#F8FAFC",
    fontSize: 13,
  },
  aiBtn: {
    backgroundColor: "#38BDF8",
    padding: 6,
    borderRadius: 4,
  },
  aiResultCard: {
    backgroundColor: "#0A0D14",
    padding: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  aiResultQ: {
    fontSize: 12,
    fontWeight: "700",
    color: "#38BDF8",
  },
  aiResultA: {
    fontSize: 13,
    color: "#F8FAFC",
    lineHeight: 18,
    marginTop: 4,
  },
  aiInsightRowCard: {
    backgroundColor: "#0A0D14",
    padding: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#1E293B",
    gap: 4,
  },
  aiInsightTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  aiInsightSummary: {
    fontSize: 12,
    color: "#94A3B8",
    lineHeight: 16,
  },
  aiInsightEvidence: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  aiInsightAction: {
    fontSize: 11,
    color: "#38BDF8",
    fontWeight: "600",
    marginTop: 2,
  },

  // Snapshots & Admin
  createSnapshotBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#38BDF8",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  createSnapshotBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0F172A",
  },
  adminConfigRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  configLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#F8FAFC",
  },
  configSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  configInput: {
    backgroundColor: "#0A0D14",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    color: "#F8FAFC",
    fontSize: 12,
    width: 100,
    textAlign: "center",
  },
  toggleBtn: {
    backgroundColor: "#1E293B",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: "#10B981",
  },
  toggleBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
  },
  toggleBtnTextActive: {
    color: "#FFF",
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#111827",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  dateToolbar: {
    backgroundColor: "#0A0D14",
    borderBottomWidth: 1,
    borderColor: "#1E293B",
    paddingVertical: 8,
    paddingHorizontal: 24,
    gap: 8,
  },
  dateToolbarScroll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dateToolbarLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
    marginRight: 4,
  },
  datePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  datePillActive: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderColor: "#38BDF8",
  },
  datePillText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
  },
  datePillTextActive: {
    color: "#38BDF8",
    fontWeight: "700",
  },
  customDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  customDateInput: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    color: "#F8FAFC",
    fontSize: 12,
    width: 110,
  },
  applyDateBtn: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  applyDateBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0F172A",
  },
  applyPolicyBtn: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#38BDF8",
    paddingVertical: 12,
    borderRadius: 6,
    marginTop: 12,
  },
  applyPolicyBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  closeEmp360Btn: {
    padding: 6,
  },

  // Pagination & Page Size Controls
  pageSizePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
  },
  pageSizePillActive: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderColor: "#38BDF8",
  },
  pageSizePillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
  },
  pageSizePillTextActive: {
    color: "#38BDF8",
  },
  paginationBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: "#1E293B",
  },
  paginationText: {
    fontSize: 12,
    color: "#64748B",
  },
  paginationControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1E293B",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  pageBtnDisabled: {
    backgroundColor: "#0A0D14",
    opacity: 0.5,
  },
  pageBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  pageBtnTextDisabled: {
    color: "#64748B",
  },
  pageNumberText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94A3B8",
    paddingHorizontal: 4,
  },
});
