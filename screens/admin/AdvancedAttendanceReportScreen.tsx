import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, Shadows, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
import { reportNonFatalError } from "@/utils/operationalErrors";
import { toTitleCase } from "@/utils/format";
import { downloadBrowserBytes } from "@/utils/browserFileDownload";
import { formatHrmsDateTime, formatHrmsTime } from "@/utils/attendanceTimestamp";
import { usePermissions } from "@/hooks/usePermissions";
import {
  CanonicalAttendanceService,
  withAttendanceV2Aliases,
} from "@/services/canonical-attendance.service";

const PAGE_SIZE = 1000;
const MAX_EXPORT_ROWS = 20_000;
const MAX_BROWSER_EXCEL_ROWS = MAX_EXPORT_ROWS;
const IST_TIME_ZONE = "Asia/Kolkata";
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
      return;
    }
    setTimeout(resolve, 0);
  });

async function downloadWorkbook(XLSX: any, workbook: any, filename: string) {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof Blob === "undefined"
  ) {
    XLSX.writeFile(workbook, filename, { compression: true });
    return;
  }

  const bytes = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    // ZIP compression is CPU-heavy and used to freeze monthly exports on the
    // browser main thread. The larger uncompressed workbook downloads much
    // faster and Excel opens it normally.
    compression: false,
  });
  await downloadBrowserBytes(bytes, filename, XLSX_MIME_TYPE);
}

type LabelKind = "office" | "team" | "person" | "role";

const LABEL_ACRONYMS = new Set([
  "agm",
  "ak",
  "bde",
  "bdm",
  "gm",
  "gv",
  "hr",
  "hrd",
  "mh",
  "vp",
]);

const TEAM_ALIASES: Record<string, string> = {
  "ankit mavi team": "Ankit Mavi",
  "mh mhendi team": "Mohammad Mehdi",
  "mohammad mehdi": "Mohammad Mehdi",
  "mohammed mehdi": "Mohammad Mehdi",
  "mohhamad mehdi": "Mohammad Mehdi",
  "prince mavi team": "Prince Mavi",
  "satya prkash": "Satya Prakash",
};

function canonicalLabel(value: unknown, kind: LabelKind): string {
  const clean = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!clean) return "";
  if (kind === "person") return toTitleCase(clean);
  if (kind === "team" && TEAM_ALIASES[clean.toLowerCase()]) {
    return TEAM_ALIASES[clean.toLowerCase()];
  }

  return clean
    .replaceAll("_", " ")
    .toLowerCase()
    .split(" ")
    .map((word) =>
      LABEL_ACRONYMS.has(word)
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function downloadAttendanceCsv(rows: any[], filename: string) {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof Blob === "undefined"
  ) {
    throw new Error("CSV recovery download is available on the web app only.");
  }
  const headers = [
    "Date",
    "Employee",
    "Employee No",
    "Registered Office",
    "Check-In Office",
    "Attendance Source",
    "Team",
    "Team Head",
    "Role",
    "App In",
    "Biometric In",
    "Final In",
    "App Out",
    "Biometric Out",
    "Final Out",
    "Status",
    "Source",
    "Suggested",
    "Fraud Severity",
    "Fraud Score",
  ];
  const values = rows.map((row) => [
    row.date,
    canonicalLabel(row.name, "person"),
    row.employee_number,
    canonicalLabel(row.office_name, "office"),
    canonicalLabel((row as any).check_in_office_name ?? row.office_name, "office"),
    (row as any).attendance_source ?? row.presence_source ?? "APP",
    canonicalLabel(row.team, "team"),
    canonicalLabel(row.team_head_name, "person"),
    canonicalLabel(row.role, "role"),
    formatHrmsDateTime(row.app_in, "No check-in"),
    formatHrmsDateTime(row.bio_in, "No biometric punch"),
    formatHrmsDateTime(row.final_in, "No check-in"),
    formatHrmsDateTime(row.app_out, "No checkout"),
    formatHrmsDateTime(row.bio_out, "No biometric evidence"),
    formatHrmsDateTime(row.final_out, "No checkout"),
    row.report_status,
    row.presence_source,
    row.suggested_status,
    row.fraud_severity,
    row.fraud_score,
  ]);
  const csv = [headers, ...values]
    .map((line) => line.map(csvCell).join(","))
    .join("\r\n");
  await downloadBrowserBytes(
    new TextEncoder().encode(`\uFEFF${csv}`),
    filename,
    "text/csv;charset=utf-8",
  );
}

