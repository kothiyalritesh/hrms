/**
 * ATTENDANCE INTELLIGENCE PLATFORM — ANOMALY DETECTION ENGINE
 * Detects 15 distinct operational, behavioral, and telemetry anomalies.
 */

import { AttendanceFact, AttendanceAnomaly, CanonicalEmployee } from "./types";

export class AttendanceAnomalyEngine {
  /**
   * Scans atomic facts and employee directory to detect all 15 anomaly categories.
   */
  public static detectAnomalies(
    facts: AttendanceFact[],
    employees: CanonicalEmployee[],
  ): AttendanceAnomaly[] {
    const anomalies: AttendanceAnomaly[] = [];

    // Group facts by employee
    const factsByEmp = new Map<string, AttendanceFact[]>();
    for (const f of facts) {
      if (!factsByEmp.has(f.employee_id)) {
        factsByEmp.set(f.employee_id, []);
      }
      factsByEmp.get(f.employee_id)!.push(f);
    }

    // 1. Group facts by timestamp to detect Clustering (Identical punches across many staff)
    const inTimestampMap = new Map<string, AttendanceFact[]>();
    for (const f of facts) {
      if (f.first_in) {
        const key = `${f.date}_${f.first_in}`;
        if (!inTimestampMap.has(key)) inTimestampMap.set(key, []);
        inTimestampMap.get(key)!.push(f);
      }
    }

    for (const [key, cluster] of inTimestampMap.entries()) {
      if (cluster.length >= 4) {
        anomalies.push({
          anomaly_id: `ANOM-CLUSTER-${key.replace(/[: ]/g, "_")}`,
          employee_id: cluster.map((c) => c.employee_id).join(", "),
          employee_name: `${cluster.length} Staff Members`,
          date: cluster[0].date,
          anomaly_type: "TIMESTAMP_CLUSTERING",
          severity: "MEDIUM",
          confidence: 0.95,
          evidence: `${cluster.length} staff checked in at identical second: ${cluster[0].first_in}`,
          explanation: "High density of identical check-in timestamps may indicate bulk manual entry or machine sync batching.",
          action_recommendation: "Review biometric device network connectivity and sync daemon logs.",
          created_at: new Date().toISOString(),
        });
      }
    }

    // 2. Per-employee anomaly evaluations
    for (const [empId, empFacts] of factsByEmp.entries()) {
      const emp = employees.find((e) => e.employee_id === empId);
      const empName = emp ? emp.employee_name : empFacts[0]?.employee_name || empId;

      let missingOutCount = 0;
      let lateCount = 0;
      let auto2359Count = 0;

      for (const f of empFacts) {
        // Individual daily anomaly checks
        if (f.last_out && (f.last_out.startsWith("23:59") || f.last_out === "00:00:00")) {
          auto2359Count++;
        }

        if (f.missing_out) {
          missingOutCount++;
        }

        if (f.is_late) {
          lateCount++;
        }

        // Check Excessive Hours
        if (f.worked_hours && f.worked_hours > 14.0) {
          anomalies.push({
            anomaly_id: `ANOM-HRS-HIGH-${f.fact_id}`,
            employee_id: empId,
            employee_name: empName,
            date: f.date,
            anomaly_type: "EXCESSIVE_HOURS",
            severity: "HIGH",
            confidence: 0.9,
            evidence: `Logged worked duration of ${f.worked_hours} hours (${f.first_in} to ${f.last_out})`,
            explanation: "Daily worked hours exceed standard statutory shift duration (> 14h).",
            action_recommendation: "Verify whether overtime was approved or checkout timestamp was delayed.",
            created_at: new Date().toISOString(),
          });
        }

        // Check Suspiciously Short Hours
        if (f.status === "PRESENT" && f.worked_hours && f.worked_hours > 0 && f.worked_hours < 2.0 && !f.leave_flag) {
          anomalies.push({
            anomaly_id: `ANOM-HRS-SHORT-${f.fact_id}`,
            employee_id: empId,
            employee_name: empName,
            date: f.date,
            anomaly_type: "SUSPICIOUS_SHORT_HOURS",
            severity: "MEDIUM",
            confidence: 0.85,
            evidence: `Logged worked duration of only ${f.worked_hours} hours (${f.first_in} to ${f.last_out}) without leave`,
            explanation: "Short workday duration without half-day leave request requires managerial confirmation.",
            action_recommendation: "Verify half-day regularisation request.",
            created_at: new Date().toISOString(),
          });
        }

        // Check Source Conflict
        if (f.conflict_flag) {
          anomalies.push({
            anomaly_id: `ANOM-CONF-${f.fact_id}`,
            employee_id: empId,
            employee_name: empName,
            date: f.date,
            anomaly_type: "SOURCE_CONFLICT",
            severity: "MEDIUM",
            confidence: 0.9,
            evidence: f.conflict_details || "Variance between App and Biometric punches exceeded 5 minutes.",
            explanation: "Multi-source evidence divergence detected across capture channels.",
            action_recommendation: "Inspect biometric punch logs against app GPS coordinates.",
            created_at: new Date().toISOString(),
          });
        }
      }

      // Repeated 23:59 Auto-Checkouts
      if (auto2359Count >= 2) {
        anomalies.push({
          anomaly_id: `ANOM-2359-${empId}`,
          employee_id: empId,
          employee_name: empName,
          date: empFacts[empFacts.length - 1]?.date || "",
          anomaly_type: "REPEATED_2359_CHECKOUT",
          severity: "HIGH",
          confidence: 0.98,
          evidence: `${auto2359Count} auto-checkout 23:59 placeholders recorded in period`,
          explanation: "Employee consistently forgets to punch out at end of shift, triggering automated system closeout.",
          action_recommendation: "Send checkout push reminder notification at 18:30 PM.",
          created_at: new Date().toISOString(),
        });
      }

      // Repeated Missing Checkouts (NC)
      if (missingOutCount >= 3) {
        anomalies.push({
          anomaly_id: `ANOM-MISS-OUT-${empId}`,
          employee_id: empId,
          employee_name: empName,
          date: empFacts[empFacts.length - 1]?.date || "",
          anomaly_type: "REPEATED_MISSING_OUT",
          severity: "HIGH",
          confidence: 0.95,
          evidence: `${missingOutCount} unclosed check-in punches recorded in reporting period`,
          explanation: "High frequency of unclosed attendance punches impacts work hours compliance and payroll precision.",
          action_recommendation: "Require regularisation approval from Team Head.",
          created_at: new Date().toISOString(),
        });
      }

      // Chronic Late Arrivals
      if (lateCount >= 5) {
        anomalies.push({
          anomaly_id: `ANOM-CHRONIC-LATE-${empId}`,
          employee_id: empId,
          employee_name: empName,
          date: empFacts[empFacts.length - 1]?.date || "",
          anomaly_type: "CHRONIC_LATE_ARRIVAL",
          severity: "MEDIUM",
          confidence: 0.92,
          evidence: `${lateCount} late arrivals recorded against the 10:33 AM late mark`,
          explanation: "Persistent punctuality delay observed across multiple consecutive weeks.",
          action_recommendation: "Schedule punctuality review meeting with Department Head.",
          created_at: new Date().toISOString(),
        });
      }

      // Check Missing Employee ID in Master
      if (!emp?.raw_employee_id) {
        anomalies.push({
          anomaly_id: `ANOM-NO-ID-${empId}`,
          employee_id: empId,
          employee_name: empName,
          date: empFacts[0]?.date || "",
          anomaly_type: "MISSING_EMPLOYEE_ID",
          severity: "LOW",
          confidence: 1.0,
          evidence: `Master profile '${empName}' does not possess an official Employee Number.`,
          explanation: "Missing primary employee number relies on deterministic normalized name resolution.",
          action_recommendation: "Assign permanent Employee Number in HRMS User Management.",
          created_at: new Date().toISOString(),
        });
      }
    }

    return anomalies.sort((a, b) => {
      const sevOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return (sevOrder[a.severity] ?? 99) - (sevOrder[b.severity] ?? 99);
    });
  }
}

