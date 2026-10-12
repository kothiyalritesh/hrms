import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
  TextInput,
  Modal,
  Platform,
  Switch,
  TouchableOpacity,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import {
  EventService,
  Event,
  EventAttendee,
  EventAudienceOptions,
} from "@/services/event.service";
import { supabase } from "@/lib/supabase";
import LocationSearchInput, { PlaceResult } from "@/components/LocationSearchInput";

const ALLOWED_ROLES = ["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"];

// ── Inline date/time picker that works on web + native ───────────────────────
function DateTimeField({
  label,
  value,
  mode,
  onChange,
}: {
  label: string;
  value: Date;
  mode: "date" | "time";
  onChange: (d: Date) => void;
}) {
  const [show, setShow] = useState(false);

  const display =
    mode === "date"
      ? formatDate(value)
      : value.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  if (Platform.OS === "web") {
    // On web use native HTML input
    const htmlValue =
      mode === "date"
        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(
            2,
            "0",
          )}-${String(value.getDate()).padStart(2, "0")}`
        : `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;

    return (
      <View style={wf.wrap}>
        <ThemedText style={wf.label}>{label}</ThemedText>
        <View style={wf.row}>
          <Feather name={mode === "date" ? "calendar" : "clock"} size={15} color="#60045d" style={{ marginRight: 8 }} />
          {/* @ts-ignore — web-only input type */}
          <input
            type={mode}
            value={htmlValue}
            onChange={(e: any) => {
              const v = e.target.value;
              if (!v) return;
              if (mode === "date") {
                const [y, m, d] = v.split("-").map(Number);
                const nd = new Date(value);
                nd.setFullYear(y, m - 1, d);
                onChange(nd);
              } else {
                const [h, min] = v.split(":").map(Number);
                const nd = new Date(value);
                nd.setHours(h, min, 0, 0);
                onChange(nd);
              }
            }}
            style={{
              flex: 1, border: "none", background: "transparent",
              fontSize: 14, color: "#111827", outline: "none", cursor: "pointer",
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={wf.wrap}>
      <ThemedText style={wf.label}>{label}</ThemedText>
      <TouchableOpacity style={wf.row} onPress={() => setShow(true)}>
        <Feather name={mode === "date" ? "calendar" : "clock"} size={15} color="#60045d" style={{ marginRight: 8 }} />
        <ThemedText style={wf.value}>{display}</ThemedText>
        <Feather name="chevron-down" size={14} color="#9CA3AF" style={{ marginLeft: "auto" }} />
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={value}
          mode={mode}
          display={mode === "date" ? "calendar" : "spinner"}
          onChange={(_, selected) => {
            setShow(false);
            if (selected) onChange(selected);
          }}
        />
      )}
    </View>
  );
}

const wf = StyleSheet.create({
  wrap: { marginBottom: Spacing.md },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  row: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 8,
    paddingHorizontal: 11, paddingVertical: 11, backgroundColor: "#F9FAFB",
  },
  value: { fontSize: 14, color: "#111827" },
});
// ─────────────────────────────────────────────────────────────────────────────

