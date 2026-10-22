// Backdated attendance corrections (HR Panel).
// Thin typed wrappers around the rpc_attendance_correction_* RPCs defined in
// supabase/migrations/20261014120000_backdated_attendance_corrections.sql.
// Transport / permission errors throw; business rule failures come back as
// { success: false, error, message } so the screen can show `message`.

import { supabase } from "@/lib/supabase";

export type CorrectionReasonCode =
  | "POOR_NETWORK"
  | "REMOTE_SITE_VISIT"
  | "HRMS_FAILURE"
  | "DEVICE_LOCATION_ISSUE"
  | "OTHER";

export type CorrectionEvidenceType =
  | "WHATSAPP_LOCATION"
  | "SITE_VISIT_RECORD"
  | "SUPERVISOR_CONFIRMATION"
  | "CLIENT_CONFIRMATION"
  | "EMPLOYEE_EXPLANATION"
  | "OTHER";

export type CorrectionEvidenceVerification = "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED";

export type CorrectionStatus = "PENDING_APPROVAL" | "NEEDS_INFO" | "APPLIED" | "REJECTED" | "CANCELLED";

/** Who raised the row: HR recording a past day, or the employee's own regularization request. */
export type CorrectionOrigin = "HR_ENTRY" | "EMPLOYEE_REQUEST";

/** Employee requests currently always use MISSED_CHECKIN_AND_CHECKOUT; HR entries have no type. */
export type CorrectionRequestType = "MISSED_CHECKIN_AND_CHECKOUT" | string;

/** `OPEN` = PENDING_APPROVAL or NEEDS_INFO (list filter only). */
export type CorrectionListStatus = CorrectionStatus | "OPEN";

export type CorrectionEventType =
  | "SUBMITTED"
  | "RETURNED_FOR_INFO"
  | "INFO_PROVIDED"
  | "APPROVED"
  | "REJECTED"
  | "APPLIED"
  | "WITHDRAWN";

export type CorrectionEvent = {
  event_type: CorrectionEventType | string;
  notes: string | null;
  created_at: string;
  actor_name: string | null;
};

export type CorrectionCounts = {
  pending: number;
  needs_info: number;
  applied: number;
  rejected: number;
};

export type CorrectionRiskLevel = "ROUTINE" | "HIGH";

export const CORRECTION_ACKNOWLEDGEMENT_VERSION = "v1";

export const DEFAULT_CORRECTION_ACKNOWLEDGEMENT_TEXT =
  "I have verified the available evidence and confirm that the entered attendance details are accurate to the best of my knowledge. I accept responsibility for submitting this correction.";

export type CorrectionEmployee = {
  id: string;
  name: string;
  employee_number: string | null;
  office_id: string | null;
  office_name: string | null;
  joining_date: string | null;
  last_working_date: string | null;
};

export type CorrectionDayAttendance = {
  id: string;
  checkin_time: string | null;
  checkout_time: string | null;
  checkin_source: string | null;
  checkout_source: string | null;
  status: string | null;
  biometric_first_punch: string | null;
  biometric_last_punch: string | null;
};

export type CorrectionDayContext = {
  attendance: CorrectionDayAttendance | null;
  biometric: { count: number; first: string | null; last: string | null } | null;
  field_visits: Array<{
    id: string;
    name: string | null;
    status: string | null;
    verification_status: string | null;
    checkin_time: string | null;
    checkout_time: string | null;
  }>;
  leave: Array<{ id: string; leave_type: string | null; is_half_day: boolean }>;
  calendar: { kind: "HOLIDAY" | "WEEKLY_OFF" | "WORKING_DAY" | string; label?: string | null } | null;
  corrections: Array<{
    id: string;
    status: CorrectionStatus;
    checkin_at: string | null;
    checkout_at: string | null;
    requested_at: string | null;
  }>;
  approved_regularizations: Array<{
    id: string;
    request_type: string | null;
    requested_checkout: string | null;
  }>;
};

