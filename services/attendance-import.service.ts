import { supabase } from '@/lib/supabase';
import * as XLSX from 'xlsx';
import { formatDate } from '@/utils/format';
import { BusinessClockService } from '@/services/business-clock.service';
import { parseIndiaCalendarDate } from '@/utils/indiaCalendarDate';
import { firstRpcRow } from '@/utils/supabaseRpc';
import { fetchAllPages } from '@/utils/supabasePagination';

export interface AttendanceRecord {
  attendanceDate: string;   // YYYY-MM-DD
  attendanceDateLabel: string; // DD-Mon-YYYY display
  employeeCode: string;
  employeeName: string;
  department: string;
  actualInTime: string;     // HH:MM:SS or ''
  actualOutTime: string;    // HH:MM:SS or ''
  status: 'Present' | 'Absent' | 'Week Off' | 'Not Marked' | 'Incomplete';
  workingHours: string;     // H:MM:SS or 'Incomplete' or '0:00:00'
  location: string;
  remarks: string;
}

export interface EmployeeMatchResult {
  systemEmployee: { id: string; name: string; email: string; department: string; smartoffice_employee_code?: string };
  smartOfficeName: string | null;
  smartOfficeCode: string | null;
  matched: boolean;
  recordCount: number;
  records: AttendanceRecord[];
}

export interface AttendanceImportResult {
  imported: number;
  submittedPunches: number;
  insertedPunches: number;
  duplicatePunches: number;
  rejectedPunches: number;
  batchId: string;
  transactionStatus: 'COMMITTED';
  errors: string[];
}

class AttendanceImportService {
  // ── Parse wide-format biometric Excel (emp per row, dates as columns) ──────
  parseExcelFile(file: File): Promise<AttendanceRecord[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, {
            type: 'binary', cellDates: false, cellText: false, cellNF: false, raw: true,
          });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
          const cellCount = (range.e.r + 1) * (range.e.c + 1);
          if (cellCount > 1_000_000) {
            throw new Error(
              'The workbook is too large to verify safely in the browser. Split it into smaller files.',
            );
          }
          const allRecords: AttendanceRecord[] = [];
          const seen = new Set<string>();

          // Row 0 = header: col0=EmpCode, col1=EmpName, col2=Dept, col3+=dates
          const dateCols: { col: number; dt: Date; label: string; iso: string }[] = [];
          const detectedYear = this._detectYear(ws, range);

          for (let c = 3; c <= range.e.c; c++) {
            const hCell = ws[XLSX.utils.encode_cell({ r: 0, c })];
            if (!hCell) continue;
            const parsed = this._parseHeaderDate(String(hCell.v ?? hCell.w ?? '').trim(), detectedYear);
            if (parsed) dateCols.push({ ...parsed, col: c });
          }

          if (!dateCols.length) {
            const hasMatrixDateWithoutYear = Array.from(
              { length: Math.max(0, range.e.c - 2) },
              (_, offset) => {
                const cell = ws[
                  XLSX.utils.encode_cell({ r: 0, c: offset + 3 })
                ];
                return /^\d{1,2}[-/][A-Za-z]+(?:[-/]\d{4})?$/.test(
                  String(cell?.v ?? cell?.w ?? '').trim(),
                );
              },
            ).some(Boolean);
            if (hasMatrixDateWithoutYear && detectedYear === null) {
              throw new Error(
                'Matrix attendance files must include a four-digit year in every date header, for example 01-May-2026.',
              );
            }
            // Fallback: try SmartOffice row-per-punch format
            return resolve(this._parseFlatFormat(ws, range));
          }

          for (let r = 1; r <= range.e.r; r++) {
            const codeCell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
            const nameCell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
            const deptCell = ws[XLSX.utils.encode_cell({ r, c: 2 })];

            const empCode = String(codeCell?.v ?? codeCell?.w ?? '').trim();
            const empName = String(nameCell?.v ?? nameCell?.w ?? '').trim();
            const dept    = String(deptCell?.v ?? deptCell?.w ?? '').trim();

            if (!empCode || !empName) continue;

            for (const { col, label, iso } of dateCols) {
              const key = `${empCode}_${iso}`;
              if (seen.has(key)) continue;
              seen.add(key);

              const dataCell = ws[XLSX.utils.encode_cell({ r, c: col })];
              const raw = String(dataCell?.v ?? dataCell?.w ?? '').trim();

              const { cin, cout, status } = this._parseAttendanceCell(raw);
              const workingHours = this._calcHours(cin, cout, status);

              allRecords.push({
                attendanceDate: iso,
                attendanceDateLabel: label,
                employeeCode: empCode,
                employeeName: empName,
                department: dept,
                actualInTime: cin,
                actualOutTime: cout,
                status,
                workingHours,
                location: '',
                remarks: '',
              });
            }
          }

