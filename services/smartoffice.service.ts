import { supabase } from "@/lib/supabase";
import * as Crypto from "expo-crypto";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { fetchAllPages } from "@/utils/supabasePagination";

export interface SmartOfficeEmployee {
  id: string;
  employee_code: string;
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  designation?: string;
  grade?: string;
  location?: string;
  company?: string;
  team?: string;
}

export interface SmartOfficeConfig {
  apiAccountName?: string; // Required for employee detail endpoints
  applicationUrl: string;
}

type EmployeeDirectorySource = "OFFICIAL_DIRECTORY" | "DEVICE_LOG_FALLBACK";
type EmployeeDirectory = any[] & { directorySource?: EmployeeDirectorySource };

function tagDirectory(
  rows: any[],
  source: EmployeeDirectorySource,
): EmployeeDirectory {
  Object.defineProperty(rows, "directorySource", {
    value: source,
    enumerable: false,
    configurable: false,
  });
  return rows as EmployeeDirectory;
}

class SmartOfficeService {
  private config: SmartOfficeConfig | null = null;

  // Initialize with API configuration
  setConfig(config: SmartOfficeConfig) {
    this.config = config;
  }

  private async request(url: URL): Promise<Response> {
    const { data, error } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (error || !token) {
      throw new Error("A valid admin session is required for SmartOffice");
    }
    return fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
  }

  // Test API connection
  async testConnection(): Promise<{
    success: boolean;
    message: string;
    data?: any;
  }> {
    try {
      // Test with simple date range (yyyy-MM-dd format only, no time)
      const data = await this.getDeviceLogs("2024-01-01", "2024-01-02");

      // Extract unique employee codes
      const employeeCodes = new Set();
      if (Array.isArray(data)) {
        data.forEach((log: any) => {
          const code = log.EmployeeCode || log.employeeCode;
          if (code) employeeCodes.add(code);
        });
      }

      return {
        success: true,
        message: `Connected successfully! Found ${employeeCodes.size} employees with ${data.length} attendance records.`,
        data: Array.isArray(data) ? data.slice(0, 5) : data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || "Connection failed",
      };
    }
  }

  // Get employee details from SmartOffice API
  async getEmployeeDetails(employeeCode?: string): Promise<any> {
    if (!this.config) throw new Error("SmartOffice not configured");

    // If apiAccountName is configured, try the detailed employee API
    if (this.config.apiAccountName) {
      try {
        const url = new URL(
          "/api/v2/WebAPI/GetEmployeeDetails",
          this.config.applicationUrl,
        );
        url.searchParams.append("APIAccountName", this.config.apiAccountName);
        if (employeeCode) {
          url.searchParams.append("EmployeeCode", employeeCode);
        }

        const response = await this.request(url);

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();

        // Handle response format
        let employees = [];
        if (data && typeof data === "object") {
          if (data.records) employees = data.records;
          else if (data.result) employees = data.result;
          else if (Array.isArray(data)) employees = data;
        }

        // Map to standard format
        const mappedEmployees = employees.map((emp: any) => ({
          employee_code: emp.StaffCode || emp.EmployeeCode || emp.employee_code,
          name:
            emp.StaffName ||
            emp.EmployeeName ||
            emp.name ||
            `Employee ${emp.StaffCode}`,
          email: emp.eMail || emp.email,
          phone: emp.MobileNumber || emp.phone,
          department: emp.DepartmentSName || emp.department,
          designation: emp.Designation || emp.designation,
          grade: emp.Grade || emp.grade,
          location: emp.Location || emp.location,
          company: emp.CompanySName || emp.company,
          team: emp.Team || emp.team,
        }));

        console.log(
          `Found ${mappedEmployees.length} employees from GetEmployeeDetails`,
        );
        return tagDirectory(mappedEmployees, "OFFICIAL_DIRECTORY");
      } catch (error: any) {
        console.error("GetEmployeeDetails Error:", error);
        console.log("Falling back to device logs...");
        return this.getEmployeesFromDeviceLogs(employeeCode);
      }
    }

    // Fallback to device logs if no apiAccountName configured
    return this.getEmployeesFromDeviceLogs(employeeCode);
  }