export type CorrectionPreview = {
  success: boolean;
  error?: string;
  message?: string;
  window_start?: string;
  window_end?: string;
  acknowledgement_version?: string;
  acknowledgement_text?: string;
  context?: CorrectionDayContext;
};

export type CorrectionSubmitInput = {
  userId: string;
  businessDate: string; // YYYY-MM-DD (IST)
  reasonCode: CorrectionReasonCode;
  remarks: string;
  checkinAt: string; // ISO with offset
  checkoutAt: string | null;
  evidenceType: CorrectionEvidenceType;
  evidenceSource: string;
  evidenceVerification: CorrectionEvidenceVerification;
  acknowledged: boolean;
  acknowledgementVersion?: string;
  idempotencyKey: string;
  siteName?: string | null;
  officeId?: string | null;
  evidenceDetails?: string | null;
};

export type CorrectionSubmitResult = {
  success: boolean;
  error?: string;
  message?: string;
  correction_id?: string;
  status?: "APPLIED" | "PENDING_APPROVAL" | CorrectionStatus;
  risk_level?: CorrectionRiskLevel;
  risk_reasons?: string[];
  replayed?: boolean;
};

export type CorrectionActionResult = {
  success: boolean;
  error?: string;
  message?: string;
  status?: CorrectionStatus;
};

export type AttendanceCorrectionRow = {
  id: string;
  user_id: string;
  business_date: string;
  reason_code: CorrectionReasonCode;
  remarks: string;
  site_name: string | null;
  office_id: string | null;
  checkin_at: string;
  checkout_at: string | null;
  evidence_type: CorrectionEvidenceType;
  evidence_source: string;
  evidence_details: string | null;
  evidence_verification: CorrectionEvidenceVerification;
  acknowledgement_version: string;
  acknowledgement_text: string;
  acknowledged_at: string;
  risk_level: CorrectionRiskLevel;
  risk_reasons: string[] | null;
  original_snapshot: Partial<CorrectionDayContext> | null;
  status: CorrectionStatus;
  attendance_id: string | null;
  applied_values: Record<string, unknown> | null;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  applied_at: string | null;
  employee_name: string | null;
  employee_number: string | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
  can_decide: boolean;
  can_cancel: boolean;
  origin: CorrectionOrigin;
  request_type: CorrectionRequestType | null;
  /** Employee-provided location information (employee requests only). */
  location_evidence: string | null;
  /** Set when an employee re-raises a day after a rejected request. */
  parent_request_id: string | null;
  events: CorrectionEvent[];
};

export type CorrectionListResult = {
  total: number;
  pending: number;
  counts: CorrectionCounts;
  rows: AttendanceCorrectionRow[];
};

export type CorrectionListParams = {
  status?: CorrectionListStatus | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
  origin?: CorrectionOrigin | null;
};

function asObject<T>(data: unknown, fallback: T): T {
  if (data && typeof data === "object" && !Array.isArray(data)) return data as T;
  return fallback;
}

