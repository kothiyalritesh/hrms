import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import Spacer from "@/components/Spacer";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { BorderRadius, Colors, Spacing } from "@/constants/theme";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import {
  LeaveApplication,
  LeaveBalance,
  LeaveService,
  LeaveStatus,
  LeaveType,
} from "@/services/leave.service";

const TYPE_LABELS: Record<LeaveType, string> = {
  sick: "Sick Leave",
  casual: "Casual Leave",
  earned: "Earned Leave",
  wfh: "Work From Home",
  comp_off: "Comp Off",
};
const STATUS: Record<LeaveStatus, { bg: string; text: string }> = {
  pending: { bg: Colors.light.warningBg, text: Colors.light.warningText },
  approved: { bg: Colors.light.successBg, text: Colors.light.successText },
  rejected: { bg: Colors.light.errorBg, text: Colors.light.errorText },
  cancelled: { bg: "#F3F4F6", text: "#6B7280" },
};
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const todayIso = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const displayDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

type FormState = {
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  isHalfDay: boolean;
  halfDayPeriod: "FIRST_HALF" | "SECOND_HALF";
};
const initialForm = (businessDate = todayIso()): FormState => ({
  type: "casual",
  startDate: businessDate,
  endDate: businessDate,
  reason: "",
  isHalfDay: false,
  halfDayPeriod: "FIRST_HALF",
});

