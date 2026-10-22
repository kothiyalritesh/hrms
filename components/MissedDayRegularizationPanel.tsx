import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { BorderRadius, Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { formatBusinessDate } from "@/utils/businessDate";
import { formatHrmsDateTime, formatHrmsTime } from "@/utils/attendanceTimestamp";
import {
  REGULARIZATION_EVIDENCE_TYPES,
  REGULARIZATION_REASONS,
  RegularizationRequestService,
  type RegularizationEvidenceType,
  type RegularizationPolicy,
  type RegularizationReasonCode,
  type RegularizationRequest,
} from "@/services/regularization-request.service";

type Props = {
  /** Business date (YYYY-MM-DD, IST) that is marked absent. */
  date: string;
  /** Called after a request is submitted, withdrawn or answered. */
  onChanged?: () => void;
};

const MAX_SHIFT_MS = 16 * 60 * 60 * 1000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  REGULARIZATION_REASONS.map((r) => [r.code, r.label]),
);
const EVIDENCE_LABEL: Record<string, string> = Object.fromEntries(
  REGULARIZATION_EVIDENCE_TYPES.map((r) => [r.code, r.label]),
);

const EVENT_LABEL: Record<string, string> = {
  SUBMITTED: "Request submitted",
  RETURNED_FOR_INFO: "HR asked for more information",
  INFO_PROVIDED: "Information added",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  APPLIED: "Attendance updated",
  WITHDRAWN: "Request withdrawn",
};

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

