/**
 * ATTENDANCE INTELLIGENCE PLATFORM — ATTENDANCE FACT ENGINE
 * Layer 3: The Single Source of Truth Atomic Daily Attendance Matrix.
 */

import { supabase } from "@/lib/supabase";
import { fetchAllPages } from "@/utils/supabasePagination";
import { attendanceTimestampParts } from "@/utils/attendanceTimestamp";
import { AttendanceFact, AttendanceStatus, RawSourceRecord, SourceName, FactEngineConfig } from "./types";
import { EmployeeMasterService } from "./employeeMaster.service";
import {
  generateDateRange,
  calculateWorkDuration,
  evaluateLateArrival,
  parseTimeStr,
  cleanStr,
} from "./normalization";

export class AttendanceFactEngine {
  private static cachedFacts: AttendanceFact[] = [];
  private static factsByEmpDate = new Map<string, AttendanceFact>();
  private static currentPeriod = { start: "", end: "" };
  private static currentConfig: FactEngineConfig = {};

  /**
   * Computes the complete atomic Attendance Fact table for a given date range.
   */
  public static async computeAttendanceFacts(
    startDate: string,
    endDate: string,
    forceRefresh = false,
    config?: FactEngineConfig,
  ): Promise<AttendanceFact[]> {
    const isConfigSame =
      (!config && !this.currentConfig) ||
      (this.currentConfig.shift_start === config?.shift_start &&
        this.currentConfig.grace_minutes === config?.grace_minutes &&
        this.currentConfig.filter_2359 === config?.filter_2359);

    if (
      !forceRefresh &&
      isConfigSame &&
      this.cachedFacts.length > 0 &&
      this.currentPeriod.start === startDate &&
      this.currentPeriod.end === endDate
    ) {
      return this.cachedFacts;
    }

    // 1. Ensure Employee Master is loaded
    let employees = EmployeeMasterService.getAllEmployees();
    if (employees.length === 0) {
      employees = await EmployeeMasterService.loadCanonicalMaster();
    }

    const dateList = generateDateRange(startDate, endDate);

    // 2. Fetch Multi-Source Operational Datasets concurrently
    const [attRes, bioRes, leaveRes, holRes, offRuleRes, fvRes] = await Promise.all([
      fetchAllPages<any>((from, to) =>
        supabase
          .from("attendance_logs")
          .select("id, user_id, date, checkin_time, checkout_time, attendance_type, smartoffice_imported, status, attendance_status, is_late, warning, distance_from_office")
          .gte("date", startDate)
          .lte("date", endDate)
          .order("date")
          .range(from, to),
      ),
      fetchAllPages<any>((from, to) =>
        supabase
          .from("smartoffice_device_logs")
          .select("id, user_id, employee_code, log_datetime, log_date, log_date_only, log_time, punch_direction, serial_number")
          .or(`log_date_only.gte.${startDate},log_datetime.gte.${startDate}`)
          .order("log_datetime", { ascending: true })
          .range(from, to),
      ).catch(() => ({ data: [], count: 0, error: null })),
      fetchAllPages<any>((from, to) =>
        supabase
          .from("leave_requests")
          .select("id, user_id, start_date, end_date, leave_type, status")
          .eq("status", "approved")
          .lte("start_date", endDate)
          .gte("end_date", startDate)
          .range(from, to),
      ).catch(() => ({ data: [], count: 0, error: null })),
      fetchAllPages<any>((from, to) =>
        supabase
          .from("holiday_calendar")
          .select("id, holiday_date, office_id, is_optional, name")
          .gte("holiday_date", startDate)
          .lte("holiday_date", endDate)
          .range(from, to),
      ).catch(() => ({ data: [], count: 0, error: null })),
      fetchAllPages<any>((from, to) =>
        supabase
          .from("weekly_off_rules")
          .select("id, weekday, week_of_month, user_id, office_id")
          .eq("is_active", true)
          .range(from, to),
      ).catch(() => ({ data: [], count: 0, error: null })),
      fetchAllPages<any>((from, to) =>
        supabase
          .from("field_visits")
          .select("id, user_id, date, checkin_time, checkout_time, status, location_name")
          .gte("date", startDate)
          .lte("date", endDate)
          .range(from, to),
      ).catch(() => ({ data: [], count: 0, error: null })),
    ]);

    const attLogs = attRes.data ?? [];
    const bioLogs = bioRes.data ?? [];
    const leaveLogs = leaveRes.data ?? [];
    const holLogs = holRes.data ?? [];
    const offRules = offRuleRes.data ?? [];
    const fvLogs = fvRes.data ?? [];

    // 3. In-memory indexing of sources
    const appMap = new Map<string, any>();
    for (const a of attLogs) {
      if (a.user_id && a.date) appMap.set(`${a.user_id}_${a.date}`, a);
    }

    const bioMap = new Map<string, { first: string; last: string; all: string[]; code?: string }>();
    for (const b of bioLogs) {
      let dateOnly: string | null = b.log_date_only ? String(b.log_date_only).slice(0, 10) : null;
      let timeOnly: string | null = b.log_time ? String(b.log_time).trim() : null;

      if (!dateOnly && (b.log_datetime || b.log_date)) {
        const rawDt = String(b.log_datetime || b.log_date).trim();
        const cleanDt = rawDt.replace(/\//g, "-");
        if (cleanDt.length >= 10) {
          dateOnly = cleanDt.slice(0, 10);
        }
        if (!timeOnly) {
          if (cleanDt.includes(" ")) {
            timeOnly = cleanDt.split(" ")[1]?.slice(0, 8) || null;
          } else if (cleanDt.includes("T")) {
            timeOnly = cleanDt.split("T")[1]?.slice(0, 8) || null;
          }
        }
      }

      if (!dateOnly || dateOnly < startDate || dateOnly > endDate) continue;
      if (!timeOnly) timeOnly = "00:00:00";

      const key = b.user_id ? `${b.user_id}_${dateOnly}` : `CODE_${cleanStr(b.employee_code)}_${dateOnly}`;
      if (!bioMap.has(key)) {
        bioMap.set(key, { first: timeOnly, last: timeOnly, all: [timeOnly], code: b.employee_code });
      } else {
        const item = bioMap.get(key)!;
        if (timeOnly < item.first) item.first = timeOnly;
        if (timeOnly > item.last) item.last = timeOnly;
        item.all.push(timeOnly);
      }
    }

    const fvMap = new Map<string, any>();
    for (const fv of fvLogs) {
      if (fv.user_id && fv.date) fvMap.set(`${fv.user_id}_${fv.date}`, fv);
    }

    // Index dates where attendance source was active
    const datesWithActivePunches = new Set<string>();
    for (const a of attLogs) {
      if (a.date && (a.checkin_time || a.checkout_time)) datesWithActivePunches.add(a.date);
    }
    for (const b of bioLogs) {
      let dateOnly = b.log_date_only ? String(b.log_date_only).slice(0, 10) : null;
      if (!dateOnly && (b.log_datetime || b.log_date)) {
        const cleanDt = String(b.log_datetime || b.log_date).trim().replace(/\//g, "-");
        if (cleanDt.length >= 10) dateOnly = cleanDt.slice(0, 10);
      }
      if (dateOnly && dateOnly >= startDate && dateOnly <= endDate) {
        datesWithActivePunches.add(dateOnly);
      }
    }
    for (const fv of fvLogs) {
      if (fv.date && (fv.checkin_time || fv.checkout_time)) {
        datesWithActivePunches.add(fv.date);
      }
    }

    // 4. Compute the atomic Attendance Fact matrix
    const facts: AttendanceFact[] = [];
    this.factsByEmpDate.clear();

    const globalShiftStart = config?.shift_start;
    const globalGraceMins = config?.grace_minutes;
    const globalFilter2359 = config?.filter_2359 ?? true;

    for (const emp of employees) {
      const profileId = emp.profile_id || emp.user_id || emp.employee_id;
      const empId = emp.employee_id;
      const rawId = emp.raw_employee_id || empId;

      const effectiveShiftStart = globalShiftStart || emp.shift_start || "10:32:00";
      const effectiveGraceMins = globalGraceMins !== undefined ? globalGraceMins : emp.grace_minutes ?? 0;

      for (const d of dateList) {
        const appRecord =
          appMap.get(`${profileId}_${d}`) ||
          appMap.get(`${empId}_${d}`) ||
          appMap.get(`${rawId}_${d}`) ||
          appMap.get(`${emp.normalized_name}_${d}`);

        const bioRecord =
          bioMap.get(`${profileId}_${d}`) ||
          bioMap.get(`${empId}_${d}`) ||
          bioMap.get(`${rawId}_${d}`) ||
          bioMap.get(`CODE_${rawId}_${d}`) ||
          bioMap.get(`CODE_${empId}_${d}`);

        const fvRecord =
          fvMap.get(`${profileId}_${d}`) ||
          fvMap.get(`${empId}_${d}`) ||
          fvMap.get(`${rawId}_${d}`);

        // Calendar Evaluation (Holidays & Weekly Offs)
        const isHoliday = holLogs.some((h) => h.holiday_date === d && (h.office_id == null || h.office_id === emp.office_id));
        const dtObj = new Date(d + "T00:00:00Z");
        const weekday = dtObj.getUTCDay();
        const weekOfMonth = Math.floor((dtObj.getUTCDate() - 1) / 7) + 1;
        const isWeeklyOff = offRules.some(
          (rule) =>
            Number(rule.weekday) === weekday &&
            (rule.week_of_month == null || Number(rule.week_of_month) === weekOfMonth) &&
            (rule.user_id === profileId || rule.user_id === empId || (rule.user_id == null && (rule.office_id == null || rule.office_id === emp.office_id))),
        );

        // Leave Request Evaluation
        const leaveItem = leaveLogs.find(
          (l) => (l.user_id === profileId || l.user_id === empId || l.user_id === rawId) && l.start_date <= d && d <= l.end_date,
        );

        // Raw Evidence Collection
        const rawEvidence: RawSourceRecord[] = [];
        let primarySource: SourceName = "APP";
        let sourceCount = 0;
        let conflictFlag = false;
        let conflictDetails: string | null = null;
        const anomalyTypes: any[] = [];

        let firstInTime: string | null = null;
        let lastOutTime: string | null = null;
        let firstInIso: string | null = null;
        let lastOutIso: string | null = null;

        // Parse App Punch
        if (appRecord) {
          sourceCount++;
          rawEvidence.push({
            source_name: "APP",
            source_record_id: appRecord.id,
            raw_employee_id: empId,
            raw_employee_name: emp.employee_name,
            source_date: d,
            raw_in: appRecord.checkin_time,
            raw_out: appRecord.checkout_time,
            raw_status: appRecord.status || appRecord.attendance_status,
            ingestion_timestamp: appRecord.created_at || new Date().toISOString(),
          });

          if (appRecord.checkin_time) {
            try {
              const parts = attendanceTimestampParts(appRecord.checkin_time);
              firstInTime = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
              firstInIso = appRecord.checkin_time;
            } catch {
              firstInTime = null;
            }
          }
          if (appRecord.checkout_time) {
            try {
              const parts = attendanceTimestampParts(appRecord.checkout_time);
              lastOutTime = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
              lastOutIso = appRecord.checkout_time;
            } catch {
              lastOutTime = null;
            }
          }
        }

        // Parse Biometric Punch
        if (bioRecord) {
          sourceCount++;
          rawEvidence.push({
            source_name: "BIOMETRIC",
            raw_employee_id: rawId,
            raw_employee_name: emp.employee_name,
            source_date: d,
            raw_in: bioRecord.first,
            raw_out: bioRecord.last,
            raw_status: "LOGGED",
            ingestion_timestamp: new Date().toISOString(),
          });

          // Multi-Source Reconciliation (Earliest IN, Latest OUT)
          if (!firstInTime && bioRecord.first) {
            firstInTime = bioRecord.first;
            primarySource = "BIOMETRIC";
          } else if (firstInTime && bioRecord.first) {
            const appInSec = parseTimeStr(firstInTime)?.total_seconds || 0;
            const bioInSec = parseTimeStr(bioRecord.first)?.total_seconds || 0;
            if (bioInSec < appInSec) {
              firstInTime = bioRecord.first;
              primarySource = "BIOMETRIC";
            }
            if (Math.abs(appInSec - bioInSec) > 300) {
              conflictFlag = true;
              conflictDetails = `Check-In discrepancy > 5 mins (App: ${firstInTime}, Bio: ${bioRecord.first})`;
            }
          }

          if (!lastOutTime && bioRecord.last && bioRecord.last !== bioRecord.first) {
            lastOutTime = bioRecord.last;
            if (primarySource !== "BIOMETRIC") primarySource = "BIOMETRIC";
          } else if (lastOutTime && bioRecord.last) {
            const appOutSec = parseTimeStr(lastOutTime)?.total_seconds || 0;
            const bioOutSec = parseTimeStr(bioRecord.last)?.total_seconds || 0;
            if (bioOutSec > appOutSec) {
              lastOutTime = bioRecord.last;
            }
          }
        }

        // Parse Field Visit if present and unclosed
        if (fvRecord) {
          sourceCount++;
          rawEvidence.push({
            source_name: "FIELD_VISIT",
            source_record_id: fvRecord.id,
            raw_employee_id: empId,
            raw_employee_name: emp.employee_name,
            source_date: d,
            raw_in: fvRecord.checkin_time,
            raw_out: fvRecord.checkout_time,
            raw_status: fvRecord.status,
            ingestion_timestamp: new Date().toISOString(),
          });
          if (!firstInTime && fvRecord.checkin_time) {
            try {
              const parts = attendanceTimestampParts(fvRecord.checkin_time);
              firstInTime = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
              primarySource = "FIELD_VISIT";
            } catch {}
          }
        }

        // Determine Canonical Daily Attendance Status
        let finalStatus: AttendanceStatus = "ABSENT";
        let leaveType: string | null = null;

        if (isHoliday) {
          finalStatus = "HOLIDAY";
          primarySource = "CALENDAR";
        } else if (isWeeklyOff) {
          finalStatus = "WEEKLY_OFF";
          primarySource = "CALENDAR";
        } else if (leaveItem) {
          finalStatus = "APPROVED_LEAVE";
          leaveType = leaveItem.leave_type || "LEAVE";
          primarySource = "LEAVE";
        } else if (firstInTime && lastOutTime) {
          finalStatus = "PRESENT";
        } else if (firstInTime && !lastOutTime) {
          finalStatus = "PRESENT_MISSING_OUT";
        } else if (!firstInTime && lastOutTime) {
          finalStatus = "DATA_EXCEPTION";
          anomalyTypes.push("IMPOSSIBLE_TIME_SEQUENCE");
        } else if (datesWithActivePunches.has(d) || appRecord || bioRecord || fvRecord) {
          finalStatus = "ABSENT";
        } else {
          finalStatus = "NO_SOURCE_DATA";
        }

        // Punctuality Evaluation against configured shift
        const lateEval = evaluateLateArrival(firstInTime, effectiveShiftStart, effectiveGraceMins);

        // Source-Aware 23:59 Auto-Close Isolation
        const isSynthetic2359 = Boolean(
          globalFilter2359 &&
            lastOutTime &&
            (lastOutTime.startsWith("23:59") || lastOutTime === "00:00:00") &&
            primarySource === "APP",
        );

        const durationEval = calculateWorkDuration(firstInTime, lastOutTime, isSynthetic2359);

        // Anomaly Checks
        if (lastOutTime && (lastOutTime.startsWith("23:59") || lastOutTime === "00:00:00")) {
          anomalyTypes.push("REPEATED_2359_CHECKOUT");
        }
        if (durationEval.status === "ANOMALY") {
          anomalyTypes.push("EXCESSIVE_HOURS");
        }
        if (lateEval.is_late && lateEval.late_minutes > 60) {
          anomalyTypes.push("CHRONIC_LATE_ARRIVAL");
        }

        const factRecord: AttendanceFact = {
          fact_id: `${emp.employee_id}_${d}`,
          employee_id: emp.employee_id,
          employee_name: emp.employee_name,
          canonical_employee_id: emp.employee_id,
          date: d,
          office_name: emp.office_name,
          department_name: emp.department_name,
          team_head_name: emp.team_head_name,

          first_in: firstInTime,
          last_out: lastOutTime,
          first_in_iso: firstInIso,
          last_out_iso: lastOutIso,

          status: finalStatus,
          leave_type: leaveType,

          expected_in: effectiveShiftStart,
          is_late: lateEval.is_late,
          late_minutes: lateEval.late_minutes,

          missing_in: !firstInTime && Boolean(lastOutTime),
          missing_out: Boolean(firstInTime) && !lastOutTime,

          worked_minutes: durationEval.worked_minutes,
          worked_hours: durationEval.worked_hours,
          hours_status: durationEval.status,

          leave_flag: Boolean(leaveItem),
          weekly_off_flag: isWeeklyOff,
          holiday_flag: isHoliday,

          source_count: sourceCount,
          primary_source: primarySource,
          source_confidence: sourceCount >= 2 ? 1.0 : sourceCount === 1 ? 0.9 : 0.5,
          raw_evidence: rawEvidence,

          conflict_flag: conflictFlag,
          conflict_details: conflictDetails,
          anomaly_flag: anomalyTypes.length > 0,
          anomaly_types: anomalyTypes,

          calculation_version: "v4.2.0-canonical",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        facts.push(factRecord);
        this.factsByEmpDate.set(factRecord.fact_id, factRecord);
      }
    }

    this.cachedFacts = facts;
    this.currentPeriod = { start: startDate, end: endDate };
    this.currentConfig = config || {};
    return facts;
  }

  public static getFact(employeeId: string, date: string): AttendanceFact | undefined {
    return this.factsByEmpDate.get(`${employeeId}_${date}`);
  }

  public static getCachedFacts(): AttendanceFact[] {
    return this.cachedFacts;
  }
}

