/**
 * ATTENDANCE INTELLIGENCE PLATFORM — TYPE DEFINITIONS
 * Four-Layer Architecture: Raw -> Normalized -> Fact -> Intelligence
 */

export type SourceName = "APP" | "BIOMETRIC" | "LEAVE" | "FIELD_VISIT" | "LOCATION" | "MANUAL_ADJUSTMENT" | "CALENDAR";

export type AttendanceStatus =
  | "PRESENT"
  | "PRESENT_MISSING_OUT"
  | "ABSENT"
  | "APPROVED_LEAVE"
  | "WEEKLY_OFF"
  | "HOLIDAY"
  | "NO_SOURCE_DATA"
  | "DATA_EXCEPTION";

export type HealthScoreCategory = "HEALTHY" | "WATCH" | "CONCERN" | "CRITICAL";

export type ExceptionSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type ExceptionStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";

export type AnomalyType =
  | "REPEATED_2359_CHECKOUT"
  | "EXCESSIVE_HOURS"
  | "SUSPICIOUS_SHORT_HOURS"
  | "REPEATED_MISSING_OUT"
  | "CHRONIC_LATE_ARRIVAL"
  | "TIMESTAMP_CLUSTERING"
  | "SOURCE_CONFLICT"
  | "MISSING_EMPLOYEE_ID"
  | "SUDDEN_ATTENDANCE_DROP"
  | "UNUSUAL_GPS_JUMP"
  | "REPEATED_IDENTICAL_COORDINATES"
  | "DUPLICATE_PUNCH"
  | "IMPOSSIBLE_TIME_SEQUENCE"
  | "HISTORICAL_BEHAVIOR_ANOMALY"
  | "NO_SOURCE_ON_SCHEDULED_DAY";

export type UserRole = "ADMIN" | "HR" | "MANAGER" | "TEAM_HEAD" | "EMPLOYEE" | "VIEW_ONLY";

// ── LAYER 1: RAW SOURCE RECORD ──────────────────────────────────────────────
export interface RawSourceRecord {
  source_name: SourceName;
  source_record_id?: string | null;
  raw_employee_id?: string | null;
  raw_employee_name?: string | null;
  source_date: string;
  raw_in?: string | null;
  raw_out?: string | null;
  raw_status?: string | null;
  ingestion_timestamp: string;
  source_file?: string | null;
  source_reference?: string | null;
  metadata?: Record<string, any>;
}

// ── LAYER 2: CLEAN / NORMALIZED EMPLOYEE MASTER ─────────────────────────────
export interface CanonicalEmployee {
  profile_id?: string | null;
  user_id?: string | null;
  employee_id: string;
  raw_employee_id?: string | null;
  employee_name: string;
  normalized_name: string;
  canonical_name: string;
  office_id?: string | null;
  office_name: string;
  department_id?: string | null;
  department_name: string;
  team_head_id?: string | null;
  team_head_name: string;
  designation?: string | null;
  role?: string | null;
  employment_status: "ACTIVE" | "INACTIVE" | "PROBATION" | "NOTICE";
  joining_date?: string | null;
  exit_date?: string | null;
  shift_name: string;
  shift_start: string; // e.g. "10:32:00"
  shift_end: string;   // e.g. "18:30:00"
  grace_minutes: number;
  match_status: "MATCHED_BY_ID" | "MATCHED_BY_NAME" | "UNRESOLVED";
  resolution_notes?: string;
  show_on_tv?: boolean;
}

// ── LAYER 3: ATTENDANCE FACT (ATOMIC SINGLE SOURCE OF TRUTH) ────────────────
export interface AttendanceFact {
  fact_id: string;
  employee_id: string;
  employee_name: string;
  canonical_employee_id: string;
  date: string; // YYYY-MM-DD
  office_name: string;
  department_name: string;
  team_head_name: string;

  // Timestamps
  first_in: string | null;      // IST HH:MM:SS or null
  last_out: string | null;      // IST HH:MM:SS or null
  first_in_iso?: string | null; // ISO UTC
  last_out_iso?: string | null; // ISO UTC

  // Primary Status
  status: AttendanceStatus;
  leave_type?: string | null;   // CL, SL, PL, WFH

  // Punctuality
  expected_in: string;          // e.g. "10:32:00"
  is_late: boolean;
  late_minutes: number;

  // Missing Punches
  missing_in: boolean;
  missing_out: boolean;

