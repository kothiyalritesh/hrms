import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";

/**
 * Employee-side "Attendance Regularization Request" for a day with no
 * attendance (missed check-in and check-out). HR reviews every request; the
 * attendance record changes only when a reviewer approves it.
 *
 * Transport failures throw. Business rule failures come back from the server
 * as { success: false, error, message } and are returned as-is.
 */

export type RegularizationRequestStatus =
  | "PENDING_APPROVAL"
  | "NEEDS_INFO"
  | "APPLIED"
  | "REJECTED"
  | "CANCELLED";

export type RegularizationReasonCode =
  | "POOR_NETWORK"
  | "REMOTE_SITE_VISIT"
  | "HRMS_FAILURE"
  | "DEVICE_LOCATION_ISSUE"
  | "OTHER";

export type RegularizationEvidenceType =
  | "WHATSAPP_LOCATION"
  | "SITE_VISIT_RECORD"
  | "SUPERVISOR_CONFIRMATION"
  | "CLIENT_CONFIRMATION"
  | "EMPLOYEE_EXPLANATION"
  | "OTHER";

export type RegularizationEventType =
  | "SUBMITTED"
  | "RETURNED_FOR_INFO"
  | "INFO_PROVIDED"
  | "APPROVED"
  | "REJECTED"
  | "APPLIED"
  | "WITHDRAWN";

export interface RegularizationPolicy {
  window_days: number;
  today: string;
  declaration_version: string;
  declaration_text: string;
}

export interface RegularizationEvent {
  event_type: RegularizationEventType | string;
  notes: string | null;
  created_at: string;
  actor_name: string | null;
}

export interface RegularizationRequest {
  id: string;
  business_date: string;
  status: RegularizationRequestStatus;
  reason_code: RegularizationReasonCode | string;
  explanation: string | null;
  site_name: string | null;
  checkin_at: string | null;
  checkout_at: string | null;
  evidence_type: RegularizationEvidenceType | string | null;
  evidence_source: string | null;
  evidence_details: string | null;
  location_evidence: string | null;
  decision_notes: string | null;
  requested_at: string;
  decided_at: string | null;
  parent_request_id: string | null;
  decided_by_name: string | null;
  events: RegularizationEvent[];
}

export interface RegularizationActionResult {
  success: boolean;
  error?: string;
  message?: string;
  request_id?: string;
  status?: RegularizationRequestStatus;
  replayed?: boolean;
}

export interface RegularizationSubmitParams {
  businessDate: string;
  checkinAt: string;
  checkoutAt: string;
  reasonCode: RegularizationReasonCode;
  explanation: string;
  evidenceType: RegularizationEvidenceType;
  evidenceSource: string;
  declared: boolean;
  declarationVersion: string;
  idempotencyKey: string;
  siteName?: string | null;
  evidenceDetails?: string | null;
  locationEvidence?: string | null;
  parentRequestId?: string | null;
}

export const REGULARIZATION_REASONS: {
  code: RegularizationReasonCode;
  label: string;
}[] = [
  { code: "POOR_NETWORK", label: "Poor internet connectivity" },
  { code: "REMOTE_SITE_VISIT", label: "Remote site visit" },
  { code: "HRMS_FAILURE", label: "HRMS / app failure" },
  { code: "DEVICE_LOCATION_ISSUE", label: "Device or location problem" },
  { code: "OTHER", label: "Other" },
];

export const REGULARIZATION_EVIDENCE_TYPES: {
  code: RegularizationEvidenceType;
  label: string;
}[] = [
  { code: "WHATSAPP_LOCATION", label: "WhatsApp location" },
  { code: "SITE_VISIT_RECORD", label: "Site visit record" },
  { code: "SUPERVISOR_CONFIRMATION", label: "Supervisor confirmation" },
  { code: "CLIENT_CONFIRMATION", label: "Client confirmation" },
  { code: "EMPLOYEE_EXPLANATION", label: "My explanation only" },
  { code: "OTHER", label: "Other" },
];

const EMPTY_RESPONSE: RegularizationActionResult = {
  success: false,
  error: "EMPTY_RESPONSE",
  message: "No response from the server. Try again.",
};

function asObject<T>(data: unknown): T | null {
  const row = firstRpcRow<any>(data as any);
  return row && typeof row === "object" ? (row as T) : null;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

export const RegularizationRequestService = {
  async policy(): Promise<RegularizationPolicy> {
    const { data, error } = await supabase.rpc("rpc_my_regularization_policy");
    if (error) throw error;
    const row = asObject<RegularizationPolicy>(data);
    if (!row || typeof row.window_days !== "number") {
      throw new Error("The regularization policy could not be loaded.");
    }
    return row;
  },

  async myRequests(
    from: string | null = null,
    to: string | null = null,
  ): Promise<RegularizationRequest[]> {
    const { data, error } = await supabase.rpc("rpc_my_regularization_requests", {
      p_from: from,
      p_to: to,
    });
    if (error) throw error;
    if (!Array.isArray(data)) return [];
    return (data as RegularizationRequest[]).map((row) => ({
      ...row,
      events: Array.isArray(row.events) ? row.events : [],
    }));
  },

  async submit(params: RegularizationSubmitParams): Promise<RegularizationActionResult> {
    const { data, error } = await supabase.rpc("rpc_regularization_request_submit", {
      p_business_date: params.businessDate,
      p_checkin_at: params.checkinAt,
      p_checkout_at: params.checkoutAt,
      p_reason_code: params.reasonCode,
      p_explanation: params.explanation.trim(),
      p_evidence_type: params.evidenceType,
      p_evidence_source: params.evidenceSource.trim(),
      p_declared: params.declared,
      p_declaration_version: params.declarationVersion,
      p_idempotency_key: params.idempotencyKey,
      p_site_name: blankToNull(params.siteName),
      p_evidence_details: blankToNull(params.evidenceDetails),
      p_location_evidence: blankToNull(params.locationEvidence),
      p_parent_request_id: params.parentRequestId ?? null,
    });
    if (error) throw error;
    return asObject<RegularizationActionResult>(data) ?? EMPTY_RESPONSE;
  },

  async respond(requestId: string, information: string): Promise<RegularizationActionResult> {
    const { data, error } = await supabase.rpc("rpc_regularization_request_respond", {
      p_request_id: requestId,
      p_information: information.trim(),
    });
    if (error) throw error;
    return asObject<RegularizationActionResult>(data) ?? EMPTY_RESPONSE;
  },

  async withdraw(requestId: string): Promise<RegularizationActionResult> {
    const { data, error } = await supabase.rpc("rpc_attendance_correction_cancel", {
      p_correction_id: requestId,
    });
    if (error) throw error;
    return asObject<RegularizationActionResult>(data) ?? EMPTY_RESPONSE;
  },
};

export default RegularizationRequestService;
