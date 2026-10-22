/**
 * Shared building blocks for the screens in the Reports tab, so every report
 * has the same filter bar, chips, and loading / error / empty states.
 * Purely presentational: no data fetching here.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { DateInput } from "@/components/DateInput";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import {
  addBusinessDays,
  businessMonthRange,
  businessMonthStart,
  getBusinessDateIST,
  isBusinessDate,
} from "@/utils/businessDate";

/** White/dark surface at the top of a report that holds its filters. */
export function ReportFilterBar({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.filterBar,
        { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function ReportSearch({
  value,
  onChangeText,
  placeholder = "Search employee",
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
      <Feather name="search" size={15} color={theme.textSecondary} />
      <TextInput
        style={[styles.searchInput, { color: theme.text }]}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={placeholder}
      />
      {value ? (
        <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => onChangeText("")}>
          <Feather name="x" size={15} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function ReportChip({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.primary : theme.backgroundSecondary,
          borderColor: active ? theme.primary : theme.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <ThemedText type="caption" style={{ color: active ? "#fff" : theme.text, fontWeight: "600" }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Wrapping row of chips (wraps instead of overflowing at 360px). */
export function ReportChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

/** Small square icon button used for Apply / Export in filter bars. */
export function ReportIconButton({
  icon,
  label,
  onPress,
  disabled,
  busy,
  tone = "primary",
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "primary" | "neutral";
}) {
  const { theme } = useTheme();
  const filled = tone === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        styles.iconBtn,
        {
          backgroundColor: filled ? theme.primary : theme.backgroundSecondary,
          borderColor: filled ? theme.primary : theme.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={filled ? "#fff" : theme.primary} />
      ) : (
        <Feather name={icon} size={16} color={filled ? "#fff" : theme.text} />
      )}
      <ThemedText type="caption" style={{ color: filled ? "#fff" : theme.text, fontWeight: "700" }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Month stepper: ‹ October 2026 ›. The next arrow is disabled past `maxMonth` ("YYYY-MM"). */
export function ReportMonthStepper({
  year,
  month,
  onChange,
  maxMonth,
}: {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
  maxMonth?: string;
}) {
  const { theme } = useTheme();
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const nextDisabled = !!maxMonth && key >= maxMonth;
  const label = new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const prev = () => (month === 1 ? onChange(year - 1, 12) : onChange(year, month - 1));
  const next = () => (month === 12 ? onChange(year + 1, 1) : onChange(year, month + 1));
  return (
    <View style={[styles.stepper, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}>
      <Pressable accessibilityLabel="Previous month" onPress={prev} hitSlop={6} style={styles.stepBtn}>
        <Feather name="chevron-left" size={20} color={theme.primary} />
      </Pressable>
      <ThemedText type="h4" style={styles.stepLabel}>{label}</ThemedText>
      <Pressable
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: nextDisabled }}
        disabled={nextDisabled}
        onPress={next}
        hitSlop={6}
        style={[styles.stepBtn, { opacity: nextDisabled ? 0.3 : 1 }]}
      >
        <Feather name="chevron-right" size={20} color={theme.primary} />
      </Pressable>
    </View>
  );
}

export type DateRange = { from: string; to: string };

/** Standard range presets, all on the IST business calendar. */
export function rangePresets(today: string = getBusinessDateIST()) {
  const lastMonthStart = businessMonthStart(today, -1);
  return [
    { key: "this_month", label: "This month", range: { from: businessMonthStart(today), to: today } },
    { key: "last_month", label: "Last month", range: { from: lastMonthStart, to: businessMonthRange(lastMonthStart).end } },
    { key: "last_30", label: "Last 30 days", range: { from: addBusinessDays(today, -29), to: today } },
  ];
}

export function isValidRange(range: DateRange): boolean {
  return isBusinessDate(range.from) && isBusinessDate(range.to) && range.from <= range.to;
}

/**
 * From / To fields with quick presets. Edits stay local until the user taps
 * Apply (or a preset), so queries never run on half-typed dates.
 */
export function ReportDateRange({
  applied,
  onApply,
  presets = rangePresets(),
  trailing,
}: {
  applied: DateRange;
  onApply: (range: DateRange) => void;
  presets?: Array<{ key: string; label: string; range: DateRange }>;
  trailing?: React.ReactNode;
}) {
  const { theme, isDark } = useTheme();
  const [draft, setDraft] = React.useState<DateRange>(applied);
  const [invalid, setInvalid] = React.useState(false);

  React.useEffect(() => {
    setDraft(applied);
    setInvalid(false);
  }, [applied.from, applied.to]);

  const apply = () => {
    if (!isValidRange(draft)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onApply(draft);
  };

  const inputStyle = [
    styles.dateInput,
    {
      backgroundColor: theme.backgroundSecondary,
      color: theme.text,
      borderColor: invalid ? theme.error : theme.border,
      colorScheme: isDark ? "dark" : "light",
    } as any,
  ];

  return (
    <View style={{ gap: Spacing.sm }}>
      <ReportChipRow>
        {presets.map((p) => (
          <ReportChip
            key={p.key}
            label={p.label}
            active={applied.from === p.range.from && applied.to === p.range.to}
            onPress={() => onApply(p.range)}
          />
        ))}
      </ReportChipRow>
      <View style={styles.dateRow}>
        <View style={styles.dateField}>
          <ThemedText type="caption" style={[styles.fieldLabel, { color: theme.textSecondary }]}>From</ThemedText>
          <DateInput
            value={draft.from}
            onChange={(from) => setDraft((d) => ({ ...d, from }))}
            style={inputStyle}
            placeholderTextColor={theme.textSecondary}
          />
        </View>
        <View style={styles.dateField}>
          <ThemedText type="caption" style={[styles.fieldLabel, { color: theme.textSecondary }]}>To</ThemedText>
          <DateInput
            value={draft.to}
            onChange={(to) => setDraft((d) => ({ ...d, to }))}
            style={inputStyle}
            placeholderTextColor={theme.textSecondary}
          />
        </View>
      </View>
      <View style={styles.actionRow}>
        <ReportIconButton icon="check" label="Apply" onPress={apply} />
        {trailing}
      </View>
      {invalid ? (
        <ThemedText type="caption" style={{ color: theme.error }}>
          Enter valid dates (YYYY-MM-DD) with From on or before To.
        </ThemedText>
      ) : null}
    </View>
  );
}

/** One line under the filters, e.g. "01 Oct – 15 Oct 2026 · 42 records". */
export function ReportMeta({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
      {children}
    </ThemedText>
  );
}

/** Centered loading / error / empty block used in every report body. */
export function ReportState({
  kind,
  title,
  message,
  onRetry,
  icon,
}: {
  kind: "loading" | "error" | "empty";
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  icon?: React.ComponentProps<typeof Feather>["name"];
}) {
  const { theme } = useTheme();
  if (kind === "loading") {
    return (
      <View style={styles.state}>
        <ActivityIndicator size="large" color={theme.primary} />
        {title ? (
          <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: Spacing.sm }}>{title}</ThemedText>
        ) : null}
      </View>
    );
  }
  const isError = kind === "error";
  const color = isError ? theme.error : theme.textSecondary;
  return (
    <View style={styles.state}>
      <View style={[styles.stateIcon, { backgroundColor: isError ? theme.errorBg : theme.backgroundSecondary }]}>
        <Feather name={icon ?? (isError ? "alert-circle" : "inbox")} size={24} color={color} />
      </View>
      <ThemedText type="h4" style={[styles.stateTitle, { color: isError ? theme.error : theme.text }]}>
        {title ?? (isError ? "Could not load this report" : "Nothing to show")}
      </ThemedText>
      {message ? (
        <ThemedText type="small" style={[styles.stateMessage, { color: theme.textSecondary }]}>{message}</ThemedText>
      ) : null}
      {onRetry ? (
        <View style={{ marginTop: Spacing.md }}>
          <ReportIconButton icon="refresh-cw" label="Try again" tone="neutral" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

/** Small inline notice (e.g. an export result) shown inside a filter bar. */
export function ReportNotice({
  kind,
  text,
  onDismiss,
}: {
  kind: "ok" | "info" | "error";
  text: string;
  onDismiss?: () => void;
}) {
  const { theme } = useTheme();
  const palette =
    kind === "error"
      ? { bg: theme.errorBg, fg: theme.errorText, icon: "alert-circle" as const }
      : kind === "ok"
        ? { bg: theme.successBg, fg: theme.successText, icon: "check-circle" as const }
        : { bg: theme.infoBg, fg: theme.infoText, icon: "info" as const };
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg }]}>
      <Feather name={palette.icon} size={14} color={palette.fg} />
      <ThemedText type="caption" style={{ color: palette.fg, flex: 1, fontWeight: "600" }}>{text}</ThemedText>
      {onDismiss ? (
        <Pressable accessibilityLabel="Dismiss" hitSlop={8} onPress={onDismiss}>
          <Feather name="x" size={14} color={palette.fg} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Friendly text for Supabase/permission errors. */
export function reportErrorMessage(e: any, fallback = "Please try again."): string {
  const msg = String(e?.message ?? e ?? "");
  if (/PERMISSION_REQUIRED|42501|permission denied/i.test(msg)) {
    return "You do not have permission to view this data. Ask HR to grant access.";
  }
  if (/Failed to fetch|Network request failed|NetworkError/i.test(msg)) {
    return "Network problem. Check your connection and try again.";
  }
  return msg || fallback;
}

const styles = StyleSheet.create({
  filterBar: { padding: Spacing.md, borderBottomWidth: 1, gap: Spacing.sm },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    minHeight: 40,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8, minWidth: 0 },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  iconBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 38,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.xs,
    minHeight: 42,
  },
  stepBtn: { padding: Spacing.sm },
  stepLabel: { flex: 1, textAlign: "center" },
  dateRow: { flexDirection: "row", gap: Spacing.sm },
  dateField: { flex: 1, minWidth: 0 },
  fieldLabel: { marginBottom: 4, fontWeight: "600" },
  dateInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    fontSize: 16, // iPhone Safari zooms into date inputs below 16px
    minHeight: 40,
  },
  actionRow: { flexDirection: "row", gap: Spacing.sm, flexWrap: "wrap" },
  state: { alignItems: "center", justifyContent: "center", paddingVertical: 48, paddingHorizontal: Spacing.xl },
  stateIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  stateTitle: { marginTop: Spacing.md, textAlign: "center" },
  stateMessage: { marginTop: 4, textAlign: "center", maxWidth: 420 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
});