  // Working Duration
  worked_minutes: number | null;
  worked_hours: number | null;
  hours_status: "VALID" | "MISSING_OUT" | "INVALID_DURATION" | "NEGATIVE_DURATION" | "ANOMALY" | "ZERO";

  // Calendar Flags
  leave_flag: boolean;
  weekly_off_flag: boolean;
  holiday_flag: boolean;

  // Multi-Source Evidence
  source_count: number;
  primary_source: SourceName;
  source_confidence: number; // 0.0 to 1.0
  raw_evidence: RawSourceRecord[];

  // Data Quality & Conflicts
  conflict_flag: boolean;
  conflict_details?: string | null;
  anomaly_flag: boolean;
  anomaly_types: AnomalyType[];

  // Audit & Versioning
  calculation_version: string;
  created_at: string;
  updated_at: string;
}

// ── LAYER 4: INTELLIGENCE & ANALYTICS ───────────────────────────────────────
export interface HealthScoreBreakdown {
  overall_score: number; // 0 - 100
  category: HealthScoreCategory;
  attendance_score: number;
  punctuality_score: number;
  hours_compliance_score: number;
  punch_discipline_score: number;
  weights: {
    attendance: number;
    punctuality: number;
    hours: number;
    discipline: number;
  };
}

export interface HealthDistribution {
  healthy: number;
  watch: number;
  concern: number;
  critical: number;
}

export interface PeriodDelta {
  attendance_delta: number;
  punctuality_delta: number;
  hours_delta: number;
  delta_label: string;
}

export interface FactEngineConfig {
  shift_start?: string;
  grace_minutes?: number;
  filter_2359?: boolean;
}

export interface WorkforceKPIs {
  total_employees: number;
  reporting_period: { start: string; end: string; days_count: number };
  working_days: number;
  total_present_days: number;
  total_present_missing_out: number;
  total_absent_days: number;
  total_no_source_days: number;
  total_leave_days: number;
  total_holiday_days: number;
  total_weekly_off_days: number;

  attendance_rate: number;       // %
  data_coverage_rate: number;    // %
  source_coverage_score?: number; // %
  report_confidence_score: number; // %
  punctuality_rate: number;      // %

  total_late_arrivals: number;
  total_late_minutes: number;
  average_late_minutes: number;

  total_missing_punches: number;
  total_missing_out: number;
  total_missing_in: number;

  total_hours_worked: number;
  average_hours_per_present_day: number;
  median_hours_per_present_day: number;

  health_breakdown: HealthScoreBreakdown;
  health_distribution?: HealthDistribution;
  period_comparison?: PeriodDelta;
  active_exceptions_count: number;
  active_anomalies_count: number;
}

export interface DailyTrendPoint {
  date: string;
  day_label: string; // e.g. "01-Aug"
  present_count: number;
  present_missing_out_count: number;
  absent_count: number;
  no_source_count: number;
  leave_count: number;
  holiday_count: number;
  weekly_off_count: number;
  late_count: number;
  missing_punch_count: number;
  total_hours: number;
  attendance_rate: number;
  data_coverage: number;
}

export interface EmployeeIntelligenceProfile {
  employee: CanonicalEmployee;
  kpis: {
    working_days: number;
    present_days: number;
    present_missing_out: number;
    absent_days: number;
    no_source_days: number;
    leave_days: number;
    late_count: number;
    total_late_minutes: number;
    missing_punches: number;
    total_hours: number;
    avg_hours: number;
    attendance_rate: number;
    punctuality_rate: number;
    data_confidence: number;
  };
  health_score: HealthScoreBreakdown;
  current_absence_streak: number;
  longest_absence_streak: number;
  current_late_streak: number;
  daily_facts: AttendanceFact[];
  recent_anomalies: AttendanceAnomaly[];
  recent_exceptions: AttendanceException[];
  ai_summary: string;
}

export interface TeamIntelligenceSummary {
  team_head: string;
  employee_count: number;
  working_days: number;
  present_days: number;
  absent_days: number;
  no_source_days: number;
  leave_days: number;
  late_marks: number;
  missing_punches: number;
  total_hours: number;
  avg_hours: number;
  attendance_rate: number;
  punctuality_rate: number;
  data_coverage: number;
  health_category: HealthScoreCategory;
  variance_from_company_avg: number;
  flagged_employees_count: number;
}

export interface OfficeIntelligenceSummary {
  office_name: string;
  employee_count: number;
  working_days: number;
  present_days: number;
  absent_days: number;
  no_source_days: number;
  leave_days: number;
  late_marks: number;
  missing_punches: number;
  total_hours: number;
  attendance_rate: number;
  punctuality_rate: number;
  data_coverage: number;
  confidence_score: number;
}

