/**
 * ATTENDANCE INTELLIGENCE PLATFORM — EXCEPTION CENTER SERVICE
 * Operational inbox for reviewing, investigating, and resolving attendance data exceptions.
 */

import { AttendanceFact, AttendanceException, ExceptionStatus, ExceptionSeverity } from "./types";

export class ExceptionCenterService {
  private static localExceptions: Map<string, AttendanceException> = new Map();
  private static resolvedMap: Map<string, { status: ExceptionStatus; by: string; notes: string; at: string }> = new Map();

  /**
   * Generates operational exceptions from attendance facts.
   */
  public static extractExceptionsFromFacts(facts: AttendanceFact[]): AttendanceException[] {
    const currentBatch = new Map<string, AttendanceException>();

    for (const f of facts) {
      // 1. Missing Check-Out (NC)
      if (f.missing_out) {
        const id = `EXC-NC-${f.fact_id}`;
        const prevRes = this.resolvedMap.get(id);
        currentBatch.set(id, {
          exception_id: id,
          employee_id: f.employee_id,
          employee_name: f.employee_name,
          date: f.date,
          category: "MISSING_OUT",
          severity: "HIGH",
          source: f.primary_source,
          reason: `Punched Check-In at ${f.first_in || "Recorded Time"} but no valid Check-Out punch was logged.`,
          evidence_summary: `First IN: ${f.first_in || "N/A"} | Last OUT: MISSING (NC)`,
          status: prevRes ? prevRes.status : "OPEN",
          created_at: f.created_at,
          resolved_at: prevRes?.at,
          resolved_by: prevRes?.by,
          resolution_notes: prevRes?.notes,
        });
      }

      // 2. Missing Check-In with Valid OUT
      if (f.missing_in) {
        const id = `EXC-NOIN-${f.fact_id}`;
        const prevRes = this.resolvedMap.get(id);
        currentBatch.set(id, {
          exception_id: id,
          employee_id: f.employee_id,
          employee_name: f.employee_name,
          date: f.date,
          category: "MISSING_IN",
          severity: "HIGH",
          source: f.primary_source,
          reason: `Check-Out recorded at ${f.last_out} without corresponding Check-In punch.`,
          evidence_summary: `First IN: MISSING | Last OUT: ${f.last_out}`,
          status: prevRes ? prevRes.status : "OPEN",
          created_at: f.created_at,
          resolved_at: prevRes?.at,
          resolved_by: prevRes?.by,
          resolution_notes: prevRes?.notes,
        });
      }

      // 3. Source Conflict
      if (f.conflict_flag) {
        const id = `EXC-CONF-${f.fact_id}`;
        const prevRes = this.resolvedMap.get(id);
        currentBatch.set(id, {
          exception_id: id,
          employee_id: f.employee_id,
          employee_name: f.employee_name,
          date: f.date,
          category: "SOURCE_CONFLICT",
          severity: "MEDIUM",
          source: "MANUAL_ADJUSTMENT",
          reason: f.conflict_details || "Variance between App and Biometric punches exceeded 5 minutes.",
          evidence_summary: `App & Biometric logs differ for date ${f.date}`,
          status: prevRes ? prevRes.status : "OPEN",
          created_at: f.created_at,
          resolved_at: prevRes?.at,
          resolved_by: prevRes?.by,
          resolution_notes: prevRes?.notes,
        });
      }

      // 4. Negative / Invalid Duration
      if (f.hours_status === "NEGATIVE_DURATION") {
        const id = `EXC-NEG-${f.fact_id}`;
        const prevRes = this.resolvedMap.get(id);
        currentBatch.set(id, {
          exception_id: id,
          employee_id: f.employee_id,
          employee_name: f.employee_name,
          date: f.date,
          category: "DATA_ERROR",
          severity: "CRITICAL",
          source: f.primary_source,
          reason: `Checkout timestamp is earlier than checkin timestamp (${f.first_in} -> ${f.last_out}).`,
          evidence_summary: `IN: ${f.first_in}, OUT: ${f.last_out} (Negative Duration)`,
          status: prevRes ? prevRes.status : "OPEN",
          created_at: f.created_at,
          resolved_at: prevRes?.at,
          resolved_by: prevRes?.by,
          resolution_notes: prevRes?.notes,
        });
      }

      // 5. Anomaly Exceptions
      if (f.anomaly_flag && f.anomaly_types.length > 0) {
        const id = `EXC-ANOM-${f.fact_id}`;
        const prevRes = this.resolvedMap.get(id);
        currentBatch.set(id, {
          exception_id: id,
          employee_id: f.employee_id,
          employee_name: f.employee_name,
          date: f.date,
          category: "ANOMALY",
          severity: f.anomaly_types.includes("EXCESSIVE_HOURS") ? "HIGH" : "MEDIUM",
          source: f.primary_source,
          reason: `Telemetry anomaly detected: ${f.anomaly_types.join(", ")}`,
          evidence_summary: `Flags: ${f.anomaly_types.join(", ")} for ${f.date}`,
          status: prevRes ? prevRes.status : "OPEN",
          created_at: f.created_at,
          resolved_at: prevRes?.at,
          resolved_by: prevRes?.by,
          resolution_notes: prevRes?.notes,
        });
      }
    }

    this.localExceptions = currentBatch;

    return Array.from(this.localExceptions.values()).sort((a, b) => {
      const sevOrder: Record<ExceptionSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return (sevOrder[a.severity] ?? 99) - (sevOrder[b.severity] ?? 99);
    });
  }

  /**
   * Resolves an operational exception with audit logging.
   */
  public static resolveException(
    exceptionId: string,
    newStatus: ExceptionStatus,
    resolverName: string,
    resolutionNotes: string,
  ): boolean {
    const item = this.localExceptions.get(exceptionId);
    const now = new Date().toISOString();
    this.resolvedMap.set(exceptionId, {
      status: newStatus,
      by: resolverName,
      notes: resolutionNotes,
      at: now,
    });

    if (item) {
      item.status = newStatus;
      item.resolved_at = now;
      item.resolved_by = resolverName;
      item.resolution_notes = resolutionNotes;
    }
    return true;
  }

  public static getExceptionsList(): AttendanceException[] {
    return Array.from(this.localExceptions.values());
  }
}