          // Sort by empCode then date
          allRecords.sort((a, b) =>
            a.employeeCode.padStart(10, '0').localeCompare(b.employeeCode.padStart(10, '0')) ||
            a.attendanceDate.localeCompare(b.attendanceDate)
          );
          resolve(allRecords);
        } catch (err: any) {
          reject(new Error(`Failed to parse Excel: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsBinaryString(file);
    });
  }

  // ── Download normalized Excel from parsed records ─────────────────────────
  // Produces 4 sheets:
  //   1. "Biometric (Device)" — raw device punches from the uploaded file
  //   2. "App Check-ins"      — HRMS app check-ins fetched from attendance_logs
  //   3. "Attendance"         — normalized merged view (same as before)
  //   4. "Summary"            — per-employee totals (same as before)
  async downloadNormalizedExcel(records: AttendanceRecord[], filename = 'attendance_normalized.xlsx') {
    const wb = XLSX.utils.book_new();

    // ── Derive date range from the uploaded records ──────────────────────────
    const allDates = [...new Set(records.map(r => r.attendanceDate))].sort();
    const minDate =
      allDates[0] ?? (await BusinessClockService.getDate(true));
    const maxDate  = allDates[allDates.length - 1] ?? minDate;

    // ── Sheet 1: Biometric (Device) ─────────────────────────────────────────
    // Raw punches from smartoffice_device_logs for the same date range.
    // Each row = one punch event from the physical biometric device.
    let bioRows: any[][] = [];
    try {
      const { data: deviceLogs, error: deviceLogsError } = await fetchAllPages<any>(
        (from, to) => supabase
          .from('smartoffice_device_logs')
          .select('id, employee_code, log_date_only, log_time, punch_direction, serial_number, profiles(name, employee_number, department)')
          .gte('log_date_only', minDate)
          .lte('log_date_only', maxDate)
          .order('log_date_only', { ascending: true })
          .order('log_time',      { ascending: true })
          .order('id')
          .range(from, to),
      );
      if (deviceLogsError) throw deviceLogsError;

      // Group by employee + date to derive first-in / last-out per day
      const bioMap = new Map<string, {
        empCode: string; name: string; empNo: string; dept: string;
        date: string; punches: string[]; firstIn: string; lastOut: string;
      }>();

      for (const row of (deviceLogs ?? [])) {
        const profile   = (row.profiles as any) ?? {};
        const empCode   = row.employee_code  ?? '';
        const name      = profile.name       ?? empCode;
        const empNo     = profile.employee_number ?? '';
        const dept      = profile.department  ?? '';
        const date      = row.log_date_only   ?? '';
        const time      = row.log_time        ?? '';
        const key       = `${empCode}__${date}`;
        if (!bioMap.has(key)) {
          bioMap.set(key, { empCode, name, empNo, dept, date, punches: [], firstIn: '', lastOut: '' });
        }
        const entry = bioMap.get(key)!;
        entry.punches.push(time);
      }

      // Derive first-in / last-out from sorted punches
      for (const entry of bioMap.values()) {
        entry.punches.sort();
        entry.firstIn  = entry.punches[0]  ?? '';
        entry.lastOut  = entry.punches[entry.punches.length - 1] ?? '';
        if (entry.firstIn === entry.lastOut) entry.lastOut = ''; // only one punch — no checkout
      }

      const bioHeaders = [
        'Emp Code', 'Employee Name', 'Emp No', 'Department', 'Date',
        'First Punch (Check-In)', 'Last Punch (Check-Out)', 'Total Punches', 'All Punch Times',
      ];
      bioRows = [bioHeaders];
      for (const e of [...bioMap.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))) {
        bioRows.push([
          e.empCode, e.name, e.empNo, e.dept, e.date,
          e.firstIn, e.lastOut, e.punches.length, e.punches.join(' | '),
        ]);
      }
    } catch (err: any) {
      throw new Error(`Biometric report query failed: ${err?.message ?? err}`);
    }
    const wsBio = XLSX.utils.aoa_to_sheet(bioRows);
    wsBio['!cols'] = [11, 26, 10, 22, 12, 22, 22, 13, 40].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsBio, 'Biometric (Device)');

    // ── Sheet 2: App Check-ins ───────────────────────────────────────────────
    // Rows from attendance_logs where attendance_type = 'APP' (or not BIOMETRIC)
    // for the same date range — these are employees who used the mobile app.
    let appRows: any[][] = [];
    try {
      const { data: appLogs, error: appLogsError } = await supabase
        .from('attendance_logs')
        .select('user_id, date, checkin_time, checkout_time, status, checkout_source, early_checkout_reason, distance_from_office, corrected_by, profiles(name, employee_number, department)')
        .gte('date', minDate)
        .lte('date', maxDate)
        .neq('attendance_type', 'BIOMETRIC')
        .order('date',         { ascending: true })
        .order('checkin_time', { ascending: true });
      if (appLogsError) throw appLogsError;

      function fmtISTTime(iso: string | null): string {
        if (!iso) return '';
        try {
          const s = iso.includes('T') ? iso : iso.replace(' ', 'T');
          const w = s.includes('+') || s.endsWith('Z') ? s : s + '+05:30';
          return new Date(w).toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false, timeZone: 'Asia/Kolkata',
          });
        } catch { return iso ?? ''; }
      }

      const resolveCheckoutType = (row: any) => this._resolveCheckoutType(row);
      const appHeaders = [
        'Employee Name', 'Emp No', 'Department', 'Date',
        'App Check-In (IST)', 'App Check-Out (IST)',
        'Status', 'Checkout Type', 'Distance from Office (m)', 'Early Checkout Reason',
      ];
      appRows = [appHeaders];
      for (const row of (appLogs ?? [])) {
        const profile  = (row.profiles as any) ?? {};
        const name     = profile.name            ?? row.user_id;
        const empNo    = profile.employee_number ?? '';
        const dept     = profile.department       ?? '';
        appRows.push([
          name, empNo, dept, row.date,
          fmtISTTime(row.checkin_time),
          fmtISTTime(row.checkout_time),
          row.status ?? '',
          resolveCheckoutType(row),
          row.distance_from_office ?? '',
          row.early_checkout_reason ?? '',
        ]);
      }
    } catch (err: any) {
      throw new Error(`App attendance report query failed: ${err?.message ?? err}`);
    }
    const wsApp = XLSX.utils.aoa_to_sheet(appRows);
    wsApp['!cols'] = [26, 10, 22, 12, 22, 22, 14, 20, 22, 36].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsApp, 'App Check-ins');

    // ── Sheet 3: Normalized Attendance (uploaded file) ───────────────────────
    const headers = ['Emp Code','EMP Name','Department','Date','Check-In Time','Check-Out Time','Status','Working Hours'];
    const aoa: any[][] = [headers];
    for (const r of records) {
      aoa.push([r.employeeCode, r.employeeName, r.department, r.attendanceDateLabel,
                r.actualInTime, r.actualOutTime, r.status, r.workingHours]);
    }
    const ws1 = XLSX.utils.aoa_to_sheet(aoa);
    ws1['!cols'] = [10,26,22,14,14,14,13,14].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws1, 'Attendance');

    // ── Sheet 4: Summary ────────────────────────────────────────────────────
    const empMap = new Map<string, {
      name: string; dept: string;
      present: number; absent: number; weekoff: number; notmarked: number;
      totalSecs: number;
    }>();

    for (const r of records) {
      if (!empMap.has(r.employeeCode)) {
        empMap.set(r.employeeCode, { name: r.employeeName, dept: r.department,
          present: 0, absent: 0, weekoff: 0, notmarked: 0, totalSecs: 0 });
      }
      const agg = empMap.get(r.employeeCode)!;
      if      (r.status === 'Present')    { agg.present++;   agg.totalSecs += this._hmsToSecs(r.workingHours); }
      else if (r.status === 'Absent')     agg.absent++;
      else if (r.status === 'Week Off')   agg.weekoff++;
      else                                agg.notmarked++;
    }

    const sHeaders = ['Emp Code','EMP Name','Department',
      'Total Present','Total Absent','Total Week Off','Not Marked',
      'Total Working Hours','Avg Daily Hours','Attendance Rate (%)'];
    const saoa: any[][] = [sHeaders];
    for (const [code, agg] of empMap) {
      const workdays = agg.present + agg.absent + agg.notmarked;
      const rate = workdays > 0 ? ((agg.present / workdays) * 100).toFixed(1) + '%' : '0%';
      const th = agg.totalSecs; const h = Math.floor(th/3600); const m = Math.floor((th%3600)/60);
      const avgSecs = agg.present > 0 ? agg.totalSecs / agg.present : 0;
      const ah = Math.floor(avgSecs/3600); const am = Math.floor((avgSecs%3600)/60);
      saoa.push([code, agg.name, agg.dept,
        agg.present, agg.absent, agg.weekoff, agg.notmarked,
        `${h}:${String(m).padStart(2,'0')}`,
        `${ah}:${String(am).padStart(2,'0')}`,
        rate]);
    }
    const ws2 = XLSX.utils.aoa_to_sheet(saoa);
    ws2['!cols'] = [10,26,22,13,13,13,11,18,14,18].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

    XLSX.writeFile(wb, filename);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  // Derive a human-readable checkout type label from an attendance_logs row.
  // Maps checkout_source + status combinations to the 6 report categories.
  private _resolveCheckoutType(row: any): string {
    if (!row.checkout_time) return row.status === 'CHECKED_IN' ? 'Active' : 'No Checkout';
    const src = (row.checkout_source ?? '').toUpperCase();
    if (src === 'ADMIN')       return 'Admin Corrected';
    if (src === 'SYSTEM')      return row.status === 'CHECKED_OUT' ? 'Auto Closed' : 'Missed Checkout';
    if (src === 'APP_EARLY')   return 'Early Checkout';
    if (row.corrected_by)      return 'Admin Corrected';
    if (row.status === 'CHECKOUT_REQUESTED') return 'Pending Approval';
    return 'Normal Checkout';
  }


  private _detectYear(ws: any, range: any): number | null {
    for (let c = 3; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      const v = String(cell?.v ?? cell?.w ?? '');
      const m = v.match(/\d{4}/);
      if (m) return parseInt(m[0]);
    }
    return null;
  }

  private _parseHeaderDate(header: string, year: number | null): { col: number; dt: Date; label: string; iso: string } | null {
    const MONTHS: Record<string, number> = {
      jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12
    };
    // DD-Mon-YYYY or DD-Mon
    const m = header.match(/^(\d{1,2})[\-\/]([A-Za-z]+)(?:[\-\/](\d{4}))?/);
    if (!m) return null;
    const day = parseInt(m[1]);
    const mon = m[2].toLowerCase().slice(0, 3);
    const yr  = m[3] ? parseInt(m[3]) : year;
    if (!MONTHS[mon] || yr === null) return null;
    const dt  = new Date(yr, MONTHS[mon] - 1, day);
    if (
      dt.getFullYear() !== yr ||
      dt.getMonth() !== MONTHS[mon] - 1 ||
      dt.getDate() !== day
    ) return null;
    const iso = `${yr}-${String(MONTHS[mon]).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const label = dt.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }).replace(/ /g,'-');
    return { col: 0, dt, label, iso }; // col will be set by caller
  }

  private _parseAttendanceCell(raw: string): { cin: string; cout: string; status: AttendanceRecord['status'] } {
    const s = raw.trim();
    if (!s)         return { cin: '', cout: '', status: 'Not Marked' };
    if (/^wo$/i.test(s)) return { cin: '', cout: '', status: 'Week Off' };
    if (/^a$/i.test(s))  return { cin: '', cout: '', status: 'Absent' };

    // Split on newlines or common separators
    const parts = s.split(/[\n\r]+/).map(p => p.trim()).filter(p => /^\d{1,2}:\d{2}/.test(p));
    if (!parts.length) return { cin: '', cout: '', status: 'Not Marked' };

    const cin  = parts[0] ?? '';
    let   cout = parts[1] ?? '';
    if (cout === '00:00' || cout === '00:00:00') cout = '';
    return { cin, cout, status: 'Present' };
  }

  private _calcHours(cin: string, cout: string, status: AttendanceRecord['status']): string {
    if (status !== 'Present') return '0:00:00';
    if (!cin) return '0:00:00';
    if (!cout) return 'Incomplete';
    const toSecs = (t: string) => {
      const p = t.split(':'); return (+p[0])*3600 + (+p[1])*60 + (+(p[2]??0));
    };
    let diff = toSecs(cout) - toSecs(cin);
    if (diff < 0) diff += 86400;
    const h = Math.floor(diff/3600); const m = Math.floor((diff%3600)/60); const s = diff%60;
    return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  private _hmsToSecs(hms: string): number {
    if (!hms || hms === 'Incomplete' || hms === '0:00:00') return 0;
    const p = hms.split(':'); return (+p[0])*3600 + (+(p[1]??0))*60 + (+(p[2]??0));
  }

  // Fallback: original SmartOffice row-per-punch format
  private _parseFlatFormat(ws: any, range: any): AttendanceRecord[] {
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '', blankrows: false, raw: false });
    return rows.map((row: any) => {
      const rawDate = String(row['AttendanceDate'] || row['Attendance Date'] || row['Date'] || '').trim();
      const parsedDate = this.parseDate(rawDate) ?? '';
      return {
      attendanceDate: parsedDate,
      attendanceDateLabel: rawDate,
      employeeCode: row['Employee Code'] || row['Emp Code'] || row['EmpCode'] || row['employee_number'] || '',
      employeeName: row['EmployeeName'] || row['Employee Name'] || row['Name'] || row['name'] || '',
      department: row['Department'] || '',
      actualInTime: row['A. InTime'] || row['InTime'] || row['In Time'] || row['CheckIn'] || '',
      actualOutTime: row['A.OutTime'] || row['OutTime'] || row['Out Time'] || row['CheckOut'] || '',
      status: (row['Status'] || 'Not Marked') as AttendanceRecord['status'],
      workingHours: '0:00:00',
      location: row['Location'] || '',
      remarks: row['Remarks'] || '',
      };
    }).filter((r: AttendanceRecord) => (r.employeeCode || r.employeeName) && r.attendanceDate);
  }

  // READ-ONLY: just compares system employees against SmartOffice file, no DB writes
  async matchEmployees(records: AttendanceRecord[]): Promise<EmployeeMatchResult[]> {
    const { data: systemEmployees, error } = await fetchAllPages<any>(
      (from, to) =>
        supabase
          .from('profiles')
          .select('id, name, email, department, smartoffice_employee_code, is_active')
          .order('id')
          .range(from, to),
    );

    if (error) throw error;
    if (!systemEmployees?.length) throw new Error('No employees found in system.');

    const byCode = new Map<string, AttendanceRecord[]>();
    const withoutCode = new Map<string, AttendanceRecord[]>();

    for (const rec of records) {
      const key = rec.employeeCode.trim().toLowerCase();
      if (key) {
        if (!byCode.has(key)) byCode.set(key, []);
        byCode.get(key)!.push(rec);
      } else {
        const noCodeKey = rec.employeeName.trim().toLowerCase() || '(unnamed)';
        if (!withoutCode.has(noCodeKey)) withoutCode.set(noCodeKey, []);
        withoutCode.get(noCodeKey)!.push(rec);
      }
    }

    const codeOwnerCount = new Map<string, number>();
    for (const emp of systemEmployees) {
      const code = String(emp.smartoffice_employee_code ?? '').trim().toLowerCase();
      if (code) codeOwnerCount.set(code, (codeOwnerCount.get(code) ?? 0) + 1);
    }

    const results: EmployeeMatchResult[] = [];
    const matchedFileCodes = new Set<string>();

    for (const emp of systemEmployees) {
      let matchedRecords: AttendanceRecord[] = [];
      let smartOfficeName: string | null = null;
      let smartOfficeCode: string | null = null;

      // Device code is the only attendance identity. Exact/fuzzy names are
      // display metadata and can never assign punches.
      const savedCode = String(emp.smartoffice_employee_code ?? '').trim();
      if (savedCode && codeOwnerCount.get(savedCode.toLowerCase()) === 1) {
        const recs = byCode.get(savedCode.toLowerCase());
        if (recs?.length) {
          matchedRecords = recs;
          smartOfficeCode = recs[0].employeeCode;
          smartOfficeName = recs[0].employeeName;
          matchedFileCodes.add(savedCode.toLowerCase());
        }
      }

      const isMatched = matchedRecords.length > 0;

      results.push({
        systemEmployee: { id: emp.id, name: emp.name, email: emp.email, department: emp.department || '', smartoffice_employee_code: emp.smartoffice_employee_code },
        smartOfficeName,
        smartOfficeCode,
        matched: isMatched,
        recordCount: matchedRecords.length,
        records: matchedRecords,
      });
    }

    // Unknown, blank or duplicate codes stay unmatched and must be resolved in
    // the dedicated Employee Match flow before a later import.
    for (const [codeKey, recs] of byCode.entries()) {
      if (!matchedFileCodes.has(codeKey)) {
        results.push({
          systemEmployee: { id: '', name: '', email: '', department: '' },
          smartOfficeName: recs[0].employeeName,
          smartOfficeCode: recs[0].employeeCode || null,
          matched: false,
          recordCount: recs.length,
          records: recs,
        });
      }
    }
    for (const recs of withoutCode.values()) {
      results.push({
        systemEmployee: { id: '', name: '', email: '', department: '' },
        smartOfficeName: recs[0].employeeName,
        smartOfficeCode: null,
        matched: false,
        recordCount: recs.length,
        records: recs,
      });
    }

    const matchedCount = results.filter(r => r.matched).length;
    console.log(`=== COMPARISON SUMMARY (READ ONLY) ===`);
    console.log(`System employees: ${systemEmployees.length}`);
    console.log(`Found in SmartOffice: ${matchedCount}`);
    console.log(`Not in SmartOffice: ${systemEmployees.length - matchedCount}`);
    console.log(`Missing:`, results.filter(r => !r.matched).map(r => r.systemEmployee.name).join(', '));

    return results;
  }

  // Only called when user explicitly clicks Import after reviewing comparison
  async importAttendance(
    results: EmployeeMatchResult[],
    context: { batchId: string; sourceFileHash: string },
  ): Promise<AttendanceImportResult> {
    const errors: string[] = [];
    const secureRows: Record<string, unknown>[] = [];
    const todayIST = await BusinessClockService.getDate(true);

    const toImport = results.filter(r => r.matched && r.records.length > 0);
    const allDates = toImport.flatMap(r => r.records.map(rec => this.parseDate(rec.attendanceDate))).filter(Boolean) as string[];
    if (!allDates.length) throw new Error('No valid attendance dates found.');

    for (const result of toImport) {
      // Group records by date — SmartOffice may have multiple punch rows per day
      const byDate = new Map<string, AttendanceRecord[]>();
      for (const rec of result.records) {
        const date = this.parseDate(rec.attendanceDate);
        if (!date) continue;
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date)!.push(rec);
      }

      for (const [date, recs] of byDate) {
        try {
          // Sort by in-time so punches are chronological
          const sorted = recs
            .map(r => ({
              in: this.parseTimeStr(r.actualInTime ?? ''),
              out: this.parseTimeStr(r.actualOutTime ?? ''),
            }))
            .filter(p => p.in)
            .sort((a, b) => (a.in! > b.in! ? 1 : -1));

          if (!sorted.length) continue;

          // SAFETY: never touch TODAY's rows — an import must never be able
          // to overwrite a live check-in session or check anyone out.
          if (date >= todayIST) continue;

          // First/last machine punches are reporting metadata only. They must
          // never populate HRMS checkout_time or end a user's live session.
          const firstIn = sorted[0].in!;
          const lastPunchOut = [...sorted].reverse().find(p => p.out)?.out ?? null;
          const employeeCode = String(
            result.smartOfficeCode ||
              result.systemEmployee.smartoffice_employee_code ||
              recs[0].employeeCode ||
              '',
          ).trim();
          if (!employeeCode) {
            errors.push(`${result.systemEmployee.name} (${date}): SmartOffice employee code is required`);
            continue;
          }
          secureRows.push({
            user_id: result.systemEmployee.id,
            employee_code: employeeCode,
            log_datetime: `${date} ${firstIn}`,
            log_date: date,
            log_time: firstIn,
            punch_timestamp: `${date}T${firstIn}+05:30`,
            punch_direction: 'IN',
            serial_number: 'MANUAL_UPLOAD',
            temperature: null,
          });
          if (lastPunchOut && lastPunchOut !== firstIn) {
            secureRows.push({
              user_id: result.systemEmployee.id,
              employee_code: employeeCode,
              log_datetime: `${date} ${lastPunchOut}`,
              log_date: date,
              log_time: lastPunchOut,
              punch_timestamp: `${date}T${lastPunchOut}+05:30`,
              punch_direction: 'OUT',
              serial_number: 'MANUAL_UPLOAD',
              temperature: null,
            });
          }
        } catch (err: any) {
          errors.push(`${result.systemEmployee.name}: ${err.message}`);
        }
      }
    }

    if (!secureRows.length)
      throw new Error("No validated biometric punches are available to import.");
    if (secureRows.length > 5_000) {
      throw new Error(
        "This import contains more than 5,000 verified punches. Split the source file into smaller date ranges.",
      );
    }

    const { data, error } = await supabase.functions.invoke(
      'biometric-manual-import',
      {
        body: {
          rows: secureRows,
          batch_id: context.batchId,
          source_file_hash: context.sourceFileHash,
        },
      },
    );
    if (error || data?.error)
      throw new Error(
        data?.message || error?.message || 'Protected attendance import failed',
      );

    const response = firstRpcRow<any>(data);
    const submittedPunches = Number(response?.submitted_punches);
    const insertedPunches = Number(response?.inserted_punches);
    const duplicatePunches = Number(response?.duplicate_punches);
    const serverRejected = Number(response?.rejected_punches);
    const imported = Number(response?.attendance_days);
    if (
      response?.success !== true ||
      response?.transaction_status !== 'COMMITTED' ||
      String(response?.batch_id).toLowerCase() !== context.batchId.toLowerCase() ||
      String(response?.source_file_hash).toLowerCase() !== context.sourceFileHash.toLowerCase() ||
      ![submittedPunches, insertedPunches, duplicatePunches, serverRejected, imported]
        .every(Number.isInteger) ||
      submittedPunches !== secureRows.length ||
      insertedPunches + duplicatePunches + serverRejected !== submittedPunches
    ) throw new Error("The server did not return authoritative biometric import counts.");

    return {
      imported,
      submittedPunches,
      insertedPunches,
      duplicatePunches,
      rejectedPunches: serverRejected + errors.length,
      batchId: response.batch_id,
      transactionStatus: 'COMMITTED',
      errors,
    };
  }

  // Parse time string (12h or 24h) to "HH:MM:SS" 24h format for DB storage
  private parseTimeStr(t: string): string | null {
    if (!t) return null;
    const s = t.trim().toUpperCase();
    const isPM = s.includes('PM');
    const isAM = s.includes('AM');
    const cleaned = s.replace('AM', '').replace('PM', '').trim();
    const parts = cleaned.split(':');
    let h = parseInt(parts[0], 10);
    const m = parseInt(parts[1] ?? '0', 10);
    const sec = parseInt(parts[2] ?? '0', 10);
    if (isNaN(h)) return null;
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    const result = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    console.log(`parseTimeStr: "${t}" → "${result}" (isPM=${isPM} isAM=${isAM} h=${h})`);
    return result;
  }

  private parseDate(dateStr: string): string | null {
    return parseIndiaCalendarDate(dateStr);
  }

  async manualMatch(employeeCode: string, _employeeName: string, userId: string): Promise<void> {
    const { data, error } = await supabase.rpc(
      'rpc_assign_biometric_employee_code',
      { p_profile_id: userId, p_employee_code: employeeCode },
    );
    if (error) throw error;
    const response = firstRpcRow<any>(data);
    if (
      response?.success !== true ||
      response?.profile_id !== userId ||
      response?.employee_code !== employeeCode
    ) throw new Error("Server did not confirm the biometric mapping.");
  }
}

export const attendanceImportService = new AttendanceImportService();