export interface DepartmentIntelligenceSummary {
  department_name: string;
  employee_count: number;
  working_days: number;
  present_days: number;
  absent_days: number;
  no_source_days: number;
  leave_days: number;
  late_marks: number;
  missing_punches: number;
  total_hours: number;
  attendance_rate: number;
  punctuality_rate: number;
  data_coverage: number;
}

// ── OPERATIONAL EXCEPTION INBOX ─────────────────────────────────────────────
export interface AttendanceException {
  exception_id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  category: string;
  severity: ExceptionSeverity;
  source: SourceName;
  reason: string;
  evidence_summary: string;
  status: ExceptionStatus;
  created_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_notes?: string | null;
}

// ── ANOMALY DETECTION RECORD ────────────────────────────────────────────────
export interface AttendanceAnomaly {
  anomaly_id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  anomaly_type: AnomalyType;
  severity: ExceptionSeverity;
  confidence: number; // 0.0 to 1.0
  evidence: string;
  explanation: string;
  action_recommendation: string;
  created_at: string;
}

// ── RECONCILIATION ENGINE RESULT ────────────────────────────────────────────
export interface ReconciliationCheckResult {
  check_id: string;
  check_name: string;
  description: string;
  expected_value: string | number;
  actual_value: string | number;
  difference: string | number;
  severity: ExceptionSeverity;
  status: "PASS" | "WARNING" | "FAIL";
  affected_items_count: number;
  notes: string;
}

// ── AI INSIGHTS ─────────────────────────────────────────────────────────────
export interface AIInsight {
  insight_id: string;
  category: "ATTENDANCE" | "PUNCTUALITY" | "HOURS" | "ABSENCE" | "DATA_QUALITY" | "TEAM_PERFORMANCE" | "ANOMALIES";
  title: string;
  summary: string;
  evidence: string;
  impact: string;
  recommended_action: string;
  confidence: number;
  severity: "INFO" | "WARNING" | "CRITICAL";
  created_at: string;
}

// ── NATURAL LANGUAGE QUERY RESULT ───────────────────────────────────────────
export interface AskAttendanceResponse {
  query: string;
  answer: string;
  summary_metrics: Record<string, string | number>;
  filters_applied: Record<string, any>;
  supporting_records: any[];
  drilldown_route?: string;
  generated_at: string;
}

// ── OFFICIAL REPORT SNAPSHOT ────────────────────────────────────────────────
export interface OfficialReportSnapshot {
  snapshot_id: string; // e.g. "ATT-2026-08-27-001"
  generated_at: string;
  reporting_period_start: string;
  reporting_period_end: string;
  calculation_version: string;
  employee_count: number;
  attendance_rate: number;
  data_coverage_rate: number;
  report_confidence_score: number;
  reconciliation_status: "VERIFIED_PASS" | "PASSED_WITH_WARNINGS" | "FAILED";
  filters_applied: Record<string, any>;
  kpi_summary: WorkforceKPIs;
  immutable_hash: string;
  exported_by: string;
}

// ── GLOBAL DASHBOARD FILTERS ────────────────────────────────────────────────
export interface GlobalAttendanceFilters {
  date_range_preset: "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM";
  start_date: string;
  end_date: string;
  office_names: string[];
  department_names: string[];
  team_head_names: string[];
  employee_search: string;
  statuses: AttendanceStatus[];
  risk_categories: HealthScoreCategory[];
  sources: SourceName[];
  exceptions_only: boolean;
  anomalies_only: boolean;
}

// ── SAVED VIEWS ─────────────────────────────────────────────────────────────
export interface SavedDashboardView {
  view_id: string;
  name: string;
  description?: string;
  filters: GlobalAttendanceFilters;
  created_by: string;
  created_at: string;
  is_default?: boolean;
}

// ── AUDIT LOG ENTRY ─────────────────────────────────────────────────────────
export interface AttendanceAuditLog {
  log_id: string;
  user_name: string;
  user_role: UserRole;
  action: "LOGIN" | "DATA_INGESTION" | "CONFIGURATION_CHANGE" | "EXCEPTION_RESOLVED" | "MANUAL_CORRECTION" | "REPORT_GENERATED" | "EXPORT_EXCEL" | "EXPORT_PDF";
  timestamp: string;
  object_type: string;
  object_id: string;
  old_value?: string | null;
  new_value?: string | null;
  reason?: string | null;
}

