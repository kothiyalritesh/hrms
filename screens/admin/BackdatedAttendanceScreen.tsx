import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { useFocusEffect, useRoute } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { DateInput } from "@/components/DateInput";
import { PaginationControls } from "@/components/PaginationControls";
import { useTheme } from "@/hooks/useTheme";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime, formatTime } from "@/utils/format";
import {
  addBusinessDays,
  businessMonthStart,
  formatBusinessDate,
  getBusinessDateIST,
  isBusinessDate,
} from "@/utils/businessDate";
import {
  AttendanceCorrectionRow,
  AttendanceCorrectionService,
  CORRECTION_ACKNOWLEDGEMENT_VERSION,
  CorrectionCounts,
  CorrectionDayContext,
  CorrectionEmployee,
  CorrectionEvent,
  CorrectionOrigin,
  CorrectionEvidenceType,
  CorrectionEvidenceVerification,
  CorrectionPreview,
  CorrectionReasonCode,
  CorrectionStatus,
  DEFAULT_CORRECTION_ACKNOWLEDGEMENT_TEXT,
} from "@/services/attendance-correction.service";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const MAX_SHIFT_MS = 16 * 60 * 60 * 1000;
const LONG_SHIFT_MS = 12 * 60 * 60 * 1000;

type Tab = "REVIEW" | "HISTORY" | "NEW";

type RowAction = "approve" | "reject" | "return" | "withdraw";

const ORIGIN_FILTERS: Array<{ value: CorrectionOrigin | null; label: string }> = [
  { value: null, label: "All" },
  { value: "EMPLOYEE_REQUEST", label: "Employee requests" },
  { value: "HR_ENTRY", label: "HR entries" },
];

const EVENT_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  RETURNED_FOR_INFO: "Asked for more information",
  INFO_PROVIDED: "Added the information",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  APPLIED: "Applied to attendance",
  WITHDRAWN: "Withdrawn",
};

/** Orange used for "Waiting for employee" (distinct from the amber "Pending"). */
const ORANGE = "#F59B3C";
const ON_ORANGE = "#2B1400";

const REASONS: Array<{ value: CorrectionReasonCode; label: string }> = [
  { value: "POOR_NETWORK", label: "Poor network" },
  { value: "REMOTE_SITE_VISIT", label: "Remote site visit" },
  { value: "HRMS_FAILURE", label: "HRMS technical failure" },
  { value: "DEVICE_LOCATION_ISSUE", label: "Device / location issue" },
  { value: "OTHER", label: "Other" },
];

const EVIDENCE_TYPES: Array<{ value: CorrectionEvidenceType; label: string }> = [
  { value: "WHATSAPP_LOCATION", label: "WhatsApp location" },
  { value: "SITE_VISIT_RECORD", label: "Site visit record" },
  { value: "SUPERVISOR_CONFIRMATION", label: "Supervisor confirmation" },
  { value: "CLIENT_CONFIRMATION", label: "Client confirmation" },
  { value: "EMPLOYEE_EXPLANATION", label: "Employee explanation" },
  { value: "OTHER", label: "Other" },
];

const VERIFICATIONS: Array<{ value: CorrectionEvidenceVerification; label: string }> = [
  { value: "VERIFIED", label: "Verified" },
  { value: "PARTIALLY_VERIFIED", label: "Partially verified" },
  { value: "UNVERIFIED", label: "Not verified" },
];