  // Get employees from device logs (only available source from SmartOffice API)
  private async getEmployeesFromDeviceLogs(
    employeeCode?: string,
  ): Promise<any> {
    try {
      const today = new Date();
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(today.getDate() - 90);

      const fromDate = this.formatDate(ninetyDaysAgo);
      const toDate = this.formatDate(today);

      console.log("Fetching employees from device logs...");
      const deviceLogs = await this.getDeviceLogs(fromDate, toDate);

      const employeeMap = new Map();

      if (Array.isArray(deviceLogs)) {
        deviceLogs.forEach((log: any) => {
          const code = log.EmployeeCode || log.employeeCode;
          if (code && (!employeeCode || code === employeeCode)) {
            if (!employeeMap.has(code)) {
              employeeMap.set(code, {
                employee_code: code,
                name: `Employee ${code}`,
                department: null,
                designation: null,
                company: null,
                location: null,
              });
            }
          }
        });
      }

      const employees = Array.from(employeeMap.values());
      console.log(`Found ${employees.length} employees from device logs`);
      return tagDirectory(employees, "DEVICE_LOG_FALLBACK");
    } catch (error: any) {
      console.error("Device logs fallback error:", error);
      return tagDirectory([], "DEVICE_LOG_FALLBACK");
    }
  }

  // Get detailed attendance logs with employee information
  async getAttendanceLogs(
    fromDate: string,
    toDate: string,
    employeeCode?: string,
  ): Promise<any> {
    if (!this.config) throw new Error("SmartOffice not configured");

    // If apiAccountName is configured, use the detailed attendance API
    if (this.config.apiAccountName) {
      try {
        const url = new URL(
          "/api/v2/WebAPI/GetEmployeeAttendanceLogs",
          this.config.applicationUrl,
        );
        url.searchParams.append("APIAccountName", this.config.apiAccountName);
        url.searchParams.append("FromDate", fromDate);
        url.searchParams.append("ToDate", toDate);
        if (employeeCode) {
          url.searchParams.append("EmployeeCode", employeeCode);
        }

        const response = await this.request(url);

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();

        // Handle response format
        let logs = [];
        if (data && typeof data === "object") {
          if (data.records) logs = data.records;
          else if (data.result) logs = data.result;
          else if (Array.isArray(data)) logs = data;
        }

        return logs;
      } catch (error: any) {
        console.error("GetEmployeeAttendanceLogs Error:", error);
        console.log("Falling back to device logs...");
        return this.getDeviceLogs(fromDate, toDate);
      }
    }

    // Fallback to basic device logs
    return this.getDeviceLogs(fromDate, toDate);
  }

  // Format date to SmartOffice format (yyyy-MM-dd only, no time)
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async getDeviceLogs(
    fromDate: string,
    toDate: string,
    saveToDatabase: boolean = false,
  ): Promise<any> {
    if (!this.config) throw new Error("SmartOffice not configured");

    try {
      const url = new URL(
        "/api/v2/WebAPI/GetDeviceLogs",
        this.config.applicationUrl,
      );
      url.searchParams.set("FromDate", fromDate);
      url.searchParams.set("ToDate", toDate);

      const response = await this.request(url);

      if (!response.ok)
        throw new Error(`API error: ${response.status} ${response.statusText}`);

      const data = await response.json();

      // API returns { status: false, message: '...' } on error
      if (data && data.status === false)
        throw new Error(data.message || data.Message || "API returned error");

      // Normalise response — docs show array or { records: [] } or { result: [] }
      let logs: any[] = [];
      if (Array.isArray(data)) logs = data;
      else if (Array.isArray(data?.records)) logs = data.records;
      else if (Array.isArray(data?.result)) logs = data.result;

      console.log(`GetDeviceLogs: ${logs.length} records`);

      if (saveToDatabase && logs.length > 0)
        await this.saveDeviceLogsToDatabase(logs);

      return logs;
    } catch (error: any) {
      console.error("GetDeviceLogs Error:", error);
      throw error;
    }
  }

