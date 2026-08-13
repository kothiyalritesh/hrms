import React, { useCallback, useState } from "react";
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
import { Picker } from "@react-native-picker/picker";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/lib/supabase";
import { fetchAllPages } from "@/utils/supabasePagination";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { isBusinessDate } from "@/utils/businessDate";
import { getBusinessDateIST } from "@/utils/attendanceTimestamp";

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

  const load = useCallback(async () => {
    setLoading(true);
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
      load();
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
    if (error)
      return Alert.alert(
        "Unable to add holiday",
        error.code === "23505"
          ? "A holiday already exists for this date and office."
          : error.message,
      );
    const response = firstRpcRow<any>(data);
    if (response?.success !== true || !response?.id)
      return Alert.alert(
        "Unable to add holiday",
        "The server did not confirm the holiday.",
      );
    setDate("");
    setName("");
    setOptional(false);
    await load();
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
        "This weekly-off rule is already configured.",
      );
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
    if (error) return Alert.alert("Unable to add weekly off", error.message);
    const response = firstRpcRow<any>(data);
    if (response?.success !== true || !response?.id)
      return Alert.alert(
        "Unable to add weekly off",
        "The server did not confirm the weekly-off rule.",
      );
    setValidTo("");
    await load();
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
            } else await load();
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
        <ThemedText style={s.label}>Date</ThemedText>
        <TextInput
          style={[s.input, { color: theme.text, borderColor: theme.border }]}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.textSecondary}
          value={date}
          onChangeText={setDate}
        />
        <ThemedText style={s.label}>Holiday name</ThemedText>
        <TextInput
          style={[s.input, { color: theme.text, borderColor: theme.border }]}
          placeholder="e.g. Diwali"
          placeholderTextColor={theme.textSecondary}
          value={name}
          onChangeText={setName}
        />
        <ThemedText style={s.label}>Applies to</ThemedText>
        <View style={[s.picker, { borderColor: theme.border }]}>
          <Picker
            selectedValue={holidayScope}
            onValueChange={setHolidayScope}
            style={{ color: theme.text }}
          >
            <Picker.Item label="All employees" value="all" />
            {offices.map((o) => (
              <Picker.Item key={`office:${o.id}`} label={`Office - ${o.name}`} value={`office:${o.id}`} />
            ))}
            {teams.map((t) => (
              <Picker.Item key={`team:${t.id}`} label={`Team - ${t.name}`} value={`team:${t.id}`} />
            ))}
            {employees.map((p) => (
              <Picker.Item key={`user:${p.id}`} label={`Employee - ${p.name}${p.employee_number ? ` (${p.employee_number})` : ""}`} value={`user:${p.id}`} />
            ))}
          </Picker>
        </View>
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
        >
          <ThemedText style={s.white}>Add holiday</ThemedText>
        </Pressable>
      </View>
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
              {h.holiday_date} · {h.profiles?.name || h.teams?.name || h.offices?.name || "All employees"}
              {h.is_optional ? " · Optional" : ""}
            </ThemedText>
          </View>
          <Pressable
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
        <View style={[s.picker, { borderColor: theme.border }]}>
          <Picker
            selectedValue={ruleScope}
            onValueChange={setRuleScope}
            style={{ color: theme.text }}
          >
            <Picker.Item label="All employees" value="all" />
            {offices.map((o) => (
              <Picker.Item key={`office:${o.id}`} label={`Office - ${o.name}`} value={`office:${o.id}`} />
            ))}
            {teams.map((t) => (
              <Picker.Item key={`team:${t.id}`} label={`Team - ${t.name}`} value={`team:${t.id}`} />
            ))}
            {employees.map((p) => (
              <Picker.Item key={`user:${p.id}`} label={`Employee - ${p.name}${p.employee_number ? ` (${p.employee_number})` : ""}`} value={`user:${p.id}`} />
            ))}
          </Picker>
        </View>
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
        <ThemedText style={s.label}>Recurrence</ThemedText>
        <View style={[s.picker, { borderColor: theme.border }]}>
          <Picker
            selectedValue={weekOfMonth}
            onValueChange={setWeekOfMonth}
            style={{ color: theme.text }}
          >
            {WEEK_OPTIONS.map((o) => (
              <Picker.Item
                key={o.value || "all"}
                label={o.label}
                value={o.value}
              />
            ))}
          </Picker>
        </View>
        <ThemedText style={s.label}>Valid from</ThemedText>
        <TextInput
          style={[s.input, { color: theme.text, borderColor: theme.border }]}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.textSecondary}
          value={validFrom}
          onChangeText={setValidFrom}
        />
        <ThemedText style={s.label}>Valid to (optional)</ThemedText>
        <TextInput
          style={[s.input, { color: theme.text, borderColor: theme.border }]}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.textSecondary}
          value={validTo}
          onChangeText={setValidTo}
        />
        <Pressable
          style={[s.primary, { backgroundColor: theme.primary }]}
          onPress={addWeeklyOff}
        >
          <ThemedText style={s.white}>Add weekly-off rule</ThemedText>
        </Pressable>
      </View>
      {rules.map((r) => (
        <View
          key={r.id}
          style={[s.card, { backgroundColor: theme.backgroundDefault }]}
        >
          <Feather name="moon" size={18} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={s.bold}>
              {r.profiles?.name || r.teams?.name || r.offices?.name || "All employees"}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {r.week_of_month
                ? `${WEEK_OPTIONS.find((o) => o.value === String(r.week_of_month))?.label} of every month`
                : "Every week"}{" "}
              · {DAYS[r.weekday]} · {r.valid_from}
              {r.valid_to ? ` to ${r.valid_to}` : " onward"}
            </ThemedText>
          </View>
          <Pressable
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
  wrap: { padding: 16, paddingBottom: 48 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  title: { fontSize: 21, fontWeight: "800" },
  panel: { padding: 14, borderRadius: 14, marginBottom: 12 },
  label: { fontWeight: "700", fontSize: 13, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 9, padding: 11, marginBottom: 12 },
  picker: {
    borderWidth: 1,
    borderRadius: 9,
    overflow: "hidden",
    marginBottom: 12,
  },
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