const labelOf = <T extends string>(list: Array<{ value: T; label: string }>, value: string | null | undefined) =>
  list.find((item) => item.value === value)?.label ?? (value ? String(value) : "—");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function istIso(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00+05:30`;
}

function istTimeMs(date: string, hhmm: string): number | null {
  if (!isBusinessDate(date) || !HHMM.test(hhmm)) return null;
  const ms = new Date(istIso(date, hhmm)).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function dateFromBusinessDate(value: string): Date {
  if (!isBusinessDate(value)) return new Date();
  return new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
}

function businessDateFromLocal(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function dateFromHHMM(value: string): Date {
  const match = HHMM.exec(value);
  const d = new Date();
  d.setHours(match ? Number(match[1]) : 9, match ? Number(match[2]) : 0, 0, 0);
  return d;
}

function displayTime(value: string | null | undefined) {
  if (!value) return "—";
  return formatTime(value, value);
}

function displaySource(value: string | null | undefined) {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper === "ADMIN") return "HR / admin";
  if (upper === "BIOMETRIC") return "Biometric";
  if (upper === "APP" || upper === "MOBILE") return "App";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replace(/_/g, " ");
}

function maxDate(a: string, b: string | null | undefined) {
  return b && isBusinessDate(b.slice(0, 10)) && b.slice(0, 10) > a ? b.slice(0, 10) : a;
}

function minDate(a: string, b: string | null | undefined) {
  return b && isBusinessDate(b.slice(0, 10)) && b.slice(0, 10) < a ? b.slice(0, 10) : a;
}

function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

type Notice = { tone: "success" | "warning" | "error"; title: string; lines?: string[] };

// ─── Small UI pieces ──────────────────────────────────────────────────────────

function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        s.chip,
        { borderColor: selected ? theme.primary : theme.border, backgroundColor: selected ? theme.primary : theme.backgroundDefault },
        disabled && { opacity: 0.5 },
      ]}
    >
      <ThemedText style={[s.chipText, { color: selected ? "#FFFFFF" : theme.text }]}>{label}</ThemedText>
    </Pressable>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  const { theme } = useTheme();
  return (
    <ThemedText style={s.fieldLabel}>
      {children}
      {required ? <ThemedText style={{ color: theme.error, fontWeight: "800" }}> *</ThemedText> : null}
    </ThemedText>
  );
}

function NoticeBox({ notice, onClose }: { notice: Notice; onClose?: () => void }) {
  const { theme } = useTheme();
  const palette =
    notice.tone === "success"
      ? { bg: theme.successBg, fg: theme.successText, border: theme.success, icon: "check-circle" as const }
      : notice.tone === "warning"
        ? { bg: theme.warningBg, fg: theme.warningText, border: theme.warning, icon: "alert-triangle" as const }
        : { bg: theme.errorBg, fg: theme.errorText, border: theme.error, icon: "alert-octagon" as const };
  return (
    <View style={[s.notice, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Feather name={palette.icon} size={18} color={palette.border} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <ThemedText style={{ color: palette.fg, fontWeight: "700" }}>{notice.title}</ThemedText>
        {(notice.lines ?? []).map((line, index) => (
          <ThemedText key={index} style={{ color: palette.fg, fontSize: 13 }}>
            • {line}
          </ThemedText>
        ))}
      </View>
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Dismiss">
          <Feather name="x" size={18} color={palette.fg} />
        </Pressable>
      ) : null}
    </View>
  );
}

function TimeField({
  value,
  onChange,
  onOpenNative,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onOpenNative: () => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const { theme } = useTheme();
  if (Platform.OS === "web") {
    return React.createElement("input", {
      type: "time",
      value: value || "",
      disabled,
      onChange: (event: any) => onChange(String(event?.target?.value ?? "").slice(0, 5)),
      style: {
        fontFamily: "inherit",
        fontSize: 16,
        boxSizing: "border-box",
        width: "100%",
        minHeight: 44,
        padding: "0 12px",
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: theme.border,
        background: theme.backgroundDefault,
        color: theme.text,
        colorScheme: "light dark",
      },
    });
  }
  return (
    <Pressable
      disabled={disabled}
      onPress={onOpenNative}
      style={[s.input, s.pickerButton, { borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
    >
      <Feather name="clock" size={16} color={theme.primary} />
      <ThemedText style={{ color: value ? theme.text : theme.textSecondary }}>{value || placeholder}</ThemedText>
    </Pressable>
  );
}

function DateField({
  value,
  onChange,
  onOpenNative,
  min,
  max,
  placeholder = "Select date",
}: {
  value: string;
  onChange: (value: string) => void;
  onOpenNative: () => void;
  min?: string;
  max?: string;
  placeholder?: string;
}) {
  const { theme } = useTheme();
  if (Platform.OS === "web") {
    return (
      <DateInput
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        style={[
          s.input,
          {
            borderColor: theme.border,
            backgroundColor: theme.backgroundDefault,
            color: theme.text,
            paddingHorizontal: 12,
            borderWidth: 1,
          },
        ]}
      />
    );
  }
  return (
    <Pressable
      onPress={onOpenNative}
      style={[s.input, s.pickerButton, { borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
    >
      <Feather name="calendar" size={16} color={theme.primary} />
      <ThemedText style={{ color: value ? theme.text : theme.textSecondary }}>
        {value ? formatBusinessDate(value) : placeholder}
      </ThemedText>
    </Pressable>
  );
}

function StatusPill({ status }: { status: CorrectionStatus }) {
  const { theme } = useTheme();
  const meta =
    status === "APPLIED"
      ? { label: "Approved", bg: theme.successBg, fg: theme.successText }
      : status === "PENDING_APPROVAL"
        ? { label: "Pending", bg: theme.warningBg, fg: theme.warningText }
        : status === "NEEDS_INFO"
          ? { label: "Waiting for employee", bg: ORANGE, fg: ON_ORANGE }
          : status === "REJECTED"
            ? { label: "Rejected", bg: theme.errorBg, fg: theme.errorText }
            : { label: "Withdrawn", bg: theme.backgroundSecondary, fg: theme.textSecondary };
  return (
    <View style={[s.pill, { backgroundColor: meta.bg }]}>
      <ThemedText style={{ color: meta.fg, fontSize: 12, fontWeight: "800" }}>{meta.label}</ThemedText>
    </View>
  );
}

function InfoRow({ icon, label, value, tone }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; tone?: string }) {
  const { theme } = useTheme();
  return (
    <View style={s.infoRow}>
      <Feather name={icon} size={14} color={tone ?? theme.textSecondary} style={{ marginTop: 2 }} />
      <ThemedText style={{ fontSize: 13, color: theme.textSecondary, width: 112 }}>{label}</ThemedText>
      <ThemedText style={{ fontSize: 13, flex: 1, color: tone ?? theme.text }}>{value}</ThemedText>
    </View>
  );
}

function OriginBadge({ origin }: { origin: CorrectionOrigin }) {
  const { theme } = useTheme();
  const employee = origin === "EMPLOYEE_REQUEST";
  return (
    <View style={[s.pill, s.originBadge, { backgroundColor: employee ? theme.infoBg : theme.backgroundSecondary }]}>
      <Feather name={employee ? "user" : "shield"} size={11} color={employee ? theme.infoText : theme.textSecondary} />
      <ThemedText style={{ color: employee ? theme.infoText : theme.textSecondary, fontSize: 12, fontWeight: "800" }}>
        {employee ? "Employee request" : "Recorded by HR"}
      </ThemedText>
    </View>
  );
}

function timeRange(from: string | null | undefined, to: string | null | undefined) {
  return `${displayTime(from)}–${to ? displayTime(to) : "no check-out"}`;
}

/**
 * What already existed for the day when the request was raised (original_snapshot),
 * condensed to "nothing" / "App 11:40" / "Biometric 2 punches (…)" plus day-level notes.
 */
function recordedComparison(ctx: Partial<CorrectionDayContext> | null | undefined): {
  recorded: string;
  notes: string[];
} {
  if (!ctx || Object.keys(ctx).length === 0) return { recorded: "Not captured when the request was raised", notes: [] };
  const parts: string[] = [];
  const att = ctx.attendance;
  if (att?.checkin_time) {
    const src = displaySource(att.checkin_source) ?? "Attendance";
    const out = att.checkout_time
      ? `–${displayTime(att.checkout_time)}${
          att.checkout_source && att.checkout_source !== att.checkin_source ? ` (${displaySource(att.checkout_source)})` : ""
        }`
      : ", no check-out";
    parts.push(`${src} ${displayTime(att.checkin_time)}${out}`);
  } else if (att?.checkout_time) {
    parts.push(`Check-out only ${displayTime(att.checkout_time)}${att.checkout_source ? ` (${displaySource(att.checkout_source)})` : ""}`);
  }
  const punches = Number(ctx.biometric?.count ?? 0);
  if (punches > 0) {
    parts.push(
      `Biometric ${punches} punch${punches === 1 ? "" : "es"} (${
        punches === 1 ? displayTime(ctx.biometric?.first) : `${displayTime(ctx.biometric?.first)}–${displayTime(ctx.biometric?.last)}`
      })`,
    );
  }
  const visits = ctx.field_visits ?? [];
  if (visits.length) {
    parts.push(
      `${visits.length} field visit${visits.length === 1 ? "" : "s"} (${visits
        .map((v) => `${v.name || "Visit"} ${displayTime(v.checkin_time)}–${displayTime(v.checkout_time)}`)
        .join("; ")})`,
    );
  }

  const notes: string[] = [];
  const kind = String(ctx.calendar?.kind ?? "").toUpperCase();
  if (kind === "HOLIDAY" || kind === "WEEKLY_OFF") {
    notes.push(`${kind === "HOLIDAY" ? "Holiday" : "Weekly off"}${ctx.calendar?.label ? `: ${ctx.calendar.label}` : ""}`);
  }
  for (const leave of ctx.leave ?? []) {
    notes.push(`Leave: ${leave.leave_type ?? "approved"} (${leave.is_half_day ? "half day" : "full day"})`);
  }
  if ((ctx.approved_regularizations ?? []).length) notes.push("A check-out regularization was already approved for this day");
  if ((ctx.corrections ?? []).length) {
    notes.push(`Earlier corrections for this day: ${(ctx.corrections ?? []).length}`);
  }
  return { recorded: parts.length ? parts.join(" / ") : "nothing", notes };
}

function eventLabel(event: CorrectionEvent) {
  return EVENT_LABELS[String(event.event_type)] ?? String(event.event_type).replace(/_/g, " ").toLowerCase();
}

// ─── Screen ───────────────────────────────────────────────────────────────────

type RouteParams = { userId?: string; userName?: string; date?: string } | undefined;

export default function BackdatedAttendanceScreen() {
  const { theme, isDark } = useTheme();
  const { user } = useAuth();
  // "Record for employee" needs Correct attendance; reviewing needs View requests
  // (Approve requests includes it). The server checks both again.
  const { hasPermission } = usePermissions();
  const canRecord = hasPermission("attendance.backdate_correct");
  const route = useRoute<any>();
  const params = (route?.params ?? undefined) as RouteParams;

  const today = getBusinessDateIST();
  const defaultWindowStart = businessMonthStart(today, -1);

  const [tab, setTab] = useState<Tab>("REVIEW");
  const [refreshing, setRefreshing] = useState(false);

  // Summary (counts across both origins)
  const [counts, setCounts] = useState<CorrectionCounts | null>(null);

  // ── Form state ──
  const [employee, setEmployee] = useState<CorrectionEmployee | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CorrectionEmployee[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reason, setReason] = useState<CorrectionReasonCode | null>(null);
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [siteName, setSiteName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [evidenceType, setEvidenceType] = useState<CorrectionEvidenceType | null>(null);
  const [evidenceSource, setEvidenceSource] = useState("");
  const [evidenceDetails, setEvidenceDetails] = useState("");
  const [verification, setVerification] = useState<CorrectionEvidenceVerification | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  // Native picker
  type PickerTarget = "date" | "checkin" | "checkout" | "histFrom" | "histTo";
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [pickerDraft, setPickerDraft] = useState<Date>(new Date());

  // ── Lists ──
  const [reviewRows, setReviewRows] = useState<AttendanceCorrectionRow[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewPage, setReviewPage] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [historyOrigin, setHistoryOrigin] = useState<CorrectionOrigin | null>(null);
  const [historyRows, setHistoryRows] = useState<AttendanceCorrectionRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [rowMessages, setRowMessages] = useState<Record<string, { tone: "error" | "success"; text: string }>>({});
  const [busy, setBusy] = useState<{ id: string; action: RowAction } | null>(null);

  // ── Prefill from route params (Attendance Control → Correct) ──
  const prefillUserId = params?.userId;
  const prefillUserName = params?.userName;
  const prefillDate = params?.date;
  useEffect(() => {
    if (!prefillUserId && !prefillDate) return;
    setTab("NEW");
    if (prefillUserId) {
      setEmployee({
        id: prefillUserId,
        name: prefillUserName || "Selected employee",
        employee_number: null,
        office_id: null,
        office_name: null,
        joining_date: null,
        last_working_date: null,
      });
      setSearch("");
    }
    if (prefillDate && isBusinessDate(prefillDate)) setDate(prefillDate);
    idempotencyKeyRef.current = null;
  }, [prefillUserId, prefillUserName, prefillDate]);

  // ── Employee search (debounced) ──
  useEffect(() => {
    if (employee || tab !== "NEW") return;
    let active = true;
    const handle = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const rows = await AttendanceCorrectionService.searchEmployees(search);
        if (active) setResults(rows);
      } catch {
        if (active) {
          setResults([]);
          setSearchError("Could not load employees. Check the connection and try again.");
        }
      } finally {
        if (active) setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [search, employee, tab]);

  // ── Window (server preview wins once loaded) ──
  const windowStartBase = preview?.success && preview.window_start ? preview.window_start : defaultWindowStart;
  const windowEndBase = preview?.success && preview.window_end ? preview.window_end : today;
  const windowStart = maxDate(windowStartBase, employee?.joining_date);
  const windowEnd = minDate(windowEndBase, employee?.last_working_date);

  const dateValid = isBusinessDate(date);
  const dateInWindow = dateValid && date >= windowStart && date <= windowEnd;

  // ── Preview ──
  const previewSeq = useRef(0);
  const loadPreview = useCallback(async () => {
    const seq = ++previewSeq.current;
    if (!employee || !isBusinessDate(date)) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await AttendanceCorrectionService.preview(employee.id, date);
      if (seq !== previewSeq.current) return;
      setPreview(result);
      if (!result.success) setPreviewError(result.message || "Could not load this day.");
    } catch {
      if (seq !== previewSeq.current) return;
      setPreview(null);
      setPreviewError("Could not load what is already recorded for this day. Check the connection and try again.");
    } finally {
      if (seq === previewSeq.current) setPreviewLoading(false);
    }
  }, [employee, date]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const ctx = preview?.success ? preview.context ?? null : null;
  const forbidden = preview?.success === false && preview.error === "FORBIDDEN";
  const ackText = (preview?.success && preview.acknowledgement_text) || DEFAULT_CORRECTION_ACKNOWLEDGEMENT_TEXT;
  const ackVersion = (preview?.success && preview.acknowledgement_version) || CORRECTION_ACKNOWLEDGEMENT_VERSION;

  // ── Derived checks ──
  const checkinMs = istTimeMs(date, checkin);
  const checkoutMs = checkout ? istTimeMs(date, checkout) : null;
  const isPastDay = dateValid && date < today;

  const validation = useMemo(() => {
    const errors: Partial<Record<
      "employee" | "date" | "reason" | "checkin" | "checkout" | "remarks" | "evidenceType" | "evidenceSource" | "verification" | "ack",
      string
    >> = {};
    const now = Date.now();
    if (!employee) errors.employee = "Choose an employee.";
    if (!dateValid) errors.date = "Choose a date.";
    else if (!dateInWindow)
      errors.date = `Choose a date from ${formatBusinessDate(windowStart)} to ${formatBusinessDate(windowEnd)}.`;
    if (!reason) errors.reason = "Choose a reason.";
    if (!HHMM.test(checkin)) errors.checkin = "Enter the actual check-in time.";
    else if (checkinMs != null && checkinMs > now) errors.checkin = "Check-in cannot be in the future.";
    if (!checkout) {
      if (isPastDay) errors.checkout = "Enter the check-out time for a past day.";
    } else if (!HHMM.test(checkout)) errors.checkout = "Enter a valid check-out time.";
    else if (checkoutMs != null && checkoutMs > now) errors.checkout = "Check-out cannot be in the future.";
    else if (checkinMs != null && checkoutMs != null && checkoutMs <= checkinMs)
      errors.checkout = "Check-out must be after check-in.";
    else if (checkinMs != null && checkoutMs != null && checkoutMs - checkinMs > MAX_SHIFT_MS)
      errors.checkout = "Check-out must be within 16 hours of check-in.";
    if (remarks.trim().length < 10) errors.remarks = "Write at least 10 characters.";
    if (!evidenceType) errors.evidenceType = "Choose the evidence type.";
    if (evidenceSource.trim().length < 3) errors.evidenceSource = "Say where the evidence came from.";
    if (!verification) errors.verification = "Choose the verification status.";
    if (!acknowledged) errors.ack = "Tick the acknowledgement to submit.";
    return errors;
  }, [
    employee, dateValid, dateInWindow, windowStart, windowEnd, reason, checkin, checkout, checkinMs, checkoutMs,
    isPastDay, remarks, evidenceType, evidenceSource, verification, acknowledged,
  ]);

  const { warnings, blockers } = useMemo(() => {
    const warn: string[] = [];
    const block: string[] = [];
    if (dateValid && date < addBusinessDays(today, -7)) warn.push("The date is more than 7 days old.");
    if (ctx) {
      if (ctx.attendance?.checkin_time) warn.push("A check-in already exists for this day and will be replaced.");
      if (ctx.biometric && Number(ctx.biometric.count) > 0) warn.push("Biometric punches exist for this day.");
      const kind = String(ctx.calendar?.kind ?? "").toUpperCase();
      if (kind === "HOLIDAY" || kind === "WEEKLY_OFF")
        warn.push(`${kind === "HOLIDAY" ? "Holiday" : "Weekly off"}${ctx.calendar?.label ? ` (${ctx.calendar.label})` : ""}: working on it may earn a comp-off.`);
      const fullDay = (ctx.leave ?? []).filter((l) => !l.is_half_day);
      const halfDay = (ctx.leave ?? []).filter((l) => l.is_half_day);
      if (fullDay.length) block.push("The employee has approved full-day leave on this date. Cancel the leave first.");
      else if (halfDay.length) warn.push("Half-day leave is approved on this day.");
      if ((ctx.corrections ?? []).some((c) => c.status === "PENDING_APPROVAL"))
        block.push("A correction for this day is already waiting for approval.");
      else if ((ctx.corrections ?? []).length) warn.push("This day was corrected before.");
      if ((ctx.approved_regularizations ?? []).length && checkout)
        block.push(
          "This day's check-out was already set by an approved regularization request. Leave check-out empty or change it there.",
        );
    }
    if (verification && verification !== "VERIFIED") warn.push("Evidence is not fully verified.");
    if (checkinMs != null && checkoutMs != null && checkoutMs - checkinMs > LONG_SHIFT_MS)
      warn.push("More than 12 working hours.");
    return { warnings: warn, blockers: block };
  }, [ctx, dateValid, date, today, verification, checkinMs, checkoutMs, checkout]);

  const canSubmit =
    Object.keys(validation).length === 0 && blockers.length === 0 && !forbidden && !previewLoading && !submitting;

  const resetForm = useCallback((keepNotice = true) => {
    setEmployee(null);
    setSearch("");
    setDate("");
    setPreview(null);
    setPreviewError(null);
    setReason(null);
    setCheckin("");
    setCheckout("");
    setSiteName("");
    setRemarks("");
    setEvidenceType(null);
    setEvidenceSource("");
    setEvidenceDetails("");
    setVerification(null);
    setAcknowledged(false);
    setSubmitError(null);
    setShowErrors(false);
    if (!keepNotice) setNotice(null);
    idempotencyKeyRef.current = null;
  }, []);

  // ── Lists loading ──
  const loadSummary = useCallback(async () => {
    try {
      const result = await AttendanceCorrectionService.list({ limit: 1, offset: 0 });
      setCounts(result.counts);
    } catch {
      setCounts(null);
    }
  }, []);

  const loadReview = useCallback(async () => {
    setReviewLoading(true);
    setReviewError(null);
    try {
      const result = await AttendanceCorrectionService.list({
        status: "OPEN",
        limit: PAGE_SIZE,
        offset: reviewPage * PAGE_SIZE,
      });
      setReviewRows(result.rows);
      setReviewTotal(result.total);
      // No origin filter here, so these counts cover both origins.
      setCounts(result.counts);
    } catch {
      setReviewError("Could not load the requests to review.");
    } finally {
      setReviewLoading(false);
    }
  }, [reviewPage]);

  const historyRangeValid =
    (!historyFrom || isBusinessDate(historyFrom)) &&
    (!historyTo || isBusinessDate(historyTo)) &&
    (!historyFrom || !historyTo || historyFrom <= historyTo);

  const loadHistory = useCallback(async () => {
    if (!historyRangeValid) {
      setHistoryError("The 'from' date must be on or before the 'to' date.");
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await AttendanceCorrectionService.list({
        status: null,
        from: historyFrom || null,
        to: historyTo || null,
        limit: PAGE_SIZE,
        offset: historyPage * PAGE_SIZE,
        origin: historyOrigin,
      });
      setHistoryRows(result.rows);
      setHistoryTotal(result.total);
    } catch {
      setHistoryError("Could not load the request history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFrom, historyTo, historyPage, historyRangeValid, historyOrigin]);

  useFocusEffect(
    useCallback(() => {
      void loadSummary();
    }, [loadSummary]),
  );

  useEffect(() => {
    if (tab === "REVIEW") void loadReview();
  }, [tab, loadReview]);

  useEffect(() => {
    if (tab === "HISTORY") void loadHistory();
  }, [tab, loadHistory]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadSummary(),
        tab === "REVIEW" ? loadReview() : tab === "HISTORY" ? loadHistory() : loadPreview(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  // ── Submit ──
  const submit = async () => {
    setShowErrors(true);
    setSubmitError(null);
    if (!canSubmit || !employee || !reason || !evidenceType || !verification) return;
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey();
    setSubmitting(true);
    try {
      const result = await AttendanceCorrectionService.submit({
        userId: employee.id,
        businessDate: date,
        reasonCode: reason,
        remarks: remarks.trim(),
        checkinAt: istIso(date, checkin),
        checkoutAt: checkout ? istIso(date, checkout) : null,
        evidenceType,
        evidenceSource: evidenceSource.trim(),
        evidenceVerification: verification,
        acknowledged,
        acknowledgementVersion: ackVersion,
        idempotencyKey: idempotencyKeyRef.current,
        siteName: siteName.trim() || null,
        officeId: employee.office_id,
        evidenceDetails: evidenceDetails.trim() || null,
      });
      if (!result.success) {
        setSubmitError(result.message || "The correction was not saved.");
        if (result.error === "IDEMPOTENCY_KEY_REUSED") idempotencyKeyRef.current = null;
        return;
      }
      const who = `${employee.name}, ${formatBusinessDate(date)}`;
      if (result.status === "APPLIED") {
        setNotice({ tone: "success", title: "Attendance corrected. The employee has been notified.", lines: [who] });
      } else {
        setNotice({
          tone: "warning",
          title: "Saved for approval. Another authorised person must approve it before it applies.",
          lines: [who, ...(result.risk_reasons ?? [])],
        });
      }
      resetForm(true);
      void loadSummary();
      void loadReview();
      void loadHistory();
    } catch {
      setSubmitError("Could not reach the server. Check the connection and submit again — it will not be recorded twice.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Approve / reject / return for info / withdraw ──
  const setRowMessage = (id: string, tone: "error" | "success", text: string | null) =>
    setRowMessages((prev) => {
      const next = { ...prev };
      if (text) next[id] = { tone, text };
      else delete next[id];
      return next;
    });

  const runAction = async (row: AttendanceCorrectionRow, action: RowAction) => {
    if (busy) return;
    const notes = (decisionNotes[row.id] || "").trim();
    if (action === "reject" && notes.length < 3) {
      setRowMessage(row.id, "error", "Write why it is rejected in the remarks (at least 3 characters).");
      return;
    }
    if (action === "return" && notes.length < 5) {
      setRowMessage(row.id, "error", "Write in the remarks what information the employee should add (at least 5 characters).");
      return;
    }
    const isEmployeeRequest = row.origin === "EMPLOYEE_REQUEST";
    const who = `${row.employee_name ?? "Employee"}, ${formatBusinessDate(row.business_date)}`;
    setBusy({ id: row.id, action });
    setRowMessage(row.id, "error", null);
    try {
      const result =
        action === "withdraw"
          ? await AttendanceCorrectionService.cancel(row.id)
          : action === "return"
            ? await AttendanceCorrectionService.returnForInfo(row.id, notes)
            : await AttendanceCorrectionService.decide(row.id, action === "approve", notes || null);
      if (!result.success) {
        setRowMessage(row.id, "error", result.message || "The action was not saved. Try again.");
        return;
      }
      const done: Record<RowAction, { tone: Notice["tone"]; title: string; inline: string }> = {
        approve: {
          tone: "success",
          title: isEmployeeRequest
            ? "Request approved and attendance updated. The employee has been notified."
            : "Correction approved and applied. The employee has been notified.",
          inline: "Approved.",
        },
        reject: {
          tone: "warning",
          title: isEmployeeRequest ? "Request rejected. The employee has been notified." : "Correction rejected.",
          inline: "Rejected.",
        },
        return: {
          tone: "success",
          title: "Sent back to the employee for more information.",
          inline: "Returned to the employee. It stays here as “Waiting for employee” until they answer.",
        },
        withdraw: { tone: "success", title: "Withdrawn.", inline: "Withdrawn." },
      };
      setNotice({ tone: done[action].tone, title: done[action].title, lines: [who] });
      setRowMessage(row.id, "success", done[action].inline);
      setDecisionNotes((prev) => ({ ...prev, [row.id]: "" }));
      await Promise.all([
        loadReview(),
        loadSummary(),
        tab === "HISTORY" ? loadHistory() : Promise.resolve(),
      ]);
    } catch {
      setRowMessage(row.id, "error", "Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  };

  // ── Native picker plumbing ──
  const openPicker = (target: PickerTarget) => {
    const initial =
      target === "date"
        ? dateFromBusinessDate(date || today)
        : target === "histFrom"
          ? dateFromBusinessDate(historyFrom || today)
          : target === "histTo"
            ? dateFromBusinessDate(historyTo || today)
            : dateFromHHMM(target === "checkin" ? checkin : checkout);
    setPickerDraft(initial);
    setPicker(target);
  };

  const applyPicker = (target: PickerTarget, value: Date) => {
    if (target === "checkin" || target === "checkout") {
      const hhmm = `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
      if (target === "checkin") setCheckin(hhmm);
      else setCheckout(hhmm);
      return;
    }
    const d = businessDateFromLocal(value);
    if (target === "date") setDate(d);
    else if (target === "histFrom") {
      setHistoryPage(0);
      setHistoryFrom(d);
    } else {
      setHistoryPage(0);
      setHistoryTo(d);
    }
  };

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") {
      const target = picker;
      setPicker(null);
      if (event.type !== "set" || !selected || !target) return;
      applyPicker(target, selected);
      return;
    }
    if (selected) setPickerDraft(selected);
  };

  const pickerMode = picker === "checkin" || picker === "checkout" ? "time" : "date";
  const pickerMin = picker === "date" ? dateFromBusinessDate(windowStart) : undefined;
  const pickerMax = picker === "date" || picker === "histFrom" || picker === "histTo" ? dateFromBusinessDate(today) : undefined;

  // ── Render helpers ──
  const err = (key: keyof typeof validation) =>
    showErrors && validation[key] ? (
      <ThemedText style={[s.fieldError, { color: theme.error }]}>{validation[key]}</ThemedText>
    ) : null;

  const inputStyle = [s.input, { borderColor: theme.border, backgroundColor: theme.backgroundDefault, color: theme.text }];

  const renderEmployeeSection = () => (
    <View style={s.field}>
      <FieldLabel required>Employee</FieldLabel>
      {employee ? (
        <View style={[s.selected, { borderColor: theme.primary, backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="user" size={18} color={theme.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText style={{ fontWeight: "700" }} numberOfLines={1}>
              {employee.name}
            </ThemedText>
            {employee.employee_number || employee.office_name ? (
              <ThemedText style={{ fontSize: 12, color: theme.textSecondary }} numberOfLines={1}>
                {[employee.employee_number, employee.office_name].filter(Boolean).join(" · ")}
              </ThemedText>
            ) : null}
          </View>
          <Pressable
            onPress={() => {
              setEmployee(null);
              setPreview(null);
              setPreviewError(null);
              idempotencyKeyRef.current = null;
            }}
            style={[s.smallButton, { borderColor: theme.border }]}
          >
            <ThemedText style={{ fontSize: 13, fontWeight: "700", color: theme.primary }}>Change</ThemedText>
          </Pressable>
        </View>
      ) : (
        <View>
          <View style={[s.searchBox, { borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}>
            <Feather name="search" size={16} color={theme.textSecondary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or employee number"
              placeholderTextColor={theme.textSecondary}
              autoCorrect={false}
              style={[s.searchInput, { color: theme.text }]}
            />
            {searching ? <ActivityIndicator size="small" color={theme.primary} /> : null}
          </View>
          {searchError ? <ThemedText style={[s.fieldError, { color: theme.error }]}>{searchError}</ThemedText> : null}
          <View style={[s.results, { borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}>
            {!searching && !searchError && results.length === 0 ? (
              <ThemedText style={{ padding: 12, color: theme.textSecondary, fontSize: 13 }}>
                {search.trim() ? "No employee matches this search." : "No employees available to correct."}
              </ThemedText>
            ) : null}
            {results.map((row, index) => (
              <Pressable
                key={row.id}
                onPress={() => {
                  setEmployee(row);
                  idempotencyKeyRef.current = null;
                }}
                style={({ pressed }) => [
                  s.resultRow,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                  pressed && { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <ThemedText style={{ fontWeight: "600" }} numberOfLines={1}>
                  {row.name}
                </ThemedText>
                <ThemedText style={{ fontSize: 12, color: theme.textSecondary }} numberOfLines={1}>
                  {[row.employee_number || "No employee number", row.office_name || "No office"].join(" · ")}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      {err("employee")}
    </View>
  );

  const renderPreviewCard = () => {
    if (!employee || !dateValid) return null;
    if (previewLoading) {
      return (
        <View style={[s.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <ActivityIndicator color={theme.primary} />
          <ThemedText style={{ textAlign: "center", color: theme.textSecondary, marginTop: 8, fontSize: 13 }}>
            Checking what is already recorded…
          </ThemedText>
        </View>
      );
    }
    if (previewError) {
      return (
        <NoticeBox
          notice={{ tone: forbidden ? "error" : "warning", title: previewError }}
        />
      );
    }
    if (!ctx) return null;
    const att = ctx.attendance;
    const kind = String(ctx.calendar?.kind ?? "").toUpperCase();
    return (
      <View style={[s.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
        <ThemedText style={s.cardTitle}>What we already know for this day</ThemedText>
        <InfoRow
          icon="log-in"
          label="Attendance"
          value={
            att && (att.checkin_time || att.checkout_time)
              ? `In ${displayTime(att.checkin_time)}${att.checkin_source ? ` (${displaySource(att.checkin_source)})` : ""} · Out ${displayTime(att.checkout_time)}${att.checkout_source ? ` (${displaySource(att.checkout_source)})` : ""}${att.status ? ` · ${att.status}` : ""}`
              : "Nothing recorded"
          }
          tone={att?.checkin_time ? theme.warning : undefined}
        />
        <InfoRow
          icon="cpu"
          label="Biometric"
          value={
            ctx.biometric && Number(ctx.biometric.count) > 0
              ? `${ctx.biometric.count} punch${Number(ctx.biometric.count) === 1 ? "" : "es"} · first ${displayTime(ctx.biometric.first)} · last ${displayTime(ctx.biometric.last)}`
              : "No punches"
          }
          tone={ctx.biometric && Number(ctx.biometric.count) > 0 ? theme.warning : undefined}
        />
        <InfoRow
          icon="map-pin"
          label="Field visits"
          value={
            (ctx.field_visits ?? []).length
              ? (ctx.field_visits ?? [])
                  .map(
                    (v) =>
                      `${v.name || "Visit"} (${displayTime(v.checkin_time)}–${displayTime(v.checkout_time)}${v.verification_status ? `, ${String(v.verification_status).toLowerCase()}` : ""})`,
                  )
                  .join("; ")
              : "None"
          }
        />
        <InfoRow
          icon="umbrella"
          label="Leave"
          value={
            (ctx.leave ?? []).length
              ? (ctx.leave ?? []).map((l) => `${l.leave_type ?? "Leave"}${l.is_half_day ? " (half day)" : " (full day)"}`).join(", ")
              : "None"
          }
          tone={(ctx.leave ?? []).some((l) => !l.is_half_day) ? theme.error : (ctx.leave ?? []).length ? theme.warning : undefined}
        />
        <InfoRow
          icon="calendar"
          label="Calendar"
          value={
            kind === "HOLIDAY"
              ? `Holiday${ctx.calendar?.label ? ` · ${ctx.calendar.label}` : ""}`
              : kind === "WEEKLY_OFF"
                ? `Weekly off${ctx.calendar?.label ? ` · ${ctx.calendar.label}` : ""}`
                : kind === "WORKING_DAY"
                  ? "Working day"
                  : ctx.calendar?.label || "Not available"
          }
          tone={kind === "HOLIDAY" || kind === "WEEKLY_OFF" ? theme.warning : undefined}
        />
        <InfoRow
          icon="edit-3"
          label="Corrections"
          value={
            (ctx.corrections ?? []).length
              ? (ctx.corrections ?? [])
                  .map((c) => `${c.status === "APPLIED" ? "Applied" : "Pending"}: ${displayTime(c.checkin_at)}–${displayTime(c.checkout_at)}`)
                  .join("; ")
              : "None"
          }
          tone={(ctx.corrections ?? []).length ? theme.warning : undefined}
        />
        <InfoRow
          icon="file-text"
          label="Regularization"
          value={
            (ctx.approved_regularizations ?? []).length
              ? (ctx.approved_regularizations ?? [])
                  .map((r) => `Approved${r.requested_checkout ? `, check-out ${displayTime(r.requested_checkout)}` : ""}`)
                  .join("; ")
              : "None approved"
          }
          tone={(ctx.approved_regularizations ?? []).length ? theme.warning : undefined}
        />
      </View>
    );
  };

  const renderForm = () => (
    <View style={{ gap: 4 }}>
      {renderEmployeeSection()}

      <View style={s.field}>
        <FieldLabel required>Date</FieldLabel>
        <DateField
          value={date}
          onChange={(value) => {
            setDate(value);
            idempotencyKeyRef.current = null;
          }}
          onOpenNative={() => openPicker("date")}
          min={windowStart}
          max={windowEnd}
        />
        <ThemedText style={[s.hint, { color: theme.textSecondary }]}>
          Allowed: {formatBusinessDate(windowStart)} to {formatBusinessDate(windowEnd)} (IST)
        </ThemedText>
        {err("date")}
      </View>

      {renderPreviewCard()}

      {blockers.length ? <NoticeBox notice={{ tone: "error", title: "This correction cannot be submitted", lines: blockers }} /> : null}
      {warnings.length ? (
        <NoticeBox
          notice={{ tone: "warning", title: "High-risk: another authorised person will have to approve it", lines: warnings }}
        />
      ) : null}

      <View style={s.field}>
        <FieldLabel required>Reason</FieldLabel>
        <View style={s.chipWrap}>
          {REASONS.map((item) => (
            <Chip key={item.value} label={item.label} selected={reason === item.value} onPress={() => setReason(item.value)} />
          ))}
        </View>
        {err("reason")}
      </View>

      <View style={s.row2}>
        <View style={[s.field, s.half]}>
          <FieldLabel required>Actual check-in</FieldLabel>
          <TimeField value={checkin} onChange={setCheckin} onOpenNative={() => openPicker("checkin")} placeholder="Select time" />
          {err("checkin")}
        </View>
        <View style={[s.field, s.half]}>
          <FieldLabel required={isPastDay || !dateValid}>Actual check-out</FieldLabel>
          <TimeField value={checkout} onChange={setCheckout} onOpenNative={() => openPicker("checkout")} placeholder="Select time" />
          {checkout ? (
            <Pressable onPress={() => setCheckout("")} hitSlop={6}>
              <ThemedText style={{ fontSize: 12, color: theme.primary, marginTop: 4 }}>Clear check-out</ThemedText>
            </Pressable>
          ) : !isPastDay && dateValid ? (
            <ThemedText style={[s.hint, { color: theme.textSecondary }]}>Optional for today</ThemedText>
          ) : null}
          {err("checkout")}
        </View>
      </View>
      <ThemedText style={[s.hint, { color: theme.textSecondary, marginTop: -4 }]}>Times are India time (IST) on the selected date.</ThemedText>

      <View style={s.field}>
        <FieldLabel>Project / site name</FieldLabel>
        <TextInput
          value={siteName}
          onChangeText={setSiteName}
          placeholder="Optional"
          placeholderTextColor={theme.textSecondary}
          style={inputStyle}
        />
      </View>

      <View style={s.field}>
        <FieldLabel required>Remarks</FieldLabel>
        <TextInput
          value={remarks}
          onChangeText={setRemarks}
          placeholder="Site name, visit purpose and how it was verified"
          placeholderTextColor={theme.textSecondary}
          multiline
          style={[inputStyle, s.multiline]}
        />
        {err("remarks")}
      </View>

      <View style={[s.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
        <ThemedText style={s.cardTitle}>Evidence</ThemedText>
        <FieldLabel required>Type</FieldLabel>
        <View style={s.chipWrap}>
          {EVIDENCE_TYPES.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              selected={evidenceType === item.value}
              onPress={() => setEvidenceType(item.value)}
            />
          ))}
        </View>
        {err("evidenceType")}
        <View style={s.field}>
          <FieldLabel required>Source</FieldLabel>
          <TextInput
            value={evidenceSource}
            onChangeText={setEvidenceSource}
            placeholder='e.g. "WhatsApp from employee, 12 Oct 6:05 PM"'
            placeholderTextColor={theme.textSecondary}
            style={inputStyle}
          />
          {err("evidenceSource")}
        </View>
        <View style={s.field}>
          <FieldLabel>Details</FieldLabel>
          <TextInput
            value={evidenceDetails}
            onChangeText={setEvidenceDetails}
            placeholder="Optional"
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[inputStyle, s.multilineSmall]}
          />
        </View>
        <View style={s.field}>
          <FieldLabel required>Verification status</FieldLabel>
          <View style={s.chipWrap}>
            {VERIFICATIONS.map((item) => (
              <Chip
                key={item.value}
                label={item.label}
                selected={verification === item.value}
                onPress={() => setVerification(item.value)}
              />
            ))}
          </View>
          {err("verification")}
        </View>
      </View>

      <View style={s.field}>
        <FieldLabel>Responsible HR officer</FieldLabel>
        <View style={[s.input, s.pickerButton, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="shield" size={16} color={theme.textSecondary} />
          <ThemedText style={{ flex: 1 }} numberOfLines={1}>
            {user?.name || "—"}
          </ThemedText>
          <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>Recorded automatically</ThemedText>
        </View>
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acknowledged }}
        onPress={() => setAcknowledged((v) => !v)}
        style={[
          s.ack,
          { borderColor: showErrors && !acknowledged ? theme.error : theme.border, backgroundColor: theme.backgroundDefault },
        ]}
      >
        <Feather name={acknowledged ? "check-square" : "square"} size={22} color={acknowledged ? theme.primary : theme.textSecondary} />
        <ThemedText style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>{ackText}</ThemedText>
      </Pressable>
      {err("ack")}

      {submitError ? <NoticeBox notice={{ tone: "error", title: submitError }} onClose={() => setSubmitError(null)} /> : null}

      <Pressable
        accessibilityRole="button"
        disabled={!canSubmit}
        onPress={() => void submit()}
        style={[s.submit, { backgroundColor: theme.primary, opacity: canSubmit ? 1 : 0.45 }]}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <ThemedText style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 16 }}>Submit correction</ThemedText>
        )}
      </Pressable>
      {!canSubmit && !submitting && Object.keys(validation).length ? (
        <Pressable onPress={() => setShowErrors(true)} hitSlop={6}>
          <ThemedText style={[s.hint, { color: theme.textSecondary, textAlign: "center" }]}>
            {showErrors ? "Complete the highlighted fields to submit." : "Fill in all required fields (tap to see what is missing)."}
          </ThemedText>
        </Pressable>
      ) : null}
      <Pressable onPress={() => resetForm(false)} style={{ alignSelf: "center", padding: 8 }}>
        <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>Clear form</ThemedText>
      </Pressable>
    </View>
  );

  const eventColor = (type: string) =>
    type === "APPROVED" || type === "APPLIED"
      ? theme.success
      : type === "REJECTED"
        ? theme.error
        : type === "RETURNED_FOR_INFO"
          ? ORANGE
          : type === "WITHDRAWN"
            ? theme.textSecondary
            : theme.primary;

  const renderRowCard = (row: AttendanceCorrectionRow, mode: "REVIEW" | "HISTORY") => {
    const rowBusy = busy?.id === row.id;
    const anyBusy = busy !== null;
    const msg = rowMessages[row.id];
    const isEmployeeRequest = row.origin === "EMPLOYEE_REQUEST";
    const waitingForEmployee = row.status === "NEEDS_INFO";
    const isOpen = row.status === "PENDING_APPROVAL" || waitingForEmployee;
    const canApprove = row.status === "PENDING_APPROVAL";
    const canReturn = isEmployeeRequest && row.status === "PENDING_APPROVAL";
    const comparison = recordedComparison(row.original_snapshot);
    const events = row.events ?? [];
    const notesValue = decisionNotes[row.id] || "";
    const accent =
      row.status === "APPLIED"
        ? theme.success
        : row.status === "PENDING_APPROVAL"
          ? theme.warning
          : row.status === "NEEDS_INFO"
            ? ORANGE
            : row.status === "REJECTED"
              ? theme.error
              : theme.border;
    const isBusy = (action: RowAction) => rowBusy && busy?.action === action;

    return (
      <View key={row.id} style={[s.rowCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: accent, borderColor: theme.border }]}>
        <View style={s.rowHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText style={{ fontWeight: "800", fontSize: 15 }} numberOfLines={2}>
              {row.employee_name || "Employee"}
              {row.employee_number ? (
                <ThemedText style={{ fontWeight: "600", fontSize: 13, color: theme.textSecondary }}> · {row.employee_number}</ThemedText>
              ) : null}
            </ThemedText>
            <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>{formatBusinessDate(row.business_date)}</ThemedText>
          </View>
          <StatusPill status={row.status} />
        </View>

        <View style={[s.chipWrap, { marginTop: 4 }]}>
          <OriginBadge origin={row.origin} />
          {row.parent_request_id ? (
            <View style={[s.pill, s.originBadge, { backgroundColor: theme.warningBg }]}>
              <Feather name="rotate-ccw" size={11} color={theme.warningText} />
              <ThemedText style={{ color: theme.warningText, fontSize: 12, fontWeight: "700" }}>Re-raised after a rejected request</ThemedText>
            </View>
          ) : null}
        </View>

        <View style={[s.compare, { backgroundColor: theme.backgroundSecondary }]}>
          <View style={s.compareRow}>
            <ThemedText style={[s.compareLabel, { color: theme.textSecondary }]}>Requested</ThemedText>
            <ThemedText style={{ flex: 1, fontSize: 14, fontWeight: "800" }}>{timeRange(row.checkin_at, row.checkout_at)}</ThemedText>
          </View>
          <View style={s.compareRow}>
            <ThemedText style={[s.compareLabel, { color: theme.textSecondary }]}>Recorded</ThemedText>
            <ThemedText
              style={{ flex: 1, fontSize: 13, color: comparison.recorded === "nothing" ? theme.textSecondary : theme.warningText }}
            >
              {comparison.recorded}
            </ThemedText>
          </View>
          {comparison.notes.map((note, index) => (
            <ThemedText key={index} style={{ fontSize: 12, color: theme.warningText }}>
              • {note}
            </ThemedText>
          ))}
          <ThemedText style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2 }}>
            India time (IST). “Recorded” is what existed when this was raised.
          </ThemedText>
        </View>

        <InfoRow icon="help-circle" label="Reason" value={labelOf(REASONS, row.reason_code)} />
        {row.site_name ? <InfoRow icon="map-pin" label="Site" value={row.site_name} /> : null}
        <InfoRow icon="message-square" label={isEmployeeRequest ? "Explanation" : "Remarks"} value={row.remarks || "—"} />
        {row.location_evidence ? <InfoRow icon="navigation" label="Location info" value={row.location_evidence} /> : null}

        <View style={[s.evidenceBox, { borderColor: isEmployeeRequest && isOpen ? theme.warning : theme.border }]}>
          <ThemedText style={{ fontSize: 12, fontWeight: "800", color: isEmployeeRequest && isOpen ? theme.warningText : theme.textSecondary }}>
            {isEmployeeRequest ? "Evidence to verify" : "Evidence"}
          </ThemedText>
          <InfoRow icon="paperclip" label="Type" value={labelOf(EVIDENCE_TYPES, row.evidence_type)} />
          <InfoRow icon="search" label={isEmployeeRequest ? "Where to find it" : "Source"} value={row.evidence_source || "—"} />
          {row.evidence_details ? <InfoRow icon="file-text" label="Details" value={row.evidence_details} /> : null}
          {!isEmployeeRequest ? (
            <InfoRow
              icon="check-circle"
              label="HR verification"
              value={labelOf(VERIFICATIONS, row.evidence_verification)}
              tone={row.evidence_verification === "VERIFIED" ? undefined : theme.warning}
            />
          ) : null}
        </View>

        {isEmployeeRequest && row.acknowledgement_text ? (
          <InfoRow icon="edit-3" label="Declaration" value={row.acknowledgement_text} />
        ) : null}
        <InfoRow icon="user" label="Submitted by" value={`${row.requested_by_name || "—"} · ${formatDateTime(row.requested_at)}`} />
        {waitingForEmployee && row.decision_notes ? (
          <InfoRow icon="corner-up-left" label="Info asked for" value={row.decision_notes} tone={theme.warningText} />
        ) : null}
        {row.decided_at ? (
          <InfoRow
            icon="user-check"
            label={row.status === "CANCELLED" ? "Withdrawn" : "Decided by"}
            value={`${row.decided_by_name || "—"} · ${formatDateTime(row.decided_at)}${row.decision_notes ? ` · ${row.decision_notes}` : ""}`}
          />
        ) : null}

        {(row.risk_reasons ?? []).length ? (
          <View style={[s.chipWrap, { marginTop: 8 }]}>
            {(row.risk_reasons ?? []).map((reasonText, index) => (
              <View key={index} style={[s.riskChip, { backgroundColor: theme.warningBg }]}>
                <Feather name="alert-triangle" size={11} color={theme.warning} />
                <ThemedText style={{ fontSize: 12, color: theme.warningText }}>{reasonText}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}

        {events.length ? (
          <View style={[s.timeline, { borderTopColor: theme.border }]}>
            <ThemedText style={{ fontSize: 12, fontWeight: "800", color: theme.textSecondary, marginBottom: 2 }}>Timeline</ThemedText>
            {events.map((event, index) => (
              <View key={`${event.created_at}-${index}`} style={s.timelineRow}>
                <View style={[s.timelineDot, { backgroundColor: eventColor(String(event.event_type)) }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ThemedText style={{ fontSize: 13 }}>
                    <ThemedText style={{ fontSize: 13, fontWeight: "700" }}>{event.actor_name || "—"}</ThemedText>
                    {` · ${eventLabel(event)}`}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>{formatDateTime(event.created_at)} IST</ThemedText>
                  {event.notes ? (
                    <ThemedText style={{ fontSize: 12, marginTop: 2 }}>“{event.notes}”</ThemedText>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {msg ? (
          <ThemedText style={{ marginTop: 8, fontSize: 13, color: msg.tone === "error" ? theme.error : theme.success }}>{msg.text}</ThemedText>
        ) : null}

        {mode === "REVIEW" && isOpen ? (
          <View style={{ marginTop: 12, gap: 8 }}>
            {row.can_decide ? (
              <>
                <View style={s.reviewerLine}>
                  <Feather name="shield" size={13} color={theme.textSecondary} />
                  <ThemedText style={{ fontSize: 12, color: theme.textSecondary, flex: 1 }}>
                    You are reviewing as <ThemedText style={{ fontSize: 12, fontWeight: "800" }}>{user?.name || "—"}</ThemedText>
                  </ThemedText>
                </View>
                {waitingForEmployee ? (
                  <ThemedText style={{ fontSize: 12, color: theme.warningText }}>
                    Waiting for the employee to add the information. You can approve once they answer; you can still reject it now.
                  </ThemedText>
                ) : null}
                <TextInput
                  value={notesValue}
                  onChangeText={(text) => setDecisionNotes((prev) => ({ ...prev, [row.id]: text }))}
                  placeholder={
                    canReturn
                      ? "Reviewer remarks (required to reject or to ask for more information)"
                      : "Reviewer remarks (required to reject)"
                  }
                  placeholderTextColor={theme.textSecondary}
                  editable={!rowBusy}
                  multiline
                  style={[inputStyle, s.multilineSmall]}
                />
                <View style={s.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={anyBusy}
                    onPress={() => void runAction(row, "reject")}
                    style={[s.action, { borderColor: theme.error, opacity: anyBusy && !isBusy("reject") ? 0.5 : 1 }]}
                  >
                    {isBusy("reject") ? (
                      <ActivityIndicator size="small" color={theme.error} />
                    ) : (
                      <ThemedText style={{ color: theme.error, fontWeight: "800" }}>Reject</ThemedText>
                    )}
                  </Pressable>
                  {canReturn ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={anyBusy}
                      onPress={() => void runAction(row, "return")}
                      style={[s.action, { borderColor: ORANGE, opacity: anyBusy && !isBusy("return") ? 0.5 : 1 }]}
                    >
                      {isBusy("return") ? (
                        <ActivityIndicator size="small" color={ORANGE} />
                      ) : (
                        <ThemedText style={{ color: isDark ? ORANGE : theme.warningText, fontWeight: "800", textAlign: "center" }}>
                          Return for info
                        </ThemedText>
                      )}
                    </Pressable>
                  ) : null}
                  {canApprove ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={anyBusy}
                      onPress={() => void runAction(row, "approve")}
                      style={[
                        s.action,
                        { borderColor: theme.success, backgroundColor: theme.success, opacity: anyBusy && !isBusy("approve") ? 0.5 : 1 },
                      ]}
                    >
                      {isBusy("approve") ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <ThemedText style={{ color: "#FFFFFF", fontWeight: "800" }}>Approve</ThemedText>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : (
              <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
                {row.can_cancel
                  ? "You raised this, so another authorised person must decide it."
                  : "Another authorised person must decide this request."}
              </ThemedText>
            )}
            {row.can_cancel ? (
              <Pressable
                accessibilityRole="button"
                disabled={anyBusy}
                onPress={() => void runAction(row, "withdraw")}
                style={[s.action, { borderColor: theme.border, alignSelf: "flex-start", flexGrow: 0 }]}
              >
                {isBusy("withdraw") ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : (
                  <ThemedText style={{ color: theme.textSecondary, fontWeight: "700" }}>Withdraw</ThemedText>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const renderList = (
    rows: AttendanceCorrectionRow[],
    loading: boolean,
    error: string | null,
    mode: "REVIEW" | "HISTORY",
    retry: () => void,
  ) => {
    if (loading && rows.length === 0) return <ActivityIndicator style={{ marginTop: 24 }} color={theme.primary} />;
    if (error) {
      return (
        <View style={{ gap: 8 }}>
          <NoticeBox notice={{ tone: "error", title: error }} />
          <Pressable onPress={retry} style={[s.smallButton, { borderColor: theme.border, alignSelf: "flex-start" }]}>
            <ThemedText style={{ color: theme.primary, fontWeight: "700", fontSize: 13 }}>Try again</ThemedText>
          </Pressable>
        </View>
      );
    }
    if (rows.length === 0) {
      return (
        <View style={[s.empty, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <Feather name={mode === "REVIEW" ? "check-circle" : "inbox"} size={28} color={theme.textSecondary} />
          <ThemedText style={{ color: theme.textSecondary, textAlign: "center" }}>
            {mode === "REVIEW"
              ? "Nothing to review. New employee requests and HR corrections that need approval will appear here."
              : "No requests found for these filters."}
          </ThemedText>
        </View>
      );
    }
    return (
      <View style={{ opacity: loading ? 0.6 : 1 }}>
        {rows.map((row) => renderRowCard(row, mode))}
      </View>
    );
  };

  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: "REVIEW", label: "Requests to review", badge: counts?.pending },
    { key: "HISTORY", label: "History" },
    ...(canRecord ? [{ key: "NEW" as Tab, label: "Record for employee" }] : []),
  ];

  const summaryChips: Array<{
    key: string;
    label: string;
    value: number | undefined;
    icon: keyof typeof Feather.glyphMap;
    bg: string;
    fg: string;
    iconColor: string;
  }> = [
    { key: "pending", label: "Pending", value: counts?.pending, icon: "clock", bg: theme.warningBg, fg: theme.warningText, iconColor: theme.warning },
    { key: "needs_info", label: "Needs info", value: counts?.needs_info, icon: "corner-up-left", bg: ORANGE, fg: ON_ORANGE, iconColor: ON_ORANGE },
    { key: "applied", label: "Approved", value: counts?.applied, icon: "check-circle", bg: theme.successBg, fg: theme.successText, iconColor: theme.success },
    { key: "rejected", label: "Rejected", value: counts?.rejected, icon: "x-circle", bg: theme.errorBg, fg: theme.errorText, iconColor: theme.error },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          Platform.OS !== "web" ? (
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.primary} />
          ) : undefined
        }
      >
        <View style={s.inner}>
          <ThemedText style={s.title}>Regularization Requests</ThemedText>
          <ThemedText style={[s.subtitle, { color: theme.textSecondary }]}>
            Employee requests for days the app could not record, and corrections recorded by HR. Every decision is permanent and
            audited.
          </ThemedText>

          <View style={s.summaryRow}>
            {summaryChips.map((chip) => (
              <View key={chip.key} style={[s.summaryChip, { backgroundColor: chip.bg }]}>
                <Feather name={chip.icon} size={14} color={chip.iconColor} />
                <ThemedText style={{ fontSize: 13, color: chip.fg, fontWeight: "700" }}>
                  {chip.label}: {chip.value ?? "—"}
                </ThemedText>
              </View>
            ))}
            {Platform.OS === "web" ? (
              <Pressable onPress={() => void onRefresh()} style={[s.summaryChip, { borderWidth: 1, borderColor: theme.border }]}>
                {refreshing ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <Feather name="refresh-cw" size={14} color={theme.primary} />
                )}
                <ThemedText style={{ fontSize: 13, color: theme.primary, fontWeight: "700" }}>Refresh</ThemedText>
              </Pressable>
            ) : null}
          </View>

          <View style={[s.tabs, { backgroundColor: theme.backgroundSecondary }]}>
            {tabs.map((item) => {
              const active = tab === item.key;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTab(item.key)}
                  style={[s.tab, active && { backgroundColor: theme.backgroundDefault }]}
                >
                  <ThemedText
                    numberOfLines={2}
                    style={{ fontSize: 13, fontWeight: active ? "800" : "600", color: active ? theme.primary : theme.textSecondary, textAlign: "center" }}
                  >
                    {item.label}
                  </ThemedText>
                  {item.badge ? (
                    <View style={[s.badge, { backgroundColor: theme.warning }]}>
                      <ThemedText style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "800" }}>{item.badge}</ThemedText>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {notice ? <NoticeBox notice={notice} onClose={() => setNotice(null)} /> : null}

          {tab === "NEW" && canRecord ? renderForm() : null}

          {tab === "REVIEW" ? (
            <View>
              <PaginationControls page={reviewPage} pageSize={PAGE_SIZE} total={reviewTotal} onPageChange={setReviewPage} />
              {renderList(reviewRows, reviewLoading, reviewError, "REVIEW", () => void loadReview())}
            </View>
          ) : null}

          {tab === "HISTORY" ? (
            <View>
              <View style={[s.chipWrap, { marginBottom: 2 }]}>
                {ORIGIN_FILTERS.map((item) => (
                  <Chip
                    key={item.label}
                    label={item.label}
                    selected={historyOrigin === item.value}
                    onPress={() => {
                      setHistoryPage(0);
                      setHistoryOrigin(item.value);
                    }}
                  />
                ))}
              </View>
              <View style={s.row2}>
                <View style={[s.field, s.half]}>
                  <FieldLabel>From</FieldLabel>
                  <DateField
                    value={historyFrom}
                    onChange={(value) => {
                      setHistoryPage(0);
                      setHistoryFrom(value);
                    }}
                    onOpenNative={() => openPicker("histFrom")}
                    max={historyTo || today}
                    placeholder="Any date"
                  />
                </View>
                <View style={[s.field, s.half]}>
                  <FieldLabel>To</FieldLabel>
                  <DateField
                    value={historyTo}
                    onChange={(value) => {
                      setHistoryPage(0);
                      setHistoryTo(value);
                    }}
                    onOpenNative={() => openPicker("histTo")}
                    min={historyFrom || undefined}
                    max={today}
                    placeholder="Any date"
                  />
                </View>
              </View>
              {historyFrom || historyTo ? (
                <Pressable
                  onPress={() => {
                    setHistoryPage(0);
                    setHistoryFrom("");
                    setHistoryTo("");
                  }}
                  hitSlop={6}
                  style={{ alignSelf: "flex-start", marginBottom: 8 }}
                >
                  <ThemedText style={{ fontSize: 13, color: theme.primary, fontWeight: "700" }}>Clear dates</ThemedText>
                </Pressable>
              ) : null}
              <PaginationControls page={historyPage} pageSize={PAGE_SIZE} total={historyTotal} onPageChange={setHistoryPage} />
              {renderList(historyRows, historyLoading, historyError, "HISTORY", () => void loadHistory())}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {picker && Platform.OS === "android" ? (
        <DateTimePicker
          value={pickerDraft}
          mode={pickerMode}
          is24Hour
          minimumDate={pickerMin}
          maximumDate={pickerMax}
          onChange={onPickerChange}
        />
      ) : null}

      {picker && Platform.OS === "ios" ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setPicker(null)}>
          <View style={s.modalBackdrop}>
            <View style={[s.modalCard, { backgroundColor: theme.backgroundDefault }]}>
              <DateTimePicker
                value={pickerDraft}
                mode={pickerMode}
                display="spinner"
                is24Hour
                minimumDate={pickerMin}
                maximumDate={pickerMax}
                onChange={onPickerChange}
                themeVariant={isDark ? "dark" : "light"}
              />
              <View style={s.actions}>
                <Pressable onPress={() => setPicker(null)} style={[s.action, { borderColor: theme.border }]}>
                  <ThemedText style={{ color: theme.textSecondary, fontWeight: "700" }}>Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const target = picker;
                    setPicker(null);
                    applyPicker(target, pickerDraft);
                  }}
                  style={[s.action, { borderColor: theme.primary, backgroundColor: theme.primary }]}
                >
                  <ThemedText style={{ color: "#FFFFFF", fontWeight: "800" }}>Done</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  inner: { width: "100%", maxWidth: 760, alignSelf: "center" },
  title: { fontSize: 22, fontWeight: "800" },
  subtitle: { marginTop: 4, marginBottom: 12, fontSize: 14, lineHeight: 20 },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  summaryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    minHeight: 32,
    borderRadius: 16,
  },
  tabs: { flexDirection: "row", borderRadius: 12, padding: 4, gap: 4, marginBottom: 14 },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    flexDirection: "row",
    gap: 6,
  },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  field: { marginTop: 10 },
  fieldLabel: { fontSize: 13, fontWeight: "700", marginBottom: 6 },
  fieldError: { fontSize: 12, marginTop: 4 },
  hint: { fontSize: 12, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 16 },
  multiline: { minHeight: 96, paddingTop: 10, textAlignVertical: "top" },
  multilineSmall: { minHeight: 64, paddingTop: 10, textAlignVertical: "top" },
  pickerButton: { flexDirection: "row", alignItems: "center", gap: 8 },
  row2: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  half: { flexGrow: 1, flexBasis: 150, minWidth: 0 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  chipText: { fontSize: 13, fontWeight: "600" },
  selected: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  smallButton: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, minHeight: 34, justifyContent: "center" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 16, minHeight: 42, minWidth: 0 },
  results: { borderWidth: 1, borderRadius: 10, marginTop: 6, overflow: "hidden", maxHeight: 320 },
  resultRow: { paddingHorizontal: 12, paddingVertical: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 12, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: "800", marginBottom: 6 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 6 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12, marginBottom: 4 },
  ack: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 },
  submit: { minHeight: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 16 },
  rowCard: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 12, padding: 14, marginBottom: 10 },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  pill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  riskChip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  originBadge: { flexDirection: "row", alignItems: "center", gap: 5 },
  compare: { borderRadius: 8, padding: 10, marginTop: 10, gap: 4 },
  compareRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  compareLabel: { fontSize: 12, fontWeight: "700", width: 76 },
  evidenceBox: { borderWidth: 1, borderStyle: "dashed", borderRadius: 8, padding: 10, marginTop: 10 },
  timeline: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 10, gap: 8 },
  timelineRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  timelineDot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  reviewerLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    flexGrow: 1,
    flexBasis: 100,
    minHeight: 44,
    borderWidth: 1.5,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  empty: { borderWidth: 1, borderRadius: 12, padding: 28, alignItems: "center", gap: 10 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 32, gap: 12 },
});