function istTimestamp(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00+05:30`;
}

function formatWeekdayDate(date: string): string {
  try {
    const weekday = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
    }).format(new Date(`${date}T12:00:00+05:30`));
    return `${weekday}, ${formatBusinessDate(date)}`;
  } catch {
    return formatBusinessDate(date);
  }
}

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as any)?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

/* ────────────────────────────────────────────────────────────────────────── */

export default function MissedDayRegularizationPanel({ date, onChanged }: Props) {
  const { theme, isDark } = useTheme();
  const [policy, setPolicy] = useState<RegularizationPolicy | null>(null);
  const [requests, setRequests] = useState<RegularizationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [parentRequestId, setParentRequestId] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [infoText, setInfoText] = useState("");
  const [busy, setBusy] = useState<"respond" | "withdraw" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const loadIdRef = useRef(0);
  const policyRef = useRef<RegularizationPolicy | null>(null);

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [nextPolicy, rows] = await Promise.all([
        policyRef.current
          ? Promise.resolve(policyRef.current)
          : RegularizationRequestService.policy(),
        RegularizationRequestService.myRequests(date, date),
      ]);
      if (loadId !== loadIdRef.current) return;
      policyRef.current = nextPolicy;
      setPolicy(nextPolicy);
      setRequests(rows.filter((row) => row.business_date === date));
    } catch (error) {
      if (loadId !== loadIdRef.current) return;
      setLoadError(errorMessage(error, "Regularization details could not be loaded."));
    } finally {
      if (loadId === loadIdRef.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      requests
        .filter((row) => row.status !== "CANCELLED")
        .sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at))),
    [requests],
  );
  const openRequest = visible.find(
    (row) => row.status === "PENDING_APPROVAL" || row.status === "NEEDS_INFO",
  );
  const latest = visible[0];
  const daysAgo = policy ? daysBetween(date, policy.today) : 0;
  const inFuture = policy ? daysAgo < 0 : false;
  const withinWindow = policy ? daysAgo >= 0 && daysAgo <= policy.window_days : false;

  const afterChange = async (note: string | null) => {
    setSuccessNote(note);
    await load();
    onChanged?.();
  };

  const respond = async (request: RegularizationRequest) => {
    if (busy || infoText.trim().length < 5) return;
    setBusy("respond");
    setActionError(null);
    try {
      const result = await RegularizationRequestService.respond(request.id, infoText);
      if (!result.success) {
        setActionError(result.message || "The information could not be sent.");
        return;
      }
      setInfoText("");
      await afterChange("Information sent. HR will continue the review.");
    } catch (error) {
      setActionError(errorMessage(error, "Network problem. Check your connection and try again."));
    } finally {
      setBusy(null);
    }
  };

  const doWithdraw = async (request: RegularizationRequest) => {
    setBusy("withdraw");
    setActionError(null);
    try {
      const result = await RegularizationRequestService.withdraw(request.id);
      if (!result.success) {
        setActionError(result.message || "The request could not be withdrawn.");
        return;
      }
      await afterChange("Request withdrawn.");
    } catch (error) {
      setActionError(errorMessage(error, "Network problem. Check your connection and try again."));
    } finally {
      setBusy(null);
    }
  };

  const withdraw = (request: RegularizationRequest) => {
    if (busy) return;
    Alert.alert(
      "Withdraw request?",
      "HR will no longer review this regularization request. The day stays absent.",
      [
        { text: "Keep request", style: "cancel" },
        { text: "Withdraw", style: "destructive", onPress: () => void doWithdraw(request) },
      ],
    );
  };

  const openForm = (parentId: string | null) => {
    setParentRequestId(parentId);
    setSuccessNote(null);
    setFormOpen(true);
  };

  const orange = isDark
    ? { bg: "#3A2208", fg: "#FDBA74" }
    : { bg: "#FFEDD5", fg: "#9A3412" };

  /* ── render pieces ── */

  const renderTimeline = (request: RegularizationRequest) =>
    request.events.length ? (
      <View style={styles.timeline}>
        {request.events.map((event, index) => (
          <View key={`${event.event_type}-${event.created_at}-${index}`} style={styles.timelineRow}>
            <View style={styles.timelineRail}>
              <View style={[styles.timelineDot, { backgroundColor: theme.primary }]} />
              {index < request.events.length - 1 ? (
                <View style={[styles.timelineLine, { backgroundColor: theme.border }]} />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: Spacing.sm }}>
              <ThemedText type="small" style={{ fontWeight: "600" }}>
                {EVENT_LABEL[event.event_type] ?? event.event_type}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {[event.actor_name, `${formatHrmsDateTime(event.created_at, "")} IST`]
                  .filter(Boolean)
                  .join(" · ")}
              </ThemedText>
              {event.notes ? (
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  “{event.notes}”
                </ThemedText>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    ) : null;

  const renderOpen = (request: RegularizationRequest) => {
    const needsInfo = request.status === "NEEDS_INFO";
    const pill = needsInfo
      ? { bg: orange.bg, fg: orange.fg, label: "More information needed", icon: "help-circle" as const }
      : { bg: theme.warningBg, fg: theme.warningText, label: "Waiting for HR review", icon: "clock" as const };
    const hrNote =
      request.decision_notes ||
      [...request.events].reverse().find((e) => e.event_type === "RETURNED_FOR_INFO")?.notes ||
      null;
    return (
      <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}>
        <View style={styles.cardHeader}>
          <ThemedText type="h4" style={{ flexShrink: 1 }}>
            Regularization request
          </ThemedText>
          <View style={[styles.pill, { backgroundColor: pill.bg }]}>
            <Feather name={pill.icon} size={12} color={pill.fg} />
            <ThemedText type="caption" style={{ color: pill.fg, fontWeight: "700" }}>
              {pill.label}
            </ThemedText>
          </View>
        </View>
        <DetailRow label="Requested time" value={`${formatHrmsTime(request.checkin_at, "—")} – ${formatHrmsTime(request.checkout_at, "—")}`} />
        <DetailRow label="Reason" value={REASON_LABEL[request.reason_code] ?? request.reason_code} />
        <DetailRow label="Submitted" value={`${formatHrmsDateTime(request.requested_at, "—")} IST`} />

        {needsInfo ? (
          <View style={[styles.noteBox, { backgroundColor: orange.bg }]}>
            <ThemedText type="small" style={{ color: orange.fg, fontWeight: "700" }}>
              HR's note
            </ThemedText>
            <ThemedText type="small" style={{ color: orange.fg }}>
              {hrNote || "HR asked for more information about this day."}
            </ThemedText>
          </View>
        ) : null}
        {needsInfo ? (
          <View style={{ gap: Spacing.sm }}>
            <TextInput
              value={infoText}
              onChangeText={setInfoText}
              placeholder="Write the information HR asked for"
              placeholderTextColor={theme.textTertiary}
              multiline
              editable={!busy}
              style={[styles.input, styles.multiline, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
            />
            <PrimaryButton
              label="Send information"
              icon="send"
              loading={busy === "respond"}
              disabled={!!busy || infoText.trim().length < 5}
              onPress={() => void respond(request)}
            />
          </View>
        ) : null}

        {renderTimeline(request)}

        {actionError ? <InlineError message={actionError} /> : null}

        <Pressable
          onPress={() => withdraw(request)}
          disabled={!!busy}
          hitSlop={8}
          accessibilityRole="button"
          style={styles.linkButton}
        >
          {busy === "withdraw" ? (
            <ActivityIndicator size="small" color={theme.error} />
          ) : (
            <Feather name="x-circle" size={14} color={theme.error} />
          )}
          <ThemedText type="small" style={{ color: theme.error, fontWeight: "600" }}>
            Withdraw request
          </ThemedText>
        </Pressable>
      </View>
    );
  };

  const renderRequestButton = (label: string, parentId: string | null) =>
    withinWindow ? (
      <PrimaryButton label={label} icon="edit-3" onPress={() => openForm(parentId)} />
    ) : (
      <View style={[styles.disabledBox, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}>
        <Feather name="lock" size={14} color={theme.textSecondary} />
        <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
          Requests can be raised for the last {policy?.window_days ?? 0} days. For older days contact HR.
        </ThemedText>
      </View>
    );

  let body: React.ReactNode;
  if (loading && !policy) {
    body = (
      <View style={styles.inlineRow}>
        <ActivityIndicator size="small" color={theme.primary} />
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Checking regularization requests…
        </ThemedText>
      </View>
    );
  } else if (loadError) {
    body = (
      <View style={{ gap: Spacing.sm }}>
        <InlineError message={loadError} />
        <Pressable onPress={() => void load()} style={styles.linkButton} accessibilityRole="button">
          <Feather name="refresh-cw" size={14} color={theme.primary} />
          <ThemedText type="small" style={{ color: theme.primary, fontWeight: "600" }}>
            Try again
          </ThemedText>
        </Pressable>
      </View>
    );
  } else if (inFuture) {
    body = null;
  } else if (openRequest) {
    body = renderOpen(openRequest);
  } else if (latest?.status === "APPLIED") {
    body = (
      <View style={[styles.banner, { backgroundColor: theme.successBg }]}>
        <Feather name="check-circle" size={16} color={theme.successText} />
        <View style={{ flex: 1 }}>
          <ThemedText type="small" style={{ color: theme.successText, fontWeight: "700" }}>
            Regularized{latest.decided_by_name ? ` — approved by ${latest.decided_by_name}` : ""}
          </ThemedText>
          {latest.decided_at ? (
            <ThemedText type="caption" style={{ color: theme.successText }}>
              {formatHrmsDateTime(latest.decided_at, "")} IST
            </ThemedText>
          ) : null}
        </View>
      </View>
    );
  } else if (latest?.status === "REJECTED") {
    body = (
      <View style={{ gap: Spacing.sm }}>
        <View style={[styles.banner, { backgroundColor: theme.errorBg }]}>
          <Feather name="x-circle" size={16} color={theme.errorText} />
          <View style={{ flex: 1 }}>
            <ThemedText type="small" style={{ color: theme.errorText, fontWeight: "700" }}>
              Request rejected{latest.decided_by_name ? ` by ${latest.decided_by_name}` : ""}
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.errorText }}>
              {latest.decision_notes || "No reason was given."}
            </ThemedText>
          </View>
        </View>
        {withinWindow ? renderRequestButton("Raise a new request", latest.id) : null}
      </View>
    );
  } else {
    body = (
      <View style={{ gap: Spacing.sm }}>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Couldn't mark attendance because of network, site or app problems? Ask HR to regularize this day.
        </ThemedText>
        {renderRequestButton("Request regularization", null)}
      </View>
    );
  }

  if (body === null && !successNote) return null;

  return (
    <View style={[styles.panel, { borderTopColor: theme.border }]}>
      {successNote ? (
        <View style={[styles.banner, { backgroundColor: theme.infoBg }]}>
          <Feather name="info" size={16} color={theme.infoText} />
          <ThemedText type="small" style={{ color: theme.infoText, flex: 1 }}>
            {successNote}
          </ThemedText>
          <Pressable onPress={() => setSuccessNote(null)} hitSlop={8} accessibilityLabel="Dismiss">
            <Feather name="x" size={14} color={theme.infoText} />
          </Pressable>
        </View>
      ) : null}
      {body}
      {policy ? (
        <RegularizationFormModal
          visible={formOpen}
          date={date}
          policy={policy}
          parentRequestId={parentRequestId}
          onClose={() => setFormOpen(false)}
          onSubmitted={() => {
            setFormOpen(false);
            void afterChange("Request sent. Your attendance changes only if HR approves it.");
          }}
        />
      ) : null}
    </View>
  );
}

/* ── Small building blocks ───────────────────────────────────────────────── */

function DetailRow({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.detailRow}>
      <ThemedText type="small" style={{ color: theme.textSecondary, width: 110 }}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={{ flex: 1, fontWeight: "600" }}>
        {value}
      </ThemedText>
    </View>
  );
}

function InlineError({ message }: { message: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: theme.errorBg }]}>
      <Feather name="alert-circle" size={16} color={theme.errorText} />
      <ThemedText type="small" style={{ color: theme.errorText, flex: 1 }}>
        {message}
      </ThemedText>
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading) }}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: theme.primary, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={theme.buttonText} />
      ) : (
        <Feather name={icon} size={16} color={theme.buttonText} />
      )}
      <ThemedText style={{ color: theme.buttonText, fontWeight: "700" }}>{label}</ThemedText>
    </Pressable>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: theme.primary, borderColor: theme.primary }
          : { backgroundColor: theme.backgroundDefault, borderColor: theme.border },
      ]}
    >
      {selected ? <Feather name="check" size={12} color={theme.buttonText} /> : null}
      <ThemedText type="small" style={{ color: selected ? theme.buttonText : theme.text, fontWeight: selected ? "700" : "500" }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function FieldLabel({ text, optional, hint }: { text: string; optional?: boolean; hint?: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 2, marginBottom: Spacing.xs }}>
      <ThemedText type="small" style={{ fontWeight: "700" }}>
        {text}
        {optional ? (
          <ThemedText type="small" style={{ color: theme.textSecondary, fontWeight: "400" }}>
            {" "}(optional)
          </ThemedText>
        ) : null}
      </ThemedText>
      {hint ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

function TimeField({
  value,
  onChange,
  onOpenNative,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onOpenNative: () => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const { theme, isDark } = useTheme();
  if (Platform.OS === "web") {
    return React.createElement("input", {
      type: "time",
      value: value || "",
      disabled,
      "aria-label": placeholder,
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
        colorScheme: isDark ? "dark" : "light",
      },
    });
  }
  return (
    <Pressable
      disabled={disabled}
      onPress={onOpenNative}
      accessibilityRole="button"
      accessibilityLabel={placeholder}
      style={[styles.input, styles.timeButton, { borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
    >
      <Feather name="clock" size={16} color={theme.primary} />
      <ThemedText style={{ color: value ? theme.text : theme.textTertiary }}>{value || placeholder}</ThemedText>
    </Pressable>
  );
}

/* ── Request form ────────────────────────────────────────────────────────── */

function RegularizationFormModal({
  visible,
  date,
  policy,
  parentRequestId,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  date: string;
  policy: RegularizationPolicy;
  parentRequestId: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isWide = width >= 720;
  const wideMaxHeight = Math.max(320, Math.round(height * 0.9));

  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [reason, setReason] = useState<RegularizationReasonCode | null>(null);
  const [siteName, setSiteName] = useState("");
  const [explanation, setExplanation] = useState("");
  const [evidenceType, setEvidenceType] = useState<RegularizationEvidenceType | null>(null);
  const [evidenceSource, setEvidenceSource] = useState("");
  const [evidenceDetails, setEvidenceDetails] = useState("");
  const [locationInfo, setLocationInfo] = useState("");
  const [declared, setDeclared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);
  const [employeeNumber, setEmployeeNumber] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  // Fresh form every time it opens.
  useEffect(() => {
    if (!visible) return;
    setCheckin("");
    setCheckout("");
    setReason(null);
    setSiteName("");
    setExplanation("");
    setEvidenceType(null);
    setEvidenceSource("");
    setEvidenceDetails("");
    setLocationInfo("");
    setDeclared(false);
    setSubmitError(null);
    setPickerFor(null);
    idempotencyKeyRef.current = null;
  }, [visible, date, parentRequestId]);

  // Employee number is not part of the auth user; read it from the own profile.
  useEffect(() => {
    if (!visible || !user?.id || employeeNumber !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("employee_number")
          .eq("id", user.id)
          .maybeSingle();
        const value = (data as any)?.employee_number;
        if (!cancelled) setEmployeeNumber(value != null && String(value).trim() ? String(value) : "");
      } catch {
        if (!cancelled) setEmployeeNumber("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, user?.id, employeeNumber]);

  const timeError = useMemo(() => {
    if (!TIME_RE.test(checkin) || !TIME_RE.test(checkout)) return null;
    const start = new Date(istTimestamp(date, checkin)).getTime();
    const end = new Date(istTimestamp(date, checkout)).getTime();
    if (end <= start) return "Check-out must be after check-in.";
    if (end - start > MAX_SHIFT_MS) return "Check-out must be within 16 hours of check-in.";
    if (start > Date.now() || end > Date.now()) return "Times cannot be in the future.";
    return null;
  }, [checkin, checkout, date]);

  const explanationOk = explanation.trim().length >= 15;
  const evidenceSourceOk = evidenceSource.trim().length >= 3;
  const valid =
    TIME_RE.test(checkin) &&
    TIME_RE.test(checkout) &&
    !timeError &&
    !!reason &&
    explanationOk &&
    !!evidenceType &&
    evidenceSourceOk &&
    declared;

  const submit = async () => {
    if (!valid || submitting || !reason || !evidenceType) return;
    setSubmitting(true);
    setSubmitError(null);
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = Crypto.randomUUID();
    try {
      const result = await RegularizationRequestService.submit({
        businessDate: date,
        checkinAt: istTimestamp(date, checkin),
        checkoutAt: istTimestamp(date, checkout),
        reasonCode: reason,
        explanation,
        evidenceType,
        evidenceSource,
        declared,
        declarationVersion: policy.declaration_version || "v1",
        idempotencyKey: idempotencyKeyRef.current,
        siteName,
        evidenceDetails,
        locationEvidence: locationInfo,
        parentRequestId,
      });
      if (!result.success) {
        setSubmitError(result.message || "The request could not be sent.");
        return;
      }
      idempotencyKeyRef.current = null;
      onSubmitted();
    } catch (error) {
      // Keep the idempotency key so a retry cannot create a duplicate request.
      setSubmitError(errorMessage(error, "Network problem. Check your connection and try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const pickerValue = (() => {
    const current = pickerFor === "in" ? checkin : checkout;
    const fallback = pickerFor === "in" ? "09:30" : "18:30";
    const [h, m] = (TIME_RE.test(current) ? current : fallback).split(":").map(Number);
    const value = new Date();
    value.setHours(h, m, 0, 0);
    return value;
  })();

  const applyPicked = (selected: Date) => {
    const hhmm = `${String(selected.getHours()).padStart(2, "0")}:${String(selected.getMinutes()).padStart(2, "0")}`;
    if (pickerFor === "in") setCheckin(hhmm);
    else if (pickerFor === "out") setCheckout(hhmm);
  };

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") {
      const target = pickerFor;
      setPickerFor(null);
      if (event.type !== "set" || !selected || !target) return;
      const hhmm = `${String(selected.getHours()).padStart(2, "0")}:${String(selected.getMinutes()).padStart(2, "0")}`;
      if (target === "in") setCheckin(hhmm);
      else setCheckout(hhmm);
      return;
    }
    if (selected) applyPicked(selected);
  };

  const inputStyle = [
    styles.input,
    { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundDefault },
  ];

  const sheetStyle = isWide
    ? [styles.sheetWide, { backgroundColor: theme.backgroundRoot, borderColor: theme.border, maxHeight: wideMaxHeight }]
    : [styles.sheetPhone, { backgroundColor: theme.backgroundRoot, paddingTop: insets.top }];

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isWide ? "fade" : "slide"}
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
    >
      <View style={[styles.backdrop, isWide ? styles.backdropWide : null]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={isWide ? styles.kavWide : styles.kavPhone}
        >
          <View style={sheetStyle}>
            <View style={[styles.sheetHeader, { borderBottomColor: theme.border, backgroundColor: theme.backgroundDefault }]}>
              <ThemedText type="h3" style={{ flex: 1 }}>
                Attendance Regularization Request
              </ThemedText>
              <Pressable
                onPress={onClose}
                disabled={submitting}
                hitSlop={10}
                accessibilityLabel="Close"
                style={styles.closeButton}
              >
                <Feather name="x" size={20} color={theme.text} />
              </Pressable>
            </View>

            <ScrollView
              style={isWide ? styles.scrollWide : styles.scrollPhone}
              contentContainerStyle={styles.sheetBody}
              keyboardShouldPersistTaps="handled"
            >
              {/* Read-only summary */}
              <View style={[styles.summary, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
                <DetailRow label="Date" value={formatWeekdayDate(date)} />
                <DetailRow label="Request type" value="Missed check-in and check-out" />
                <DetailRow
                  label="Employee"
                  value={[
                    user?.name || "—",
                    employeeNumber ? `#${employeeNumber}` : employeeNumber === null ? "…" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
                <View style={styles.inlineRow}>
                  <Feather name="lock" size={11} color={theme.textSecondary} />
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    Captured automatically
                  </ThemedText>
                </View>
              </View>

              {parentRequestId ? (
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  This is a new request after your earlier request for this day was rejected.
                </ThemedText>
              ) : null}

              {/* Times */}
              <View>
                <FieldLabel text="Requested check-in and check-out time" hint="India time (IST), on this date." />
                <View style={styles.timeRow}>
                  <View style={styles.timeCol}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 2 }}>
                      Check-in
                    </ThemedText>
                    <TimeField
                      value={checkin}
                      onChange={setCheckin}
                      onOpenNative={() => setPickerFor("in")}
                      placeholder="Check-in"
                      disabled={submitting}
                    />
                  </View>
                  <View style={styles.timeCol}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 2 }}>
                      Check-out
                    </ThemedText>
                    <TimeField
                      value={checkout}
                      onChange={setCheckout}
                      onOpenNative={() => setPickerFor("out")}
                      placeholder="Check-out"
                      disabled={submitting}
                    />
                  </View>
                </View>
                {pickerFor && Platform.OS !== "web" ? (
                  <View style={Platform.OS === "ios" ? [styles.iosPicker, { borderColor: theme.border, backgroundColor: theme.backgroundDefault }] : null}>
                    <DateTimePicker
                      value={pickerValue}
                      mode="time"
                      is24Hour
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={onPickerChange}
                    />
                    {Platform.OS === "ios" ? (
                      <Pressable onPress={() => setPickerFor(null)} style={styles.linkButton} accessibilityRole="button">
                        <ThemedText style={{ color: theme.primary, fontWeight: "700" }}>Done</ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {timeError ? (
                  <ThemedText type="small" style={{ color: theme.error, marginTop: Spacing.xs }}>
                    {timeError}
                  </ThemedText>
                ) : null}
              </View>

              {/* Reason */}
              <View>
                <FieldLabel text="Reason" />
                <View style={styles.chipWrap}>
                  {REGULARIZATION_REASONS.map((item) => (
                    <Chip
                      key={item.code}
                      label={item.label}
                      selected={reason === item.code}
                      onPress={() => setReason(item.code)}
                    />
                  ))}
                </View>
              </View>

              <View>
                <FieldLabel text="Project / site details" optional />
                <TextInput
                  value={siteName}
                  onChangeText={setSiteName}
                  placeholder="Project name and site address"
                  placeholderTextColor={theme.textTertiary}
                  style={inputStyle}
                  maxLength={200}
                />
              </View>

              <View>
                <FieldLabel text="Explanation" hint="What happened and why attendance could not be marked (at least 15 characters)." />
                <TextInput
                  value={explanation}
                  onChangeText={setExplanation}
                  placeholder="Describe what happened that day"
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  style={[...inputStyle, styles.multiline]}
                  maxLength={2000}
                />
                {explanation.length > 0 && !explanationOk ? (
                  <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>
                    {15 - explanation.trim().length} more characters needed
                  </ThemedText>
                ) : null}
              </View>

              {/* Evidence */}
              <View>
                <FieldLabel text="Supporting evidence" />
                <View style={styles.chipWrap}>
                  {REGULARIZATION_EVIDENCE_TYPES.map((item) => (
                    <Chip
                      key={item.code}
                      label={item.label}
                      selected={evidenceType === item.code}
                      onPress={() => setEvidenceType(item.code)}
                    />
                  ))}
                </View>
              </View>

              <View>
                <FieldLabel text="Where HR can find it" hint="Who or where HR can check it." />
                <TextInput
                  value={evidenceSource}
                  onChangeText={setEvidenceSource}
                  placeholder="e.g. WhatsApp to Rakesh (manager), 9:40 AM"
                  placeholderTextColor={theme.textTertiary}
                  style={inputStyle}
                  maxLength={300}
                />
              </View>

              <View>
                <FieldLabel text="Evidence details" optional />
                <TextInput
                  value={evidenceDetails}
                  onChangeText={setEvidenceDetails}
                  placeholder="Anything else that helps HR verify"
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  style={[...inputStyle, styles.multilineSmall]}
                  maxLength={1000}
                />
              </View>

              <View>
                <FieldLabel
                  text="Location information"
                  optional
                  hint="Reference the location you shared (source and time). Do not invent GPS coordinates."
                />
                <TextInput
                  value={locationInfo}
                  onChangeText={setLocationInfo}
                  placeholder="e.g. Live location shared in team WhatsApp group at 10:05 AM"
                  placeholderTextColor={theme.textTertiary}
                  style={inputStyle}
                  maxLength={500}
                />
              </View>

              {/* Declaration */}
              <Pressable
                onPress={() => setDeclared((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: declared }}
                style={[styles.declaration, { borderColor: declared ? theme.primary : theme.border, backgroundColor: theme.backgroundDefault }]}
              >
                <Feather name={declared ? "check-square" : "square"} size={20} color={declared ? theme.primary : theme.textSecondary} />
                <ThemedText type="small" style={{ flex: 1 }}>
                  {policy.declaration_text}
                </ThemedText>
              </Pressable>

              {submitError ? <InlineError message={submitError} /> : null}
            </ScrollView>

            <View
              style={[
                styles.sheetFooter,
                {
                  borderTopColor: theme.border,
                  backgroundColor: theme.backgroundDefault,
                  paddingBottom: (isWide ? 0 : insets.bottom) + Spacing.md,
                },
              ]}
            >
              <Pressable
                onPress={onClose}
                disabled={submitting}
                accessibilityRole="button"
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <ThemedText style={{ fontWeight: "600" }}>Cancel</ThemedText>
              </Pressable>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label="Submit request"
                  icon="send"
                  loading={submitting}
                  disabled={!valid}
                  onPress={() => void submit()}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: 999,
  },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm },
  noteBox: { borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: 2 },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
  },
  disabledBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
  },
  timeline: { marginTop: Spacing.xs },
  timelineRow: { flexDirection: "row", gap: Spacing.sm },
  timelineRail: { width: 12, alignItems: "center" },
  timelineDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  timelineLine: { width: 2, flex: 1, marginTop: 2 },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    alignSelf: "flex-start",
    paddingVertical: Spacing.xs,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === "web" ? 10 : 8,
    fontSize: 16,
  },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  multilineSmall: { minHeight: 64, textAlignVertical: "top" },
  timeRow: { flexDirection: "row", gap: Spacing.sm },
  timeCol: { flex: 1, minWidth: 0 },
  timeButton: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  iosPicker: {
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  backdropWide: { alignItems: "center", justifyContent: "center", padding: Spacing.xl },
  kavPhone: { flex: 1 },
  kavWide: { width: "100%", maxWidth: 640 },
  scrollPhone: { flex: 1 },
  scrollWide: { flexGrow: 0, flexShrink: 1 },
  sheetPhone: { flex: 1, overflow: "hidden" },
  sheetWide: {
    width: "100%",
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: { padding: Spacing.xs },
  sheetBody: { padding: Spacing.lg, gap: Spacing.lg },
  summary: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.xs },
  declaration: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  sheetFooter: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