  // Save device logs to database
  private async saveDeviceLogsToDatabase(
    logs: any[],
  ): Promise<{ saved: number; errors: string[] }> {
    const errors: string[] = [];
    let saved = 0;

    const recordsToInsert = logs
      .map((log) => ({
        employee_code: log.EmployeeCode || log.employeeCode,
        log_date: log.LogDate || log.logDate,
        serial_number: log.SerialNumber || log.serialNumber,
        punch_direction: log.PunchDirection || log.punchDirection,
        temperature: log.Temperature || log.temperature,
        temperature_state: log.TemperatureState || log.temperatureState,
      }))
      .filter((record) => record.employee_code && record.log_date);

    if (recordsToInsert.length) {
      errors.push(
        "Direct device-log writes are disabled. Run the protected biometric sync.",
      );
    }

    console.log(
      `Saved ${saved}/${recordsToInsert.length} device logs to database`,
    );
    return { saved, errors };
  }

  async syncEmployeeProfilesBatch(employeeData: any[]): Promise<{
    batchId: string;
    submitted: number;
    updated: number;
    rejected: number;
    unmatched: number;
  }> {
    if (!Array.isArray(employeeData)) {
      throw new Error("Invalid employee data format from SmartOffice.");
    }
    if (
      (employeeData as EmployeeDirectory).directorySource !==
      "OFFICIAL_DIRECTORY"
    ) {
      throw new Error(
        "Permanent profile refresh is blocked because the official SmartOffice employee directory was unavailable. Device-log fallback rows are read-only.",
      );
    }
    const { data: profiles, error: profileError } = await fetchAllPages<{
      id: string;
      smartoffice_employee_code: string | null;
    }>((from, to) =>
      supabase
        .from("profiles")
        .select("id,smartoffice_employee_code")
        .eq("is_active", true)
        .not("smartoffice_employee_code", "is", null)
        .order("id")
        .range(from, to),
    );
    if (profileError) {
      throw new Error(`Employee lookup failed: ${profileError.message}`);
    }
    const localCodes = new Set(
      (profiles ?? []).map((profile) =>
        String(profile.smartoffice_employee_code).trim().toLowerCase(),
      ),
    );
    const normalized = employeeData.map((employee) => {
      const employeeCode = String(
        employee.StaffCode ?? employee.employee_code ?? "",
      ).trim();
      return {
        employee_code: employeeCode,
        name:
          employee.StaffName ??
          employee.name ??
          (employeeCode ? `Employee ${employeeCode}` : ""),
        email: employee.eMail ?? employee.email ?? null,
        phone: employee.MobileNumber ?? employee.phone ?? null,
        smartoffice_department:
          employee.DepartmentSName ?? employee.department ?? null,
        smartoffice_designation:
          employee.Designation ?? employee.designation ?? null,
        smartoffice_grade: employee.Grade ?? employee.grade ?? null,
        smartoffice_location: employee.Location ?? employee.location ?? null,
        smartoffice_company: employee.CompanySName ?? employee.company ?? null,
        smartoffice_team: employee.Team ?? employee.team ?? null,
      };
    });
    if (normalized.some((row) => !row.employee_code)) {
      throw new Error(
        "SmartOffice returned employee rows without a verified employee code.",
      );
    }
    const codeCounts = new Map<string, number>();
    for (const row of normalized) {
      const key = row.employee_code.toLowerCase();
      codeCounts.set(key, (codeCounts.get(key) ?? 0) + 1);
    }
    if ([...codeCounts.values()].some((count) => count > 1)) {
      throw new Error("SmartOffice returned duplicate employee codes.");
    }
    const rows = normalized.filter((row) =>
      localCodes.has(row.employee_code.toLowerCase()),
    );
    const unmatched = normalized.length - rows.length;
    if (!rows.length) {
      throw new Error("No SmartOffice codes match active HRMS profiles.");
    }

    const payloadHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(rows),
    );
    const batchId = Crypto.randomUUID();
    const invoke = () =>
      supabase.rpc("rpc_admin_sync_smartoffice_profiles_batch", {
        p_batch_id: batchId,
        p_payload_hash: payloadHash,
        p_rows: rows,
      });
    let rpcResult = await invoke();
    if (rpcResult.error) rpcResult = await invoke();
    if (rpcResult.error) throw rpcResult.error;
    const response = firstRpcRow<any>(rpcResult.data);
    if (
      response?.success !== true ||
      response?.transaction_status !== "COMMITTED" ||
      String(response?.batch_id).toLowerCase() !== batchId.toLowerCase() ||
      String(response?.payload_hash).toLowerCase() !== payloadHash ||
      Number(response?.submitted_count) !== rows.length ||
      Number(response?.updated_count) !== rows.length ||
      Number(response?.rejected_count) !== 0
    ) {
      throw new Error(
        "The server did not confirm the complete SmartOffice refresh.",
      );
    }
    return {
      batchId,
      submitted: rows.length,
      updated: rows.length,
      rejected: 0,
      unmatched,
    };
  }

  // Sync employees from SmartOffice to local database
  async syncEmployees(): Promise<{ synced: number; errors: string[] }> {
    if (!this.config) throw new Error("SmartOffice not configured");
    try {
      const employeeData = await this.getEmployeeDetails();
      const result = await this.syncEmployeeProfilesBatch(employeeData);
      return {
        synced: result.updated,
        errors: result.unmatched
          ? [
              `${result.unmatched} SmartOffice employees are not linked to active HRMS profiles.`,
            ]
          : [],
      };
    } catch (error: any) {
      throw new Error(`Sync failed: ${error.message}`);
    }
  }

  // Permanent automatic links require a unique stable identifier. Names are
  // intentionally excluded because similar/duplicate names are not identity.
  async autoMatchEmployees(): Promise<{ matched: number; suggestions: any[] }> {
    const suggestions: any[] = [];
    let matched = 0;

    try {
      // Get unmatched SmartOffice employees (no smartoffice_employee_code)
      const { data: localEmployees, error: employeeError } =
        await fetchAllPages<any>((from, to) =>
          supabase
            .from("profiles")
            .select(
              "id, name, email, phone, employee_number, smartoffice_employee_code, is_active",
            )
            .is("smartoffice_employee_code", null)
            .order("id")
            .range(from, to),
        );
      if (employeeError) {
        throw new Error(`Employee lookup failed: ${employeeError.message}`);
      }

      if (!localEmployees || localEmployees.length === 0) {
        return { matched, suggestions };
      }

      // Get SmartOffice employees
      const smartOfficeEmployees = await this.getEmployeeDetails();

      if (!smartOfficeEmployees || !Array.isArray(smartOfficeEmployees)) {
        throw new Error("Could not fetch SmartOffice employees");
      }

      const normalizedPhone = (value: unknown) =>
        String(value ?? "").replace(/\D/g, "");
      const normalizedText = (value: unknown) =>
        String(value ?? "")
          .trim()
          .toLowerCase();
      const candidates = new Map<string, any[]>();

      for (const localEmp of localEmployees) {
        const localEmail = normalizedText(localEmp.email);
        const localPhone = normalizedPhone(localEmp.phone);
        const localNumber = normalizedText(localEmp.employee_number);
        const matches = smartOfficeEmployees.filter((soEmp: any) => {
          const code = normalizedText(soEmp.employee_code);
          const email = normalizedText(soEmp.email);
          const phone = normalizedPhone(soEmp.phone);
          return Boolean(
            (localNumber && code && localNumber === code) ||
              (localEmail && email && localEmail === email) ||
              (localPhone.length >= 8 &&
                phone.length >= 8 &&
                localPhone === phone),
          );
        });
        candidates.set(localEmp.id, matches);
      }

      const candidateCodeOwners = new Map<string, string[]>();
      for (const localEmp of localEmployees) {
        const matches = candidates.get(localEmp.id) ?? [];
        if (matches.length === 1) {
          const code = normalizedText(matches[0].employee_code);
          if (code) {
            candidateCodeOwners.set(code, [
              ...(candidateCodeOwners.get(code) ?? []),
              localEmp.id,
            ]);
          }
        }
      }

      const mappings: { profile_id: string; employee_code: string }[] = [];
      for (const localEmp of localEmployees) {
        const matches = candidates.get(localEmp.id) ?? [];
        if (
          matches.length === 1 &&
          candidateCodeOwners.get(normalizedText(matches[0].employee_code))
            ?.length === 1
        ) {
          mappings.push({
            profile_id: localEmp.id,
            employee_code: String(matches[0].employee_code).trim(),
          });
        } else if (matches.length > 0) {
          suggestions.push({
            localEmployee: localEmp,
            potentialMatches: matches,
          });
        }
      }

      if (mappings.length) {
        const { data, error } = await supabase.rpc(
          "rpc_assign_biometric_employee_codes_batch",
          { p_mappings: mappings },
        );
        if (error) throw error;
        const response = firstRpcRow<any>(data);
        if (
          response?.success !== true ||
          Number(response?.updated) !== mappings.length
        ) {
          throw new Error(
            "Server did not confirm the complete automatic mapping batch.",
          );
        }
        matched = mappings.length;
      }

      return { matched, suggestions };
    } catch (error: any) {
      throw new Error(`Auto-match failed: ${error.message}`);
    }
  }

  // Manual match employee
  async matchEmployee(
    localEmployeeId: string,
    smartofficeEmployeeCode: string,
  ): Promise<void> {
    const { data, error } = await supabase.rpc(
      "rpc_assign_biometric_employee_code",
      {
        p_profile_id: localEmployeeId,
        p_employee_code: smartofficeEmployeeCode,
      },
    );

    if (error) {
      throw new Error(`Failed to match employee: ${error.message}`);
    }
    const response = firstRpcRow<any>(data);
    if (
      response?.success !== true ||
      response?.profile_id !== localEmployeeId ||
      response?.employee_code !== smartofficeEmployeeCode
    )
      throw new Error("Server did not confirm the biometric mapping.");
  }

  // Sync attendance data from SmartOffice device logs
  async syncAttendanceData(
    fromDate?: string,
    toDate?: string,
  ): Promise<{ synced: number; errors: string[] }> {
    if (!this.config) throw new Error("SmartOffice not configured");

    const errors: string[] = [];
    let synced = 0;

    try {
      // Default to today if no dates provided
      const today = new Date();
      const startDate = fromDate ? new Date(fromDate) : today;
      const endDate = toDate ? new Date(toDate) : today;

      // Get device logs from SmartOffice
      const deviceLogs = await this.getDeviceLogs(
        this.formatDate(startDate),
        this.formatDate(endDate),
      );

      if (!Array.isArray(deviceLogs)) {
        throw new Error("Invalid device logs data format from SmartOffice");
      }

      console.log(`Received ${deviceLogs.length} device logs from SmartOffice`);

      // Active employees with SmartOffice codes (punches of people who left
      // must not be applied to attendance).
      const { data: localEmployees, error: employeeError } =
        await fetchAllPages<any>((from, to) =>
          supabase
            .from("profiles")
            .select("id, smartoffice_employee_code")
            .eq("is_active", true)
            .not("smartoffice_employee_code", "is", null)
            .order("id")
            .range(from, to),
        );
      if (employeeError) {
        throw new Error(
          `Employee mapping lookup failed: ${employeeError.message}`,
        );
      }

      const codeToIdMap = new Map<string, string>();
      localEmployees?.forEach((emp: any) => {
        if (emp.smartoffice_employee_code) {
          codeToIdMap.set(emp.smartoffice_employee_code, emp.id);
        }
      });

      // Group logs by employee and date to create daily attendance records
      const attendanceMap = new Map<string, any>();

      for (const log of deviceLogs) {
        try {
          const empCode = log.EmployeeCode || log.employeeCode;
          const logDate = log.LogDate || log.logDate;

          if (!empCode || !logDate) continue;

          const employeeId = codeToIdMap.get(empCode);
          if (!employeeId) continue;

          // Parse date from log (format: "2019-09-16 13:45:29")
          const date = logDate.split(" ")[0];
          const time = logDate;

          const key = `${employeeId}_${date}`;

          if (!attendanceMap.has(key)) {
            attendanceMap.set(key, {
              user_id: employeeId,
              date: date,
              checkin_time: time,
              checkout_time: null,
              status: "CHECKED_IN",
              attendance_type: "OFFICE",
              smartoffice_synced: true,
              biometric_first_punch: time.replace(" ", "T") + "+05:30",
              biometric_last_punch: time.replace(" ", "T") + "+05:30",
              biometric_punch_count: 1,
            });
          } else {
            // AUTO-CHECKOUT REMOVED: later punches are NOT treated as a
            // checkout. Only keep the earliest punch as the check-in time.
            // Checkout happens only from HRMS Check Out or protected day-end.
            const existing = attendanceMap.get(key);
            if (time < existing.checkin_time) {
              existing.checkin_time = time;
              existing.biometric_first_punch =
                time.replace(" ", "T") + "+05:30";
            }
            if (
              time.replace(" ", "T") + "+05:30" >
              existing.biometric_last_punch
            ) {
              existing.biometric_last_punch = time.replace(" ", "T") + "+05:30";
            }
            existing.biometric_punch_count += 1;
          }
        } catch (recordError: any) {
          errors.push(`Error processing log: ${recordError.message}`);
        }
      }

      for (const key of attendanceMap.keys()) {
        errors.push(
          `${key}: direct attendance writes are disabled; run the protected biometric sync`,
        );
      }

      return { synced, errors };
    } catch (error: any) {
      throw new Error(`Attendance sync failed: ${error.message}`);
    }
  }

  // Get available employee codes from SmartOffice
  async getAvailableEmployeeCodes(): Promise<string[]> {
    try {
      const employeeData = await this.getEmployeeDetails();

      if (!Array.isArray(employeeData)) {
        return [];
      }

      return employeeData.map((emp) => emp.employee_code).filter(Boolean);
    } catch (error) {
      console.error("Failed to get employee codes:", error);
      return [];
    }
  }

  // Bulk import employees with their SmartOffice codes
  async bulkImportEmployees(
    employeeCodes: string[],
  ): Promise<{ imported: number; errors: string[] }> {
    if (!this.config) throw new Error("SmartOffice not configured");

    const errors: string[] = [];
    let imported = 0;

    try {
      for (const code of employeeCodes) {
        try {
          const employeeData = await this.getEmployeeDetails(code);

          if (
            !employeeData ||
            !Array.isArray(employeeData) ||
            employeeData.length === 0
          ) {
            errors.push(`No data found for employee code: ${code}`);
            continue;
          }

          const emp = employeeData[0];

          // Check if employee already exists
          const { data: existingEmployee } = await supabase
            .from("profiles")
            .select("id")
            .eq("smartoffice_employee_code", code)
            .single();

          if (existingEmployee) {
            errors.push(`Employee ${emp.name} (${code}) already imported`);
            continue;
          }

          // Only update existing employee's code — never insert new profiles
          const { data: existingByCode } = await supabase
            .from("profiles")
            .select("id")
            .eq("smartoffice_employee_code", code)
            .single();

          if (!existingByCode) {
            errors.push(
              `No matching profile found for code ${code} — skipped (use manual match instead)`,
            );
            continue;
          }
        } catch (empError: any) {
          errors.push(`Error importing employee ${code}: ${empError.message}`);
        }
      }

      return { imported, errors };
    } catch (error: any) {
      throw new Error(`Bulk import failed: ${error.message}`);
    }
  }

  // Get sync status
  async getSyncStatus(): Promise<{
    totalLocal: number;
    totalMatched: number;
    lastSyncDate?: string;
    connectionStatus: "connected" | "error" | "unknown";
  }> {
    const { data: totalData, count: totalLocal } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    const { data: matchedData, count: totalMatched } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .not("smartoffice_employee_code", "is", null);

    const { data: lastSync } = await supabase
      .from("profiles")
      .select("smartoffice_synced_at")
      .not("smartoffice_synced_at", "is", null)
      .order("smartoffice_synced_at", { ascending: false })
      .limit(1)
      .single();

    // Test connection status
    let connectionStatus: "connected" | "error" | "unknown" = "unknown";
    try {
      const testResult = await this.testConnection();
      connectionStatus = testResult.success ? "connected" : "error";
    } catch {
      connectionStatus = "error";
    }

    return {
      totalLocal: totalLocal || 0,
      totalMatched: totalMatched || 0,
      lastSyncDate: lastSync?.smartoffice_synced_at,
      connectionStatus,
    };
  }

  // Sync ALL device logs from SmartOffice and save to database
  async syncAllDeviceLogs(
    fromDate: string,
    toDate: string,
  ): Promise<{ synced: number; errors: string[] }> {
    if (!this.config) throw new Error("SmartOffice not configured");

    try {
      console.log(`Syncing all device logs from ${fromDate} to ${toDate}...`);
      const logs = await this.getDeviceLogs(fromDate, toDate, true);

      return {
        synced: Array.isArray(logs) ? logs.length : 0,
        errors: [],
      };
    } catch (error: any) {
      throw new Error(`Failed to sync device logs: ${error.message}`);
    }
  }
}

export const smartOfficeService = new SmartOfficeService();

// Initialize with your API key
smartOfficeService.setConfig({
  apiAccountName: "smart", // Your SmartOffice account name
  applicationUrl: `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/smartoffice-proxy`,
});
