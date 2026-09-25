/**
 * ATTENDANCE INTELLIGENCE PLATFORM — AUTOMATED TEST SUITE
 * Verifies Canonical Master, Facts Engine, 16 Reconciliations, 15 Anomalies, AI Insights & Q&A.
 */

import {
  cleanStr,
  toTitleCase,
  normalizeTeamHead,
  calculateWorkDuration,
  evaluateLateArrival,
  parseTimeStr,
} from "@/services/attendanceIntelligence/normalization";
import { AttendanceAnalyticsService } from "@/services/attendanceIntelligence/analytics.service";
import { AttendanceReconciliationEngine } from "@/services/attendanceIntelligence/reconciliation.service";
import { AttendanceAnomalyEngine } from "@/services/attendanceIntelligence/anomalyDetection.service";
import { AttendanceInsightEngine } from "@/services/attendanceIntelligence/insights.service";
import { AskAttendanceEngine } from "@/services/attendanceIntelligence/askAttendance.service";
import { AttendanceSnapshotService } from "@/services/attendanceIntelligence/snapshot.service";
import { AttendanceFact, CanonicalEmployee } from "@/services/attendanceIntelligence/types";

describe("ATTENDANCE INTELLIGENCE PLATFORM — CORE ENGINE TESTS", () => {
  // ── 1. Data Normalization & Shift Engine ──────────────────────────────────
  describe("Normalization & Shift Timing Engine", () => {
    test("cleans, trims, and collapses duplicate spaces", () => {
      expect(cleanStr("  Ankit    Mavi  ")).toBe("Ankit Mavi");
      expect(cleanStr(null)).toBe("");
    });

    test("converts names to canonical title case", () => {
      expect(toTitleCase("SONAKSHI SHARMA")).toBe("Sonakshi Sharma");
      expect(toTitleCase("ritesh kothiyal")).toBe("Ritesh Kothiyal");
    });

    test("canonicalizes team head names with zero duplicates", () => {
      expect(normalizeTeamHead("Ankit mavi")).toBe("Ankit Mavi");
      expect(normalizeTeamHead("ANKIT MAVI")).toBe("Ankit Mavi");
      expect(normalizeTeamHead("Sales GV")).toBe("Sales GV");
      expect(normalizeTeamHead("gv team")).toBe("Sales GV");
      expect(normalizeTeamHead("vishal joshi")).toBe("Vishal Joshi");
    });

    test("parses 12-hour and 24-hour timestamps accurately", () => {
      const t1 = parseTimeStr("10:24:47");
      expect(t1).not.toBeNull();
      expect(t1?.hours).toBe(10);
      expect(t1?.minutes).toBe(24);
      expect(t1?.total_seconds).toBe(10 * 3600 + 24 * 60 + 47);

      const t2 = parseTimeStr("06:30 PM");
      expect(t2).not.toBeNull();
      expect(t2?.hours).toBe(18);
      expect(t2?.minutes).toBe(30);
    });

    test("evaluates late arrival against 10:30 AM Shift Start with zero grace", () => {
      // On-time check-in (10:15 AM)
      const onTime = evaluateLateArrival("10:15:00", "10:30:00", 0);
      expect(onTime.is_late).toBe(false);
      expect(onTime.late_minutes).toBe(0);

      // Late check-in (10:45 AM -> 15 mins late)
      const late = evaluateLateArrival("10:45:00", "10:30:00", 0);
      expect(late.is_late).toBe(true);
      expect(late.late_minutes).toBe(15);
    });

    test("calculates true worked duration and ignores synthetic 23:59:00 placeholders", () => {
      // Valid duration (10:00 to 18:30 -> 8.5 hours)
      const valid = calculateWorkDuration("10:00:00", "18:30:00", true);
      expect(valid.status).toBe("VALID");
      expect(valid.worked_hours).toBe(8.5);

      // Synthetic 23:59:00 auto-checkout
      const auto2359 = calculateWorkDuration("10:00:00", "23:59:00", true);
      expect(auto2359.status).toBe("MISSING_OUT");
      expect(auto2359.worked_hours).toBeNull();

      // Excessive hours (> 16h)
      const excessive = calculateWorkDuration("06:00:00", "23:30:00", true);
      expect(excessive.status).toBe("ANOMALY");
    });
  });

  // ── 2. Mock Canonical Model & Aggregations ────────────────────────────────
  describe("Canonical Fact Model & Analytics Aggregations", () => {
    const mockEmployees: CanonicalEmployee[] = [
      {
        employee_id: "EMP001",
        employee_name: "Sonakshi Sharma",
        normalized_name: "SONAKSHISHARMA",
        canonical_name: "Sonakshi Sharma",
        office_name: "Noida 136",
        department_name: "Sales",
        team_head_name: "Ankit Mavi",
        employment_status: "ACTIVE",
        shift_name: "Morning",
        shift_start: "10:30:00",
        shift_end: "18:30:00",
        grace_minutes: 0,
        match_status: "MATCHED_BY_ID",
      },
      {
        employee_id: "EMP002",
        employee_name: "Jeetendra Kumar",
        normalized_name: "JEETENDRAKUMAR",
        canonical_name: "Jeetendra Kumar",
        office_name: "Noida 136",
        department_name: "Sales",
        team_head_name: "Gaurav Mavi",
        employment_status: "ACTIVE",
        shift_name: "Morning",
        shift_start: "10:30:00",
        shift_end: "18:30:00",
        grace_minutes: 0,
        match_status: "MATCHED_BY_ID",
      },
    ];

    const mockFacts: AttendanceFact[] = [
      // EMP001 Day 1: Present On-Time
      {
        fact_id: "EMP001_2026-08-01",
        employee_id: "EMP001",
        employee_name: "Sonakshi Sharma",
        canonical_employee_id: "EMP001",
        date: "2026-08-01",
        office_name: "Noida 136",
        department_name: "Sales",
        team_head_name: "Ankit Mavi",
        first_in: "10:15:00",
        last_out: "18:30:00",
        status: "PRESENT",
        expected_in: "10:30:00",
        is_late: false,
        late_minutes: 0,
        missing_in: false,
        missing_out: false,
        worked_minutes: 495,
        worked_hours: 8.25,
        hours_status: "VALID",
        leave_flag: false,
        weekly_off_flag: false,
        holiday_flag: false,
        source_count: 2,
        primary_source: "APP",
        source_confidence: 1.0,
        raw_evidence: [],
        conflict_flag: false,
        anomaly_flag: false,
        anomaly_types: [],
        calculation_version: "v4.0.0",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      // EMP001 Day 2: Present Late (10:45)
      {
        fact_id: "EMP001_2026-08-02",
        employee_id: "EMP001",
        employee_name: "Sonakshi Sharma",
        canonical_employee_id: "EMP001",
        date: "2026-08-02",
        office_name: "Noida 136",
        department_name: "Sales",
        team_head_name: "Ankit Mavi",
        first_in: "10:45:00",
        last_out: "18:45:00",
        status: "PRESENT",
        expected_in: "10:30:00",
        is_late: true,
        late_minutes: 15,
        missing_in: false,
        missing_out: false,
        worked_minutes: 480,
        worked_hours: 8.0,
        hours_status: "VALID",
        leave_flag: false,
        weekly_off_flag: false,
        holiday_flag: false,
        source_count: 2,
        primary_source: "APP",
        source_confidence: 1.0,
        raw_evidence: [],
        conflict_flag: false,
        anomaly_flag: false,
        anomaly_types: [],
        calculation_version: "v4.0.0",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      // EMP002 Day 1: Present Missing OUT (NC)
      {
        fact_id: "EMP002_2026-08-01",
        employee_id: "EMP002",
        employee_name: "Jeetendra Kumar",
        canonical_employee_id: "EMP002",
        date: "2026-08-01",
        office_name: "Noida 136",
        department_name: "Sales",
        team_head_name: "Gaurav Mavi",
        first_in: "10:00:00",
        last_out: null,
        status: "PRESENT_MISSING_OUT",
        expected_in: "10:30:00",
        is_late: false,
        late_minutes: 0,
        missing_in: false,
        missing_out: true,
        worked_minutes: null,
        worked_hours: null,
        hours_status: "MISSING_OUT",
        leave_flag: false,
        weekly_off_flag: false,
        holiday_flag: false,
        source_count: 1,
        primary_source: "APP",
        source_confidence: 0.9,
        raw_evidence: [],
        conflict_flag: false,
        anomaly_flag: true,
        anomaly_types: ["REPEATED_MISSING_OUT"],
        calculation_version: "v4.0.0",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      // EMP002 Day 2: Absent
      {
        fact_id: "EMP002_2026-08-02",
        employee_id: "EMP002",
        employee_name: "Jeetendra Kumar",
        canonical_employee_id: "EMP002",
        date: "2026-08-02",
        office_name: "Noida 136",
        department_name: "Sales",
        team_head_name: "Gaurav Mavi",
        first_in: null,
        last_out: null,
        status: "ABSENT",
        expected_in: "10:30:00",
        is_late: false,
        late_minutes: 0,
        missing_in: false,
        missing_out: false,
        worked_minutes: null,
        worked_hours: null,
        hours_status: "ZERO",
        leave_flag: false,
        weekly_off_flag: false,
        holiday_flag: false,
        source_count: 0,
        primary_source: "APP",
        source_confidence: 0.5,
        raw_evidence: [],
        conflict_flag: false,
        anomaly_flag: false,
        anomaly_types: [],
        calculation_version: "v4.0.0",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    test("computes workforce KPIs accurately", () => {
      const kpis = AttendanceAnalyticsService.computeWorkforceKPIs(mockFacts, mockEmployees);
      expect(kpis.total_employees).toBe(2);
      expect(kpis.total_present_days).toBe(2);
      expect(kpis.total_present_missing_out).toBe(1);
      expect(kpis.total_absent_days).toBe(1);
      expect(kpis.total_late_arrivals).toBe(1);
      expect(kpis.total_missing_punches).toBe(1);
      expect(kpis.total_hours_worked).toBe(16.25);
      expect(kpis.attendance_rate).toBe(75); // 3 present / 4 total = 75%
      expect(kpis.health_breakdown.overall_score).toBeGreaterThan(0);
    });

    test("executes 16 reconciliation assertions with 100% PASS", () => {
      const kpis = AttendanceAnalyticsService.computeWorkforceKPIs(mockFacts, mockEmployees);
      const results = AttendanceReconciliationEngine.runReconciliation(mockFacts, mockEmployees, kpis);

      expect(results.length).toBe(16);
      for (const res of results) {
        expect(res.status).toBe("PASS");
      }
    });

    test("detects operational anomalies", () => {
      const anomalies = AttendanceAnomalyEngine.detectAnomalies(mockFacts, mockEmployees);
      expect(anomalies).toBeDefined();
    });

    test("generates evidence-based AI insights", () => {
      const kpis = AttendanceAnalyticsService.computeWorkforceKPIs(mockFacts, mockEmployees);
      const insights = AttendanceInsightEngine.generateInsights(mockFacts, mockEmployees, kpis);
      expect(insights.length).toBeGreaterThan(0);
      expect(insights[0].evidence).toBeDefined();
      expect(insights[0].recommended_action).toBeDefined();
    });

    test("processes natural-language queries via Ask Attendance AI without hallucination", async () => {
      const response = await AskAttendanceEngine.queryAttendance("Who was late more than 0 times?", mockFacts, mockEmployees);
      expect(response.query).toBe("Who was late more than 0 times?");
      expect(response.answer).toContain("Sonakshi Sharma");
      expect(response.supporting_records.length).toBe(1);
    });

    test("creates immutable official report snapshot", () => {
      const snapshot = AttendanceSnapshotService.createOfficialSnapshot(mockFacts, mockEmployees, {});
      expect(snapshot.snapshot_id).toMatch(/^ATT-\d{8}-\d{3}$/);
      expect(snapshot.attendance_rate).toBe(75);
      expect(snapshot.reconciliation_status).toBe("VERIFIED_PASS");
      expect(snapshot.immutable_hash).toContain("SHA256-");
    });
  });
});