const formatTime = (value: string | null | undefined) => {
  if (!value) return "Not recorded";
  return formatHrmsTime(value, "No time recorded");
};

async function fetchAllRows(
  table: string,
  select: string,
  start: string,
  end: string,
) {
  const rows: any[] = [];
  for (let from = 0; from < MAX_EXPORT_ROWS; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
  throw new Error(
    `Report exceeds ${MAX_EXPORT_ROWS.toLocaleString("en-IN")} rows. Select a smaller date range.`,
  );
}

async function fetchAttendanceRows(start: string, end: string, scopeFilters?: any) {
  return (await CanonicalAttendanceService.list(start, end, MAX_EXPORT_ROWS, scopeFilters)).map(
    withAttendanceV2Aliases,
  );
}

function isLate(row: any) {
  return (
    row.is_late === true ||
    String(row.attendance_status || row.day_status || "").toUpperCase() ===
      "LATE"
  );
}

function isPresent(row: any) {
  return (
    !!row.final_in ||
    !!row.has_field_visit ||
    ["P", "P-NC", "FV"].includes(String(row.report_status || "").toUpperCase())
  );
}

function specialistMatch(row: any, filter: string) {
  if (!filter) return true;
  if (filter === "LATE") return isLate(row);
  if (filter === "NO_CHECKOUT") {
    return (
      row.suggested_status === "NO_CHECKOUT" ||
      row.report_status === "P-NC" ||
      (!row.final_out && !!row.final_in)
    );
  }
  if (filter === "FIELD_VISIT") return !!row.has_field_visit;
  if (filter === "SUSPICIOUS_GPS") {
    return String(row.fraud_severity).toUpperCase() === "SUSPICIOUS";
  }
  return row.suggested_status === filter || row.report_status === filter;
}

const displayStatus = (row: any) =>
  String(row.report_status || row.suggested_status || "UNKNOWN").replaceAll(
    "_",
    " ",
  );

type Filters = {
  office: string;
  team: string;
  head: string;
  role: string;
  status: string;
  source: string;
  search: string;
};

const EMPTY_FILTERS: Filters = {
  office: "",
  team: "",
  head: "",
  role: "",
  status: "",
  source: "",
  search: "",
};

const REPORT_SECTIONS = [
  "Overview",
  "Daily Records",
  "Exceptions",
  "Field Visits",
  "Reconciliation",
  "Exports",
] as const;

export default function AdvancedAttendanceReportScreen({ route }: any) {
  const { theme } = useTheme();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStage, setExportStage] = useState("");
  const [exportError, setExportError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const { getScopedPermission, hasPermission } = usePermissions();
  const [section, setSection] = useState<(typeof REPORT_SECTIONS)[number]>(
    REPORT_SECTIONS.includes(route?.params?.initialSection)
      ? route.params.initialSection
      : "Overview",
  );

  const load = useCallback(async () => {
    const serverDate = await BusinessClockService.getDate(true);
    const resolvedStart = start || `${serverDate.slice(0, 8)}01`;
    const resolvedEnd = end || serverDate;
    if (!start) setStart(resolvedStart);
    if (!end) setEnd(resolvedEnd);
    if (resolvedEnd < resolvedStart) {
      Alert.alert("Invalid range", "End date must be after start date.");
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const perm = getScopedPermission('attendance.view');
        const isGlobal = perm?.scope === 'GLOBAL' || hasPermission('SYSTEM_ADMIN');
        setRows(await fetchAttendanceRows(resolvedStart, resolvedEnd, isGlobal ? undefined : { office_id: (perm?.scope === 'OFFICE' || perm?.scope === 'OFFICE_TREE') ? perm.scope_id : undefined }));
    } catch (error: any) {
      const rawMessage = error?.message ?? "Unable to load report.";
      const message = rawMessage.includes(
        "HISTORICAL_ASSIGNMENT_OR_POLICY_NOT_VERIFIED",
      )
        ? "Historical payroll reporting is blocked because an employee assignment, office policy or calendar is not verified for part of this period. Complete historical configuration or select today only."
        : rawMessage;
      setLoadError(message);
      Alert.alert("Report error", message);
    } finally {
      setLoading(false);
    }
  }, [start, end, getScopedPermission, hasPermission]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!filters.office ||
            canonicalLabel(row.office_name, "office") === filters.office) &&
          (!filters.team ||
            canonicalLabel(row.team, "team") === filters.team) &&
          (!filters.head ||
            canonicalLabel(row.team_head_name, "person") === filters.head) &&
          (!filters.role ||
            canonicalLabel(row.role, "role") === filters.role) &&
          (!filters.source || row.presence_source === filters.source) &&
          (!filters.search || `${row.name ?? ""} ${row.employee_number ?? ""}`.toLowerCase().includes(filters.search.toLowerCase())) &&
          specialistMatch(row, filters.status),
      ),
    [rows, filters],
  );

  const sectionRows = useMemo(() => {
    if (section === "Field Visits") {
      return filtered.filter((row) => row.has_field_visit);
    }
    if (section === "Exceptions") {
      return filtered.filter(
        (row) =>
          row.attendance_status === "ABSENT" ||
          isLate(row) ||
          specialistMatch(row, "NO_CHECKOUT") ||
          Boolean(row.tracking_health_reason || row.ping_is_stale) ||
          row.history_verified !== true,
      );
    }
    if (section === "Reconciliation") {
      return filtered.filter(
        (row) =>
          row.presence_source === "MULTIPLE" ||
          row.report_status === "MISMATCH" ||
          Boolean(row.biometric_last_punch_evidence),
      );
    }
    return filtered;
  }, [filtered, section]);

  const options = (key: string, kind: LabelKind) =>
    (
      [
        ...new Set(
          rows.map((row) => canonicalLabel(row[key], kind)).filter(Boolean),
        ),
      ] as string[]
    ).sort((a, b) => a.localeCompare(b));

  const summary = useMemo(
    () => ({
      total: filtered.length,
      present: filtered.filter(isPresent).length,
      late: filtered.filter(isLate).length,
      mismatch: filtered.filter((row) => row.report_status === "MISMATCH")
        .length,
      noCheckout: filtered.filter((row) => specialistMatch(row, "NO_CHECKOUT"))
        .length,
      setupRequired: filtered.filter((row) => row.history_verified !== true)
        .length,
      absent: filtered.filter((row) => row.report_status === "ABSENT").length,
      fieldVisits: filtered.filter((row) => row.has_field_visit).length,
      gpsExceptions: filtered.filter((row) => row.tracking_health_reason || row.ping_is_stale).length,
    }),
    [filtered],
  );

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const statusColors = (row: any) => {
    const status = displayStatus(row).toUpperCase();
    if (status === "P" || status === "VERIFIED") {
      return { background: theme.successBg, foreground: theme.successText };
    }
    if (status.includes("MISMATCH") || status.includes("SUSPICIOUS")) {
      return { background: theme.errorBg, foreground: theme.errorText };
    }
    if (status.includes("NO CHECKOUT") || status.includes("P-NC")) {
      return { background: theme.warningBg, foreground: theme.warningText };
    }
    if (status.includes("CONFIG REQUIRED")) {
      return { background: theme.warningBg, foreground: theme.warningText };
    }
    return { background: theme.infoBg, foreground: theme.infoText };
  };

  const renderFilter = (
    label: string,
    filter: keyof Filters,
    values: string[],
  ) => (
    <View style={styles.filterGroup}>
      <ThemedText
        type="caption"
        style={[styles.filterLabel, { color: theme.textSecondary }]}
      >
        {label}
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {["", ...values].map((value) => {
          const selected = filters[filter] === value;
          return (
            <Pressable
              key={value || "all"}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: selected
                    ? theme.primary
                    : theme.backgroundSecondary,
                  borderColor: selected ? theme.primary : theme.border,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
              onPress={() =>
                setFilters((previous) => ({
                  ...previous,
                  [filter]: value,
                }))
              }
            >
              <ThemedText
                type="caption"
                style={{
                  color: selected ? theme.buttonText : theme.text,
                  fontWeight: selected ? "700" : "500",
                }}
              >
                {value || "All"}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const exportSevenSheets = async () => {
    if (!filtered.length || exporting) {
      if (!exporting) {
        setExportError("There are no matching attendance records to export.");
      }
      Alert.alert(
        "No data",
        "Load records or change the filters before exporting.",
      );
      return;
    }
    if (filtered.length > MAX_BROWSER_EXCEL_ROWS) {
      const message = `This export contains ${filtered.length.toLocaleString("en-IN")} attendance rows. Select a period containing ${MAX_BROWSER_EXCEL_ROWS.toLocaleString("en-IN")} rows or fewer.`;
      setExportError(message);
      Alert.alert("Range too large for browser Excel", message);
      return;
    }
    setExporting(true);
    setExportError("");
    setExportStage("Loading Excel tools...");
    await yieldToBrowser();
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const addSheet = async (name: string, data: any[]) => {
        setExportStage(`Building ${name}...`);
        await yieldToBrowser();
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(data),
          name,
        );
      };
      const daily = filtered.map((row) => ({
        Date: row.date,
        Employee: canonicalLabel(row.name, "person"),
        EmployeeNo: row.employee_number,
        RegisteredOffice: canonicalLabel(row.office_name, "office"),
        CheckInOffice: canonicalLabel((row as any).check_in_office_name ?? row.office_name, "office"),
        AttendanceSource: (row as any).attendance_source ?? row.presence_source ?? "APP",
        Team: canonicalLabel(row.team, "team"),
        TeamHead: canonicalLabel(row.team_head_name, "person"),
        Role: canonicalLabel(row.role, "role"),
        AppIn: formatHrmsDateTime(row.app_in, "No check-in"),
        BioIn: formatHrmsDateTime(row.bio_in, "No biometric punch"),
        FinalIn: formatHrmsDateTime(row.final_in, "No check-in"),
        FirstInSource: row.first_in_source || "Unknown / Needs review",
        AppOut: formatHrmsDateTime(row.app_out, "No checkout"),
        BioLastPunchEvidence: formatHrmsDateTime(row.bio_out, "No biometric evidence"),
        FinalOut: formatHrmsDateTime(row.final_out, "No checkout"),
        LastOutSource: row.last_out_source || "Unknown / Needs review",
        Status: row.report_status,
        Source: row.presence_source,
        Suggested: row.suggested_status,
        FraudSeverity: row.fraud_severity,
        FraudScore: row.fraud_score,
      }));
      const summarize = (key: string, label: string, kind: LabelKind) =>
        Object.values(
          filtered.reduce((all: any, row: any) => {
            const value = canonicalLabel(row[key], kind) || "Unassigned";
            all[value] ??= {
              [label]: value,
              Records: 0,
              Present: 0,
              Mismatch: 0,
              Late: 0,
              NoCheckout: 0,
              FieldVisits: 0,
              SuspiciousGPS: 0,
            };
            const item = all[value];
            item.Records += 1;
            if (isPresent(row)) item.Present += 1;
            if (row.report_status === "MISMATCH") item.Mismatch += 1;
            if (isLate(row)) item.Late += 1;
            if (specialistMatch(row, "NO_CHECKOUT")) item.NoCheckout += 1;
            if (row.has_field_visit) item.FieldVisits += 1;
            if (specialistMatch(row, "SUSPICIOUS_GPS")) item.SuspiciousGPS += 1;
            return all;
          }, {}),
        );
      await addSheet("Daily Attendance", daily);
      await addSheet(
        "Employee Summary",
        summarize("name", "Employee", "person"),
      );
      await addSheet("Team Summary", summarize("team", "Team", "team"));
      await addSheet(
        "Late Report",
        daily.filter((_item, index) => isLate(filtered[index])),
      );
      await addSheet(
        "No Checkout Report",
        daily.filter((_item, index) =>
          specialistMatch(filtered[index], "NO_CHECKOUT"),
        ),
      );
      let fieldVisits: any[] = [];
      let fieldVisitWarning = "";
      try {
        setExportStage("Loading field visits...");
        await yieldToBrowser();
        fieldVisits = await fetchAllRows(
          "field_visits",
          "date,user_id,location_name,visit_type,checkin_time,checkout_time,status,profiles:user_id(name)",
          start,
          end,
        );
      } catch (error: any) {
        fieldVisitWarning =
          "Field visits could not be loaded; the attendance workbook was still downloaded.";
        void reportNonFatalError("attendance_report.field_visit_export", error);
      }
      await addSheet(
        "Field Visit Report",
        fieldVisits.length
          ? fieldVisits.map((visit: any) => ({
              Date: visit.date,
              Employee: visit.profiles?.name,
              Location: visit.location_name,
              Type: visit.visit_type,
              In: formatHrmsDateTime(visit.checkin_time, "No check-in"),
              Out: formatHrmsDateTime(visit.checkout_time, "No checkout"),
              Status: visit.status,
            }))
          : [
              {
                Notice:
                  fieldVisitWarning ||
                  "No field visits were recorded for the selected period.",
              },
            ],
      );
      await addSheet(
        "Biometric Mismatch",
        daily.filter(
          (item) =>
            item.Status === "MISMATCH" || item.Suggested === "NEEDS_REVIEW",
        ),
      );
      setExportStage("Preparing download...");
      await yieldToBrowser();
      await downloadWorkbook(
        XLSX,
        workbook,
        `Advanced_Attendance_${start}_${end}.xlsx`,
      );
      Alert.alert(
        "Export ready",
        `Created seven sheets from ${filtered.length.toLocaleString("en-IN")} attendance records.${fieldVisitWarning ? ` ${fieldVisitWarning}` : ""}`,
      );
    } catch (error: any) {
      const excelMessage = error?.message ?? "Unable to create Excel export.";
      try {
        setExportStage("Creating CSV recovery download...");
        await yieldToBrowser();
        await downloadAttendanceCsv(
          filtered,
          `Advanced_Attendance_${start}_${end}.csv`,
        );
        setExportError(
          `Excel could not be created (${excelMessage}). A CSV attendance report was downloaded instead.`,
        );
      } catch (csvError: any) {
        const message = `${excelMessage} CSV recovery also failed: ${csvError?.message ?? "unknown error"}`;
        setExportError(message);
        Alert.alert("Export failed", message);
      }
    } finally {
      setExporting(false);
      setExportStage("");
    }
  };

  const metrics = [
    {
      label: "Total",
      value: summary.total,
      icon: "database" as const,
      background: theme.infoBg,
      foreground: theme.infoText,
    },
    {
      label: "Present",
      value: summary.present,
      icon: "check-circle" as const,
      background: theme.successBg,
      foreground: theme.successText,
    },
    {
      label: "Late",
      value: summary.late,
      icon: "clock" as const,
      background: theme.warningBg,
      foreground: theme.warningText,
    },
    {
      label: "Mismatch",
      value: summary.mismatch,
      icon: "alert-triangle" as const,
      background: theme.errorBg,
      foreground: theme.errorText,
    },
    {
      label: "No checkout",
      value: summary.noCheckout,
      icon: "log-out" as const,
      background: theme.warningBg,
      foreground: theme.warningText,
    },
    {
      label: "Setup required",
      value: summary.setupRequired,
      icon: "settings" as const,
      background: theme.warningBg,
      foreground: theme.warningText,
    },
    {
      label: "Absent",
      value: summary.absent,
      icon: "user-x" as const,
      background: theme.errorBg,
      foreground: theme.errorText,
    },
    {
      label: "Field visits",
      value: summary.fieldVisits,
      icon: "map-pin" as const,
      background: theme.infoBg,
      foreground: theme.infoText,
    },
    {
      label: "GPS exceptions",
      value: summary.gpsExceptions,
      icon: "navigation" as const,
      background: theme.warningBg,
      foreground: theme.warningText,
    },
  ];

  return (
    <ScreenScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.wrap}
    >
      <View
        style={[styles.hero, { backgroundColor: theme.primary }, Shadows.md]}
      >
        <View style={styles.heroIcon}>
          <Feather name="bar-chart-2" size={22} color={theme.buttonText} />
        </View>
        <View style={styles.flex}>
          <ThemedText type="h2" style={{ color: theme.buttonText }}>
            Attendance intelligence
          </ThemedText>
          <ThemedText type="small" style={styles.heroSubtitle}>
            App, biometric, field visit and GPS reconciliation
          </ThemedText>
        </View>
        <View style={styles.heroCount}>
          <ThemedText
            style={[styles.heroCountValue, { color: theme.buttonText }]}
          >
            {sectionRows.length.toLocaleString("en-IN")}
          </ThemedText>
          <ThemedText type="caption" style={styles.heroSubtitle}>
            records
          </ThemedText>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sectionTabs}>
        {REPORT_SECTIONS.map((item, idx) => (
          <Pressable
            key={`section-${idx}`}
            onPress={() => setSection(item)}
            style={[
              styles.sectionTab,
              { borderColor: section === item ? theme.primary : theme.border, backgroundColor: section === item ? theme.primary : theme.backgroundDefault },
            ]}
          >
            <ThemedText type="small" style={{ color: section === item ? theme.buttonText : theme.text, fontWeight: "700" }}>
              {item}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      <View
        style={[
          styles.panel,
          {
            backgroundColor: theme.backgroundDefault,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={styles.panelTitleRow}>
          <View style={[styles.sectionIcon, { backgroundColor: theme.infoBg }]}>
            <Feather name="calendar" size={17} color={theme.infoText} />
          </View>
          <View style={styles.flex}>
            <ThemedText type="h4">Report period</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Dates are interpreted in Indian Standard Time
            </ThemedText>
          </View>
        </View>
        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              FROM
            </ThemedText>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              value={start}
              onChangeText={setStart}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textTertiary}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.dateField}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              TO
            </ThemedText>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              value={end}
              onChangeText={setEnd}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textTertiary}
              autoCapitalize="none"
            />
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: theme.primary,
              opacity: pressed || loading ? 0.75 : 1,
            },
          ]}
          onPress={load}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={theme.buttonText} />
          ) : (
            <Feather name="refresh-cw" size={17} color={theme.buttonText} />
          )}
          <ThemedText style={[styles.buttonText, { color: theme.buttonText }]}>
            {loading ? "Loading report..." : "Refresh report"}
          </ThemedText>
        </Pressable>
        {exportError ? (
          <ThemedText
            type="small"
            style={{ color: theme.errorText, textAlign: "center" }}
          >
            Download failed: {exportError}
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.metricsGrid}>
        {metrics.map((metric) => (
          <View
            key={metric.label}
            style={[
              styles.metric,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.border,
              },
            ]}
          >
            <View
              style={[
                styles.metricIcon,
                { backgroundColor: metric.background },
              ]}
            >
              <Feather name={metric.icon} size={16} color={metric.foreground} />
            </View>
            <ThemedText type="h3">
              {metric.value.toLocaleString("en-IN")}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {metric.label}
            </ThemedText>
          </View>
        ))}
      </View>

      <View
        style={[
          styles.panel,
          {
            backgroundColor: theme.backgroundDefault,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={styles.panelTitleRow}>
          <View
            style={[
              styles.sectionIcon,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <Feather name="filter" size={17} color={theme.primary} />
          </View>
          <View style={styles.flex}>
            <ThemedText type="h4">Filters</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {activeFilterCount
                ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`
                : "Showing all available records"}
            </ThemedText>
          </View>
          {activeFilterCount ? (
            <Pressable onPress={() => setFilters(EMPTY_FILTERS)} hitSlop={8}>
              <ThemedText
                type="small"
                style={{ color: theme.primary, fontWeight: "700" }}
              >
                Clear all
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
        {renderFilter("OFFICE", "office", options("office_name", "office"))}
        {renderFilter("TEAM", "team", options("team", "team"))}
        {renderFilter("TEAM HEAD", "head", options("team_head_name", "person"))}
        {renderFilter("ROLE", "role", options("role", "role"))}
        {renderFilter("SOURCE", "source", ["APP", "BIOMETRIC", "FIELD_VISIT", "MULTIPLE", "NO_DATA"])}
        <TextInput
          style={[styles.input, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border, color: theme.text }]}
          value={filters.search}
          onChangeText={(search) => setFilters((previous) => ({ ...previous, search }))}
          placeholder="Search employee or employee ID"
          placeholderTextColor={theme.textTertiary}
        />
        {renderFilter("SPECIALIST", "status", [
          "LATE",
          "NO_CHECKOUT",
          "FIELD_VISIT",
          "MISMATCH",
          "SUSPICIOUS_GPS",
          "CONFIG_REQUIRED",
        ])}
      </View>

      <View style={styles.resultsHeader}>
        <View>
          <ThemedText type="h3">{section}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {rows.length >= PAGE_SIZE
              ? "Paginated production data"
              : "Reconciled data"}
          </ThemedText>
        </View>
        <View
          style={[
            styles.resultPill,
            { backgroundColor: theme.backgroundSecondary },
          ]}
        >
          <ThemedText
            type="caption"
            style={{ color: theme.primary, fontWeight: "800" }}
          >
            {sectionRows.length.toLocaleString("en-IN")}
          </ThemedText>
        </View>
      </View>

      {loadError ? (
        <View
          style={[
            styles.stateCard,
            { backgroundColor: theme.errorBg, borderColor: theme.error },
          ]}
        >
          <Feather name="alert-circle" size={24} color={theme.errorText} />
          <ThemedText type="h4" style={{ color: theme.errorText }}>
            Could not load the report
          </ThemedText>
          <ThemedText
            type="small"
            style={{ color: theme.errorText, textAlign: "center" }}
          >
            {loadError}
          </ThemedText>
        </View>
      ) : loading && !rows.length ? (
        <View
          style={[
            styles.stateCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
        >
          <ActivityIndicator color={theme.primary} />
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Reconciling attendance records...
          </ThemedText>
        </View>
      ) : !sectionRows.length ? (
        <View
          style={[
            styles.stateCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
        >
          <View
            style={[
              styles.emptyIcon,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <Feather name="search" size={25} color={theme.textSecondary} />
          </View>
          <ThemedText type="h4">No matching records</ThemedText>
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, textAlign: "center" }}
          >
            Try another date range or clear one of the active filters.
          </ThemedText>
        </View>
      ) : (
        sectionRows.slice(0, 200).map((row, index) => {
          const colors = statusColors(row);
          return (
            <View
              key={`${row.user_id}-${row.date}-${index}`}
              style={[
                styles.recordCard,
                {
                  backgroundColor: theme.backgroundDefault,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.recordTop}>
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <ThemedText
                    style={{ color: theme.primary, fontWeight: "800" }}
                  >
                    {String(row.name || "?")
                      .trim()
                      .charAt(0)
                      .toUpperCase()}
                  </ThemedText>
                </View>
                <View style={styles.flex}>
                  <ThemedText type="h4" numberOfLines={1}>
                    {canonicalLabel(row.name, "person") || "Unknown employee"}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                    numberOfLines={1}
                  >
                    {[
                      row.employee_number,
                      row.date,
                      canonicalLabel(row.team, "team"),
                    ]
                      .filter(Boolean)
                      .join(" | ")}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: colors.background },
                  ]}
                >
                  <ThemedText
                    type="caption"
                    style={{ color: colors.foreground, fontWeight: "800" }}
                  >
                    {displayStatus(row)}
                  </ThemedText>
                </View>
              </View>

              <View
                style={[styles.timeRow, { borderColor: theme.borderLight }]}
              >
                <View style={styles.timeCell}>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    FIRST IN
                  </ThemedText>
                  <ThemedText type="small" style={styles.timeValue}>
                    {formatTime(row.final_in || row.app_in)}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.timeDivider,
                    { backgroundColor: theme.borderLight },
                  ]}
                />
                <View style={styles.timeCell}>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    LAST OUT
                  </ThemedText>
                  <ThemedText type="small" style={styles.timeValue}>
                    {formatTime(row.final_out || row.app_out)}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.timeDivider,
                    { backgroundColor: theme.borderLight },
                  ]}
                />
                <View style={styles.timeCell}>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    SOURCE
                  </ThemedText>
                  <ThemedText
                    type="small"
                    style={styles.timeValue}
                    numberOfLines={1}
                  >
                    {row.presence_source || "-"}
                  </ThemedText>
                </View>
              </View>

              {isLate(row) ||
              row.has_field_visit ||
              row.fraud_severity ||
              row.history_verified !== true ? (
                <View style={styles.flagsRow}>
                  {isLate(row) ? (
                    <View
                      style={[
                        styles.flag,
                        { backgroundColor: theme.warningBg },
                      ]}
                    >
                      <Feather
                        name="clock"
                        size={12}
                        color={theme.warningText}
                      />
                      <ThemedText
                        type="caption"
                        style={{ color: theme.warningText }}
                      >
                        Late
                      </ThemedText>
                    </View>
                  ) : null}
                  {row.has_field_visit ? (
                    <View
                      style={[styles.flag, { backgroundColor: theme.infoBg }]}
                    >
                      <Feather
                        name="map-pin"
                        size={12}
                        color={theme.infoText}
                      />
                      <ThemedText
                        type="caption"
                        style={{ color: theme.infoText }}
                      >
                        Field visit
                      </ThemedText>
                    </View>
                  ) : null}
                  {row.history_verified !== true ? (
                    <View
                      style={[
                        styles.flag,
                        { backgroundColor: theme.warningBg },
                      ]}
                    >
                      <Feather
                        name="settings"
                        size={12}
                        color={theme.warningText}
                      />
                      <ThemedText
                        type="caption"
                        style={{ color: theme.warningText }}
                      >
                        Office/policy setup required
                      </ThemedText>
                    </View>
                  ) : null}
                  {row.fraud_severity ? (
                    <View
                      style={[styles.flag, { backgroundColor: theme.errorBg }]}
                    >
                      <Feather
                        name="shield"
                        size={12}
                        color={theme.errorText}
                      />
                      <ThemedText
                        type="caption"
                        style={{ color: theme.errorText }}
                      >
                        {row.fraud_severity}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })
      )}

      {sectionRows.length > 200 ? (
        <View style={[styles.preview, { backgroundColor: theme.infoBg }]}>
          <Feather name="info" size={16} color={theme.infoText} />
          <ThemedText type="small" style={{ color: theme.infoText, flex: 1 }}>
            Showing the first 200 records. Excel includes all{" "}
            {sectionRows.length.toLocaleString("en-IN")} records in this section.
          </ThemedText>
        </View>
      ) : null}

      <View
        style={[
          styles.exportPanel,
          {
            backgroundColor: theme.successBg,
            borderColor: theme.success,
          },
        ]}
      >
        <View style={styles.exportCopy}>
          <ThemedText type="h4" style={{ color: theme.successText }}>
            Seven-sheet Excel report
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.successText }}>
            Daily, employee, team, late, no-checkout, field visit and biometric
            mismatch
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.export,
            {
              backgroundColor: theme.success,
              opacity: pressed || exporting ? 0.75 : 1,
            },
          ]}
          onPress={exportSevenSheets}
          disabled={exporting}
        >
          {exporting ? (
            <ActivityIndicator color={theme.buttonText} />
          ) : (
            <Feather name="download" size={17} color={theme.buttonText} />
          )}
          <ThemedText style={[styles.buttonText, { color: theme.buttonText }]}>
            {exporting ? exportStage || "Building sheets..." : "Export Excel"}
          </ThemedText>
        </Pressable>
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  sectionTabs: { gap: 8, paddingVertical: 2 },
  sectionTab: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  flex: { flex: 1 },
  hero: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroSubtitle: { color: "rgba(255,255,255,0.78)" },
  heroCount: { alignItems: "flex-end" },
  heroCountValue: { fontSize: 20, fontWeight: "800" },
  panel: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  panelTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dateRow: { flexDirection: "row", gap: Spacing.sm },
  dateField: { flex: 1, gap: Spacing.xs },
  input: {
    borderWidth: 1,
    height: 46,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    fontSize: 14,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: BorderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  buttonText: { fontWeight: "800" },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  metric: {
    minWidth: 104,
    flexGrow: 1,
    flexBasis: "30%",
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: 3,
  },
  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  filterGroup: { gap: 2 },
  filterLabel: { fontWeight: "800", letterSpacing: 0.7 },
  chipRow: { paddingVertical: Spacing.xs, paddingRight: Spacing.sm },
  chip: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    marginRight: Spacing.sm,
  },
  resultsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  resultPill: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stateCard: {
    minHeight: 170,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  recordCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  recordTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBadge: {
    maxWidth: 110,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  timeRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    paddingTop: Spacing.md,
  },
  timeCell: { flex: 1, gap: 3 },
  timeDivider: { width: 1, marginHorizontal: Spacing.sm },
  timeValue: { fontWeight: "700" },
  flagsRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  flag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  preview: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  exportPanel: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  exportCopy: { gap: 3 },
  export: {
    minHeight: 46,
    borderRadius: BorderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
});