export default function LeaveScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [balance, setBalance] = useState<LeaveBalance>({
    sick: 0,
    casual: 0,
    earned: 0,
    comp_off: 0,
  });
  const [holidays, setHolidays] = useState<any[]>([]);
  const [weeklyOffs, setWeeklyOffs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showApply, setShowApply] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm());
  const [businessDate, setBusinessDate] = useState(todayIso());
  const [picker, setPicker] = useState<"startDate" | "endDate" | null>(null);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const serverDate = await LeaveService.getBusinessDate();
      const year = Number(serverDate.slice(0, 4));
      const [items, balances, calendar] = await Promise.all([
        LeaveService.getUserLeaves(user.id),
        LeaveService.getBalance(user.id),
        LeaveService.getCalendar(user.id, `${year}-01-01`, `${year + 1}-12-31`),
      ]);
      setLeaves(items);
      setBalance(balances);
      setHolidays(calendar.holidays);
      setWeeklyOffs(calendar.weeklyOffs);
      setBusinessDate(serverDate);
    } catch (error: any) {
      Alert.alert(
        "Unable to load leave data",
        error?.message ?? "Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );
  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const availableTypes = useMemo(
    () =>
      (["casual", "sick", "earned", "wfh"] as LeaveType[]).concat(
        balance.comp_off > 0 ? ["comp_off"] : [],
      ),
    [balance.comp_off],
  );
  const upcomingHolidays = useMemo(
    () => holidays.filter((h) => h.holiday_date >= businessDate).slice(0, 8),
    [holidays, businessDate],
  );

  const onDateChange = (_event: DateTimePickerEvent, selected?: Date) => {
    const target = picker;
    setPicker(null);
    if (!target || !selected) return;
    const value = toIsoDate(selected);
    setForm((old) => {
      if (target === "startDate")
        return {
          ...old,
          startDate: value,
          endDate: old.endDate < value ? value : old.endDate,
        };
      return { ...old, endDate: value };
    });
  };

  const submit = async () => {
    if (!user?.id || submitting) return;
    if (form.endDate < form.startDate)
      return Alert.alert(
        "Invalid dates",
        "End date must be on or after start date.",
      );
    if (form.reason.trim().length < 3)
      return Alert.alert(
        "Reason required",
        "Please enter a meaningful reason.",
      );
    setSubmitting(true);
    const result = await LeaveService.submitLeave(user.id, {
      type: form.type,
      startDate: form.startDate,
      endDate: form.endDate,
      reason: form.reason,
      isHalfDay: form.isHalfDay,
      halfDayPeriod: form.isHalfDay ? form.halfDayPeriod : undefined,
    });
    setSubmitting(false);
    if (!result.success)
      return Alert.alert(
        "Leave not submitted",
        result.message ?? "Please check the details and try again.",
      );
    setShowApply(false);
    setForm(initialForm(businessDate));
    await loadData();
    Alert.alert(
      "Request submitted",
      `${result.requested_days ?? ""} day(s) sent to HR for approval.`,
    );
  };

  const cancel = (leave: LeaveApplication) =>
    Alert.alert(
      "Cancel leave request?",
      "This pending request will be cancelled.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel request",
          style: "destructive",
          onPress: async () => {
            if (!user?.id) return;
            const result = await LeaveService.cancel(leave.id, user.id);
            if (!result.success)
              return Alert.alert(
                "Cannot cancel",
                result.message ?? "Please try again.",
              );
            await loadData();
          },
        },
      ],
    );

  const dateField = (key: "startDate" | "endDate", label: string) => (
    <View style={{ flex: 1 }}>
      <ThemedText type="small" style={styles.label}>
        {label}
      </ThemedText>
      {Platform.OS === "web" ? (
        <TextInput
          style={[
            styles.input,
            { backgroundColor: theme.backgroundSecondary, color: theme.text },
          ]}
          value={form[key]}
          onChangeText={(value) => setForm((old) => ({ ...old, [key]: value }))}
          placeholder="YYYY-MM-DD"
        />
      ) : (
        <Pressable
          style={[
            styles.input,
            styles.dateButton,
            { backgroundColor: theme.backgroundSecondary },
          ]}
          onPress={() => setPicker(key)}
        >
          <Feather name="calendar" size={16} color={theme.primary} />
          <ThemedText>{displayDate(form[key])}</ThemedText>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <PageHeader
        title="Leave History"
        subtitle={`${leaves.filter((l) => l.status === "pending").length} pending approval`}
        rightIcon="plus"
        rightLabel="Apply"
        onRightPress={() => setShowApply(true)}
      />
      <ScreenScrollView
        noPaddingTop
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
          />
        }
        contentContainerStyle={styles.content}
      >
        <Spacer height={Spacing.lg} />
        <ThemedText type="h4" style={styles.sectionTitle}>
          Available balance
        </ThemedText>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.balanceRow}
        >
          {(["casual", "sick", "earned", "comp_off"] as const).map((type) => (
            <View
              key={type}
              style={[
                styles.balanceCard,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {TYPE_LABELS[type]}
              </ThemedText>
              <ThemedText type="h2" style={{ color: theme.primary }}>
                {balance[type]}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                days
              </ThemedText>
            </View>
          ))}
        </ScrollView>

        <ThemedText type="h4" style={styles.sectionTitle}>
          My leave applications
        </ThemedText>
        {loading ? (
          <ActivityIndicator color={theme.primary} />
        ) : leaves.length === 0 ? (
          <View
            style={[styles.empty, { backgroundColor: theme.backgroundDefault }]}
          >
            <Feather name="calendar" size={36} color={theme.textSecondary} />
            <ThemedText style={{ color: theme.textSecondary }}>
              No leave applications yet
            </ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {leaves.map((leave) => {
              const status = STATUS[leave.status] ?? STATUS.pending;
              return (
                <View
                  key={leave.id}
                  style={[
                    styles.card,
                    { backgroundColor: theme.backgroundDefault },
                  ]}
                >
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={styles.cardTitle}>
                        {TYPE_LABELS[leave.leave_type] ?? leave.leave_type}
                      </ThemedText>
                      <ThemedText
                        type="caption"
                        style={{ color: theme.textSecondary }}
                      >
                        {displayDate(leave.start_date)} -{" "}
                        {displayDate(leave.end_date)} ·{" "}
                        {leave.requested_days ?? "-"} day(s)
                        {leave.is_half_day
                          ? ` · ${leave.half_day_period === "FIRST_HALF" ? "First half" : "Second half"}`
                          : ""}
                      </ThemedText>
                    </View>
                    <View
                      style={[styles.badge, { backgroundColor: status.bg }]}
                    >
                      <ThemedText
                        type="caption"
                        style={{ color: status.text, fontWeight: "700" }}
                      >
                        {leave.status.toUpperCase()}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary, marginTop: 7 }}
                  >
                    {leave.reason}
                  </ThemedText>
                  {leave.rejection_reason ? (
                    <ThemedText type="caption" style={styles.rejected}>
                      HR: {leave.rejection_reason}
                    </ThemedText>
                  ) : null}
                  {leave.status === "pending" ? (
                    <Pressable
                      onPress={() => cancel(leave)}
                      style={styles.cancelButton}
                    >
                      <ThemedText
                        type="caption"
                        style={{ color: Colors.light.error, fontWeight: "700" }}
                      >
                        Cancel request
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        <ThemedText type="h4" style={styles.sectionTitle}>
          Company calendar
        </ThemedText>
        <View
          style={[
            styles.calendarCard,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <View style={styles.calendarHeading}>
            <Feather name="repeat" size={17} color={theme.primary} />
            <ThemedText style={styles.cardTitle}>Weekly offs</ThemedText>
          </View>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {weeklyOffs.length
              ? weeklyOffs
                  .map(
                    (r) =>
                      `${r.week_of_month ? `${r.week_of_month}${r.week_of_month === 1 ? "st" : r.week_of_month === 2 ? "nd" : r.week_of_month === 3 ? "rd" : "th"} ` : "Every "}${DAY_NAMES[r.weekday]}`,
                  )
                  .join(", ")
              : "No weekly-off rule assigned"}
          </ThemedText>
        </View>
        {upcomingHolidays.length ? (
          upcomingHolidays.map((holiday) => (
            <View
              key={holiday.id}
              style={[
                styles.holidayRow,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <View style={styles.dateTile}>
                <ThemedText type="caption" style={{ color: theme.primary }}>
                  {new Date(`${holiday.holiday_date}T00:00:00`)
                    .toLocaleDateString("en-IN", { month: "short" })
                    .toUpperCase()}
                </ThemedText>
                <ThemedText type="h3">
                  {holiday.holiday_date.slice(8)}
                </ThemedText>
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.cardTitle}>{holiday.name}</ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  {displayDate(holiday.holiday_date)}
                  {holiday.is_optional ? " · Optional" : ""}
                </ThemedText>
              </View>
            </View>
          ))
        ) : (
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            No upcoming holidays configured.
          </ThemedText>
        )}
        <Spacer height={Spacing["2xl"]} />
      </ScreenScrollView>

      <Modal
        visible={showApply}
        animationType="slide"
        transparent
        onRequestClose={() => setShowApply(false)}
      >
        <View style={styles.overlay}>
          <ThemedView
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + Spacing.md },
            ]}
          >
            <View style={styles.sheetHeader}>
              <ThemedText type="h3">Apply for leave</ThemedText>
              <Pressable onPress={() => setShowApply(false)}>
                <Feather name="x" size={22} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.form}
              keyboardShouldPersistTaps="handled"
            >
              <ThemedText type="small" style={styles.label}>
                Leave type
              </ThemedText>
              <View style={styles.chips}>
                {availableTypes.map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => setForm((old) => ({ ...old, type }))}
                    style={[
                      styles.chip,
                      {
                        backgroundColor:
                          form.type === type
                            ? theme.primary
                            : theme.backgroundSecondary,
                      },
                    ]}
                  >
                    <ThemedText
                      type="caption"
                      style={{
                        color: form.type === type ? "#fff" : theme.text,
                        fontWeight: "600",
                      }}
                    >
                      {TYPE_LABELS[type]}
                      {type !== "wfh" ? ` (${balance[type]})` : ""}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <View style={styles.dateRow}>
                {dateField("startDate", "Start date")}
                {dateField("endDate", "End date")}
              </View>
              <Pressable
                style={[
                  styles.toggle,
                  {
                    borderColor: form.isHalfDay ? theme.primary : theme.border,
                  },
                ]}
                onPress={() =>
                  setForm((old) => ({
                    ...old,
                    isHalfDay: !old.isHalfDay,
                    endDate: old.startDate,
                  }))
                }
              >
                <Feather
                  name={form.isHalfDay ? "check-square" : "square"}
                  size={18}
                  color={form.isHalfDay ? theme.primary : theme.textSecondary}
                />
                <ThemedText>Half-day leave</ThemedText>
              </Pressable>
              {form.isHalfDay ? (
                <View style={styles.chips}>
                  {(["FIRST_HALF", "SECOND_HALF"] as const).map((period) => (
                    <Pressable
                      key={period}
                      style={[
                        styles.chip,
                        {
                          backgroundColor:
                            form.halfDayPeriod === period
                              ? theme.primary
                              : theme.backgroundSecondary,
                        },
                      ]}
                      onPress={() =>
                        setForm((old) => ({ ...old, halfDayPeriod: period }))
                      }
                    >
                      <ThemedText
                        type="caption"
                        style={{
                          color:
                            form.halfDayPeriod === period ? "#fff" : theme.text,
                        }}
                      >
                        {period === "FIRST_HALF" ? "First half" : "Second half"}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <ThemedText type="small" style={styles.label}>
                Reason *
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  styles.reason,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={form.reason}
                onChangeText={(reason) =>
                  setForm((old) => ({ ...old, reason }))
                }
                placeholder="Why do you need leave?"
                placeholderTextColor={theme.textSecondary}
                multiline
              />
              <Button onPress={submit} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit for approval"}
              </Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
      {picker ? (
        <DateTimePicker
          value={new Date(`${form[picker]}T00:00:00`)}
          mode="date"
          minimumDate={new Date(new Date().setHours(0, 0, 0, 0))}
          onChange={onDateChange}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg },
  sectionTitle: { marginTop: Spacing.lg, marginBottom: Spacing.sm },
  balanceRow: { gap: 10, paddingRight: 16 },
  balanceCard: { width: 118, padding: 14, borderRadius: 14 },
  list: { gap: 10 },
  card: { padding: 14, borderRadius: 14 },
  cardTop: { flexDirection: "row", gap: 10 },
  cardTitle: { fontWeight: "700" },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    alignSelf: "flex-start",
  },
  rejected: { color: Colors.light.error, marginTop: 7 },
  cancelButton: { alignSelf: "flex-end", marginTop: 9, paddingVertical: 5 },
  empty: { padding: 28, borderRadius: 14, alignItems: "center", gap: 10 },
  calendarCard: { padding: 14, borderRadius: 14, marginBottom: 8 },
  calendarHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 5,
  },
  holidayRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 14,
    marginBottom: 7,
    gap: 12,
  },
  dateTile: {
    width: 48,
    alignItems: "center",
    paddingVertical: 5,
    borderRadius: 9,
    backgroundColor: "#F5EAF5",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128,128,128,.18)",
  },
  form: { padding: Spacing.lg, gap: 14 },
  label: { fontWeight: "600", marginBottom: -7 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
  },
  dateRow: { flexDirection: "row", gap: 10 },
  input: {
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  dateButton: { flexDirection: "row", alignItems: "center", gap: 8 },
  reason: { height: 96, paddingTop: 12, textAlignVertical: "top" },
  toggle: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
});
