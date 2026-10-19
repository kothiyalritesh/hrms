import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/lib/supabase";
import { fetchAllPages } from "@/utils/supabasePagination";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { isBusinessDate } from "@/utils/businessDate";
import { getBusinessDateIST } from "@/utils/attendanceTimestamp";
import { DateInput } from "@/components/DateInput";
import { SearchableSelect, SelectOption } from "@/components/SearchableSelect";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const WEEK_OPTIONS = [
  { label: "Every week", value: "" },
  { label: "1st week", value: "1" },
  { label: "2nd week", value: "2" },
  { label: "3rd week", value: "3" },
  { label: "4th week", value: "4" },
  { label: "5th week", value: "5" },
];
const validDate = isBusinessDate;
const scopeColumns = (scope: string) => {
  const [kind, id] = scope.split(":", 2);
  return {
    office_id: kind === "office" ? id : null,
    team_id: kind === "team" ? id : null,
    user_id: kind === "user" ? id : null,
  };
};

export default function AttendanceCalendarScreen() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [holidayScope, setHolidayScope] = useState("all");
  const [optional, setOptional] = useState(false);
  const [ruleScope, setRuleScope] = useState("all");
  const [weekday, setWeekday] = useState(0);
  const [weekOfMonth, setWeekOfMonth] = useState("");
  const [validFrom, setValidFrom] = useState(getBusinessDateIST());
  const [validTo, setValidTo] = useState("");
  const [saving, setSaving] = useState<null | "holiday" | "weekly">(null);

  const scopeOptions = useMemo<SelectOption[]>(
    () => [
      { value: "all", label: "All employees", subtitle: "Company-wide", icon: "globe" },
      ...offices.map((o) => ({ value: `office:${o.id}`, label: o.name, group: "Offices", icon: "home" as const })),
      ...teams.map((t) => ({ value: `team:${t.id}`, label: t.name, group: "Teams", icon: "users" as const })),
      ...employees.map((p) => ({
        value: `user:${p.id}`,
        label: p.name,
        subtitle: p.employee_number ? `Emp. no. ${p.employee_number}` : undefined,
        group: "Employees",
        icon: "user" as const,
      })),
    ],
    [offices, teams, employees],
  );
  const scopeLabel = (row: any) =>
    row.profiles?.name
      ? `Employee · ${row.profiles.name}`
      : row.teams?.name
        ? `Team · ${row.teams.name}`
        : row.offices?.name
          ? `Office · ${row.offices.name}`
          : "All employees";

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [h, w, o, t, p] = await Promise.all([
      fetchAllPages<any>((from, to) => supabase
        .from("holiday_calendar")
        .select("id,holiday_date,name,is_optional,office_id,team_id,user_id,is_active,created_at,offices(name),teams(name),profiles:user_id(name)")
        .eq("is_active", true)
        .order("holiday_date").order("id").range(from, to)),
      fetchAllPages<any>((from, to) => supabase
        .from("weekly_off_rules")
        .select("id,weekday,week_of_month,office_id,team_id,user_id,is_active,valid_from,valid_to,created_at,offices(name),teams(name),profiles:user_id(name)")
        .eq("is_active", true)
        .order("weekday").order("id").range(from, to)),
      fetchAllPages<any>((from, to) => supabase
        .from("offices")
        .select("id,name")
        .eq("is_active", true)
        .order("name").order("id").range(from, to)),
      fetchAllPages<any>((from, to) => supabase
        .from("teams")
        .select("id,name")
        .eq("is_active", true)
        .order("name").order("id").range(from, to)),
      fetchAllPages<any>((from, to) => supabase
        .from("profiles")
        .select("id,name,employee_number")
        .eq("is_active", true)
        .order("name").order("id").range(from, to)),
    ]);
    if (h.error || w.error || o.error || t.error || p.error)
      Alert.alert(
        "Calendar error",
        h.error?.message ||
          w.error?.message ||
          o.error?.message ||
          t.error?.message ||
          p.error?.message ||
          "Unable to load calendar.",
      );
    setHolidays(h.data ?? []);
    setRules(w.data ?? []);
    setOffices(o.data ?? []);
    setTeams(t.data ?? []);
    setEmployees(p.data ?? []);
    setLoading(false);
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const addHoliday = async () => {
    if (!validDate(date))
      return Alert.alert(
        "Invalid date",
        "Enter the holiday date as YYYY-MM-DD.",
      );
    if (name.trim().length < 2)
      return Alert.alert("Holiday name required", "Enter the holiday name.");
    if (saving) return;
    setSaving("holiday");
    const { data, error } = await supabase.rpc(
      "rpc_admin_mutate_configuration",
      {
        p_entity: "HOLIDAY",
        p_action: "CREATE",
        p_id: null,
        p_values: {
          holiday_date: date,
          name: name.trim(),
          ...scopeColumns(holidayScope),
          is_optional: optional,
        },
      },
    );
    setSaving(null);
    if (error)
      return Alert.alert(
        "Unable to add holiday",
        error.code === "23505"
          ? "A holiday already exists for this date and scope."
          : error.message,
      );
    const response = firstRpcRow<any>(data);
    if (response?.success !== true || !response?.id)
      return Alert.alert(
        "Unable to add holiday",
        "The server did not confirm the holiday.",
      );
    const added = `${name.trim()} on ${date}`;
    setDate("");
    setName("");
    setOptional(false);
    await load(true);
    Alert.alert("Holiday added", added);
  };
  const addWeeklyOff = async () => {
    if (!validDate(validFrom))
      return Alert.alert("Invalid start date", "Enter Valid from as YYYY-MM-DD.");
    if (validTo && (!validDate(validTo) || validTo < validFrom))
      return Alert.alert(
        "Invalid end date",
        "Valid to must be YYYY-MM-DD and cannot be before Valid from.",
      );
    const target = scopeColumns(ruleScope);
    const duplicate = rules.some(
      (r) =>
        r.office_id === target.office_id &&
        r.team_id === target.team_id &&
        r.user_id === target.user_id &&
        r.weekday === weekday &&
        String(r.week_of_month ?? "") === weekOfMonth,
    );
    if (duplicate)
      return Alert.alert(
        "Rule already exists",
        `${DAYS[weekday]} is already a weekly off for this scope. Pick another day, recurrence or "Applies to".`,
      );
    if (saving) return;
    setSaving("weekly");
    const { data, error } = await supabase.rpc(
      "rpc_admin_mutate_configuration",
      {
        p_entity: "WEEKLY_OFF",
        p_action: "CREATE",
        p_id: null,
        p_values: {
          ...target,
          weekday,
          week_of_month: weekOfMonth || null,
          valid_from: validFrom,
          valid_to: validTo || null,
        },
      },
    );
    setSaving(null);
    if (error) return Alert.alert("Unable to add weekly off", error.message);
    const response = firstRpcRow<any>(data);
    if (response?.success !== true || !response?.id)
      return Alert.alert(
        "Unable to add weekly off",
        "The server did not confirm the weekly-off rule.",
      );
    setValidTo("");
    await load(true);
    Alert.alert("Weekly off added", `${DAYS[weekday]} from ${validFrom}`);
  };
  const remove = (
    table: "holiday_calendar" | "weekly_off_rules",
    id: string,
    label: string,
  ) =>
    Alert.alert("Remove calendar rule?", label, [
      { text: "Keep", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const { data, error } = await supabase.rpc(
            "rpc_admin_mutate_configuration",
            {
              p_entity:
                table === "weekly_off_rules" ? "WEEKLY_OFF" : "HOLIDAY",
              p_action:
                table === "weekly_off_rules" ? "DEACTIVATE" : "DELETE",
              p_id: id,
              p_values: {},
            },
          );
          if (error) Alert.alert("Unable to remove", error.message);
          else {
            const response = firstRpcRow<any>(data);
            if (response?.success !== true || response?.id !== id) {
              Alert.alert(
                "Unable to remove",
                "The server did not confirm removal of this calendar rule.",
              );
            } else await load(true);
          }
        },
      },
    ]);

  if (loading)
    return (
      <View style={[s.center, { backgroundColor: theme.backgroundRoot }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={s.wrap}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.heading}>
        <Feather name="calendar" size={22} color={theme.primary} />
        <View>
          <ThemedText style={s.title}>Holiday calendar</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Holidays are excluded from leave-day calculations.
          </ThemedText>
        </View>
      </View>
      <View style={[s.panel, { backgroundColor: theme.backgroundDefault }]}>
        <View style={s.row2}>
          <View style={s.col}>
            <ThemedText style={s.label}>Date</ThemedText>
            <DateInput
              style={[s.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
              placeholderTextColor={theme.textSecondary}
              value={date}
              onChange={setDate}
            />
          </View>
          <View style={s.colWide}>
            <ThemedText style={s.label}>Holiday name</ThemedText>
            <TextInput
              style={[s.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
              placeholder="e.g. Diwali"
              placeholderTextColor={theme.textSecondary}
              value={name}
              onChangeText={setName}
            />
          </View>
        </View>
        <ThemedText style={s.label}>Applies to</ThemedText>
        <SearchableSelect
          title="Holiday applies to"
          value={holidayScope}
          options={scopeOptions}
          onChange={setHolidayScope}
          searchPlaceholder="Search office, team or employee"
        />
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <ThemedText style={s.label}>Optional holiday</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Optional holidays remain chargeable unless HR approves leave.
            </ThemedText>
          </View>
          <Switch
            value={optional}
            onValueChange={setOptional}
            trackColor={{ true: theme.primary }}
          />
        </View>
        <Pressable
          style={[s.primary, { backgroundColor: theme.primary }]}
          onPress={addHoliday}
          disabled={saving !== null}
        >
          <ThemedText style={s.white}>{saving === "holiday" ? "Saving..." : "Add holiday"}</ThemedText>
        </Pressable>
      </View>
      {holidays.length === 0 ? (
        <ThemedText style={[s.emptyText, { color: theme.textSecondary }]}>No holidays added yet.</ThemedText>
      ) : null}
      {holidays.map((h) => (
        <View
          key={h.id}
          style={[s.card, { backgroundColor: theme.backgroundDefault }]}
        >
          <View style={s.dateTile}>
            <ThemedText type="caption" style={{ color: theme.primary }}>
              {h.holiday_date.slice(5, 7)}
            </ThemedText>
            <ThemedText style={s.bold}>{h.holiday_date.slice(8)}</ThemedText>
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={s.bold}>{h.name}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {h.holiday_date} · {scopeLabel(h)}
            </ThemedText>
            {h.is_optional ? (
              <View style={[s.badge, { backgroundColor: "#F59E0B22" }]}>
                <ThemedText style={[s.badgeText, { color: "#B45309" }]}>Optional</ThemedText>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityLabel={`Remove ${h.name}`}
            hitSlop={8}
            style={s.iconBtn}
            onPress={() =>
              remove("holiday_calendar", h.id, `${h.name} on ${h.holiday_date}`)
            }
          >
            <Feather name="trash-2" size={18} color="#EF4444" />
          </Pressable>
        </View>
      ))}

      <View style={[s.heading, { marginTop: 24 }]}>
        <Feather name="repeat" size={22} color={theme.primary} />
        <View>
          <ThemedText style={s.title}>Weekly offs</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Employee rules override team, office and company-wide rules.
          </ThemedText>
        </View>
      </View>
      <View style={[s.panel, { backgroundColor: theme.backgroundDefault }]}>
        <ThemedText style={s.label}>Applies to</ThemedText>
        <SearchableSelect
          title="Weekly off applies to"
          value={ruleScope}
          options={scopeOptions}
          onChange={setRuleScope}
          searchPlaceholder="Search office, team or employee"
        />
        <ThemedText style={s.label}>Day</ThemedText>
        <View style={s.days}>
          {DAYS.map((day, index) => (
            <Pressable
              key={day}
              onPress={() => setWeekday(index)}
              style={[
                s.day,
                {
                  borderColor: weekday === index ? theme.primary : theme.border,
                  backgroundColor:
                    weekday === index ? theme.primary : "transparent",
                },
              ]}
            >
              <ThemedText
                type="caption"
                style={{ color: weekday === index ? "#fff" : theme.text }}
              >
                {day.slice(0, 3)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <ThemedText style={s.label}>Repeats</ThemedText>
        <View style={s.days}>
          {WEEK_OPTIONS.map((o) => {
            const active = weekOfMonth === o.value;
            return (
              <Pressable
                key={o.value || "all"}
                onPress={() => setWeekOfMonth(o.value)}
                style={[
                  s.day,
                  {
                    borderColor: active ? theme.primary : theme.border,
                    backgroundColor: active ? theme.primary : "transparent",
                  },
                ]}
              >
                <ThemedText type="caption" style={{ color: active ? "#fff" : theme.text, fontWeight: "600" }}>
                  {o.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <ThemedText type="caption" style={[s.preview, { color: theme.textSecondary, backgroundColor: theme.backgroundSecondary }]}>
          {weekOfMonth
            ? `${WEEK_OPTIONS.find((o) => o.value === weekOfMonth)?.label} ${DAYS[weekday]} of every month`
            : `Every ${DAYS[weekday]}`}
          {" · "}
          {scopeOptions.find((o) => o.value === ruleScope)?.label ?? "All employees"}
        </ThemedText>
        <View style={s.row2}>
          <View style={s.col}>
            <ThemedText style={s.label}>Valid from</ThemedText>
            <DateInput
              style={[s.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
              placeholderTextColor={theme.textSecondary}
              value={validFrom}
              onChange={setValidFrom}
            />
          </View>
          <View style={s.col}>
            <ThemedText style={s.label}>Valid to (optional)</ThemedText>
            <DateInput
              style={[s.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
              placeholderTextColor={theme.textSecondary}
              value={validTo}
              onChange={setValidTo}
              min={validFrom || undefined}
            />
          </View>
        </View>
        <Pressable
          style={[s.primary, { backgroundColor: theme.primary }]}
          onPress={addWeeklyOff}
          disabled={saving !== null}
        >
          <ThemedText style={s.white}>{saving === "weekly" ? "Saving..." : "Add weekly-off rule"}</ThemedText>
        </Pressable>
      </View>
      {rules.length === 0 ? (
        <ThemedText style={[s.emptyText, { color: theme.textSecondary }]}>No weekly-off rules yet.</ThemedText>
      ) : null}
      {rules.map((r) => (
        <View
          key={r.id}
          style={[s.card, { backgroundColor: theme.backgroundDefault }]}
        >
          <Feather name="moon" size={18} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={s.bold}>{scopeLabel(r)}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {r.week_of_month
                ? `${WEEK_OPTIONS.find((o) => o.value === String(r.week_of_month))?.label} of every month`
                : "Every week"}{" "}
              · {DAYS[r.weekday]} · {r.valid_from}
              {r.valid_to ? ` to ${r.valid_to}` : " onward"}
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="Remove weekly-off rule"
            hitSlop={8}
            style={s.iconBtn}
            onPress={() =>
              remove(
                "weekly_off_rules",
                r.id,
                `${DAYS[r.weekday]} off for ${r.profiles?.name || r.teams?.name || r.offices?.name || "all employees"}`,
              )
            }
          >
            <Feather name="trash-2" size={18} color="#EF4444" />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  wrap: { padding: 16, paddingBottom: 48, width: "100%", maxWidth: 820, alignSelf: "center" },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  title: { fontSize: 21, fontWeight: "800" },
  panel: { padding: 14, borderRadius: 14, marginBottom: 12 },
  label: { fontWeight: "700", fontSize: 13, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 11, minHeight: 46, marginBottom: 12 },
  row2: { flexDirection: "row", flexWrap: "wrap", columnGap: 12 },
  col: { flexGrow: 1, flexBasis: 150 },
  colWide: { flexGrow: 2, flexBasis: 200 },
  preview: { padding: 10, borderRadius: 9, marginBottom: 12, overflow: "hidden" },
  badge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginTop: 4 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  iconBtn: { padding: 8, borderRadius: 8 },
  emptyText: { textAlign: "center", paddingVertical: 12 },
  switchRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  primary: { padding: 12, borderRadius: 9, alignItems: "center" },
  white: { color: "#fff", fontWeight: "700" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 11,
    marginBottom: 7,
    gap: 10,
  },
  dateTile: {
    width: 42,
    alignItems: "center",
    backgroundColor: "#F5EAF5",
    borderRadius: 8,
    padding: 5,
  },
  bold: { fontWeight: "800" },
  days: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  day: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
});
