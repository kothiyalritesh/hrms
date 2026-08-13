import React, { useState, useCallback, useEffect } from "react";
import {
  StyleSheet, View, FlatList, Pressable,
  Alert, TextInput, TouchableOpacity, ScrollView, Text, Modal,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { formatDate, toTitleCase } from "@/utils/format";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import LocationTimelineModal, {
  PingPoint,
} from "@/components/LocationTimelineModal";
import { biometricSyncService } from "@/services/biometric-sync-secure.service";
import { useNavigation } from "@react-navigation/native";
import { AttendanceService } from "@/services/attendance.service";
import { useAuth } from "@/contexts/AuthContext";
import { BusinessClockService } from "@/services/business-clock.service";
import {
  addBusinessDays,
  businessMonthRange,
  parseDatabaseTimestamp,
} from "@/utils/businessDate";
import { fetchAllPages } from "@/utils/supabasePagination";
import { CanonicalAttendanceService } from "@/services/canonical-attendance.service";
import { firstRpcRow } from "@/utils/supabaseRpc";
import {
  attendanceTimestampParts,
  parseAttendanceTimestamp,
} from "@/utils/attendanceTimestamp";
import { downloadBrowserBytes } from "@/utils/browserFileDownload";
import {
  attendanceEmptyStateCopy,
  classifyAttendanceEvidence,
} from "@/services/attendance-control.classification";

interface AttendanceRecord {
  id: string;
  user_id: string;
  employee_name: string;
  employee_number?: string;
  office_name: string;
  office_id?: string | null;
  date: string;
  checkin_time?: string;
  checkout_time?: string;
  app_checkin_time?: string | null;
  biometric_first_in?: string | null;
  first_in_source?: string | null;
  status: string;
  distance_from_office?: number;
  warning: boolean;
  smartoffice_imported?: boolean;
  attendance_type?: string;
  biometric_punches?: { in: string; out: string | null }[];
  checkin_location?: any;
  checkout_location?: any;
  is_late?: boolean | null;
}

function isServerConfirmedLate(record: Pick<AttendanceRecord, "is_late"> | null | undefined) {
  return record?.is_late === true;
}

function fmt(iso?: string) {
  if (!iso) return '--';
  // handles: bare "2026-06-20 14:30:20", "2026-06-20T14:30:20+05:30", UTC Z strings
  const d = parseAttendanceTimestamp(iso);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

function toIST(iso: string) {
  return parseAttendanceTimestamp(iso);
}

function fmtDate(dateStr: string) {
  return formatDate(new Date(dateStr + "T00:00:00"));
}

function attendanceStatusLabel(record: AttendanceRecord, today: string) {
  if (record.status === "AUTO_CHECKED_OUT" || record.status === "AUTO_CLOSED") return "AUTO-CO";
  if (record.checkin_time && !record.checkout_time && record.date < today) return "P-NC";
  if (record.status === "ADMIN_CORRECTED") return "Corrected";
  if (record.status === "CHECKED_OUT") return "Done";
  if (record.status === "CHECKED_IN") return "Active";
  return record.status;
}

async function saveExcelWorkbook(XLSX: any, workbook: any, filename: string) {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof Blob === "undefined"
  ) {
    XLSX.writeFile(workbook, filename, { compression: false });
    return;
  }
  const bytes = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: false,
  });
  await downloadBrowserBytes(
    bytes,
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

const PRESETS = [
  { label: "Today", getRange: (base: string) => ({ s: base, e: base }) },
  { label: "Yesterday", getRange: (base: string) => {
    const date = addBusinessDays(base, -1);
    return { s: date, e: date };
  } },
  { label: "This Week", getRange: (base: string) => {
    const day = new Date(`${base}T12:00:00Z`).getUTCDay() || 7;
    return { s: addBusinessDays(base, 1 - day), e: base };
  } },
  { label: "Last Week", getRange: (base: string) => {
    const day = new Date(`${base}T12:00:00Z`).getUTCDay() || 7;
    const end = addBusinessDays(base, -day);
    return { s: addBusinessDays(end, -6), e: end };
  } },
  { label: "This Month", getRange: (base: string) => {
    const month = businessMonthRange(base);
    return { s: month.start, e: base };
  } },
  { label: "Last Month", getRange: (base: string) => {
    const previous = businessMonthRange(addBusinessDays(`${base.slice(0, 8)}01`, -1));
    return { s: previous.start, e: previous.end };
  } },
];

export default function AttendanceControlScreenNew() {
  const { user } = useAuth();
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const textColor = isDark ? "#FFFFFF" : theme.text;
  const [today, setToday] = useState("");
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [activePreset, setActivePreset] = useState("Today");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [officeFilter, setOfficeFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [searchText, setSearchText] = useState("");
  // 'app' = App+Biometric combined view (existing), 'biometric' = raw device logs only
  const [activeTab, setActiveTab] = useState<'app' | 'biometric'>('app');
  // Raw device logs for the Biometric Logs tab (all punches including unmatched codes)
  const [rawDeviceLogs, setRawDeviceLogs] = useState<any[]>([]);
  const [rawDeviceError, setRawDeviceError] = useState<string | null>(null);
  const [biometricDataError, setBiometricDataError] = useState<string | null>(null);
  const [profileLookupError, setProfileLookupError] = useState<string | null>(null);
  const [warningUpdateError, setWarningUpdateError] = useState<string | null>(null);
  // All HRMS profiles for inline matching
  const [allProfiles, setAllProfiles] = useState<any[]>([]);
  // Per-code inline match state: code → search text
  const [matchSearchMap, setMatchSearchMap] = useState<Record<string, string>>({});
  // Which code has its search panel open
  const [openMatchCode, setOpenMatchCode] = useState<string | null>(null);
  // Which code is currently saving
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [correctionRecord, setCorrectionRecord] = useState<AttendanceRecord | null>(null);
  const [correctionForm, setCorrectionForm] = useState({
    checkin: "",
    checkout: "",
    reason: "",
  });
  const [correctionSaving, setCorrectionSaving] = useState(false);

  const correctAttendance = (record: AttendanceRecord) => {
    setCorrectionRecord(record);
    setCorrectionForm({
      checkin: record.checkin_time ?? "",
      checkout: record.checkout_time ?? "",
      reason: "",
    });
  };

  const submitAttendanceCorrection = async () => {
    if (!user?.id || !correctionRecord) return;
    if (!correctionForm.reason.trim()) {
      Alert.alert("Reason required", "Enter the reason for this correction.");
      return;
    }
    try {
      setCorrectionSaving(true);
      const parseInput = (value: string) => {
        if (!value.trim()) return undefined;
        return parseDatabaseTimestamp(value.trim()).toISOString();
      };
      const newCheckin =
        correctionForm.checkin.trim() !== (correctionRecord.checkin_time ?? "")
          ? parseInput(correctionForm.checkin)
          : undefined;
      const newCheckout =
        correctionForm.checkout.trim() !== (correctionRecord.checkout_time ?? "")
          ? parseInput(correctionForm.checkout)
          : undefined;
      const result = await AttendanceService.adminCorrectAttendance({
        adminId: user.id,
        attendanceId: correctionRecord.id,
        newCheckin,
        newCheckout,
        newStatus: correctionForm.checkout.trim() ? "ADMIN_CORRECTED" : undefined,
        reason: correctionForm.reason.trim(),
      });
      if (!result.success) {
        throw new Error(result.message || "Correction failed.");
      }
      setCorrectionRecord(null);
      await loadData();
      Alert.alert("Correction saved", "Attendance was corrected and added to the audit log.");
    } catch (error: any) {
      Alert.alert(
        "Correction failed",
        error?.message || "Enter valid timestamps with a timezone, for example 2026-07-30T10:00:00+05:30.",
      );
    } finally {
      setCorrectionSaving(false);
    }
  };

  const [syncStatus, setSyncStatus] = useState(biometricSyncService.getStatus());
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    const unsubscribe = biometricSyncService.subscribe(setSyncStatus);
    return () => {
      unsubscribe();
    };
  }, []);

  // raw first/last device punch per userId_date — used to compare vs HRMS app checkin
  const [devicePunchMap, setDevicePunchMap] = useState<Record<string, { first: string; last: string | null }>>({}); 
  // ALL raw punches per userId_date — for the split biometric column
  const [deviceAllPunches, setDeviceAllPunches] = useState<Record<string, string[]>>({});

  // ── Location timeline state ──────────────────────────────────────────────

  useEffect(() => {
    if (!today) return;
    const channel = supabase
      .channel('smartoffice-device-logs')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'smartoffice_device_logs',
        filter: `log_date_only=eq.${today}`,
      }, (payload: any) => {
        const row = payload.new;
        if (!row?.user_id || !row?.log_time) return;
        // Re-run the checked, paginated source query so reconciliation and its
        // error state stay consistent.
        loadData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [today]);

  const [timelineEmployee, setTimelineEmployee] = useState<{ id: string; name: string; date: string } | null>(null);
  const [timelinePings, setTimelinePings] = useState<PingPoint[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const openTimeline = useCallback(async (userId: string, name: string, date: string) => {
    setTimelineEmployee({ id: userId, name, date });
    setTimelineLoading(true);

    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const dayStartUTC = new Date(new Date(`${date}T00:00:00Z`).getTime() - IST_OFFSET_MS);
    const dayEndUTC   = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1);

    // Official database timestamps must include an explicit timezone.
    function parseISO(s: string | null): Date | null {
      if (!s) return null;
      try {
        return parseDatabaseTimestamp(s);
      } catch {
        return null;
      }
    }

    const [trackingRes, attendanceRes] = await Promise.all([
      supabase
        .from("location_tracking")
        .select("latitude, longitude, recorded_at, gps_available, status, source")
        .eq("user_id", userId)
        .gte("recorded_at", dayStartUTC.toISOString())
        .lte("recorded_at", dayEndUTC.toISOString())
        .order("recorded_at", { ascending: true }),
      supabase
        .from("attendance_logs")
        .select("checkin_location, checkin_time, checkout_location, checkout_time")
        .eq("user_id", userId)
        .eq("date", date)
        .maybeSingle(),
    ]);

    const pings: { latitude: number | null; longitude: number | null; recorded_at: string; gps_available: boolean; status: string; source?: string }[] = (trackingRes.data ?? []).map((p: any) => ({
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      recorded_at: p.recorded_at,
      gps_available: p.gps_available ?? true,
      status: p.status ?? "GREEN",
      source: p.source ?? "web",
    }));
    const att = attendanceRes.data;

    if (att) {
      const checkinDate  = parseISO(att.checkin_time);
      const checkoutDate = parseISO(att.checkout_time);

      if (pings.length === 0) {
        if (checkinDate && att.checkin_location?.latitude) {
          pings.push({ latitude: att.checkin_location.latitude, longitude: att.checkin_location.longitude, recorded_at: att.checkin_time, gps_available: true, status: "GREEN", source: "app", ...(({ is_checkin: true } as any)) });
        }
        if (checkoutDate && att.checkout_location?.latitude) {
          pings.push({ latitude: att.checkout_location.latitude, longitude: att.checkout_location.longitude, recorded_at: att.checkout_time, gps_available: true, status: "GREEN", source: "app" });
        }
      } else {
        if (checkinDate && att.checkin_location?.latitude) {
          const firstPingTime = parseISO(pings[0].recorded_at)?.getTime() ?? Infinity;
          if (checkinDate.getTime() < firstPingTime) {
            pings.unshift({ latitude: att.checkin_location.latitude, longitude: att.checkin_location.longitude, recorded_at: att.checkin_time, gps_available: true, status: "GREEN", source: "app", ...(({ is_checkin: true } as any)) });
          }
        }
      }
    }

    setTimelinePings(
      pings.filter(
        (ping): ping is PingPoint & { latitude: number; longitude: number } =>
          Number.isFinite(ping.latitude) && Number.isFinite(ping.longitude),
      ),
    );
    setTimelineLoading(false);
  }, []);

  const loadRawDeviceLogs = useCallback(async (s: string, e: string) => {
    try {
      const { data, error } = await fetchAllPages<any>((from, to) => supabase
        .from('smartoffice_device_logs')
        .select(`
          id, employee_code, log_date_only, log_time, punch_direction, serial_number,
          user_id,
          profiles:user_id ( name, employee_number )
        `)
        .gte('log_date_only', s)
        .lte('log_date_only', e)
        // NO user_id filter — we want ALL rows including unmatched (user_id = null)
        .order('log_date_only', { ascending: false })
        .order('log_time', { ascending: true })
        .order('id')
        .range(from, to));
      if (error) throw error;
      setRawDeviceLogs(data ?? []);
      setRawDeviceError(null);
    } catch (err: any) {
      setRawDeviceError(err?.message || "Biometric logs could not be loaded");
      console.warn('[AttendanceControl] Raw device logs failed:', err);
    }
  }, []);

  // Load all HRMS profiles once for inline matching
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, name, employee_number, role, smartoffice_employee_code')
      .eq('is_active', true)
      .order('name')
      .then(({ data, error }: { data: any[] | null; error: any }) => {
        if (error) {
          setProfileLookupError(error.message);
          return;
        }
        setAllProfiles((data ?? []).map((p: any) => ({ ...p, name: toTitleCase(p.name ?? '') })));
        setProfileLookupError(null);
      });
  }, []);

  const handleInlineMatch = async (employeeCode: string, profile: any) => {
    // Warn if profile already has a different code
    if (profile.smartoffice_employee_code && profile.smartoffice_employee_code.toLowerCase() !== employeeCode.toLowerCase()) {
      if (!window.confirm(`${profile.name} is already linked to "${profile.smartoffice_employee_code}". Replace with "${employeeCode}"?`)) return;
    }
    setSavingCode(employeeCode);
    try {
      const { data, error } = await supabase.rpc('rpc_assign_biometric_employee_code', {
        p_profile_id: profile.id,
        p_employee_code: employeeCode,
      });
      const response = firstRpcRow<any>(data);
      if (
        error ||
        response?.success !== true ||
        response?.profile_id !== profile.id ||
        response?.employee_code !== employeeCode
      ) {
        throw error ?? new Error(response?.message || "Server did not confirm the biometric mapping.");
      }
      // Close panel and refresh
      setOpenMatchCode(null);
      setMatchSearchMap(prev => ({ ...prev, [employeeCode]: '' }));
      // Update local profiles list so the card immediately shows as matched
      setAllProfiles(prev => prev.map(p => p.id === profile.id ? { ...p, smartoffice_employee_code: employeeCode } : p));
      // Reload raw logs so the card updates
      loadRawDeviceLogs(startDate, endDate);
      window.alert(`✅ "${employeeCode}" permanently linked to ${profile.name}. Future syncs will auto-map this code.`);
    } catch (err: any) {
      window.alert('Save failed: ' + err.message);
    } finally {
      setSavingCode(null);
    }
  };

  const loadData = useCallback(async (s = startDate, e = endDate) => {
    setLoading(true);
    try {
    
    // Update attendance warnings, but never hide a failed recalculation.
    try {
      const warningResult = await AttendanceService.updateAllAttendanceWarnings();
      if (!warningResult.success) {
        throw new Error(warningResult.error || "Warning recalculation was not confirmed.");
      }
      setWarningUpdateError(null);
    } catch (err: any) {
      console.error('Warning update failed:', err);
      setWarningUpdateError(err?.message || "Attendance warnings could not be recalculated.");
    }
    
    const [canonicalRows, offRes, empRes] = await Promise.all([
      CanonicalAttendanceService.list(s, e),
      fetchAllPages<any>((from, to) =>
        supabase.from("offices").select("id, name")
          .eq("is_active", true).order("id").range(from, to),
      ),
      fetchAllPages<any>((from, to) =>
        supabase.from("profiles").select("id, name")
          .eq("is_active", true).order("name").order("id").range(from, to),
      ),
    ]);
    if (offRes.error) throw offRes.error;
    if (empRes.error) throw empRes.error;

    // Preserve the last valid reconciliation map if the biometric source fails.
    const punchMap: Record<string, { first: string; last: string | null }> = {};
    const allPunchesMap: Record<string, string[]> = {};
    try {
      const deviceRes = await fetchAllPages<any>((from, to) =>
        supabase.from("smartoffice_device_logs")
          .select("id, user_id, log_date_only, log_time")
          .gte("log_date_only", s)
          .lte("log_date_only", e)
          .not("user_id", "is", null)
          .order("log_time", { ascending: true })
          .order("id")
          .range(from, to),
      );
      if (deviceRes.error) throw deviceRes.error;
      for (const row of deviceRes.data ?? []) {
        const k = `${row.user_id}_${row.log_date_only}`;
        if (!punchMap[k]) {
          punchMap[k] = { first: row.log_time, last: null };
          allPunchesMap[k] = [row.log_time];
        } else {
          punchMap[k].last = row.log_time;
          allPunchesMap[k].push(row.log_time);
        }
      }
      setDevicePunchMap(punchMap);
      setDeviceAllPunches(allPunchesMap);
      setBiometricDataError(null);
    } catch (e) {
      console.warn('[AttendanceControl] Device logs query failed:', e);
      setBiometricDataError(
        e instanceof Error
          ? e.message
          : "Biometric logs could not be loaded for reconciliation.",
      );
    }
    // Title Case all display names at the source (per UI audit, 12 Jun 2026)
    let data = canonicalRows.map((r: any) => ({
      ...r,
      id: r.attendance_log_id ?? `${r.user_id}:${r.work_date}`,
      date: r.work_date,
      checkin_time: r.official_first_in,
      checkout_time: r.official_last_out,
      app_checkin_time: r.app_first_in,
      biometric_first_in: r.biometric_first_in,
      first_in_source: r.first_in_source,
      status: r.attendance_status,
      distance_from_office: r.distance_from_office_m,
      employee_name: toTitleCase(r.employee_name ?? ''),
      office_name: r.office_name ?? '',
      attendance_type: r.presence_source,
      smartoffice_imported: r.first_in_source === 'BIOMETRIC',
      biometric_punches: [r.biometric_first_in, r.biometric_last_punch_evidence].filter(Boolean),
    }));
    if (officeFilter) data = data.filter((r: any) => r.office_id === officeFilter);
    if (employeeFilter) data = data.filter((r: any) => r.user_id === employeeFilter);
    setRecords(data);
    setOffices(offRes.data || []);
    setEmployees((empRes.data || []).map((p: any) => ({ ...p, name: toTitleCase(p.name) })));
    setLoading(false);
    // Also load raw biometric device logs for the Biometric Logs tab
    loadRawDeviceLogs(s, e);
    } catch (error: any) {
      setLoading(false);
      Alert.alert(
        "Attendance data unavailable",
        error?.message || "The attendance query failed. Please retry.",
      );
    }
  }, [startDate, endDate, officeFilter, employeeFilter, loadRawDeviceLogs, user?.id]);

  useFocusEffect(useCallback(() => {
    if (today) {
      void loadData();
      return;
    }
    void BusinessClockService.getDate(true).then((date) => {
      setToday(date);
      setStartDate(date);
      setEndDate(date);
      setExpandedDates(new Set([date]));
      return loadData(date, date);
    });
  }, [loadData, today]));

  const applyPreset = (preset: typeof PRESETS[0]) => {
    if (!today) return;
    const { s, e } = preset.getRange(today);
    setStartDate(s);
    setEndDate(e);
    setActivePreset(preset.label);
    // expand all dates in range
    const dates = new Set<string>();
    for (let cursor = s; cursor <= e; cursor = addBusinessDays(cursor, 1)) {
      dates.add(cursor);
    }
    setExpandedDates(dates);
    loadData(s, e);
  };

  const toggleDate = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  };

  const filteredRecords = records.filter((r) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase().trim();
    return r.employee_name?.toLowerCase().includes(q) ||
           r.employee_number?.toLowerCase().includes(q) ||
           r.office_name?.toLowerCase().includes(q);
  });

  // Classify using source evidence. Canonical reporting deliberately returns an
  // employee-day for absent/no-data users too; those rows are never app rows.
  type DateGroup = {
    date: string;
    appOnly: AttendanceRecord[];
    bioOnly: AttendanceRecord[];
    both: AttendanceRecord[];
    otherAttendance: AttendanceRecord[];
    noAttendance: AttendanceRecord[];
  };
  const dateMap = new Map<string, Omit<DateGroup, "date">>();
  for (const r of filteredRecords) {
    if (!dateMap.has(r.date)) {
      dateMap.set(r.date, {
        appOnly: [],
        bioOnly: [],
        both: [],
        otherAttendance: [],
        noAttendance: [],
      });
    }
    const group = classifyAttendanceEvidence(
      r,
      deviceAllPunches[`${r.user_id}_${r.date}`]?.length ?? 0,
    );
    const day = dateMap.get(r.date)!;
    if (group === "BOTH") day.both.push(r);
    else if (group === "APP_ONLY") day.appOnly.push(r);
    else if (group === "BIOMETRIC_ONLY") day.bioOnly.push(r);
    else if (group === "OTHER_ATTENDANCE") day.otherAttendance.push(r);
    else day.noAttendance.push(r);
  }
  const grouped: DateGroup[] = [];
  for (const [date, groups] of dateMap) {
    grouped.push({ date, ...groups });
  }

  // ── Biometric Logs Excel (separate file) ─────────────────────────────────
  const downloadBiometricExcel = async () => {
    if (rawDeviceError) {
      window.alert(`Biometric export unavailable: ${rawDeviceError}`);
      return;
    }
    if (rawDeviceLogs.length === 0) { window.alert('No biometric logs for this period.'); return; }
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const fmtPunch = (t: string) => {
        const s = t.includes('T') ? t : t.replace(' ', 'T');
        const w = s.includes('+') || s.endsWith('Z') ? s : s + '+05:30';
        const d = new Date(w);
        if (isNaN(d.getTime())) return t;
        return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
      };

      const bioHeaders = [
        'Date', 'Employee Code', 'Employee Name', 'Employee #',
        'Punch Time', 'Direction', 'Device Serial', 'Matched to HRMS',
      ];
      const bioRows = rawDeviceLogs.map((r: any) => [
        r.log_date_only ?? '',
        r.employee_code ?? '',
        toTitleCase(r.profiles?.name ?? ''),
        r.profiles?.employee_number ?? '',
        fmtPunch(r.log_time ?? ''),
        r.punch_direction ?? '',
        r.serial_number ?? '',
        r.user_id ? 'Yes' : 'No',
      ]);

      // Group by employee+date for summary
      const bioSummaryMap: Record<string, { name: string; empNum: string; code: string; dates: Set<string>; punches: number; unmatched: boolean }> = {};
      for (const r of rawDeviceLogs) {
        const key = r.employee_code ?? 'UNKNOWN';
        if (!bioSummaryMap[key]) {
          bioSummaryMap[key] = {
            name: toTitleCase(r.profiles?.name ?? ''),
            empNum: r.profiles?.employee_number ?? '',
            code: key,
            dates: new Set(),
            punches: 0,
            unmatched: !r.user_id,
          };
        }
        bioSummaryMap[key].dates.add(r.log_date_only);
        bioSummaryMap[key].punches++;
      }
      const bioSummaryHeaders = ['Employee Code', 'Employee Name', 'Employee #', 'Days Present', 'Total Punches', 'Matched to HRMS'];
      const bioSummaryRows = Object.values(bioSummaryMap).map(r => [
        r.code, r.name, r.empNum, r.dates.size, r.punches, r.unmatched ? 'No — needs matching' : 'Yes',
      ]);

      const rawSheet = XLSX.utils.aoa_to_sheet([bioHeaders, ...bioRows]);
      rawSheet['!cols'] = [12,14,22,12,12,10,14,12].map(w => ({ wch: w }));
      const sumSheet = XLSX.utils.aoa_to_sheet([bioSummaryHeaders, ...bioSummaryRows]);
      sumSheet['!cols'] = [14,22,12,12,12,20].map(w => ({ wch: w }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, rawSheet, 'Raw Punches');
      XLSX.utils.book_append_sheet(wb, sumSheet, 'Employee Summary');
      await saveExcelWorkbook(
        XLSX,
        wb,
        `BiometricLogs_${startDate}_to_${endDate}.xlsx`,
      );
    } catch (err: any) {
      window.alert('Export failed: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const downloadHistoricalAppAttendanceExcel = async () => {
    const exportRows = [...filteredRecords].sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.employee_name.localeCompare(right.employee_name),
    );
    if (!exportRows.length) {
      setExportError("No app attendance records are loaded for this period.");
      return;
    }

    setExporting(true);
    setExportStatus("Building historical workbook...");
    setExportError("");
    try {
      // Let the pressed state and progress label render before SheetJS starts
      // its synchronous worksheet serialization.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const detailHeaders = [
        "Date",
        "Employee Name",
        "Employee Number",
        "Office",
        "Check-In",
        "Check-Out",
        "Status",
        "Late",
        "Worked Hours",
        "Attendance Source",
        "Distance From Office (m)",
        "Warning",
      ];
      const detailRows = exportRows.map((record) => {
        const checkin = record.checkin_time
          ? parseAttendanceTimestamp(record.checkin_time)
          : null;
        const checkout = record.checkout_time
          ? parseAttendanceTimestamp(record.checkout_time)
          : null;
        const workedHours =
          checkin && checkout
            ? Math.max(0, (checkout.getTime() - checkin.getTime()) / 3_600_000)
            : null;
        return [
          record.date,
          record.employee_name,
          record.employee_number ?? "",
          record.office_name,
          fmt(record.checkin_time),
          fmt(record.checkout_time),
          attendanceStatusLabel(record, today),
          isServerConfirmedLate(record) ? "Yes" : "No",
          workedHours == null ? "" : workedHours.toFixed(2),
          record.attendance_type ??
            (record.smartoffice_imported ? "BIOMETRIC" : "APP"),
          record.distance_from_office ?? "",
          record.warning ? "Yes" : "No",
        ];
      });
      const detailsSheet = XLSX.utils.aoa_to_sheet([
        detailHeaders,
        ...detailRows,
      ]);
      detailsSheet["!cols"] = [
        12, 24, 16, 20, 13, 13, 16, 9, 14, 18, 22, 10,
      ].map((width) => ({ wch: width }));
      XLSX.utils.book_append_sheet(
        workbook,
        detailsSheet,
        "App Attendance",
      );

      const employeeSummary = new Map<
        string,
        {
          name: string;
          employeeNumber: string;
          office: string;
          records: number;
          late: number;
          noCheckout: number;
          workedHours: number;
        }
      >();
      for (const record of exportRows) {
        const item = employeeSummary.get(record.user_id) ?? {
          name: record.employee_name,
          employeeNumber: record.employee_number ?? "",
          office: record.office_name,
          records: 0,
          late: 0,
          noCheckout: 0,
          workedHours: 0,
        };
        item.records += 1;
        if (isServerConfirmedLate(record)) item.late += 1;
        if (record.checkin_time && !record.checkout_time) item.noCheckout += 1;
        if (record.checkin_time && record.checkout_time) {
          const checkin = parseAttendanceTimestamp(record.checkin_time);
          const checkout = parseAttendanceTimestamp(record.checkout_time);
          item.workedHours += Math.max(
            0,
            (checkout.getTime() - checkin.getTime()) / 3_600_000,
          );
        }
        employeeSummary.set(record.user_id, item);
      }
      const summarySheet = XLSX.utils.aoa_to_sheet([
        [
          "Employee Name",
          "Employee Number",
          "Office",
          "Attendance Records",
          "Late Arrivals",
          "No Checkout",
          "Total Worked Hours",
        ],
        ...[...employeeSummary.values()].map((item) => [
          item.name,
          item.employeeNumber,
          item.office,
          item.records,
          item.late,
          item.noCheckout,
          item.workedHours.toFixed(2),
        ]),
      ]);
      summarySheet["!cols"] = [24, 16, 20, 18, 14, 14, 20].map(
        (width) => ({ wch: width }),
      );
      XLSX.utils.book_append_sheet(
        workbook,
        summarySheet,
        "Employee Summary",
      );

      const informationSheet = XLSX.utils.aoa_to_sheet([
        ["Selected period", `${startDate} to ${endDate}`],
        ["Attendance records", exportRows.length],
        [
          "Data note",
          "Times and statuses come from stored attendance logs. Employee and office labels reflect the current HRMS directory.",
        ],
      ]);
      informationSheet["!cols"] = [{ wch: 22 }, { wch: 90 }];
      XLSX.utils.book_append_sheet(
        workbook,
        informationSheet,
        "Export Information",
      );

      setExportStatus("Starting download...");
      await saveExcelWorkbook(
        XLSX,
        workbook,
        `App_Attendance_${startDate}_to_${endDate}.xlsx`,
      );
    } catch (error: any) {
      const message = error?.message || "Historical workbook could not be created.";
      setExportError(message);
      window.alert(`Export failed: ${message}`);
    } finally {
      setExporting(false);
      setExportStatus("");
    }
  };

  const downloadExcel = async () => {
    if (biometricDataError) {
      const message = `Complete export unavailable because biometric reconciliation failed: ${biometricDataError}`;
      setExportError(message);
      window.alert(message);
      return;
    }
    if (records.length === 0) {
      const message = "No records to export for this period.";
      setExportError(message);
      window.alert(message);
      return;
    }
    setExporting(true);
    setExportStatus("Loading complete report data...");
    setExportError("");
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const XLSX = await import("xlsx");
      setExportStatus("Loading field visits...");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      // ── Sheet 1: Field Visits per Employee per Date ───────────────────
      const { data: fieldVisits, error: fieldVisitsError } = await supabase
        .from("field_visits")
        .select(`
          id, date, visit_type, location_name, meeting_type,
          contact_name, contact_phone, company_name, project_name,
          notes, checkin_time, checkout_time, checkout_notes, status,
          profiles:user_id ( name, employee_number, role, team )
        `)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .order("checkin_time", { ascending: true });
      if (fieldVisitsError) throw fieldVisitsError;

      const fvHeaders = [
        "Date", "Employee Name", "Employee #", "Team", "Designation",
        "Visit Type", "Location / Site", "Meeting Type",
        "Contact Name", "Contact Phone", "Company", "Project",
        "Check-In Time", "Check-Out Time", "Duration (hrs)",
        "Status", "Notes", "Checkout Notes",
      ];

      const fvRows = (fieldVisits || []).map((v: any) => {
        const cin  = v.checkin_time  ? toIST(v.checkin_time)  : null;
        const cout = v.checkout_time ? toIST(v.checkout_time) : null;
        const duration = cin && cout
          ? ((cout.getTime() - cin.getTime()) / 3600000).toFixed(2)
          : "";
        return [
          v.date,
          v.profiles?.name          ?? "",
          v.profiles?.employee_number ?? "",
          v.profiles?.team          ?? "",
          v.profiles?.role          ?? "",
          v.visit_type              ?? "",
          v.location_name           ?? "",
          v.meeting_type            ?? "",
          v.contact_name            ?? "",
          v.contact_phone           ?? "",
          v.company_name            ?? "",
          v.project_name            ?? "",
          cin  ? cin.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "",
          cout ? cout.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "",
          duration,
          v.status                  ?? "",
          v.notes                   ?? "",
          v.checkout_notes          ?? "",
        ];
      });

      const fvSheet = XLSX.utils.aoa_to_sheet([fvHeaders, ...fvRows]);
      fvSheet["!cols"] = [12,22,12,14,16,12,22,14,18,14,18,18,12,12,12,12,24,24].map((w) => ({ wch: w }));

      // ── Sheet 2: Summary per Employee ────────────────────────────────
      const summaryMap: Record<string, { name: string; empNum: string; email: string; office: string; present: number; absent: number; late: number; totalHours: number; }> = {};

      // Build a set of all (employee, date) combos that have records
      const allDates = new Set<string>();
      for (
        let cursor = startDate;
        cursor <= endDate;
        cursor = addBusinessDays(cursor, 1)
      ) {
        allDates.add(cursor);
      }
      const totalDays = allDates.size;

      for (const r of records as any[]) {
        if (!summaryMap[r.user_id]) {
          summaryMap[r.user_id] = { name: r.employee_name ?? "", empNum: r.employee_number ?? "", email: r.email ?? "", office: r.office_name ?? "", present: 0, absent: 0, late: 0, totalHours: 0 };
        }
        const e = summaryMap[r.user_id];
        e.present++;
        const cin  = r.checkin_time  ? toIST(r.checkin_time)  : null;
        const cout = r.checkout_time ? toIST(r.checkout_time) : null;
        if (isServerConfirmedLate(r)) e.late++;
        if (cin && cout) e.totalHours += (cout.getTime() - cin.getTime()) / 3600000;
      }
      // Calculate absent days
      for (const key of Object.keys(summaryMap)) {
        summaryMap[key].absent = totalDays - summaryMap[key].present;
      }

      const summaryHeaders = ["Employee Name", "Employee #", "Email", "Office", "Days Present", "Days Absent", "Late Arrivals", "Total Hours Worked", `Period (${startDate} → ${endDate})`];
      const summaryRows = Object.values(summaryMap).map((e) => [
        e.name, e.empNum, e.email, e.office,
        e.present, e.absent, e.late,
        e.totalHours.toFixed(2),
        `${totalDays} working days`,
      ]);

      let summarySheet = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
      summarySheet["!cols"] = [22,12,26,18,12,12,12,18,24].map((w) => ({ wch: w }));

      // ── Sheet 3: Daily Pivot (employee vs date) ───────────────────────
      const dateList = Array.from(allDates).sort();
      const empList  = Object.values(summaryMap);
      const pivotHeaders = ["Employee Name", "Employee #", ...dateList];

      // Build lookup: userId+date → "HH:MM In / HH:MM Out"
      const lookup: Record<string, string> = {};
      for (const r of records as any[]) {
        const cinFmt  = r.checkin_time  ? toIST(r.checkin_time).toLocaleTimeString("en-IN",  { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "Missing";
        const coutFmt = r.checkout_time ? toIST(r.checkout_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "Not Out";
        lookup[`${r.user_id}_${r.date}`] = `${cinFmt} / ${coutFmt}`;
      }
      const pivotRows = Object.entries(summaryMap).map(([uid, e]) => [
        e.name, e.empNum,
        ...dateList.map((d) => lookup[`${uid}_${d}`] ?? "Absent"),
      ]);

      const pivotSheet = XLSX.utils.aoa_to_sheet([pivotHeaders, ...pivotRows]);
      pivotSheet["!cols"] = [22, 12, ...dateList.map(() => ({ wch: 22 })) as any];

      // ── AD Attendance profiles (with team_leader / department) ────────
      setExportStatus("Loading employees and calendars...");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const { data: adProfiles, error: adProfilesError } =
        await fetchAllPages<any>((from, to) =>
          supabase.from("profiles")
            .select("id, name, employee_number, office_id, team, department, reports_to")
            .eq("is_active", true)
            .order("name")
            .order("id")
            .range(from, to),
        );
      if (adProfilesError) throw adProfilesError;

      // reports_to is the canonical hierarchy field used by team screens.
      const managerIds = [...new Set((adProfiles || []).map((p: any) => p.reports_to).filter(Boolean))];
      let managerMap: Record<string, string> = {};
      if (managerIds.length) {
        const { data: mgrs, error: managersError } = await supabase.from("profiles").select("id, name").in("id", managerIds);
        if (managersError) throw managersError;
        for (const m of mgrs || []) managerMap[m.id] = m.name;
      }

      // Approved leaves in range: user_id → [{ start_date, end_date }]
      const { data: adLeaves, error: adLeavesError } =
        await fetchAllPages<any>((from, to) =>
          supabase.from("leave_requests")
            .select("id, user_id, start_date, end_date, leave_type")
            .eq("status", "approved")
            .lte("start_date", endDate)
            .gte("end_date", startDate)
            .order("user_id")
            .order("start_date")
            .order("id")
            .range(from, to),
        );
      if (adLeavesError) throw adLeavesError;

      const leaveRanges: Record<string, { s: string; e: string; type: string }[]> = {};
      for (const lv of adLeaves || []) {
        if (!leaveRanges[lv.user_id]) leaveRanges[lv.user_id] = [];
        leaveRanges[lv.user_id].push({
          s: lv.start_date,
          e: lv.end_date,
          type: lv.leave_type ?? "",
        });
      }

      const [holidayResult, weeklyOffResult] = await Promise.all([
        fetchAllPages<any>((from, to) =>
          supabase.from("holiday_calendar")
            .select("id, holiday_date, office_id, is_optional")
            .gte("holiday_date", startDate)
            .lte("holiday_date", endDate)
            .order("holiday_date")
            .order("id")
            .range(from, to),
        ),
        fetchAllPages<any>((from, to) =>
          supabase.from("weekly_off_rules")
            .select("id, weekday, week_of_month, user_id, office_id")
            .eq("is_active", true)
            .order("weekday")
            .order("id")
            .range(from, to),
        ),
      ]);
      if (holidayResult.error) throw holidayResult.error;
      if (weeklyOffResult.error) throw weeklyOffResult.error;
      const holidays = holidayResult.data ?? [];
      const weeklyOffRules = weeklyOffResult.data ?? [];
      const profileById = new Map<string, any>(
        (adProfiles ?? []).map((profile: any) => [profile.id, profile]),
      );

      // Attendance lookup userId_date → record
      const attByKey: Record<string, any> = {};
      for (const r of records as any[]) attByKey[`${r.user_id}_${r.date}`] = r;

      function fmtIST(iso: string): string {
        return toIST(iso).toLocaleTimeString("en-IN", {
          hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
        });
      }
      function getLeaveCode(uid: string, date: string): string | null {
        const leave = (leaveRanges[uid] || [])
          .find((range) => range.s <= date && date <= range.e);
        if (!leave) return null;
        const type = leave.type.toLowerCase();
        if (type.includes("casual") || type === "cl") return "CL";
        if (type.includes("sick") || type === "sl") return "SL";
        if (
          type.includes("privilege") ||
          type.includes("earned") ||
          type === "pl" ||
          type === "el"
        ) return "PL";
        if (type.includes("work from home") || type === "wfh") return "WFH";
        return "L";
      }
      function isOnLeave(uid: string, date: string): boolean {
        return getLeaveCode(uid, date) !== null;
      }
      function getNonWorkingCode(uid: string, date: string): "H" | "WO" | null {
        const officeId = profileById.get(uid)?.office_id ?? null;
        const holiday = holidays.some(
          (item: any) =>
            item.holiday_date === date &&
            item.is_optional !== true &&
            (item.office_id == null || item.office_id === officeId),
        );
        if (holiday) return "H";

        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        const weekOfMonth = Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1;
        const weeklyOff = weeklyOffRules.some(
          (rule: any) =>
            Number(rule.weekday) === weekday &&
            (rule.week_of_month == null ||
              Number(rule.week_of_month) === weekOfMonth) &&
            (rule.user_id === uid ||
              (rule.user_id == null && rule.office_id === officeId)),
        );
        return weeklyOff ? "WO" : null;
      }

      // Build cell value + tag for colouring
      type CellMeta = { v: string; tag: "normal" | "late" | "absent" | "missing" | "leave" | "wo" | "header" };

      function getCellIn(uid: string, date: string): CellMeta {
        const leaveCode = getLeaveCode(uid, date);
        if (leaveCode) return { v: leaveCode, tag: "leave" };
        const nonWorkingCode = getNonWorkingCode(uid, date);
        if (nonWorkingCode) return { v: nonWorkingCode, tag: "wo" };
        const rec = attByKey[`${uid}_${date}`];
        if (!rec) return { v: "A", tag: "absent" };
        if (!rec.checkin_time) return { v: "Missing Punch", tag: "missing" };
        const t = fmtIST(rec.checkin_time);
        if (isServerConfirmedLate(rec)) return { v: `${t} (Late)`, tag: "late" };
        return { v: t, tag: "normal" };
      }

      function getCellOut(uid: string, date: string): CellMeta {
        const leaveCode = getLeaveCode(uid, date);
        if (leaveCode) return { v: leaveCode, tag: "leave" };
        const nonWorkingCode = getNonWorkingCode(uid, date);
        if (nonWorkingCode) return { v: nonWorkingCode, tag: "wo" };
        const rec = attByKey[`${uid}_${date}`];
        if (!rec) return { v: "A", tag: "absent" };
        if (!rec.checkout_time) return { v: "Missing Punch", tag: "missing" };
        return { v: fmtIST(rec.checkout_time), tag: "normal" };
      }

      // ── Build AD Attendance sheet ────────────────────────────────────
      const FIXED_COLS = 5; // Name, EmpID, Office, TeamLeader, Department
      const adDateList = Array.from(allDates).sort();

      // Helper to format date label "01-Jun"
      function fmtDateLabel(d: string): string {
        const dt = new Date(d + "T00:00:00");
        return `${String(dt.getDate()).padStart(2, "0")}-${dt.toLocaleString("en-IN", { month: "short" })}`;
      }

      // ─ Colours (ARGB) ─
      const CLR = {
        headerDark:  "FF1F3864",  // deep navy  — summary header
        headerDate:  "FF2E75B6",  // blue        — date parent row
        headerSub:   "FF4472C4",  // lighter blue— Check In/Out row
        headerFixed: "FF2F5496",  // fixed col header
        summaryBg:   "FFD6E4F0",  // summary section bg
        late:        "FFFFF2CC",  // yellow
        absent:      "FFFFC7CE",  // red
        missing:     "FFFCE4D6",  // orange
        leave:       "FFE2EFDA",  // green tint
        wo:          "FFF2F2F2",  // grey
        white:       "FFFFFFFF",
        altRow:      "FFF5F8FF",
      };

      function cellStyle(tag: CellMeta["tag"], rowEven: boolean): any {
        const base: any = {
          font: { name: "Calibri", sz: 10 },
          alignment: { horizontal: "center", vertical: "center", wrapText: false },
          border: {
            top:    { style: "thin", color: { rgb: "FFD9D9D9" } },
            bottom: { style: "thin", color: { rgb: "FFD9D9D9" } },
            left:   { style: "thin", color: { rgb: "FFD9D9D9" } },
            right:  { style: "thin", color: { rgb: "FFD9D9D9" } },
          },
        };
        if (tag === "late")    { base.fill = { patternType: "solid", fgColor: { rgb: CLR.late } }; base.font.color = { rgb: "FF7D6608" }; }
        else if (tag === "absent")  { base.fill = { patternType: "solid", fgColor: { rgb: CLR.absent } }; base.font.color = { rgb: "FF9C0006" }; base.font.bold = true; }
        else if (tag === "missing") { base.fill = { patternType: "solid", fgColor: { rgb: CLR.missing } }; base.font.color = { rgb: "FFBE4B03" }; }
        else if (tag === "leave")   { base.fill = { patternType: "solid", fgColor: { rgb: CLR.leave } }; base.font.color = { rgb: "FF375623" }; }
        else if (tag === "wo")      { base.fill = { patternType: "solid", fgColor: { rgb: CLR.wo } }; base.font.color = { rgb: "FF595959" }; }
        else { base.fill = { patternType: "solid", fgColor: { rgb: rowEven ? CLR.altRow : CLR.white } }; }
        return base;
      }

      function hdrStyle(bgRgb: string, bold = true, fontSize = 10): any {
        return {
          font: { name: "Calibri", sz: fontSize, bold, color: { rgb: "FFFFFFFF" } },
          fill: { patternType: "solid", fgColor: { rgb: bgRgb } },
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          border: {
            top:    { style: "medium", color: { rgb: "FFFFFFFF" } },
            bottom: { style: "medium", color: { rgb: "FFFFFFFF" } },
            left:   { style: "thin",   color: { rgb: "FFFFFFFF" } },
            right:  { style: "thin",   color: { rgb: "FFFFFFFF" } },
          },
        };
      }

      // Compute summary totals across ALL employees x ALL dates
      let adTotalPresent = 0, adTotalAbsent = 0, adTotalLate = 0,
          adTotalLeave = 0, adTotalMissing = 0;
      const adEmployees = (adProfiles || []).filter((p: any) => {
        // apply same filters as main records
        if (officeFilter && p.office_id !== officeFilter) return false;
        if (employeeFilter && p.id !== employeeFilter) return false;
        return true;
      });

      // Replace the preliminary calendar-day summary with a working-day
      // summary based on configured holidays, weekly offs, and approved leave.
      const authoritativeSummaryHeaders = [
        "Employee Name",
        "Employee #",
        "Office",
        "Working Days",
        "Days Present",
        "Days Absent",
        "Approved Leave Days",
        "Late Arrivals",
        "Attendance %",
        "Total Hours Worked",
      ];
      const authoritativeSummaryRows = adEmployees.map((profile: any) => {
        const workingDates = adDateList.filter(
          (date) =>
            !getLeaveCode(profile.id, date) &&
            !getNonWorkingCode(profile.id, date),
        );
        const leaveDays = adDateList.filter(
          (date) => !!getLeaveCode(profile.id, date),
        ).length;
        const attendanceRows = workingDates
          .map((date) => attByKey[`${profile.id}_${date}`])
          .filter((record) => record?.checkin_time);
        const present = attendanceRows.length;
        const absent = Math.max(0, workingDates.length - present);
        const late = attendanceRows.filter(isServerConfirmedLate).length;
        const hours = attendanceRows.reduce((sum, record) => {
          if (!record.checkout_time) return sum;
          return sum +
            Math.max(
              0,
              (toIST(record.checkout_time).getTime() -
                toIST(record.checkin_time).getTime()) /
                3600000,
            );
        }, 0);
        const percentage = workingDates.length
          ? (present / workingDates.length) * 100
          : 0;
        return [
          profile.name ?? "",
          profile.employee_number ?? "",
          profile.office_id
            ? offices.find((office: any) => office.id === profile.office_id)?.name ?? ""
            : "",
          workingDates.length,
          present,
          absent,
          leaveDays,
          late,
          Number(percentage.toFixed(2)),
          Number(hours.toFixed(2)),
        ];
      });
      summarySheet = XLSX.utils.aoa_to_sheet([
        authoritativeSummaryHeaders,
        ...authoritativeSummaryRows,
      ]);
      summarySheet["!cols"] = [22, 12, 18, 12, 12, 12, 16, 12, 14, 18]
        .map((wch) => ({ wch }));

      for (const p of adEmployees) {
        for (const d of adDateList) {
          const cin  = getCellIn(p.id, d);
          const cout = getCellOut(p.id, d);
          if (cin.tag === "absent")  adTotalAbsent++;
          else if (cin.tag === "leave") adTotalLeave++;
          else if (cin.tag !== "wo") {
            adTotalPresent++;
            if (cin.tag === "late")    adTotalLate++;
            if (cin.tag === "missing" || cout.tag === "missing") adTotalMissing++;
          }
        }
      }

      // ── Build the sheet as a sparse cell map ─────────────────────────
      const adSheet: any = { "!type": "sheet" };
      const enc = XLSX.utils.encode_cell;

      // Total columns = FIXED_COLS + dateCount*2
      const totalCols = FIXED_COLS + adDateList.length * 2;
      const lastColLetter = XLSX.utils.encode_col(totalCols - 1);

      // Row offsets
      const SUMMARY_ROWS = 9; // rows 0-8 (1-indexed: 1-9)
      const HDR_DATE_ROW  = SUMMARY_ROWS;      // row index 9
      const HDR_SUB_ROW   = SUMMARY_ROWS + 1;  // row index 10
      const DATA_START_ROW = SUMMARY_ROWS + 2; // row index 11

      // ── SUMMARY SECTION (rows 0-8) ───────────────────────────────────
      function setCell(r: number, c: number, v: any, style?: any) {
        const ref = enc({ r, c });
        adSheet[ref] = { v, t: typeof v === "number" ? "n" : "s", s: style };
      }

      // Summary header
      setCell(0, 0, "AD ATTENDANCE REPORT", { ...hdrStyle(CLR.headerDark, true, 14), alignment: { horizontal: "center", vertical: "center" } });
      setCell(0, 1, `Period: ${startDate}  →  ${endDate}`, { ...hdrStyle(CLR.headerDark, false, 10) });
      setCell(1, 0, "Total Employees",    { fill: { patternType: "solid", fgColor: { rgb: CLR.summaryBg } }, font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center" } });
      setCell(1, 1, adEmployees.length,   { fill: { patternType: "solid", fgColor: { rgb: CLR.summaryBg } }, font: { sz: 10, bold: true, color: { rgb: "FF1F3864" } }, alignment: { horizontal: "center", vertical: "center" } });
      setCell(2, 0, "Total Present Days", { fill: { patternType: "solid", fgColor: { rgb: CLR.summaryBg } }, font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center" } });
      setCell(2, 1, adTotalPresent,       { fill: { patternType: "solid", fgColor: { rgb: "FF00B050" } }, font: { sz: 10, bold: true, color: { rgb: "FFFFFFFF" } }, alignment: { horizontal: "center", vertical: "center" } });
      setCell(3, 0, "Total Absent Days",  { fill: { patternType: "solid", fgColor: { rgb: CLR.summaryBg } }, font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center" } });
      setCell(3, 1, adTotalAbsent,        { fill: { patternType: "solid", fgColor: { rgb: "FFFF0000" } }, font: { sz: 10, bold: true, color: { rgb: "FFFFFFFF" } }, alignment: { horizontal: "center", vertical: "center" } });
      setCell(4, 0, "Total Late Marks",   { fill: { patternType: "solid", fgColor: { rgb: CLR.summaryBg } }, font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center" } });
      setCell(4, 1, adTotalLate,          { fill: { patternType: "solid", fgColor: { rgb: "FFFFEB9C" } }, font: { sz: 10, bold: true, color: { rgb: "FF7D6608" } }, alignment: { horizontal: "center", vertical: "center" } });
      setCell(5, 0, "Total Leaves",       { fill: { patternType: "solid", fgColor: { rgb: CLR.summaryBg } }, font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center" } });
      setCell(5, 1, adTotalLeave,         { fill: { patternType: "solid", fgColor: { rgb: "FF92D050" } }, font: { sz: 10, bold: true, color: { rgb: "FFFFFFFF" } }, alignment: { horizontal: "center", vertical: "center" } });
      setCell(6, 0, "Total Missing Punches", { fill: { patternType: "solid", fgColor: { rgb: CLR.summaryBg } }, font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center" } });
      setCell(6, 1, adTotalMissing,       { fill: { patternType: "solid", fgColor: { rgb: "FFFF7043" } }, font: { sz: 10, bold: true, color: { rgb: "FFFFFFFF" } }, alignment: { horizontal: "center", vertical: "center" } });
      setCell(7, 0, "Legend:", { font: { bold: true, sz: 9 }, alignment: { horizontal: "left", vertical: "center" } });
      const legends = [["Late",CLR.late,"FF7D6608"],["Absent",CLR.absent,"FF9C0006"],["Missing Punch",CLR.missing,"FFBE4B03"],["Leave",CLR.leave,"FF375623"],["Week Off",CLR.wo,"FF595959"]];
      legends.forEach(([label, bg, fg], i) => {
        setCell(7, i + 1, label, { fill: { patternType: "solid", fgColor: { rgb: bg } }, font: { sz: 9, bold: true, color: { rgb: fg } }, alignment: { horizontal: "center", vertical: "center" }, border: { top: { style: "thin", color: { rgb: "FFD9D9D9" } }, bottom: { style: "thin", color: { rgb: "FFD9D9D9" } }, left: { style: "thin", color: { rgb: "FFD9D9D9" } }, right: { style: "thin", color: { rgb: "FFD9D9D9" } } } });
      });
      // blank separator row 8
      for (let c = 0; c < totalCols; c++) setCell(8, c, "", {});

      // ── DATE PARENT HEADER ROW (row HDR_DATE_ROW) ─────────────────────
      // Fixed col headers
      const fixedHdrs = ["Employee Name", "Employee ID", "Office", "Team Leader", "Department"];
      fixedHdrs.forEach((h, c) => setCell(HDR_DATE_ROW, c, h, hdrStyle(CLR.headerFixed)));
      // Date parent headers
      adDateList.forEach((d, i) => {
        const c = FIXED_COLS + i * 2;
        setCell(HDR_DATE_ROW, c, fmtDateLabel(d), hdrStyle(CLR.headerDate));
        setCell(HDR_DATE_ROW, c + 1, "", hdrStyle(CLR.headerDate)); // will be merged
      });

      // ── CHECK IN / CHECK OUT SUB-HEADER ROW (row HDR_SUB_ROW) ─────────
      fixedHdrs.forEach((_, c) => setCell(HDR_SUB_ROW, c, "", hdrStyle(CLR.headerFixed)));
      adDateList.forEach((_, i) => {
        const c = FIXED_COLS + i * 2;
        setCell(HDR_SUB_ROW, c,     "Check In",  hdrStyle(CLR.headerSub));
        setCell(HDR_SUB_ROW, c + 1, "Check Out", hdrStyle(CLR.headerSub));
      });

      // ── DATA ROWS ─────────────────────────────────────────────────────
      const officeNameMap: Record<string, string> = {};
      for (const o of offices) officeNameMap[o.id] = o.name;

      adEmployees.forEach((p: any, ri: number) => {
        const r = DATA_START_ROW + ri;
        const even = ri % 2 === 1;
        const fixedStyle: any = {
          font: { name: "Calibri", sz: 10, bold: ri === 0 || false },
          fill: { patternType: "solid", fgColor: { rgb: even ? CLR.altRow : CLR.white } },
          alignment: { horizontal: "left", vertical: "center" },
          border: { top: { style: "thin", color: { rgb: "FFD9D9D9" } }, bottom: { style: "thin", color: { rgb: "FFD9D9D9" } }, left: { style: "thin", color: { rgb: "FFD9D9D9" } }, right: { style: "thin", color: { rgb: "FFD9D9D9" } } },
        };
        setCell(r, 0, p.name             ?? "", fixedStyle);
        setCell(r, 1, p.employee_number  ?? "", { ...fixedStyle, alignment: { horizontal: "center", vertical: "center" } });
        setCell(r, 2, officeNameMap[p.office_id] ?? "", fixedStyle);
        setCell(r, 3, managerMap[p.reports_to] ?? p.team ?? "", fixedStyle);
        setCell(r, 4, p.department       ?? "", fixedStyle);

        adDateList.forEach((d, di) => {
          const c = FIXED_COLS + di * 2;
          const cin  = getCellIn(p.id, d);
          const cout = getCellOut(p.id, d);
          setCell(r, c,     cin.v,  cellStyle(cin.tag,  even));
          setCell(r, c + 1, cout.v, cellStyle(cout.tag, even));
        });
      });

      // ── Sheet ref ─────────────────────────────────────────────────────
      adSheet["!ref"] = `A1:${lastColLetter}${DATA_START_ROW + adEmployees.length}`;

      // ── Merges ────────────────────────────────────────────────────────
      const merges: any[] = [
        // Title spans first 4 cols
        { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
        // Summary label+value pairs — stretch label across 1 col
      ];
      // Merge date parent headers (each spans 2 cols)
      adDateList.forEach((_, i) => {
        const c = FIXED_COLS + i * 2;
        merges.push({ s: { r: HDR_DATE_ROW, c }, e: { r: HDR_DATE_ROW, c: c + 1 } });
      });
      // Merge fixed col headers vertically across date+sub rows
      for (let c = 0; c < FIXED_COLS; c++) {
        merges.push({ s: { r: HDR_DATE_ROW, c }, e: { r: HDR_SUB_ROW, c } });
      }
      adSheet["!merges"] = merges;

      // ── Column widths ─────────────────────────────────────────────────
      const colWidths: any[] = [
        { wch: 24 }, // Employee Name
        { wch: 13 }, // Employee ID
        { wch: 18 }, // Office
        { wch: 20 }, // Team Leader
        { wch: 16 }, // Department
        ...adDateList.flatMap(() => [{ wch: 16 }, { wch: 16 }]),
      ];
      adSheet["!cols"] = colWidths;

      // ── Row heights ───────────────────────────────────────────────────
      const rowHeights: any[] = [];
      for (let i = 0; i < DATA_START_ROW + adEmployees.length; i++) {
        rowHeights.push({ hpt: i === 0 ? 28 : i < SUMMARY_ROWS ? 20 : i === HDR_DATE_ROW || i === HDR_SUB_ROW ? 22 : 18 });
      }
      adSheet["!rows"] = rowHeights;

      // ── Freeze panes: freeze top (HDR rows) + first FIXED_COLS columns ─
      adSheet["!freeze"] = { xSplit: FIXED_COLS, ySplit: DATA_START_ROW, topLeftCell: enc({ r: DATA_START_ROW, c: FIXED_COLS }) };

      // ── Auto-filter on fixed columns (applied on sub-header row) ──────
      adSheet["!autofilter"] = { ref: `A${HDR_SUB_ROW + 1}:E${HDR_SUB_ROW + 1}` };

      // ── Sheet 4: Location Tracking (hourly pings per employee per day) ──
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const locStartUTC = new Date(new Date(`${startDate}T00:00:00Z`).getTime() - IST_OFFSET_MS);
      const locEndUTC   = new Date(new Date(`${endDate}T00:00:00Z`).getTime() - IST_OFFSET_MS + 24 * 60 * 60 * 1000 - 1);
      setExportStatus("Loading location details...");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const { data: locationPings, error: locationPingsError } = await supabase
        .from("location_tracking")
        .select(`
          user_id, latitude, longitude, distance_from_base,
          status, gps_available, recorded_at,
          profiles:user_id ( name, employee_number )
        `)
        .gte("recorded_at", locStartUTC.toISOString())
        .lte("recorded_at", locEndUTC.toISOString())
        .not("latitude", "is", null)
        .order("recorded_at", { ascending: true });
      if (locationPingsError) throw locationPingsError;

      // Build attendance lookup for check-in/out times per user+date
      const attLookup: Record<string, { cin: string; cout: string }> = {};
      for (const r of records as any[]) {
        attLookup[`${r.user_id}_${r.date}`] = {
          cin:  r.checkin_time  ? toIST(r.checkin_time).toLocaleTimeString("en-IN",  { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "",
          cout: r.checkout_time ? toIST(r.checkout_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "",
        };
      }

      const locHeaders = [
        "Employee Name", "Employee #",
        "Date (IST)", "Time (IST)", "Hour (IST)",
        "Latitude", "Longitude",
        "Distance from Base (m)", "GPS Status", "GPS Available",
        "Check-In Time", "Check-Out Time",
        "Google Maps Link",
      ];

      const locRows: any[][] = (locationPings || []).map((p: any) => {
        const parts = attendanceTimestampParts(p.recorded_at);
        const dateIST = parts.date;
        const timeIST = parts.time;
        const hourIST = `${String(parts.hour).padStart(2, "0")}:00`;
        const attKey  = `${p.user_id}_${parts.date}`;
        const att     = attLookup[attKey] ?? { cin: "", cout: "" };
        const mapsUrl = `https://maps.google.com/?q=${p.latitude},${p.longitude}`;

        return [
          (p.profiles as any)?.name            ?? "",
          (p.profiles as any)?.employee_number ?? "",
          dateIST,
          timeIST,
          hourIST,
          p.latitude,
          p.longitude,
          p.distance_from_base !== null ? Math.round(p.distance_from_base) : "",
          p.status,
          p.gps_available ? "Yes" : "No",
          att.cin,
          att.cout,
          mapsUrl,
        ];
      });

      const locSheet = XLSX.utils.aoa_to_sheet([locHeaders, ...locRows]);
      locSheet["!cols"] = [22,12,14,12,10,14,14,20,14,12,12,12,40].map((w) => ({ wch: w }));

      // Make Google Maps links clickable
      locRows.forEach((row, i) => {
        const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: 12 });
        if (locSheet[cellRef]) {
          locSheet[cellRef].l = { Target: row[12] as string, Tooltip: "Open in Google Maps" };
        }
      });

      // ── Sheet 5: Hourly Location Summary (one row per employee per hour per day) ──
      // Group pings by employee + date + hour, keep first ping of each hour
      const hourlyMap: Record<string, any> = {};
      for (const p of locationPings || []) {
        const parts = attendanceTimestampParts(p.recorded_at);
        const dateKey = parts.date;
        const hourKey = String(parts.hour).padStart(2, "0");
        const key = `${p.user_id}_${dateKey}_${hourKey}`;
        if (!hourlyMap[key]) hourlyMap[key] = { ...p, dateKey, hourKey };
      }

      const hourlyHeaders = [
        "Employee Name", "Employee #", "Date", "Hour (IST)",
        "Latitude", "Longitude", "Distance from Base (m)",
        "GPS Status", "Check-In", "Check-Out", "Google Maps Link",
      ];

      const hourlyRows = Object.values(hourlyMap).map((p: any) => {
        const att     = attLookup[`${p.user_id}_${p.dateKey}`] ?? { cin: "", cout: "" };
        const mapsUrl = `https://maps.google.com/?q=${p.latitude},${p.longitude}`;
        return [
          (p.profiles as any)?.name            ?? "",
          (p.profiles as any)?.employee_number ?? "",
          p.dateKey,
          `${p.hourKey}:00`,
          p.latitude,
          p.longitude,
          p.distance_from_base !== null ? Math.round(p.distance_from_base) : "",
          p.status,
          att.cin,
          att.cout,
          mapsUrl,
        ];
      });

      // Sort by employee name → date → hour
      hourlyRows.sort((a: any[], b: any[]) => {
        if (a[0] !== b[0]) return String(a[0]).localeCompare(String(b[0]));
        if (a[2] !== b[2]) return String(a[2]).localeCompare(String(b[2]));
        return String(a[3]).localeCompare(String(b[3]));
      });

      const hourlySheet = XLSX.utils.aoa_to_sheet([hourlyHeaders, ...hourlyRows]);
      hourlySheet["!cols"] = [22,12,14,10,14,14,20,14,12,12,40].map((w) => ({ wch: w }));
      hourlyRows.forEach((row, i) => {
        const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: 10 });
        if (hourlySheet[cellRef]) {
          hourlySheet[cellRef].l = { Target: row[10] as string, Tooltip: "Open in Google Maps" };
        }
      });

      // ── Sheet: App Check-ins (wide pivot, grouped by dept, same format as biometric export) ──
      function fmtISTTime(iso: string | null): string {
        if (!iso) return '';
        return attendanceTimestampParts(iso).time;
      }

      // Fetch ALL app attendance for the full date range directly — do not rely on records state
      setExportStatus("Building attendance sheets...");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const { data: appAttData, error: appAttendanceError } =
        await fetchAllPages<any>((from, to) =>
          supabase.from('attendance_logs')
            .select('id, user_id, date, checkin_time, checkout_time, attendance_type, smartoffice_imported, is_late')
            .gte('date', startDate)
            .lte('date', endDate)
            .or('attendance_type.neq.BIOMETRIC,attendance_type.is.null')
            .order('date', { ascending: true })
            .order('user_id')
            .order('id')
            .range(from, to),
        );
      if (appAttendanceError) throw appAttendanceError;

      // Build lookup: userId_date -> { cin, cout }
      const appCiLookup: Record<string, { cin: string; cout: string; isLate: boolean }> = {};
      for (const rr of (appAttData ?? [])) {
        if (rr.smartoffice_imported) continue;
        appCiLookup[`${rr.user_id}_${rr.date}`] = {
          cin:  fmtISTTime(rr.checkin_time),
          cout: fmtISTTime(rr.checkout_time ?? null),
          isLate: rr.is_late === true,
        };
      }

      // Group employees by department
      const appDeptMap = new Map<string, any[]>();
      for (const p of adEmployees) {
        const dept = (p.department ?? p.team ?? officeNameMap[p.office_id] ?? 'General').toUpperCase();
        if (!appDeptMap.has(dept)) appDeptMap.set(dept, []);
        appDeptMap.get(dept)!.push(p);
      }

      // Build the pivot rows
      const appCiDateLabels = adDateList.map((d: string) => fmtDateLabel(d));
      const appCiHeaderRow = ['Emp Code', 'EMP Name', ...appCiDateLabels];
      const appCiAoa: any[][] = [appCiHeaderRow];

      for (const [dept, members] of [...appDeptMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        appCiAoa.push(['Department', dept, ...adDateList.map(() => '')]);
        for (const p of members.sort((a: any, b: any) => (a.name ?? '').localeCompare(b.name ?? ''))) {
          const row: any[] = [p.employee_number ?? '', p.name ?? ''];
          for (const d of adDateList) {
            const leaveCode = getLeaveCode(p.id, d);
            if (leaveCode) { row.push(leaveCode); continue; }
            const nonWorkingCode = getNonWorkingCode(p.id, d);
            if (nonWorkingCode) { row.push(nonWorkingCode); continue; }
            const cell = appCiLookup[`${p.id}_${d}`];
            if (!cell) { row.push('A'); continue; }
            const cinStr  = cell.cin  || 'Missing';
            const coutStr = cell.cout || 'NC';
            row.push(`${cinStr} / ${coutStr}${cell.isLate ? " / LATE" : ""}`);
          }
          appCiAoa.push(row);
        }
      }

      const appCiSheet = XLSX.utils.aoa_to_sheet(appCiAoa);
      appCiSheet['!cols'] = [12, 26, ...adDateList.map(() => ({ wch: 16 }))] as any;
      const appCiRange = XLSX.utils.decode_range(appCiSheet['!ref'] ?? 'A1');
      for (let R = 1; R <= appCiRange.e.r; R++) {
        for (let C = 2; C <= appCiRange.e.c; C++) {
          const ref2 = XLSX.utils.encode_cell({ r: R, c: C });
          if (appCiSheet[ref2]) {
            appCiSheet[ref2].s = { alignment: { wrapText: true, vertical: 'top', horizontal: 'center' } };
          }
        }
      }

      // ── Sheet: Biometric (Device) — wide pivot, same format as App Check-ins ──
      const bioCiHeaders = [
        'Emp Code', 'EMP Name', ...adDateList.map((d: string) => fmtDateLabel(d)),
      ];

      // Build lookup: employeeCode_date -> sorted punches[]
      const bioByCodeDate = new Map<string, {
        code: string; name: string; empNum: string; userId: string | null; punches: string[];
      }>();
      for (const row of rawDeviceLogs) {
        const key2 = `${row.employee_code}__${row.log_date_only}`;
        if (!bioByCodeDate.has(key2)) {
          bioByCodeDate.set(key2, {
            code: row.employee_code ?? '',
            name: toTitleCase(row.profiles?.name ?? ''),
            empNum: row.profiles?.employee_number ?? '',
            userId: row.user_id ?? null,
            punches: [],
          });
        }
        bioByCodeDate.get(key2)!.punches.push(row.log_time ?? '');
      }

      // Collect unique employee codes and their display name/empNum
      const bioEmpMap = new Map<string, { code: string; name: string; empNum: string; userId: string | null }>();
      for (const [key2, val] of bioByCodeDate) {
        if (!bioEmpMap.has(val.code)) {
          bioEmpMap.set(val.code, { code: val.code, name: val.name, empNum: val.empNum, userId: val.userId });
        }
      }

      // Group by department using adProfiles lookup (matched employees only)
      // Unmatched codes (no user_id) go into a separate "Unmatched Device Codes" group
      const bioDeptMap = new Map<string, { code: string; name: string; empNum: string; userId: string | null }[]>();
      for (const [code, emp] of bioEmpMap) {
        let dept = 'UNMATCHED DEVICE CODES';
        if (emp.userId) {
          const profile = adProfiles?.find((p: any) => p.id === emp.userId);
          dept = (profile?.department ?? profile?.team ?? officeNameMap[profile?.office_id] ?? 'General').toUpperCase();
        }
        if (!bioDeptMap.has(dept)) bioDeptMap.set(dept, []);
        bioDeptMap.get(dept)!.push(emp);
      }

      const bioCiAoa: any[][] = [bioCiHeaders];
      for (const [dept, members] of [...bioDeptMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        bioCiAoa.push(['Department', dept, ...adDateList.map(() => '')]);
        for (const emp of members.sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code))) {
          const row: any[] = [emp.empNum || emp.code, emp.name || emp.code];
          for (const d of adDateList) {
            const entry = bioByCodeDate.get(`${emp.code}__${d}`);
            if (!entry || entry.punches.length === 0) {
              // For matched employees show WO/L/A like app sheet; for unmatched just blank
              if (emp.userId) {
                const leaveCode = getLeaveCode(emp.userId, d);
                if (leaveCode) { row.push(leaveCode); continue; }
                const nonWorkingCode = getNonWorkingCode(emp.userId, d);
                if (nonWorkingCode) { row.push(nonWorkingCode); continue; }
                row.push('A');
              } else {
                row.push('');
              }
              continue;
            }
            entry.punches.sort();
            const firstPunch = entry.punches[0];
            const lastPunch  = entry.punches.length > 1 ? entry.punches[entry.punches.length - 1] : 'NC';
            row.push(`${firstPunch} / ${lastPunch}`);
          }
          bioCiAoa.push(row);
        }
      }

      const bioCiSheet = XLSX.utils.aoa_to_sheet(bioCiAoa);
      bioCiSheet['!cols'] = [12, 26, ...adDateList.map(() => ({ wch: 18 }))] as any;
      const bioCiRange = XLSX.utils.decode_range(bioCiSheet['!ref'] ?? 'A1');
      for (let R = 1; R <= bioCiRange.e.r; R++) {
        for (let C = 2; C <= bioCiRange.e.c; C++) {
          const refB = XLSX.utils.encode_cell({ r: R, c: C });
          if (bioCiSheet[refB]) {
            bioCiSheet[refB].s = { alignment: { wrapText: true, vertical: 'top', horizontal: 'center' } };
          }
        }
      }

      // The complete download button intentionally produces the eight core
      // operational sheets. These two extended layouts are significantly more
      // expensive and duplicate data already present in the core workbook.
      setExportStatus("Building Combined and Team Head sheets...");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      let combinedSheet: any = null;
      let thSheet: any = null;
      const includeExtendedDuplicateSheets = true;
      if (includeExtendedDuplicateSheets) {
      // ── Combined Sheet ─────────────────────────────────────────────────
      // Helper: parse a "HH:MM:SS" or "HH:MM" time string to total seconds
      function timeStrToSeconds(t: string): number {
        if (!t) return Infinity;
        const parts = t.split(':').map(Number);
        return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
      }

      // Format IST time string "HH:MM:SS" from a full ISO/datetime string
      function toISTTimeStr(iso: string | null | undefined): string {
        if (!iso) return '';
        try {
          return attendanceTimestampParts(iso).time;
        } catch { return ''; }
      }

      // Build HRMS app lookup: userId_date -> { cin: "HH:MM:SS", cout: "HH:MM:SS" }
      const hrmsLookup: Record<string, { cin: string; cout: string; isLate: boolean }> = {};
      for (const rr of (appAttData ?? [])) {
        if (rr.smartoffice_imported) continue;
        hrmsLookup[`${rr.user_id}_${rr.date}`] = {
          cin:  toISTTimeStr(rr.checkin_time),
          cout: toISTTimeStr(rr.checkout_time ?? null),
          isLate: rr.is_late === true,
        };
      }

      // Build bio punch lookup: userId_date -> { first: "HH:MM:SS", last: "HH:MM:SS" }
      // bioByCodeDate is keyed by employeeCode__date; we need userId__date
      // Use devicePunchMap which is already userId_date -> { first, last } built above
      // devicePunchMap times are bare "HH:MM:SS" strings from smartoffice_device_logs

      // Build combined cell value for one employee x one date
      function getCombinedCell(userId: string, date: string): string {
        const leaveCode = getLeaveCode(userId, date);
        if (leaveCode) return leaveCode;
        const nonWorkingCode = getNonWorkingCode(userId, date);
        if (nonWorkingCode) return nonWorkingCode;

        const hrms = hrmsLookup[`${userId}_${date}`];
        const bio  = devicePunchMap[`${userId}_${date}`];

        const hrmsCin  = hrms?.cin  ?? '';
        const hrmsCout = hrms?.cout ?? '';
        const bioCin   = bio?.first ?? '';
        const bioCout  = bio?.last  ?? '';

        // Determine final check-in: MIN(hrmsIn, bioIn)
        let finalCin = '';
        if (hrmsCin && bioCin) {
          finalCin = timeStrToSeconds(hrmsCin) <= timeStrToSeconds(bioCin) ? hrmsCin : bioCin;
        } else {
          finalCin = hrmsCin || bioCin;
        }

        // Determine final check-out: MAX(hrmsOut, bioOut)
        let finalCout = '';
        if (hrmsCout && bioCout) {
          finalCout = timeStrToSeconds(hrmsCout) >= timeStrToSeconds(bioCout) ? hrmsCout : bioCout;
        } else {
          finalCout = hrmsCout || bioCout;
        }

        // Neither source has any data → Absent
        if (!finalCin && !finalCout) return 'A';

        const cinDisplay  = finalCin  ? finalCin.slice(0, 5)  : 'Missing';
        if (!finalCout) {
          return `IN: ${cinDisplay}\nOUT: \nSTATUS: NC${hrms?.isLate ? "\nSTATUS: LATE" : ""}`;
        }
        return `IN: ${cinDisplay}\nOUT: ${finalCout.slice(0, 5)}${hrms?.isLate ? "\nSTATUS: LATE" : ""}`;
      }

      // Date labels for Combined Sheet columns ("01-May", "02-May", ...)
      const combinedDateLabels = adDateList.map((d: string) => fmtDateLabel(d));

      // Company info rows
      const COMPANY_NAME = 'BOP Realty Pvt. Ltd';
      const REPORT_TITLE = 'Monthly InOut Report';
      const dateRangeLabel = `${fmtDateLabel(startDate)}-${new Date(startDate+'T00:00:00').getFullYear()} to ${fmtDateLabel(endDate)}-${new Date(endDate+'T00:00:00').getFullYear()}`;

      // Build AOA for Combined Sheet
      const combinedAoa: any[][] = [
        [COMPANY_NAME],
        [REPORT_TITLE],
        [dateRangeLabel],
        ['Emp Code', 'EMP Name', ...combinedDateLabels],
      ];

      // Group employees by department (reuse appDeptMap built above)
      for (const [dept, members] of [...appDeptMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        combinedAoa.push(['Department', dept, ...adDateList.map(() => '')]);
        for (const p of members.sort((a: any, b: any) => (a.name ?? '').localeCompare(b.name ?? ''))) {
          const row: any[] = [p.employee_number ?? '', p.name ?? ''];
          for (const d of adDateList) {
            row.push(getCombinedCell(p.id, d));
          }
          combinedAoa.push(row);
        }
      }

      combinedSheet = XLSX.utils.aoa_to_sheet(combinedAoa);
      const combinedRange = XLSX.utils.decode_range(combinedSheet['!ref'] ?? 'A1');
      const totalComboDateCols = adDateList.length;
      const totalComboCols = 2 + totalComboDateCols;
      const lastComboCol = XLSX.utils.encode_col(totalComboCols - 1);

      // ── Merges for top 3 title rows (span all columns) ─────────────────
      const combinedMerges: any[] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: totalComboCols - 1 } }, // company name
        { s: { r: 1, c: 0 }, e: { r: 1, c: totalComboCols - 1 } }, // report title
        { s: { r: 2, c: 0 }, e: { r: 2, c: totalComboCols - 1 } }, // date range
      ];
      combinedSheet['!merges'] = combinedMerges;

      // ── Apply styles ───────────────────────────────────────────────────
      const combinedThinBorder = {
        top:    { style: 'thin', color: { rgb: 'FFB0B0B0' } },
        bottom: { style: 'thin', color: { rgb: 'FFB0B0B0' } },
        left:   { style: 'thin', color: { rgb: 'FFB0B0B0' } },
        right:  { style: 'thin', color: { rgb: 'FFB0B0B0' } },
      };

      // Style each cell based on its row/col position
      for (let R = 0; R <= combinedRange.e.r; R++) {
        for (let C = 0; C <= combinedRange.e.c; C++) {
          const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
          if (!combinedSheet[cellRef]) {
            combinedSheet[cellRef] = { v: '', t: 's' };
          }
          const cell = combinedSheet[cellRef];
          const val  = String(cell.v ?? '');

          if (R === 0) {
            // Company name row
            cell.s = {
              font: { name: 'Calibri', sz: 14, bold: true, color: { rgb: 'FF1F3864' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              fill: { patternType: 'solid', fgColor: { rgb: 'FFD6E4F0' } },
            };
          } else if (R === 1) {
            // Report title row
            cell.s = {
              font: { name: 'Calibri', sz: 12, bold: true, color: { rgb: 'FF2E75B6' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              fill: { patternType: 'solid', fgColor: { rgb: 'FFD6E4F0' } },
            };
          } else if (R === 2) {
            // Date range row
            cell.s = {
              font: { name: 'Calibri', sz: 10, italic: true, color: { rgb: 'FF595959' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              fill: { patternType: 'solid', fgColor: { rgb: 'FFF2F2F2' } },
            };
          } else if (R === 3) {
            // Header row: Emp Code, EMP Name, date columns
            cell.s = {
              font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFFFF' } },
              fill: { patternType: 'solid', fgColor: { rgb: 'FF2F5496' } },
              alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
              border: combinedThinBorder,
            };
          } else if (val === 'Department' && C === 0) {
            // Department label cell
            cell.s = {
              font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFFFF' } },
              fill: { patternType: 'solid', fgColor: { rgb: 'FF4472C4' } },
              alignment: { horizontal: 'left', vertical: 'center' },
              border: combinedThinBorder,
            };
          } else if (C === 0 && R > 3 && combinedSheet[XLSX.utils.encode_cell({ r: R, c: 0 })]?.v === 'Department') {
            // Handled above
          } else if (R > 3 && combinedAoa[R]?.[0] === 'Department') {
            // Department name cell and rest of dept row
            cell.s = {
              font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFFFF' } },
              fill: { patternType: 'solid', fgColor: { rgb: 'FF4472C4' } },
              alignment: { horizontal: C === 1 ? 'left' : 'center', vertical: 'center' },
              border: combinedThinBorder,
            };
          } else if (R > 3 && C < 2) {
            // Emp Code / EMP Name data cells
            cell.s = {
              font: { name: 'Calibri', sz: 10 },
              fill: { patternType: 'solid', fgColor: { rgb: R % 2 === 0 ? 'FFF5F8FF' : 'FFFFFFFF' } },
              alignment: { horizontal: C === 0 ? 'center' : 'left', vertical: 'center', wrapText: false },
              border: combinedThinBorder,
            };
          } else if (R > 3 && C >= 2) {
            // Attendance data cells
            let fillColor = R % 2 === 0 ? 'FFF5F8FF' : 'FFFFFFFF';
            let fontColor = 'FF000000';
            if (val === 'A') { fillColor = 'FFFFC7CE'; fontColor = 'FF9C0006'; }
            else if (val === 'WO' || val === 'H') { fillColor = 'FFF2F2F2'; fontColor = 'FF595959'; }
            else if (['L', 'CL', 'SL', 'PL', 'WFH'].includes(val)) { fillColor = 'FFE2EFDA'; fontColor = 'FF375623'; }
            cell.s = {
              font: { name: 'Calibri', sz: 9, bold: val === 'A' || val === 'WO' || val === 'H', color: { rgb: fontColor } },
              fill: { patternType: 'solid', fgColor: { rgb: fillColor } },
              alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
              border: combinedThinBorder,
            };
          }
        }
      }

      // ── Column widths ──────────────────────────────────────────────────
      combinedSheet['!cols'] = [
        { wch: 12 }, // Emp Code
        { wch: 26 }, // EMP Name
        ...adDateList.map(() => ({ wch: 12 })), // date cols (compact)
      ];

      // ── Row heights ────────────────────────────────────────────────────
      const combinedRowHeights: any[] = [
        { hpt: 22 }, // company name
        { hpt: 18 }, // report title
        { hpt: 16 }, // date range
        { hpt: 20 }, // header row
      ];
      for (let i = 4; i <= combinedRange.e.r; i++) {
        const isDeptRow = combinedAoa[i]?.[0] === 'Department';
        combinedRowHeights.push({ hpt: isDeptRow ? 18 : 32 }); // taller for wrap text
      }
      combinedSheet['!rows'] = combinedRowHeights;

      // ── Freeze top 4 rows + first 2 columns ───────────────────────────
      combinedSheet['!freeze'] = {
        xSplit: 2, ySplit: 4,
        topLeftCell: XLSX.utils.encode_cell({ r: 4, c: 2 }),
      };

      // ── Team Head Wise Sheet ───────────────────────────────────────────
      // Columns: Emp Code | Employee Name | Department | Team Head | [dates...] | Total Present | Total Absent | Total WO | Late Count | Missing Checkout
      const TH_STAT_COLS = ['Total Present', 'Total Absent', 'Total WO', 'Late Count', 'Missing Checkout'];
      const thDateLabels = adDateList.map((d: string) => fmtDateLabel(d));
      const thFixedHdrs  = ['Emp Code', 'Employee Name', 'Department', 'Team Head'];
      const thHeaderRow  = [...thFixedHdrs, ...thDateLabels, ...TH_STAT_COLS];

      // Group employees by team head name
      const thGroupMap = new Map<string, any[]>();
      for (const p of adEmployees) {
        const head = managerMap[p.reports_to] ?? p.team ?? 'General';
        if (!thGroupMap.has(head)) thGroupMap.set(head, []);
        thGroupMap.get(head)!.push(p);
      }

      const COMPANY_NAME_TH = 'BOP Realty Pvt. Ltd';
      const thAoa: any[][] = [
        [COMPANY_NAME_TH],
        ['Team Head Wise Attendance Report'],
        [dateRangeLabel],
        thHeaderRow,
      ];

      // Per-employee per-date cell builder — returns { display, tag }
      function getThCell(uid: string, date: string): { display: string; tag: 'normal' | 'late' | 'absent' | 'wo' | 'leave' | 'missing' } {
        const leaveCode = getLeaveCode(uid, date);
        if (leaveCode) return { display: leaveCode, tag: 'leave' };
        const nonWorkingCode = getNonWorkingCode(uid, date);
        if (nonWorkingCode) return { display: nonWorkingCode, tag: 'wo' };

        const hrms = hrmsLookup[`${uid}_${date}`];
        const bio  = devicePunchMap[`${uid}_${date}`];

        const hrmsCin  = hrms?.cin  ?? '';
        const hrmsCout = hrms?.cout ?? '';
        const bioCin   = bio?.first ?? '';
        const bioCout  = bio?.last  ?? '';

        let finalCin = '';
        if (hrmsCin && bioCin) finalCin = timeStrToSeconds(hrmsCin) <= timeStrToSeconds(bioCin) ? hrmsCin : bioCin;
        else finalCin = hrmsCin || bioCin;

        let finalCout = '';
        if (hrmsCout && bioCout) finalCout = timeStrToSeconds(hrmsCout) >= timeStrToSeconds(bioCout) ? hrmsCout : bioCout;
        else finalCout = hrmsCout || bioCout;

        if (!finalCin && !finalCout) return { display: 'A', tag: 'absent' };

        const cinDisplay  = finalCin  ? finalCin.slice(0, 5)  : 'Missing';
        if (!finalCout) {
          return {
            display: `IN: ${cinDisplay}\nOUT: \nSTATUS: NC`,
            tag: 'missing',
          };
        }
        const tag = !finalCin ? 'missing' : hrms?.isLate ? 'late' : 'normal';
        return { display: `IN: ${cinDisplay}\nOUT: ${finalCout.slice(0, 5)}`, tag };
      }

      for (const [head, members] of [...thGroupMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        // Team head header row
        const headRowCols = thHeaderRow.length;
        const headRow: any[] = [`Team Head: ${head}`, ...Array(headRowCols - 1).fill('')];
        thAoa.push(headRow);

        // Per-employee stats
        let teamPresent = 0, teamAbsent = 0, teamWO = 0, teamLate = 0, teamMissing = 0;

        for (const p of members.sort((a: any, b: any) => (a.name ?? '').localeCompare(b.name ?? ''))) {
          const row: any[] = [
            p.employee_number ?? '',
            p.name ?? '',
            p.department ?? p.team ?? '',
            managerMap[p.reports_to] ?? p.team ?? '',
          ];

          let empPresent = 0, empAbsent = 0, empWO = 0, empLate = 0, empMissing = 0;

          for (const d of adDateList) {
            const cell = getThCell(p.id, d);
            row.push(cell.display);
            if (cell.tag === 'wo' || cell.display === 'WO')         { empWO++;      }
            else if (cell.tag === 'absent' || cell.display === 'A') { empAbsent++;  }
            else if (cell.tag === 'leave' || cell.display === 'L')  { /* leave — not absent, not present */ }
            else {
              empPresent++;
              if (cell.tag === 'late')                empLate++;
              if (cell.tag === 'missing' && cell.display.includes('STATUS: NC')) empMissing++;
            }
          }

          row.push(empPresent, empAbsent, empWO, empLate, empMissing);
          thAoa.push(row);

          teamPresent += empPresent;
          teamAbsent  += empAbsent;
          teamWO      += empWO;
          teamLate    += empLate;
          teamMissing += empMissing;
        }

        // Team summary row
        const summaryLabel = `Team Summary | Employees: ${members.length} | Present: ${teamPresent} | Absent: ${teamAbsent} | WO: ${teamWO} | Late: ${teamLate} | Missing Checkout: ${teamMissing}`;
        thAoa.push([summaryLabel, ...Array(thHeaderRow.length - 1).fill('')]);
      }

      thSheet = XLSX.utils.aoa_to_sheet(thAoa);
      const thRange = XLSX.utils.decode_range(thSheet['!ref'] ?? 'A1');
      const thTotalCols = thFixedHdrs.length + adDateList.length + TH_STAT_COLS.length;
      const thLastCol = XLSX.utils.encode_col(thTotalCols - 1);

      // Merges: title rows span all columns
      const thMerges: any[] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: thTotalCols - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: thTotalCols - 1 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: thTotalCols - 1 } },
      ];
      // Merge team head rows and summary rows across all cols
      for (let R = 4; R <= thRange.e.r; R++) {
        const firstCell = thAoa[R]?.[0] ?? '';
        if (typeof firstCell === 'string' && (firstCell.startsWith('Team Head:') || firstCell.startsWith('Team Summary'))) {
          thMerges.push({ s: { r: R, c: 0 }, e: { r: R, c: thTotalCols - 1 } });
        }
      }
      thSheet['!merges'] = thMerges;

      // Styles
      const thThinBorder = {
        top:    { style: 'thin', color: { rgb: 'FFB0B0B0' } },
        bottom: { style: 'thin', color: { rgb: 'FFB0B0B0' } },
        left:   { style: 'thin', color: { rgb: 'FFB0B0B0' } },
        right:  { style: 'thin', color: { rgb: 'FFB0B0B0' } },
      };

      for (let R = 0; R <= thRange.e.r; R++) {
        for (let C = 0; C <= thRange.e.c; C++) {
          const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
          if (!thSheet[cellRef]) thSheet[cellRef] = { v: '', t: 's' };
          const cell = thSheet[cellRef];
          const val  = String(cell.v ?? '');

          if (R === 0) {
            cell.s = { font: { name: 'Calibri', sz: 14, bold: true, color: { rgb: 'FF1F3864' } }, alignment: { horizontal: 'center', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: 'FFD6E4F0' } } };
          } else if (R === 1) {
            cell.s = { font: { name: 'Calibri', sz: 12, bold: true, color: { rgb: 'FF2E75B6' } }, alignment: { horizontal: 'center', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: 'FFD6E4F0' } } };
          } else if (R === 2) {
            cell.s = { font: { name: 'Calibri', sz: 10, italic: true, color: { rgb: 'FF595959' } }, alignment: { horizontal: 'center', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: 'FFF2F2F2' } } };
          } else if (R === 3) {
            // Column header row
            const isStatCol = C >= thFixedHdrs.length + adDateList.length;
            cell.s = {
              font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFFFF' } },
              fill: { patternType: 'solid', fgColor: { rgb: isStatCol ? 'FF1F3864' : 'FF2F5496' } },
              alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
              border: thThinBorder,
            };
          } else if (typeof val === 'string' && val.startsWith('Team Head:')) {
            cell.s = {
              font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFFFF' } },
              fill: { patternType: 'solid', fgColor: { rgb: 'FF2E75B6' } },
              alignment: { horizontal: 'left', vertical: 'center' },
              border: thThinBorder,
            };
          } else if (typeof val === 'string' && val.startsWith('Team Summary')) {
            cell.s = {
              font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FF1F3864' } },
              fill: { patternType: 'solid', fgColor: { rgb: 'FFD6E4F0' } },
              alignment: { horizontal: 'left', vertical: 'center' },
              border: thThinBorder,
            };
          } else if (R > 3) {
            const rowEven = R % 2 === 0;
            const isFixed = C < thFixedHdrs.length;
            const isStatC = C >= thFixedHdrs.length + adDateList.length;

            if (isFixed || isStatC) {
              cell.s = {
                font: { name: 'Calibri', sz: 10, bold: isStatC },
                fill: { patternType: 'solid', fgColor: { rgb: isStatC ? (rowEven ? 'FFEAF0FB' : 'FFF0F4FF') : (rowEven ? 'FFF5F8FF' : 'FFFFFFFF') } },
                alignment: { horizontal: isFixed && C === 1 ? 'left' : 'center', vertical: 'center', wrapText: false },
                border: thThinBorder,
              };
            } else {
              // Date attendance cells
              let fillColor = rowEven ? 'FFF5F8FF' : 'FFFFFFFF';
              let fontColor = 'FF000000';
              let bold = false;
              if (val === 'A')       { fillColor = 'FFFFC7CE'; fontColor = 'FF9C0006'; bold = true; }
              else if (val === 'WO' || val === 'H') { fillColor = 'FFF2F2F2'; fontColor = 'FF595959'; }
              else if (['L', 'CL', 'SL', 'PL', 'WFH'].includes(val)) { fillColor = 'FFE2EFDA'; fontColor = 'FF375623'; }
              else if (val.includes('IN:')) {
                if (val.includes('STATUS: LATE')) { fillColor = 'FFFFF2CC'; fontColor = 'FF7D6608'; }
              }
              cell.s = {
                font: { name: 'Calibri', sz: 9, bold, color: { rgb: fontColor } },
                fill: { patternType: 'solid', fgColor: { rgb: fillColor } },
                alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                border: thThinBorder,
              };
            }
          }
        }
      }

      // Column widths
      thSheet['!cols'] = [
        { wch: 12 }, // Emp Code
        { wch: 24 }, // Employee Name
        { wch: 16 }, // Department
        { wch: 20 }, // Team Head
        ...adDateList.map(() => ({ wch: 12 })),
        ...TH_STAT_COLS.map(() => ({ wch: 14 })),
      ];

      // Row heights
      const thRowHeights: any[] = [
        { hpt: 22 }, { hpt: 18 }, { hpt: 16 }, { hpt: 22 },
      ];
      for (let i = 4; i <= thRange.e.r; i++) {
        const v = thAoa[i]?.[0] ?? '';
        thRowHeights.push({
          hpt: typeof v === 'string' && (v.startsWith('Team Head:') || v.startsWith('Team Summary')) ? 20 : 32,
        });
      }
      thSheet['!rows'] = thRowHeights;

      // Freeze top 4 rows + first 4 fixed columns
      thSheet['!freeze'] = {
        xSplit: 4, ySplit: 4,
        topLeftCell: XLSX.utils.encode_cell({ r: 4, c: 4 }),
      };
      }

      // ── Workbook ──────────────────────────────────────────────────────
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, appCiSheet,     'App Check-ins');
      XLSX.utils.book_append_sheet(wb, bioCiSheet,     'Biometric (Device)');
      XLSX.utils.book_append_sheet(wb, adSheet,        "AD Attendance");
      XLSX.utils.book_append_sheet(wb, fvSheet,        "Field Visits");
      XLSX.utils.book_append_sheet(wb, summarySheet,   "Employee Summary");
      XLSX.utils.book_append_sheet(wb, pivotSheet,     "Daily Pivot");
      XLSX.utils.book_append_sheet(wb, locSheet,       "Location Pings (All)");
      XLSX.utils.book_append_sheet(wb, hourlySheet,    "Location Hourly Summary");
      if (combinedSheet && thSheet) {
        XLSX.utils.book_append_sheet(wb, combinedSheet, 'Combined Sheet');
        XLSX.utils.book_append_sheet(wb, thSheet, 'Team Head Wise');
      }

      const fileName = `Attendance_${startDate}_to_${endDate}.xlsx`;
      setExportStatus("Starting complete 10-sheet download...");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await saveExcelWorkbook(XLSX, wb, fileName);
    } catch (err: any) {
      const message = err?.message || "The complete attendance workbook could not be created.";
      setExportError(message);
      window.alert("Export failed: " + message);
    } finally {
      setExporting(false);
      setExportStatus("");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={s.headerRow}>
          <View>
            <ThemedText type="h3">Attendance</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>{records.length} records</ThemedText>
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {/* Admin-only: Match biometric device codes to HRMS users */}
            <TouchableOpacity
              style={[s.viewToggleBtn, { backgroundColor: '#7C3AED' }]}
              onPress={() => navigation.navigate('BiometricUserMatch')}
            >
              <Feather name="cpu" size={15} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.viewToggleBtn, viewMode === "list" && { backgroundColor: theme.primary }]}
              onPress={() => setViewMode("list")}
            >
              <Feather name="list" size={15} color={viewMode === "list" ? "#fff" : theme.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.viewToggleBtn, viewMode === "grid" && { backgroundColor: theme.primary }]}
              onPress={() => setViewMode("grid")}
            >
              <Feather name="grid" size={15} color={viewMode === "grid" ? "#fff" : theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Tab switcher: App Attendance | Biometric Logs ── */}
        {biometricDataError ? (
          <>
            <View
              style={{
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: "#EF4444",
                backgroundColor: "#EF444410",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Feather name="alert-triangle" size={16} color="#EF4444" />
              <ThemedText style={{ color: "#EF4444", flex: 1, fontSize: 12 }}>
                Biometric reconciliation is incomplete: {biometricDataError}
              </ThemedText>
              <TouchableOpacity onPress={() => void loadData()}>
                <ThemedText style={{ color: "#EF4444", fontWeight: "700", fontSize: 12 }}>
                  Retry
                </ThemedText>
              </TouchableOpacity>
            </View>
            <Spacer height={8} />
          </>
        ) : null}

        {profileLookupError || warningUpdateError ? (
          <>
            <View
              style={{
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: "#F59E0B",
                backgroundColor: "#F59E0B10",
                gap: 4,
              }}
            >
              {profileLookupError ? (
                <ThemedText style={{ color: "#92400E", fontSize: 12 }}>
                  Biometric employee lookup unavailable: {profileLookupError}
                </ThemedText>
              ) : null}
              {warningUpdateError ? (
                <ThemedText style={{ color: "#92400E", fontSize: 12 }}>
                  Attendance warning recalculation failed: {warningUpdateError}
                </ThemedText>
              ) : null}
            </View>
            <Spacer height={8} />
          </>
        ) : null}

        <View style={s.tabRow}>
          <TouchableOpacity
            style={[s.tabBtn, activeTab === 'app' && { backgroundColor: theme.primary, borderColor: theme.primary }]}
            onPress={() => setActiveTab('app')}
          >
            <Feather name="smartphone" size={13} color={activeTab === 'app' ? '#fff' : theme.textSecondary} />
            <ThemedText style={[s.tabBtnText, activeTab === 'app' && { color: '#fff' }]}>App Attendance</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabBtn, activeTab === 'biometric' && { backgroundColor: '#7C3AED', borderColor: '#7C3AED' }]}
            onPress={() => setActiveTab('biometric')}
          >
            <Feather name="cpu" size={13} color={activeTab === 'biometric' ? '#fff' : theme.textSecondary} />
            <ThemedText style={[s.tabBtnText, activeTab === 'biometric' && { color: '#fff' }]}>
              Biometric Logs {rawDeviceLogs.length > 0 ? `(${rawDeviceLogs.length})` : ''}
            </ThemedText>
          </TouchableOpacity>
        </View>

        <Spacer height={12} />

        {/* Biometric sync status banner */}
        <TouchableOpacity
          style={[s.syncBanner, { backgroundColor: syncStatus.ok ? '#05966910' : '#EF444410', borderColor: syncStatus.ok ? '#059669' : '#EF4444' }]}
          onPress={async () => {
            setSyncing(true);
            try {
              await biometricSyncService.runNow();
              await loadData();
            } catch (error: any) {
              Alert.alert(
                "Biometric sync failed",
                error?.message || "The synchronization result is unknown.",
              );
            } finally {
              setSyncing(false);
            }
          }}
          disabled={syncing}
        >
          <Feather name={syncStatus.ok ? 'check-circle' : 'alert-circle'} size={14} color={syncStatus.ok ? '#059669' : '#EF4444'} />
          <ThemedText style={{ fontSize: 12, fontWeight: '600', color: syncStatus.ok ? '#059669' : '#EF4444', flex: 1 }}>
            {syncStatus.ok
              ? `Biometric synced ${syncStatus.lastAttempt ? syncStatus.lastAttempt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}`
              : `Biometric: ${syncStatus.message}`}
          </ThemedText>
          <ThemedText style={{ fontSize: 11, color: syncStatus.ok ? '#059669' : '#EF4444', fontWeight: '700' }}>
            {syncing ? 'Syncing...' : 'Sync Now'}
          </ThemedText>
        </TouchableOpacity>

        <Spacer height={8} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 2 }}>
            {PRESETS.map((p) => (
              <TouchableOpacity
                key={p.label}
                style={[s.preset, activePreset === p.label && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                onPress={() => applyPreset(p)}
              >
                <ThemedText style={[s.presetText, activePreset === p.label && { color: "#fff" }]}>{p.label}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Search Bar */}
        <View style={s.searchContainer}>
          <Feather name="search" size={16} color={theme.textSecondary} style={s.searchIcon} />
          <TextInput
            style={[s.searchInput, { backgroundColor: theme.backgroundDefault, color: theme.text }]}
            placeholder="Search employees..."
            placeholderTextColor={theme.textSecondary}
            value={searchText}
            onChangeText={setSearchText}
          />
          {searchText ? (
            <Pressable onPress={() => setSearchText("")}>
              <Feather name="x" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {/* Manual date range */}
        <View style={[s.filterCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 4 }}>From</ThemedText>
              <TextInput
                style={[s.input, { backgroundColor: theme.backgroundRoot, color: theme.text }]}
                value={startDate} onChangeText={setStartDate}
                placeholder="e.g. 27 Jun 2026" placeholderTextColor={theme.textSecondary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 4 }}>To</ThemedText>
              <TextInput
                style={[s.input, { backgroundColor: theme.backgroundRoot, color: theme.text }]}
                value={endDate} onChangeText={setEndDate}
                placeholder="e.g. 27 Jun 2026" placeholderTextColor={theme.textSecondary}
              />
            </View>
          </View>

          <Spacer height={10} />

          {/* Office filter */}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {[{ id: "", name: "All Offices" }, ...offices].map((o) => (
              <TouchableOpacity
                key={o.id}
                style={[s.chip, officeFilter === o.id && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                onPress={() => setOfficeFilter(o.id)}
              >
                <ThemedText style={[s.chipText, officeFilter === o.id && { color: "#fff" }]}>{o.name}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          <Spacer height={10} />

          <TouchableOpacity
            style={[s.applyBtn, { backgroundColor: theme.primary }]}
            onPress={() => { setActivePreset(""); loadData(); }}
          >
            <Feather name="search" size={14} color="#fff" />
            <ThemedText style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Search</ThemedText>
          </TouchableOpacity>
        </View>

        <Spacer height={16} />

        {/* ═══════════════ BIOMETRIC LOGS TAB ═══════════════ */}
        {activeTab === 'biometric' && (
          <View>
            {/* Info banner */}
            <View style={[s.infoBanner, { backgroundColor: '#7C3AED10', borderColor: '#7C3AED30' }]}>
              <Feather name="info" size={13} color="#7C3AED" />
              <ThemedText style={{ flex: 1, fontSize: 12, color: '#7C3AED', lineHeight: 17 }}>
              Raw punches from the SmartOffice biometric device. Tap "Match" on any unmatched code to link it to an employee. The link is saved permanently — future syncs auto-map it.
              </ThemedText>
            </View>
            <Spacer height={8} />
            {loading ? (
              <ThemedText style={{ textAlign: 'center', color: theme.textSecondary, marginTop: 40 }}>Loading...</ThemedText>
            ) : rawDeviceLogs.length === 0 ? (
              <View style={s.empty}>
                <Feather name="cpu" size={40} color={theme.textSecondary} />
                <Spacer height={12} />
                <ThemedText style={{ color: theme.textSecondary }}>No biometric logs for this period</ThemedText>
                <ThemedText style={{ color: theme.textSecondary, fontSize: 12, marginTop: 4, textAlign: 'center' }}>The SmartOffice device may be offline (HTTP 500) or no punches exist yet.</ThemedText>
              </View>
            ) : (() => {
              // Group raw punches by date → employee_code
              const byDate = new Map<string, Map<string, { name: string; empNum: string; code: string; punches: string[]; directions: (string|null)[]; matched: boolean }>>();
              for (const row of rawDeviceLogs) {
                const date = row.log_date_only ?? '--';
                const code = row.employee_code ?? 'UNKNOWN';
                if (!byDate.has(date)) byDate.set(date, new Map());
                const dateMap = byDate.get(date)!;
                if (!dateMap.has(code)) {
                  dateMap.set(code, {
                    name: toTitleCase(row.profiles?.name ?? ''),
                    empNum: row.profiles?.employee_number ?? '',
                    code,
                    punches: [],
                    directions: [],
                    matched: !!row.user_id,
                  });
                }
                const entry = dateMap.get(code)!;
                entry.punches.push(row.log_time ?? '');
                entry.directions.push(row.punch_direction ?? null);
              }
              const fmtRawTime = (t: string) => t.slice(0, 5).replace(/^(\d{2}):(\d{2})/, (_, h, m) => { const n = parseInt(h); return `${n % 12 || 12}:${m} ${n >= 12 ? 'pm' : 'am'}`; });
              return Array.from(byDate.entries()).map(([date, codeMap]) => (
                <View key={date} style={{ marginBottom: 12 }}>
                  <View style={[s.dateHeader, { backgroundColor: '#7C3AED' }]}>
                    <View>
                      <ThemedText style={s.dateHeaderText}>{fmtDate(date)}</ThemedText>
                      <ThemedText style={s.dateHeaderSub}>{codeMap.size} employee codes | {[...codeMap.values()].reduce((a, v) => a + v.punches.length, 0)} punches</ThemedText>
                    </View>
                    <Feather name="cpu" size={16} color="#fff" />
                  </View>
                  {[...codeMap.values()].map(emp => {
                    const isOpen = openMatchCode === emp.code;
                    const isSaving = savingCode === emp.code;
                    const searchQ = (matchSearchMap[emp.code] ?? '').toLowerCase().trim();
                    const filteredProfiles = searchQ
                      ? allProfiles.filter(p =>
                          p.name.toLowerCase().includes(searchQ) ||
                          (p.employee_number ?? '').toLowerCase().includes(searchQ) ||
                          (p.role ?? '').toLowerCase().includes(searchQ)
                        )
                      : allProfiles;
                    return (
                      <View key={emp.code} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: emp.matched ? '#7C3AED' : '#F59E0B', padding: 0, overflow: 'hidden' }]}>
                        <View style={{ padding: 12 }}>
                          {/* Top row: name + match button */}
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <View style={{ flex: 1, marginRight: 8 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <ThemedText style={[s.empName, { color: textColor }]}>
                                  {emp.matched ? emp.name || emp.code : emp.code}
                                </ThemedText>
                                <View style={[s.statusBadge, { backgroundColor: emp.matched ? '#7C3AED20' : '#F59E0B20' }]}>
                                  <ThemedText style={[s.statusText, { color: emp.matched ? '#7C3AED' : '#F59E0B' }]}>
                                    {emp.matched ? 'Linked' : 'Unmatched'}
                                  </ThemedText>
                                </View>
                              </View>
                              {emp.matched && emp.empNum ? (
                                <ThemedText style={[s.meta, { color: theme.textSecondary }]}>#{emp.empNum} | Code: {emp.code}</ThemedText>
                              ) : emp.matched ? (
                                <ThemedText style={[s.meta, { color: theme.textSecondary }]}>Code: {emp.code}</ThemedText>
                              ) : (
                                <ThemedText style={[s.meta, { color: '#F59E0B' }]}>Device code not linked — search below to match</ThemedText>
                              )}
                            </View>
                            {/* Match / Re-link button — always visible */}
                            <TouchableOpacity
                              style={[s.actionBtn, {
                                backgroundColor: isOpen ? '#7C3AED' : '#7C3AED15',
                                borderColor: '#7C3AED',
                              }]}
                              onPress={() => setOpenMatchCode(isOpen ? null : emp.code)}
                              disabled={isSaving}
                            >
                              {isSaving ? (
                                <ThemedText style={{ fontSize: 11, color: isOpen ? '#fff' : '#7C3AED', fontWeight: '700' }}>Saving...</ThemedText>
                              ) : (
                                <>
                                  <Feather name={isOpen ? 'chevron-up' : 'link'} size={11} color={isOpen ? '#fff' : '#7C3AED'} />
                                  <ThemedText style={{ fontSize: 11, color: isOpen ? '#fff' : '#7C3AED', fontWeight: '700' }}>
                                    {emp.matched ? 'Re-link' : 'Match'}
                                  </ThemedText>
                                </>
                              )}
                            </TouchableOpacity>
                          </View>

                          {/* Punch time chips */}
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                            {emp.punches.map((t, i) => (
                              <View key={i} style={[s.punchChip, {
                                backgroundColor: emp.directions[i]?.toLowerCase() === 'in' ? '#10B98115'
                                  : emp.directions[i]?.toLowerCase() === 'out' ? '#EF444415' : '#7C3AED15',
                              }]}>
                                <Feather
                                  name={emp.directions[i]?.toLowerCase() === 'in' ? 'log-in' : emp.directions[i]?.toLowerCase() === 'out' ? 'log-out' : 'clock'}
                                  size={10}
                                  color={emp.directions[i]?.toLowerCase() === 'in' ? '#10B981' : emp.directions[i]?.toLowerCase() === 'out' ? '#EF4444' : '#7C3AED'}
                                />
                                <ThemedText style={{ fontSize: 11, fontWeight: '600', color: textColor }}>{fmtRawTime(t)}</ThemedText>
                                {!!emp.directions[i] && (
                                  <ThemedText style={{ fontSize: 10, color: theme.textSecondary }}>{emp.directions[i]}</ThemedText>
                                )}
                              </View>
                            ))}
                          </View>
                        </View>

                        {/* ── Inline search + match panel ── */}
                        {isOpen && (
                          <View style={[s.matchPanel, { backgroundColor: theme.backgroundRoot, borderTopColor: theme.backgroundRoot }]}>
                            {/* Search input */}
                            <View style={[s.matchSearchRow, { backgroundColor: theme.backgroundDefault }]}>
                              <Feather name="search" size={14} color={theme.textSecondary} />
                              <TextInput
                                style={[s.matchSearchInput, { color: theme.text }]}
                                placeholder="Search by name, employee ID or role..."
                                placeholderTextColor={theme.textSecondary}
                                value={matchSearchMap[emp.code] ?? ''}
                                onChangeText={text => setMatchSearchMap(prev => ({ ...prev, [emp.code]: text }))}
                                autoFocus
                              />
                              {(matchSearchMap[emp.code] ?? '') ? (
                                <TouchableOpacity onPress={() => setMatchSearchMap(prev => ({ ...prev, [emp.code]: '' }))}>
                                  <Feather name="x" size={14} color={theme.textSecondary} />
                                </TouchableOpacity>
                              ) : null}
                            </View>
                            {/* Results list */}
                            <ScrollView nestedScrollEnabled style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
                              {filteredProfiles.length === 0 ? (
                                <ThemedText style={{ padding: 12, color: theme.textSecondary, fontSize: 12, textAlign: 'center' }}>No employees found</ThemedText>
                              ) : (
                                filteredProfiles.map((profile: any) => (
                                  <TouchableOpacity
                                    key={profile.id}
                                    style={[
                                      s.matchProfileRow,
                                      { borderBottomColor: theme.backgroundRoot },
                                      profile.smartoffice_employee_code === emp.code && { backgroundColor: '#7C3AED10' },
                                    ]}
                                    onPress={() => handleInlineMatch(emp.code, profile)}
                                  >
                                    <View style={{ flex: 1 }}>
                                      <ThemedText style={{ fontSize: 13, fontWeight: '700', color: textColor }}>{profile.name}</ThemedText>
                                      <ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>
                                        {[profile.employee_number, profile.role].filter(Boolean).join(' · ')}
                                      </ThemedText>
                                      {profile.smartoffice_employee_code && profile.smartoffice_employee_code !== emp.code && (
                                        <ThemedText style={{ fontSize: 10, color: '#F59E0B', marginTop: 2 }}>
                                          Already linked to: {profile.smartoffice_employee_code}
                                        </ThemedText>
                                      )}
                                      {profile.smartoffice_employee_code === emp.code && (
                                        <ThemedText style={{ fontSize: 10, color: '#7C3AED', marginTop: 2, fontWeight: '700' }}>✓ Currently linked</ThemedText>
                                      )}
                                    </View>
                                    <View style={[s.matchBtn, { backgroundColor: profile.smartoffice_employee_code === emp.code ? '#10B981' : '#7C3AED' }]}>
                                      <ThemedText style={{ fontSize: 11, color: '#fff', fontWeight: '700' }}>
                                        {profile.smartoffice_employee_code === emp.code ? 'Linked' : 'Match'}
                                      </ThemedText>
                                    </View>
                                  </TouchableOpacity>
                                ))
                              )}
                            </ScrollView>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              ));
            })()}
            <Spacer height={100} />
          </View>
        )}

        {/* ═══════════════ APP ATTENDANCE TAB ═══════════════ */}
        {activeTab === 'app' && loading ? (
          <ThemedText style={{ textAlign: "center", color: theme.textSecondary, marginTop: 40 }}>Loading...</ThemedText>
        ) : activeTab === 'app' && grouped.length === 0 ? (
          <View style={s.empty}>
            <Feather name="calendar" size={40} color={theme.textSecondary} />
            <Spacer height={12} />
            <ThemedText style={{ color: theme.textSecondary }}>No records for this period</ThemedText>
          </View>
        ) : activeTab === 'app' && (
          grouped.map(({ date, appOnly, bioOnly, both, otherAttendance, noAttendance }) => {
            const expanded = expandedDates.has(date);
            const presentCount =
              both.length + appOnly.length + bioOnly.length + otherAttendance.length;
            const absentCount = noAttendance.filter((item) =>
              ["ABSENT", "NO_DATA", "CONFIG_REQUIRED"].includes(
                String(item.status).toUpperCase(),
              ),
            ).length;

            const renderRecord = (item: AttendanceRecord) => {
              const isBio = item.smartoffice_imported === true || item.attendance_type === 'BIOMETRIC';
              const cinTime = fmt(item.checkin_time);
              const coutTime = item.checkout_time ? fmt(item.checkout_time) : null;
              const statusColor = item.status === 'CHECKED_OUT' ? Colors.light.success
                : item.status === 'CHECKED_IN' ? Colors.light.info : Colors.light.error;
              const isLate = isServerConfirmedLate(item);
              return (
                <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={[s.empName, { color: textColor }]}>{item.employee_name}</ThemedText>
                      <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{item.office_name}</ThemedText>
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                        <View style={s.timeChip}>
                          <Feather name="log-in" size={11} color="#10B981" />
                          <ThemedText style={[s.timeText, { color: textColor }]}>{cinTime}</ThemedText>
                        </View>
                        {coutTime && (
                          <View style={s.timeChip}>
                            <Feather name="log-out" size={11} color="#EF4444" />
                            <ThemedText style={[s.timeText, { color: textColor }]}>{coutTime}</ThemedText>
                          </View>
                        )}
                        {item.distance_from_office ? (
                          <View style={s.timeChip}>
                            <Feather name="map-pin" size={11} color="#6B7280" />
                            <ThemedText style={[s.timeText, { color: textColor }]}>{item.distance_from_office}m</ThemedText>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <View style={[s.statusBadge, { backgroundColor: statusColor + '20' }]}>
                        <ThemedText style={[s.statusText, { color: statusColor }]}>
                          {attendanceStatusLabel(item, today)}
                        </ThemedText>
                      </View>
                      {isLate && (
                        <View style={[s.statusBadge, { backgroundColor: Colors.light.warning + '20' }]}>
                          <ThemedText style={[s.statusText, { color: Colors.light.warning }]}>Late</ThemedText>
                        </View>
                      )}
                      {item.warning && <Feather name="alert-triangle" size={14} color={Colors.light.warning} />}
                      {!isBio && (
                        <TouchableOpacity style={s.timelineBtn} onPress={() => openTimeline(item.user_id, item.employee_name, item.date)}>
                          <Feather name="map-pin" size={11} color="#3B82F6" />
                          <ThemedText style={s.timelineBtnText}>Timeline</ThemedText>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            };

            // "Both" section: dedupe by user, split left=App / right=Bio
            const bothUserIds = [...new Set(both.map(r => r.user_id))];
            const fmtPunch = (t: string) => t.slice(0,5).replace(/^(\d{2}):(\d{2})/, (_, h, m) => { const n=parseInt(h); return `${n%12||12}:${m} ${n>=12?'pm':'am'}`; });
            const renderBothSection = () => {
              if (bothUserIds.length === 0) return null;
              return (
                <View>
                  <View style={[s.sectionHeader, { backgroundColor: '#05966915', borderLeftColor: '#059669' }]}>
                    <Feather name="check-circle" size={12} color="#059669" />
                    <ThemedText style={[s.sectionHeaderText, { color: '#059669' }]}>App + Biometric ({bothUserIds.length})</ThemedText>
                  </View>
                  {bothUserIds.map(uid => {
                    const appRec = both.find(r => r.user_id === uid)!;
                    const ref = appRec;
                    const bioPunches = deviceAllPunches[`${uid}_${date}`] ?? [];
                    const rawPunch = devicePunchMap[`${uid}_${date}`];
                    const isLate = isServerConfirmedLate(ref);

                    let gapMins: number | null = null;
                    if (appRec?.app_checkin_time && rawPunch?.first) {
                      const rawMs = new Date(`${date}T${rawPunch.first}+05:30`).getTime();
                      const appMs = toIST(appRec.app_checkin_time).getTime();
                      gapMins = Math.round((appMs - rawMs) / 60000);
                    }
                    const bigGap = gapMins !== null && Math.abs(gapMins) >= 15;
                    const gapLabel = gapMins !== null && gapMins !== 0
                      ? `App ${gapMins > 0 ? Math.abs(gapMins)+'m AFTER' : Math.abs(gapMins)+'m BEFORE'} device`
                      : null;
                    const lastPunchHour = rawPunch?.last
                      ? parseInt(rawPunch.last.split(':')[0], 10)
                      : rawPunch?.first ? parseInt(rawPunch.first.split(':')[0], 10) : 25;
                    const noCheckoutPunch = bioPunches.length > 0 && lastPunchHour < 18;
                    const borderColor = bigGap ? '#EF4444' : noCheckoutPunch ? '#F59E0B' : '#059669';

                    return (
                      <View key={uid} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: borderColor, padding: 0, overflow: 'hidden' }]}>
                        {/* Header */}
                        <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
                          <ThemedText style={[s.empName, { color: textColor }]}>{ref.employee_name}</ThemedText>
                          <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{ref.office_name}</ThemedText>
                          {bigGap && gapLabel && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                              <Feather name="alert-triangle" size={10} color="#EF4444" />
                              <ThemedText style={{ fontSize: 11, color: '#EF4444', fontWeight: '700' }}>{gapLabel}</ThemedText>
                            </View>
                          )}
                          {noCheckoutPunch && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                              <Feather name="alert-circle" size={10} color="#F59E0B" />
                              <ThemedText style={{ fontSize: 11, color: '#F59E0B', fontWeight: '700' }}>No checkout punch before 6 PM</ThemedText>
                            </View>
                          )}
                        </View>
                        {/* Left / Right split */}
                        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.backgroundRoot }}>
                          {/* LEFT — App */}
                          <View style={{ flex: 1, padding: 10, borderRightWidth: 1, borderRightColor: theme.backgroundRoot, backgroundColor: '#0EA5E908' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                              <Feather name="smartphone" size={11} color="#0EA5E9" />
                              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: '#0EA5E9' }}>App</ThemedText>
                              {isLate && <View style={[s.statusBadge, { backgroundColor: '#F59E0B20' }]}><ThemedText style={[s.statusText, { color: '#F59E0B' }]}>Late</ThemedText></View>}
                            </View>
                            {appRec ? (
                              <>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                  <Feather name="log-in" size={10} color="#10B981" />
                                  <ThemedText style={[s.timeText, { color: textColor }]}>{fmt(appRec.app_checkin_time ?? undefined)}</ThemedText>
                                </View>
                                {appRec.checkout_time ? (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                    <Feather name="log-out" size={10} color="#EF4444" />
                                    <ThemedText style={[s.timeText, { color: textColor }]}>{fmt(appRec.checkout_time)}</ThemedText>
                                  </View>
                                ) : (
                                  <ThemedText style={{ fontSize: 11, color: appRec.date < today ? '#F59E0B' : '#10B981', marginTop: 3 }}>
                                    {appRec.date < today ? 'P-NC | Present - No Checkout' : 'Active'}
                                  </ThemedText>
                                )}
                                <TouchableOpacity style={[s.timelineBtn, { marginTop: 6 }]} onPress={() => openTimeline(uid, ref.employee_name, ref.date)}>
                                  <Feather name="map-pin" size={10} color="#3B82F6" />
                                  <ThemedText style={s.timelineBtnText}>Timeline</ThemedText>
                                </TouchableOpacity>
                                {appRec && (
                                  <TouchableOpacity style={[s.timelineBtn, { marginTop: 6 }]} onPress={() => correctAttendance(appRec)}>
                                    <Feather name="edit-2" size={10} color="#6D1B6D" />
                                    <ThemedText style={[s.timelineBtnText, { color: "#6D1B6D" }]}>Correct</ThemedText>
                                  </TouchableOpacity>
                                )}
                              </>
                            ) : (
                              <ThemedText style={{ fontSize: 11, color: theme.textSecondary, fontStyle: 'italic' }}>No app record</ThemedText>
                            )}
                          </View>
                          {/* RIGHT — Biometric */}
                          <View style={{ flex: 1, padding: 10, backgroundColor: '#7C3AED08' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                              <Feather name="cpu" size={11} color="#7C3AED" />
                              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: '#7C3AED' }}>Biometric</ThemedText>
                              <ThemedText style={{ fontSize: 10, color: theme.textSecondary }}>({bioPunches.length} log{bioPunches.length !== 1 ? 's' : ''})</ThemedText>
                            </View>
                            {bioPunches.length === 0 ? (
                              <ThemedText style={{ fontSize: 11, color: theme.textSecondary, fontStyle: 'italic' }}>No device punches</ThemedText>
                            ) : (
                              bioPunches.map((t, i) => (
                                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                  <ThemedText style={{ fontSize: 10, color: theme.textSecondary, width: 14 }}>{i + 1}.</ThemedText>
                                  <ThemedText style={[s.timeText, { color: textColor }]}>{fmtPunch(t)}</ThemedText>
                                </View>
                              ))
                            )}
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            };

            return (
              <View key={date} style={{ marginBottom: 12 }}>
                <TouchableOpacity style={[s.dateHeader, { backgroundColor: theme.primary }]} onPress={() => toggleDate(date)}>
                  <View>
                    <ThemedText style={s.dateHeaderText}>{fmtDate(date)}</ThemedText>
                    <ThemedText style={s.dateHeaderSub}>
                      {presentCount} checked in | {absentCount} absent
                      {noAttendance.length > absentCount
                        ? ` | ${noAttendance.length - absentCount} off/leave/configuration`
                        : ""}
                    </ThemedText>
                  </View>
                  <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#fff" />
                </TouchableOpacity>

                {expanded && (
                  <>
                    {renderBothSection()}
                    {appOnly.length > 0 && (
                      <View>
                        <View style={[s.sectionHeader, { backgroundColor: '#0EA5E915', borderLeftColor: '#0EA5E9' }]}>
                          <Feather name="smartphone" size={12} color="#0EA5E9" />
                          <ThemedText style={[s.sectionHeaderText, { color: '#0EA5E9' }]}>App Only ({appOnly.length})</ThemedText>
                        </View>
                        {appOnly.map(item => {
                          const isLate = isServerConfirmedLate(item);
                          const bioPunches = deviceAllPunches[`${item.user_id}_${item.date}`] ?? [];
                          const fmtPunch = (t: string) => t.slice(0,5).replace(/^(\d{2}):(\d{2})/, (_, h, m) => { const n=parseInt(h); return `${n%12||12}:${m} ${n>=12?'pm':'am'}`; });
                          return (
                            <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: '#0EA5E9', padding: 0, overflow: 'hidden' }]}>
                              {/* Employee name + office header */}
                              <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
                                <ThemedText style={[s.empName, { color: textColor }]}>{item.employee_name}</ThemedText>
                                <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{item.office_name}</ThemedText>
                              </View>
                              {/* Left / Right split */}
                              <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.backgroundRoot }}>
                                {/* LEFT — App */}
                                <View style={{ flex: 1, padding: 10, borderRightWidth: 1, borderRightColor: theme.backgroundRoot, backgroundColor: '#0EA5E908' }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                                    <Feather name="smartphone" size={11} color="#0EA5E9" />
                                    <ThemedText style={{ fontSize: 11, fontWeight: '700', color: '#0EA5E9' }}>App</ThemedText>
                                    {isLate && <View style={[s.statusBadge, { backgroundColor: '#F59E0B20' }]}><ThemedText style={[s.statusText, { color: '#F59E0B' }]}>Late</ThemedText></View>}
                                  </View>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Feather name="log-in" size={10} color="#10B981" />
                                    <ThemedText style={[s.timeText, { color: textColor }]}>{fmt(item.app_checkin_time ?? undefined)}</ThemedText>
                                  </View>
                                  {item.checkout_time ? (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                      <Feather name="log-out" size={10} color="#EF4444" />
                                      <ThemedText style={[s.timeText, { color: textColor }]}>{fmt(item.checkout_time)}</ThemedText>
                                    </View>
                                  ) : (
                                    <ThemedText style={{ fontSize: 11, color: item.date < today ? '#F59E0B' : '#10B981', marginTop: 3 }}>
                                      {item.date < today ? 'P-NC | Present - No Checkout' : 'Active'}
                                    </ThemedText>
                                  )}
                                  <TouchableOpacity style={[s.timelineBtn, { marginTop: 6 }]} onPress={() => openTimeline(item.user_id, item.employee_name, item.date)}>
                                    <Feather name="map-pin" size={10} color="#3B82F6" />
                                    <ThemedText style={s.timelineBtnText}>Timeline</ThemedText>
                                  </TouchableOpacity>
                                  <TouchableOpacity style={[s.timelineBtn, { marginTop: 6 }]} onPress={() => correctAttendance(item)}>
                                    <Feather name="edit-2" size={10} color="#6D1B6D" />
                                    <ThemedText style={[s.timelineBtnText, { color: "#6D1B6D" }]}>Correct</ThemedText>
                                  </TouchableOpacity>
                                </View>
                                {/* RIGHT — Biometric */}
                                <View style={{ flex: 1, padding: 10, backgroundColor: '#7C3AED08' }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                                    <Feather name="cpu" size={11} color="#7C3AED" />
                                    <ThemedText style={{ fontSize: 11, fontWeight: '700', color: '#7C3AED' }}>Biometric</ThemedText>
                                    <ThemedText style={{ fontSize: 10, color: theme.textSecondary }}>({bioPunches.length} log{bioPunches.length !== 1 ? 's' : ''})</ThemedText>
                                  </View>
                                  {bioPunches.length === 0 ? (
                                    <ThemedText style={{ fontSize: 11, color: theme.textSecondary, fontStyle: 'italic' }}>No device punches</ThemedText>
                                  ) : (
                                    bioPunches.map((t, i) => (
                                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                        <ThemedText style={{ fontSize: 10, color: theme.textSecondary, width: 14 }}>{i + 1}.</ThemedText>
                                        <ThemedText style={[s.timeText, { color: textColor }]}>{fmtPunch(t)}</ThemedText>
                                      </View>
                                    ))
                                  )}
                                </View>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                    {bioOnly.length > 0 && (
                      <View>
                        <View style={[s.sectionHeader, { backgroundColor: '#7C3AED15', borderLeftColor: '#7C3AED' }]}>
                          <Feather name="cpu" size={12} color="#7C3AED" />
                          <ThemedText style={[s.sectionHeaderText, { color: '#7C3AED' }]}>Biometric Only ({bioOnly.length})</ThemedText>
                        </View>
                        {bioOnly.map(item => {
                          const punch = devicePunchMap[`${item.user_id}_${item.date}`];
                          // punch.last before 18:00 means no checkout punch — flag yellow
                          const lastPunchHour = punch?.last
                            ? parseInt(punch.last.split(':')[0], 10)
                            : punch?.first
                              ? parseInt(punch.first.split(':')[0], 10)
                              : 25;
                          const noCheckout = lastPunchHour < 18;
                          return (
                            <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: noCheckout ? '#F59E0B' : '#7C3AED' }]}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <View style={{ flex: 1 }}>
                                  <ThemedText style={[s.empName, { color: textColor }]}>{item.employee_name}</ThemedText>
                                  <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{item.office_name}</ThemedText>
                                  <View style={{ gap: 4, marginTop: 6 }}>
                                    <View style={[s.sourceRow, { backgroundColor: '#7C3AED12' }]}>
                                      <Feather name="cpu" size={10} color="#7C3AED" />
                                      <ThemedText style={[s.sourceLbl, { color: '#7C3AED' }]}>Bio</ThemedText>
                                      {punch ? (
                                        <>
                                          <ThemedText style={[s.timeText, { color: textColor }]}>
                                            {punch.first.slice(0,5).replace(/^(\d{2}):(\d{2})/, (_, h, m) => { const n=parseInt(h); return `${n%12||12}:${m} ${n>=12?'pm':'am'}`; })}
                                          </ThemedText>
                                          {punch.last && punch.last !== punch.first && (
                                            <ThemedText style={[s.timeText, { color: theme.textSecondary }]}>
                                              {' → '}{punch.last.slice(0,5).replace(/^(\d{2}):(\d{2})/, (_, h, m) => { const n=parseInt(h); return `${n%12||12}:${m} ${n>=12?'pm':'am'}`; })}
                                            </ThemedText>
                                          )}
                                        </>
                                      ) : (
                                        <ThemedText style={[s.timeText, { color: textColor }]}>{fmt(item.biometric_first_in ?? item.checkin_time)}</ThemedText>
                                      )}
                                    </View>
                                    {noCheckout && (
                                      <View style={[s.sourceRow, { backgroundColor: '#F59E0B15', marginTop: 2 }]}>
                                        <Feather name="alert-circle" size={10} color="#F59E0B" />
                                        <ThemedText style={{ fontSize: 11, color: '#F59E0B', fontWeight: '700' }}>No checkout punch before 6 PM</ThemedText>
                                      </View>
                                    )}
                                  </View>
                                </View>
                                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                                  {noCheckout ? (
                                    <View style={[s.statusBadge, { backgroundColor: '#F59E0B20' }]}>
                                      <ThemedText style={[s.statusText, { color: '#F59E0B' }]}>No Out</ThemedText>
                                    </View>
                                  ) : (
                                    <View style={[s.statusBadge, { backgroundColor: '#7C3AED20' }]}>
                                      <ThemedText style={[s.statusText, { color: '#7C3AED' }]}>Bio</ThemedText>
                                    </View>
                                  )}
                                </View>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                    {otherAttendance.length > 0 && (
                      <View>
                        <View style={[s.sectionHeader, { backgroundColor: '#2563EB15', borderLeftColor: '#2563EB' }]}>
                          <Feather name="map-pin" size={12} color="#2563EB" />
                          <ThemedText style={[s.sectionHeaderText, { color: '#2563EB' }]}>Other Verified Attendance ({otherAttendance.length})</ThemedText>
                        </View>
                        {otherAttendance.map((item) => (
                          <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: '#2563EB' }]}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                              <View style={{ flex: 1 }}>
                                <ThemedText style={[s.empName, { color: textColor }]}>{item.employee_name}</ThemedText>
                                <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{item.office_name || 'Office not assigned'}</ThemedText>
                                <ThemedText style={[s.timeText, { color: textColor, marginTop: 6 }]}>
                                  {item.first_in_source || item.attendance_type || 'Verified'} · {fmt(item.checkin_time)}
                                </ThemedText>
                              </View>
                              <View style={[s.statusBadge, { backgroundColor: '#2563EB20' }]}>
                                <ThemedText style={[s.statusText, { color: '#2563EB' }]}>{attendanceStatusLabel(item, today)}</ThemedText>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                    {noAttendance.length > 0 && (
                      <View>
                        <View style={[s.sectionHeader, { backgroundColor: '#64748B15', borderLeftColor: '#64748B' }]}>
                          <Feather name="user-x" size={12} color="#64748B" />
                          <ThemedText style={[s.sectionHeaderText, { color: '#64748B' }]}>No Check-In ({noAttendance.length})</ThemedText>
                        </View>
                        {noAttendance.map((item) => {
                          const emptyState = attendanceEmptyStateCopy(item.status);
                          const configurationRequired = item.status === 'CONFIG_REQUIRED';
                          const accent = configurationRequired ? '#D97706' : item.status === 'ABSENT' ? '#DC2626' : '#64748B';
                          return (
                            <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: accent }]}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                                <View style={{ flex: 1 }}>
                                  <ThemedText style={[s.empName, { color: textColor }]}>{item.employee_name}</ThemedText>
                                  <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{item.office_name || 'Office not assigned'}</ThemedText>
                                  <ThemedText style={{ fontSize: 11, color: theme.textSecondary, marginTop: 5 }}>{emptyState.detail}</ThemedText>
                                </View>
                                <View style={[s.statusBadge, { backgroundColor: `${accent}20` }]}>
                                  <ThemedText style={[s.statusText, { color: accent }]}>{emptyState.label}</ThemedText>
                                </View>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </>
                )}
              </View>
            );
          })


        )}

        <Spacer height={100} />
      </ScrollView>

      {/* ── Location Timeline Modal ── */}
      <Modal
        visible={!!correctionRecord}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!correctionSaving) setCorrectionRecord(null);
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 560,
              backgroundColor: theme.backgroundDefault,
              borderRadius: 14,
              padding: 18,
              gap: 10,
            }}
          >
            <ThemedText type="h3">Correct Attendance</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {correctionRecord?.employee_name} | {correctionRecord?.date}
            </ThemedText>
            <ThemedText type="caption">Check-in timestamp</ThemedText>
            <TextInput
              style={[s.input, { backgroundColor: theme.backgroundRoot, color: theme.text }]}
              value={correctionForm.checkin}
              onChangeText={(checkin) => setCorrectionForm((current) => ({ ...current, checkin }))}
              placeholder="2026-07-30T10:00:00+05:30"
              placeholderTextColor={theme.textSecondary}
            />
            <ThemedText type="caption">Checkout timestamp (blank means no checkout)</ThemedText>
            <TextInput
              style={[s.input, { backgroundColor: theme.backgroundRoot, color: theme.text }]}
              value={correctionForm.checkout}
              onChangeText={(checkout) => setCorrectionForm((current) => ({ ...current, checkout }))}
              placeholder="2026-07-30T18:30:00+05:30"
              placeholderTextColor={theme.textSecondary}
            />
            <ThemedText type="caption">Correction reason *</ThemedText>
            <TextInput
              style={[s.input, { backgroundColor: theme.backgroundRoot, color: theme.text, minHeight: 72 }]}
              value={correctionForm.reason}
              onChangeText={(reason) => setCorrectionForm((current) => ({ ...current, reason }))}
              multiline
              placeholder="Explain why this attendance record is being changed"
              placeholderTextColor={theme.textSecondary}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                style={[s.exportBtn, { flex: 1, justifyContent: "center", backgroundColor: theme.backgroundRoot }]}
                disabled={correctionSaving}
                onPress={() => setCorrectionRecord(null)}
              >
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.exportBtn, { flex: 1, justifyContent: "center", backgroundColor: theme.primary }]}
                disabled={correctionSaving}
                onPress={() => void submitAttendanceCorrection()}
              >
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                  {correctionSaving ? "Saving..." : "Save correction"}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <LocationTimelineModal
        visible={!!timelineEmployee}
        employeeName={timelineEmployee?.name ?? ""}
        date={timelineEmployee?.date ?? ""}
        pings={timelinePings}
        loading={timelineLoading}
        onClose={() => setTimelineEmployee(null)}
      />

      {activeTab === "app" && !!today && (startDate !== today || endDate !== today) ? (
        <View
          style={{
            marginHorizontal: 16,
            marginBottom: 8,
            padding: 10,
            borderRadius: 8,
            backgroundColor: "#FFF7ED",
          }}
        >
          <ThemedText style={{ color: "#9A3412", fontSize: 12, fontWeight: "600" }}>
            The historical download includes all ten managed attendance sheets, including Combined and Team Head calculations, in one Excel workbook.
          </ThemedText>
        </View>
      ) : null}

      {/* Sticky Download Buttons at Bottom — different per tab */}
      {activeTab === 'app' ? (
        <TouchableOpacity
          style={s.stickyDownloadBtn}
          onPress={downloadExcel}
          disabled={exporting}
        >
          <Feather name="download" size={18} color="#fff" />
          <Text style={s.stickyDownloadText}>{exporting ? exportStatus || 'Exporting...' : 'Download Complete Attendance Excel (10 sheets)'}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[s.stickyDownloadBtn, { backgroundColor: '#7C3AED' }]}
          onPress={downloadBiometricExcel}
          disabled={exporting}
        >
          <Feather name="download" size={18} color="#fff" />
          <Text style={s.stickyDownloadText}>{exporting ? exportStatus || 'Exporting...' : 'Download Biometric Logs Excel'}</Text>
        </TouchableOpacity>
      )}
      {exportError ? (
        <View style={s.exportErrorBanner}>
          <ThemedText style={s.exportErrorText}>
            Download failed: {exportError}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  exportBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  exportBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  preset: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  presetText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  filterCard: { borderRadius: 12, padding: 14 },
  input: { padding: 10, borderRadius: 8, fontSize: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  chipText: { fontSize: 12, fontWeight: "600", color: "#374151" },
  applyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8 },
  dateHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderRadius: 10, marginBottom: 2 },
  dateHeaderText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  dateHeaderSub: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 },
  recordCard: { padding: 14, borderRadius: 10, marginBottom: 2, borderLeftWidth: 3, borderLeftColor: "#E5E7EB" },
  empName: { fontSize: 14, fontWeight: "700" },
  meta: { fontSize: 12, marginTop: 2 },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: { fontSize: 12, fontWeight: "600" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: "700" },
  stickyDownloadBtn: {
    position: "absolute",
    bottom: 80,
    left: 16,
    right: 16,
    backgroundColor: "#16A34A",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
    elevation: 6,
    boxShadow: "0 3px 6px rgba(0,0,0,0.2)",
  },
  stickyDownloadText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  exportErrorBanner: {
    position: "absolute",
    bottom: 142,
    left: 16,
    right: 16,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#FEE2E2",
  },
  exportErrorText: {
    color: "#991B1B",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderLeftWidth: 3, marginBottom: 2, marginTop: 6 },
  sectionHeaderText: { fontSize: 12, fontWeight: '700' },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  sourceLbl: { fontSize: 10, fontWeight: '700', width: 26 },
  empty: { alignItems: "center", paddingTop: 60 },
  timelineBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: "#3B82F6", marginTop: 4 },
  timelineBtnText: { fontSize: 11, color: "#3B82F6", fontWeight: "600" },
  searchContainer: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, padding: 10, borderRadius: 8, fontSize: 14 },
  searchIcon: { color: "#6B7280" },
  viewToggleBtn: { padding: 8, borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  syncBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, marginBottom: 4 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  tabBtnText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  punchChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  matchPanel: { borderTopWidth: 1, paddingBottom: 8 },
  matchSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 10, padding: 10, borderRadius: 8 },
  matchSearchInput: { flex: 1, fontSize: 13, padding: 0 },
  matchProfileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  matchBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
});