export const AttendanceCorrectionService = {
  async searchEmployees(search: string): Promise<CorrectionEmployee[]> {
    const { data, error } = await supabase.rpc("rpc_attendance_correction_employees", {
      p_search: search.trim() || null,
    });
    if (error) throw error;
    return Array.isArray(data) ? (data as CorrectionEmployee[]) : [];
  },

  async preview(userId: string, date: string): Promise<CorrectionPreview> {
    const { data, error } = await supabase.rpc("rpc_attendance_correction_preview", {
      p_user_id: userId,
      p_date: date,
    });
    if (error) throw error;
    return asObject<CorrectionPreview>(data, {
      success: false,
      error: "EMPTY_RESPONSE",
      message: "No response from the server. Try again.",
    });
  },

  async submit(input: CorrectionSubmitInput): Promise<CorrectionSubmitResult> {
    const { data, error } = await supabase.rpc("rpc_attendance_correction_submit", {
      p_user_id: input.userId,
      p_business_date: input.businessDate,
      p_reason_code: input.reasonCode,
      p_remarks: input.remarks,
      p_checkin_at: input.checkinAt,
      p_checkout_at: input.checkoutAt,
      p_evidence_type: input.evidenceType,
      p_evidence_source: input.evidenceSource,
      p_evidence_verification: input.evidenceVerification,
      p_acknowledged: input.acknowledged,
      p_acknowledgement_version: input.acknowledgementVersion ?? CORRECTION_ACKNOWLEDGEMENT_VERSION,
      p_idempotency_key: input.idempotencyKey,
      p_site_name: input.siteName?.trim() || null,
      p_office_id: input.officeId ?? null,
      p_evidence_details: input.evidenceDetails?.trim() || null,
    });
    if (error) throw error;
    const result = asObject<CorrectionSubmitResult>(data, {
      success: false,
      error: "EMPTY_RESPONSE",
      message: "No response from the server. Try again.",
    });
    return {
      ...result,
      risk_reasons: Array.isArray(result.risk_reasons) ? result.risk_reasons.map(String) : [],
    };
  },

  async decide(correctionId: string, approve: boolean, notes: string | null): Promise<CorrectionActionResult> {
    const { data, error } = await supabase.rpc("rpc_attendance_correction_decide", {
      p_correction_id: correctionId,
      p_approve: approve,
      p_notes: notes?.trim() || null,
    });
    if (error) throw error;
    return asObject<CorrectionActionResult>(data, {
      success: false,
      error: "EMPTY_RESPONSE",
      message: "No response from the server. Try again.",
    });
  },

  /** Ask the employee for more information (employee requests in PENDING_APPROVAL only; notes ≥ 5 chars). */
  async returnForInfo(correctionId: string, notes: string): Promise<CorrectionActionResult> {
    const { data, error } = await supabase.rpc("rpc_attendance_correction_return", {
      p_correction_id: correctionId,
      p_notes: notes.trim(),
    });
    if (error) throw error;
    return asObject<CorrectionActionResult>(data, {
      success: false,
      error: "EMPTY_RESPONSE",
      message: "No response from the server. Try again.",
    });
  },

  async cancel(correctionId: string): Promise<CorrectionActionResult> {
    const { data, error } = await supabase.rpc("rpc_attendance_correction_cancel", {
      p_correction_id: correctionId,
    });
    if (error) throw error;
    return asObject<CorrectionActionResult>(data, {
      success: false,
      error: "EMPTY_RESPONSE",
      message: "No response from the server. Try again.",
    });
  },

  async list(params: CorrectionListParams = {}): Promise<CorrectionListResult> {
    const { data, error } = await supabase.rpc("rpc_attendance_corrections_list", {
      p_status: params.status ?? null,
      p_from: params.from || null,
      p_to: params.to || null,
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
      p_origin: params.origin ?? null,
    });
    if (error) throw error;
    const result = asObject<Partial<CorrectionListResult>>(data, {});
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const counts = asObject<Partial<CorrectionCounts>>(result.counts, {});
    return {
      total: Number(result.total ?? 0),
      pending: Number(result.pending ?? counts.pending ?? 0),
      counts: {
        pending: Number(counts.pending ?? result.pending ?? 0),
        needs_info: Number(counts.needs_info ?? 0),
        applied: Number(counts.applied ?? 0),
        rejected: Number(counts.rejected ?? 0),
      },
      rows: rows.map((row) => ({
        ...row,
        origin: row.origin === "EMPLOYEE_REQUEST" ? "EMPLOYEE_REQUEST" : "HR_ENTRY",
        request_type: row.request_type ?? null,
        location_evidence: row.location_evidence ?? null,
        parent_request_id: row.parent_request_id ?? null,
        risk_reasons: Array.isArray(row.risk_reasons) ? row.risk_reasons.map(String) : [],
        events: Array.isArray(row.events) ? row.events : [],
        can_decide: row.can_decide === true,
        can_cancel: row.can_cancel === true,
      })),
    };
  },
};

export default AttendanceCorrectionService;
