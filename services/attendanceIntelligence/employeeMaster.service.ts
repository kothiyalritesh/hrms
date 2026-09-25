/**
 * ATTENDANCE INTELLIGENCE PLATFORM — CANONICAL EMPLOYEE MASTER SERVICE
 * Single Source of Truth for Employee Identity, Office, Department & Shift Policies.
 */

import { supabase } from "@/lib/supabase";
import { fetchAllPages } from "@/utils/supabasePagination";
import { CanonicalEmployee } from "./types";
import {
  cleanStr,
  normalizeNameKey,
  toTitleCase,
  normalizeTeamHead,
  normalizeOfficeName,
  normalizeDepartmentName,
} from "./normalization";

export class EmployeeMasterService {
  private static cachedEmployees: CanonicalEmployee[] = [];
  private static employeeByIdMap = new Map<string, CanonicalEmployee>();
  private static employeeByNormNameMap = new Map<string, CanonicalEmployee[]>();

  /**
   * Loads and builds the Canonical Employee Master from database profiles.
   */
  public static async loadCanonicalMaster(): Promise<CanonicalEmployee[]> {
    const [profilesRes, officesRes] = await Promise.all([
      fetchAllPages<any>((from, to) =>
        supabase
          .from("profiles")
          .select("id, name, employee_number, smartoffice_employee_code, office_id, team, department, reports_to, role, is_active, show_on_tv, created_at")
          .neq("is_active", false)
          .select("id, name, employee_number, smartoffice_employee_code, office_id, team, department, reports_to, role, is_active, show_on_tv, created_at, attendance_reporting_enabled, last_working_date, joining_date")
          .eq("is_active", true)
          .eq("attendance_reporting_enabled", true)
          .order("name")
          .order("id")
          .range(from, to),
      ),
      fetchAllPages<any>((from, to) =>
        supabase.from("offices").select("id, name").neq("is_active", false).range(from, to),
      ),
    ]);

    const rawProfiles = profilesRes.data ?? [];
    const rawOffices = officesRes.data ?? [];

    const officeMap = new Map<string, string>();
    for (const off of rawOffices) {
      officeMap.set(off.id, off.name);
    }

    // Build manager lookup
    const managerIds = [...new Set(rawProfiles.map((p) => p.reports_to).filter(Boolean))];
    const managerNameMap = new Map<string, string>();
    if (managerIds.length) {
      const { data: mgrRows } = await supabase.from("profiles").select("id, name").in("id", managerIds);
      for (const m of mgrRows || []) {
        managerNameMap.set(m.id, m.name);
      }
    }

    const canonicalList: CanonicalEmployee[] = [];
    this.employeeByIdMap.clear();
    this.employeeByNormNameMap.clear();

    for (const p of rawProfiles) {
      const rawId = cleanStr(p.employee_number || p.smartoffice_employee_code || "");
      const rawName = cleanStr(p.name || "Unknown");
      const normKey = normalizeNameKey(rawName);

      const rawOffice = p.office_id ? officeMap.get(p.office_id) : null;
      const canonicalOffice = normalizeOfficeName(rawOffice);

      const rawTeamHead = p.reports_to
        ? managerNameMap.get(p.reports_to) || p.team || p.department
        : p.team || p.department || "General Operations";
      const canonicalTeamHead = normalizeTeamHead(rawTeamHead);

      const canonicalDept = normalizeDepartmentName(p.department, canonicalTeamHead);

      const empRecord: CanonicalEmployee = {
        profile_id: p.id,
        user_id: p.id,
        employee_id: rawId || p.id,
        raw_employee_id: rawId || null,
        employee_name: rawName,
        normalized_name: normKey,
        canonical_name: toTitleCase(rawName),
        office_id: p.office_id || null,
        office_name: canonicalOffice,
        department_id: null,
        department_name: canonicalDept,
        team_head_id: p.reports_to || null,
        team_head_name: canonicalTeamHead,
        designation: p.role || "Executive",
        role: p.role || null,
        employment_status: "ACTIVE",
        joining_date: p.created_at ? p.created_at.slice(0, 10) : null,
        shift_name: "Standard Morning Shift",
        shift_start: "10:30:00",
        shift_end: "18:30:00",
        grace_minutes: 0,
        match_status: rawId ? "MATCHED_BY_ID" : "MATCHED_BY_NAME",
        resolution_notes: rawId ? "" : "Matched via normalized name key.",
        show_on_tv: p.show_on_tv ?? true,
      };

      canonicalList.push(empRecord);

      // Index by ID
      this.employeeByIdMap.set(empRecord.employee_id, empRecord);
      this.employeeByIdMap.set(p.id, empRecord);
      if (rawId) this.employeeByIdMap.set(rawId, empRecord);

      // Index by Normalized Name
      if (!this.employeeByNormNameMap.has(normKey)) {
        this.employeeByNormNameMap.set(normKey, []);
      }
      this.employeeByNormNameMap.get(normKey)!.push(empRecord);
    }

    this.cachedEmployees = canonicalList;
    return canonicalList;
  }

  /**
   * Deterministic Identity Resolution Engine:
   * Resolves raw employee record to canonical master without ambiguity.
   */
  public static resolveEmployee(rawId?: string | null, rawName?: string | null): {
    matched_employee: CanonicalEmployee | null;
    resolution_type: "MATCHED_BY_ID" | "MATCHED_BY_NAME" | "UNRESOLVED_AMBIGUOUS" | "UNRESOLVED_NOT_FOUND";
    notes: string;
  } {
    const idKey = cleanStr(rawId);
    if (idKey && this.employeeByIdMap.has(idKey)) {
      return {
        matched_employee: this.employeeByIdMap.get(idKey)!,
        resolution_type: "MATCHED_BY_ID",
        notes: `Direct deterministic match on Employee ID: ${idKey}`,
      };
    }

    const nameKey = rawName ? normalizeNameKey(rawName) : "";
    if (nameKey && this.employeeByNormNameMap.has(nameKey)) {
      const candidates = this.employeeByNormNameMap.get(nameKey)!;
      if (candidates.length === 1) {
        return {
          matched_employee: candidates[0],
          resolution_type: "MATCHED_BY_NAME",
          notes: `Deterministic unique match on Normalized Name: ${nameKey}`,
        };
      } else {
        return {
          matched_employee: null,
          resolution_type: "UNRESOLVED_AMBIGUOUS",
          notes: `Ambiguity detected: Multiple (${candidates.length}) employees share name ${rawName}`,
        };
      }
    }

    return {
      matched_employee: null,
      resolution_type: "UNRESOLVED_NOT_FOUND",
      notes: `No matching employee found in Master for ID: '${rawId}', Name: '${rawName}'`,
    };
  }

  public static getAllEmployees(): CanonicalEmployee[] {
    return this.cachedEmployees;
  }
}