export default function EventManagementScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState(new Date());
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(); d.setHours(9, 0, 0, 0); return d;
  });
  const [endTime, setEndTime] = useState(() => {
    const d = new Date(); d.setHours(18, 0, 0, 0); return d;
  });
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [grantMarketingCompOff, setGrantMarketingCompOff] = useState(false);
  const [lateGraceMinutes, setLateGraceMinutes] = useState("10");
  const [audienceMode, setAudienceMode] = useState<
    "individual" | "groups" | "all"
  >("individual");
  const [audienceSearch, setAudienceSearch] = useState("");
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceOptions, setAudienceOptions] = useState<EventAudienceOptions>({
    employees: [],
    teams: [],
    departments: [],
  });
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);

  // Attendees panel
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [showAttendees, setShowAttendees] = useState(false);
  const { hasPermission } = usePermissions();
  const isAllowed = hasPermission("events.manage");

  const resolvedEmployeeIds = useMemo(() => {
    if (audienceMode === "all") {
      return new Set(audienceOptions.employees.map((employee) => employee.id));
    }
    const resolved = new Set(selectedEmployeeIds);
    for (const employee of audienceOptions.employees) {
      if (employee.team_id && selectedTeamIds.includes(employee.team_id)) {
        resolved.add(employee.id);
      }
      if (
        employee.department &&
        selectedDepartments.some(
          (department) =>
            department.toLowerCase() === employee.department?.toLowerCase(),
        )
      ) {
        resolved.add(employee.id);
      }
    }
    return resolved;
  }, [
    audienceMode,
    audienceOptions.employees,
    selectedDepartments,
    selectedEmployeeIds,
    selectedTeamIds,
  ]);

  const filteredEmployees = useMemo(() => {
    const query = audienceSearch.trim().toLowerCase();
    return audienceOptions.employees.filter((employee) =>
      !query ||
      [employee.name, employee.employee_number, employee.department, employee.team_name]
        .some((value) => value?.toLowerCase().includes(query)),
    );
  }, [audienceOptions.employees, audienceSearch]);

  const filteredGroups = useMemo(() => {
    const query = audienceSearch.trim().toLowerCase();
    return {
      teams: audienceOptions.teams.filter((team) =>
        !query || team.name.toLowerCase().includes(query),
      ),
      departments: audienceOptions.departments.filter((department) =>
        !query || department.name.toLowerCase().includes(query),
      ),
    };
  }, [audienceOptions, audienceSearch]);

  const toggleSelection = (
    value: string,
    selected: string[],
    setSelected: React.Dispatch<React.SetStateAction<string[]>>,
  ) => setSelected((current) =>
    current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value],
  );

  const openCreateForm = async () => {
    setShowForm(true);
    if (audienceOptions.employees.length) return;
    setAudienceLoading(true);
    try {
      setAudienceOptions(await EventService.getAudienceOptions());
    } catch (error: any) {
      Alert.alert("Audience unavailable", error.message);
    } finally {
      setAudienceLoading(false);
    }
  };

  const load = useCallback(async () => {
    if (!isAllowed) return;
    setLoading(true);
    try {
      setEvents(await EventService.getAllEvents());
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [isAllowed]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!isAllowed) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ThemedText type="body">Access denied.</ThemedText>
      </View>
    );
  }

  const resetForm = () => {
    setTitle(""); setDescription(""); setAddress(""); setCoords(null);
    setGrantMarketingCompOff(false);
    setLateGraceMinutes("10");
    setAudienceMode("individual");
    setAudienceSearch("");
    setSelectedEmployeeIds([]);
    setSelectedTeamIds([]);
    setSelectedDepartments([]);
    const now = new Date();
    setEventDate(now);
    const s = new Date(now); s.setHours(9, 0, 0, 0); setStartTime(s);
    const e = new Date(now); e.setHours(18, 0, 0, 0); setEndTime(e);
  };

  const handleSave = async () => {
    if (!title.trim()) { Alert.alert("Validation", "Event title is required."); return; }
    if (!address || !coords) { Alert.alert("Validation", "Please search and select a location."); return; }
    if (audienceMode !== "all" && resolvedEmployeeIds.size === 0) {
      Alert.alert("Validation", "Select at least one employee, team, or department.");
      return;
    }

    setSaving(true);
    try {
      const pad = (n: number) => String(n).padStart(2, "0");
      const eventDateValue = `${eventDate.getFullYear()}-${pad(eventDate.getMonth() + 1)}-${pad(eventDate.getDate())}`;

      await EventService.createEvent({
        title: title.trim(),
        description: description.trim() || undefined,
        event_date: eventDateValue,
        start_time: `${pad(startTime.getHours())}:${pad(startTime.getMinutes())}`,
        end_time: `${pad(endTime.getHours())}:${pad(endTime.getMinutes())}`,
        address,
        latitude: coords.latitude,
        longitude: coords.longitude,
        checkin_radius_m: 200,
        comp_off_enabled: grantMarketingCompOff,
        comp_off_team: "ALL_ATTENDEES",
        comp_off_days: 1,
        created_by: user!.id,
        event_late_grace_minutes: Math.max(
          0,
          Math.min(Number(lateGraceMinutes) || 0, 240),
        ),
        audience: {
          allEmployees: audienceMode === "all",
          employeeIds: audienceMode === "individual" ? selectedEmployeeIds : [],
          teamIds: audienceMode === "groups" ? selectedTeamIds : [],
          departments:
            audienceMode === "groups" ? selectedDepartments : [],
        },
      });

      Alert.alert("✅ Success", "Event created successfully.");
      resetForm();
      setShowForm(false);
      load();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string, evTitle: string) => {
    Alert.alert("Delete Event", `Delete "${evTitle}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try { await EventService.deleteEvent(id); load(); }
          catch (e: any) { Alert.alert("Error", e.message); }
        },
      },
    ]);
  };

  const openAttendees = async (ev: Event) => {
    setSelectedEvent(ev);
    setShowAttendees(true);
    setAttendeesLoading(true);
    try {
      setAttendees(await EventService.getEventAttendees(ev.id));
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setAttendeesLoading(false);
    }
  };

  return (
    <ScreenScrollView>
      <View style={styles.topRow}>
        <ThemedText type="h3">Events</ThemedText>
        <Pressable
          onPress={openCreateForm}
          style={[styles.addBtn, { backgroundColor: theme.primary }]}
        >
          <Feather name="plus" size={16} color="#fff" />
          <ThemedText type="small" style={{ color: "#fff", fontWeight: "700" }}>New Event</ThemedText>
        </Pressable>
      </View>

      <Spacer height={Spacing.lg} />

      {loading ? (
        <ActivityIndicator color={theme.primary} />
      ) : events.length === 0 ? (
        <View style={[styles.emptyBox, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="calendar" size={32} color={theme.textSecondary} />
          <Spacer height={Spacing.sm} />
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            No events yet. Tap New Event to create one.
          </ThemedText>
        </View>
      ) : (
        events.map((ev) => (
          <Pressable
            key={ev.id}
            style={({ pressed }) => [styles.eventCard, { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.9 : 1 }]}
            onPress={() => openAttendees(ev)}
          >
            {ev.photo_url ? (
              <Image source={{ uri: ev.photo_url }} style={styles.eventPhoto} />
            ) : (
              <View style={[styles.eventPhotoPlaceholder, { backgroundColor: theme.primary + "18" }]}>
                <Feather name="calendar" size={22} color={theme.primary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <ThemedText type="body" style={{ fontWeight: "700" }}>{ev.title}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {formatDate(ev.event_date)}
                {" · "}{ev.start_time} – {ev.end_time}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
                📍 {ev.address}
              </ThemedText>
              <View style={styles.attendeeBadge}>
                <Feather name="users" size={11} color={theme.primary} />
                <ThemedText type="caption" style={{ color: theme.primary, fontSize: 11, fontWeight: "600" }}>
                  View Attendees
                </ThemedText>
              </View>
            </View>
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); handleDelete(ev.id, ev.title); }}
              style={{ padding: 8 }}
              hitSlop={8}
            >
              <Feather name="trash-2" size={18} color={Colors.light.error} />
            </Pressable>
          </Pressable>
        ))
      )}

      {/* ── Attendees Modal ────────────────────────────────────────────── */}
      <Modal
        visible={showAttendees}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAttendees(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.backgroundDefault }]}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <ThemedText type="h3" numberOfLines={1}>{selectedEvent?.title}</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {selectedEvent?.event_date} · {selectedEvent?.start_time} – {selectedEvent?.end_time}
                </ThemedText>
              </View>
              <Pressable onPress={() => setShowAttendees(false)} style={{ padding: 4 }}>
                <Feather name="x" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>

            {/* Summary bar */}
            <View style={[styles.summaryBar, { backgroundColor: theme.primary + "12" }]}>
              <Feather name="users" size={16} color={theme.primary} />
              <ThemedText type="body" style={{ color: theme.primary, fontWeight: "700" }}>
                {attendeesLoading ? "…" : attendees.length} {attendees.length === 1 ? "Attendee" : "Attendees"} Checked In
              </ThemedText>
            </View>

            <View
              style={[
                styles.detailGrid,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                },
              ]}
            >
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Participants:{" "}
                <ThemedText type="caption" style={{ color: theme.text, fontWeight: "700" }}>
                  {selectedEvent?.participant_count ?? "—"}
                </ThemedText>
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                On Time:{" "}
                <ThemedText type="caption" style={{ color: Colors.light.success, fontWeight: "700" }}>
                  {selectedEvent?.on_time_count ?? 0}
                </ThemedText>
                {"   ·   "}
                Late:{" "}
                <ThemedText type="caption" style={{ color: Colors.light.error, fontWeight: "700" }}>
                  {selectedEvent?.late_count ?? 0}
                </ThemedText>
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Comp-Off Eligible:{" "}
                <ThemedText type="caption" style={{ color: theme.text, fontWeight: "700" }}>
                  {selectedEvent?.comp_off_eligible_count ?? 0}
                </ThemedText>
              </ThemedText>
              <ThemedText type="caption" numberOfLines={2} style={{ color: theme.textSecondary }}>
                Teams:{" "}
                <ThemedText type="caption" style={{ color: theme.text }}>
                  {[...(selectedEvent?.assigned_team_names ?? []), ...(selectedEvent?.assigned_departments ?? [])].join(", ") || "Individual / All Employees"}
                </ThemedText>
              </ThemedText>
              <ThemedText type="caption" numberOfLines={2} style={{ color: theme.textSecondary }}>
                Location:{" "}
                <ThemedText type="caption" style={{ color: theme.text }}>
                  {selectedEvent?.address}
                </ThemedText>
              </ThemedText>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: Spacing.md }}>
              {attendeesLoading ? (
                <ActivityIndicator color={theme.primary} style={{ marginTop: Spacing.xl }} />
              ) : attendees.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Feather name="user-x" size={28} color={theme.textSecondary} />
                  <Spacer height={Spacing.sm} />
                  <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
                    No one has checked in yet.
                  </ThemedText>
                </View>
              ) : (
                attendees.map((a, i) => (
                  <View
                    key={a.id}
                    style={[styles.attendeeRow, { borderBottomColor: theme.textSecondary + "20" }]}
                  >
                    {/* Avatar circle */}
                    <View style={[styles.avatar, { backgroundColor: theme.primary + "18" }]}>
                      <ThemedText style={{ fontSize: 15, fontWeight: "700", color: theme.primary }}>
                        {a.name.charAt(0).toUpperCase()}
                      </ThemedText>
                    </View>

                    <View style={{ flex: 1 }}>
                      <ThemedText type="body" style={{ fontWeight: "700" }}>{a.name}</ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                        {a.role.replace(/_/g, " ")}
                      </ThemedText>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <ThemedText type="caption" style={{ color: theme.text, fontWeight: "600" }}>
                        {new Date(a.checkin_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                      </ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 10 }}>
                        {a.arrival_status === "LATE" ? `Late${a.late_minutes ? ` · ${a.late_minutes} min` : ""}` : "On Time"}
                      </ThemedText>
                      {a.distance_metres != null ? (
                        <View style={styles.distBadge}>
                          <ThemedText style={{ fontSize: 10, color: Colors.light.success, fontWeight: "700" }}>
                            {a.distance_metres}m away
                          </ThemedText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
              <Spacer height={Spacing.xl} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Create Event Modal ─────────────────────────────────────────── */}
      <Modal
        visible={showForm}
        animationType="slide"
        transparent
        onRequestClose={() => { resetForm(); setShowForm(false); }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Create Event</ThemedText>
              <Pressable onPress={() => { resetForm(); setShowForm(false); }}>
                <Feather name="x" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Title */}
              <View style={styles.field}>
                <ThemedText style={styles.fieldLabel}>Title *</ThemedText>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Event title"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { borderColor: "#E5E7EB", color: theme.text }]}
                />
              </View>

              {/* Description */}
              <View style={styles.field}>
                <ThemedText style={styles.fieldLabel}>Description</ThemedText>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Optional description"
                  placeholderTextColor={theme.textSecondary}
                  multiline
                  numberOfLines={2}
                  style={[styles.input, { borderColor: "#E5E7EB", color: theme.text, minHeight: 60, textAlignVertical: "top" }]}
                />
              </View>

              {/* Date */}
              <DateTimeField label="Event Date *" value={eventDate} mode="date" onChange={setEventDate} />

              <View style={styles.audienceBox}>
                <ThemedText style={styles.fieldLabel}>Who should attend? *</ThemedText>
                <View style={styles.audienceModeRow}>
                  {([
                    ["individual", "Employees"],
                    ["groups", "Teams / Departments"],
                    ["all", "All Employees"],
                  ] as const).map(([mode, label]) => (
                    <Pressable
                      key={mode}
                      onPress={() => { setAudienceMode(mode); setAudienceSearch(""); }}
                      style={[styles.modeChip, audienceMode === mode && { backgroundColor: theme.primary }]}
                    >
                      <ThemedText type="caption" style={{ color: audienceMode === mode ? "#fff" : theme.text }}>
                        {label}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>

                {audienceMode !== "all" ? (
                  <>
                    <TextInput
                      value={audienceSearch}
                      onChangeText={setAudienceSearch}
                      placeholder="Search employees, teams, departments…"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.input, { borderColor: "#E5E7EB", color: theme.text }]}
                    />
                    <View style={styles.audienceActions}>
                      <Pressable onPress={() => {
                        if (audienceMode === "individual") {
                          setSelectedEmployeeIds(filteredEmployees.map((employee) => employee.id));
                        } else {
                          setSelectedTeamIds(filteredGroups.teams.map((team) => team.id));
                          setSelectedDepartments(filteredGroups.departments.map((department) => department.name));
                        }
                      }}>
                        <ThemedText type="caption" style={{ color: theme.primary }}>Select All</ThemedText>
                      </Pressable>
                      <Pressable onPress={() => {
                        if (audienceMode === "individual") setSelectedEmployeeIds([]);
                        else { setSelectedTeamIds([]); setSelectedDepartments([]); }
                      }}>
                        <ThemedText type="caption" style={{ color: Colors.light.error }}>Clear</ThemedText>
                      </Pressable>
                    </View>
                    {audienceLoading ? <ActivityIndicator color={theme.primary} /> : (
                      <ScrollView style={styles.audienceList} nestedScrollEnabled>
                        {audienceMode === "individual" ? filteredEmployees.map((employee) => {
                          const checked = selectedEmployeeIds.includes(employee.id);
                          return <Pressable key={employee.id} style={styles.optionRow}
                            onPress={() => toggleSelection(employee.id, selectedEmployeeIds, setSelectedEmployeeIds)}>
                            <Feather name={checked ? "check-square" : "square"} size={18} color={checked ? theme.primary : theme.textSecondary} />
                            <View style={{ flex: 1 }}>
                              <ThemedText type="small">{employee.name}</ThemedText>
                              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                                {[employee.team_name, employee.department].filter(Boolean).join(" · ")}
                              </ThemedText>
                            </View>
                          </Pressable>;
                        }) : <>
                          {filteredGroups.teams.map((team) => {
                            const checked = selectedTeamIds.includes(team.id);
                            return <Pressable key={`team:${team.id}`} style={styles.optionRow}
                              onPress={() => toggleSelection(team.id, selectedTeamIds, setSelectedTeamIds)}>
                              <Feather name={checked ? "check-square" : "square"} size={18} color={checked ? theme.primary : theme.textSecondary} />
                              <ThemedText type="small" style={{ flex: 1 }}>{team.name}</ThemedText>
                              <ThemedText type="caption">{team.member_count}</ThemedText>
                            </Pressable>;
                          })}
                          {filteredGroups.departments.map((department) => {
                            const checked = selectedDepartments.includes(department.name);
                            return <Pressable key={`department:${department.name}`} style={styles.optionRow}
                              onPress={() => toggleSelection(department.name, selectedDepartments, setSelectedDepartments)}>
                              <Feather name={checked ? "check-square" : "square"} size={18} color={checked ? theme.primary : theme.textSecondary} />
                              <ThemedText type="small" style={{ flex: 1 }}>{department.name} Department</ThemedText>
                              <ThemedText type="caption">{department.member_count}</ThemedText>
                            </Pressable>;
                          })}
                        </>}
                      </ScrollView>
                    )}
                  </>
                ) : null}
                <ThemedText type="caption" style={{ color: theme.primary, marginTop: 8, fontWeight: "700" }}>
                  Selected: {audienceMode === "groups" ? selectedTeamIds.length + selectedDepartments.length : 0} Teams / Departments · {resolvedEmployeeIds.size} Employees
                </ThemedText>
              </View>

              <View style={styles.compOffRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.fieldLabel}>
                    Weekly-Off / Holiday Comp-Off
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    Evaluate assigned attendees using the configurable event-duty policy.
                  </ThemedText>
                </View>
                <Switch
                  value={grantMarketingCompOff}
                  onValueChange={setGrantMarketingCompOff}
                  trackColor={{ false: "#D1D5DB", true: theme.primary + "80" }}
                  thumbColor={grantMarketingCompOff ? theme.primary : "#F9FAFB"}
                />
              </View>

              <View style={styles.field}>
                <ThemedText style={styles.fieldLabel}>Late Grace (minutes)</ThemedText>
                <TextInput
                  value={lateGraceMinutes}
                  onChangeText={(value) => setLateGraceMinutes(value.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="10"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { borderColor: "#E5E7EB", color: theme.text }]}
                />
              </View>

              {/* Start / End time side by side */}
              <View style={styles.timeRow}>
                <View style={{ flex: 1 }}>
                  <DateTimeField label="Start Time *" value={startTime} mode="time" onChange={setStartTime} />
                </View>
                <Spacer height={0} />
                <View style={{ flex: 1 }}>
                  <DateTimeField label="End Time *" value={endTime} mode="time" onChange={setEndTime} />
                </View>
              </View>

              {/* Location search — replaces manual lat/lng */}
              <LocationSearchInput
                label="Event Location"
                value={address}
                placeholder="Search city, area, landmark…"
                required
                onSelect={(place: PlaceResult) => {
                  setAddress(place.displayName);
                  setCoords({ latitude: place.latitude, longitude: place.longitude });
                }}
                onChange={(text) => {
                  setAddress(text);
                  if (!text) setCoords(null);
                }}
              />

              {coords ? (
                <ThemedText style={styles.coordHint}>
                  📍 {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
                </ThemedText>
              ) : null}

              <Spacer height={Spacing.sm} />

              <Spacer height={Spacing.xl} />

              <Button onPress={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Create Event"}
              </Button>
              <Spacer height={Spacing.sm} />
              <Button
                onPress={() => { resetForm(); setShowForm(false); }}
                style={{ backgroundColor: Colors.light.error }}
              >
                Cancel
              </Button>
              <Spacer height={Spacing.xl} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  emptyBox: {
    alignItems: "center", padding: Spacing.xl, borderRadius: BorderRadius.lg,
  },
  eventCard: {
    flexDirection: "row", alignItems: "center", gap: Spacing.md,
    padding: Spacing.md, borderRadius: BorderRadius.md, marginBottom: Spacing.sm,
  },
  eventPhoto: { width: 60, height: 60, borderRadius: BorderRadius.sm },
  eventPhotoPlaceholder: {
    width: 60, height: 60, borderRadius: BorderRadius.sm,
    alignItems: "center", justifyContent: "center",
  },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalBox: {
    borderTopLeftRadius: BorderRadius.lg, borderTopRightRadius: BorderRadius.lg,
    padding: Spacing.lg, maxHeight: "92%",
  },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: Spacing.lg,
  },
  field: { marginBottom: Spacing.md },
  compOffRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "#FFF7ED",
  },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderRadius: 8,
    paddingHorizontal: Spacing.md, paddingVertical: Platform.OS === "web" ? 9 : 11,
    fontSize: 14,
  },
  timeRow: {
    flexDirection: "row", gap: Spacing.md,
  },
  coordHint: {
    fontSize: 11, color: "#10B981", marginTop: -8, marginBottom: Spacing.sm, marginLeft: 2,
  },
  photoBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderStyle: "dashed", borderColor: "#60045d",
    borderRadius: BorderRadius.sm, padding: Spacing.md, justifyContent: "center",
  },
  previewImg: {
    width: "100%", height: 160, borderRadius: BorderRadius.sm, marginTop: Spacing.sm,
  },
  attendeeBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    marginTop: 4,
  },
  summaryBar: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm,
    padding: Spacing.md, borderRadius: BorderRadius.md,
  },
  detailGrid: {
    marginTop: Spacing.sm,
    gap: 6,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  audienceBox: {
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  audienceModeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: Spacing.sm,
  },
  modeChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  audienceActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 8,
  },
  audienceList: { maxHeight: 210 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  attendeeRow: {
    flexDirection: "row", alignItems: "center", gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  distBadge: {
    marginTop: 2, backgroundColor: Colors.light.successBg,
    borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
  },
});
