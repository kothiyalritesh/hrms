import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Modal, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { LeaveBalanceService } from "@/services/leave-balance.service";

type LifecycleStatus = "candidate" | "onboarding" | "active" | "on_leave" | "suspended" | "exit";

const STATUS_CFG: Record<LifecycleStatus, { label: string; color: string; icon: keyof typeof import("@expo/vector-icons").Feather.glyphMap }> = {
  candidate:  { label: "Candidate",  color: "#8B5CF6", icon: "user-plus" },
  onboarding: { label: "Onboarding", color: "#F59E0B", icon: "clipboard" },
  active:     { label: "Active",     color: "#10B981", icon: "check-circle" },
  on_leave:   { label: "On Leave",   color: "#3B82F6", icon: "calendar" },
  suspended:  { label: "Suspended",  color: "#EF4444", icon: "slash" },
  exit:       { label: "Exited",     color: "#6B7280", icon: "log-out" },
};

// Which statuses can be moved to from a given status
const ALLOWED_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  candidate:  ["onboarding", "exit"],
  onboarding: ["active", "exit"],
  active:     ["on_leave", "suspended", "exit"],
  on_leave:   ["active", "exit"],
  suspended:  ["active", "exit"],
  exit:       [],
};

interface Employee {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  role: string;
  employee_number?: string;
  lifecycle_status: LifecycleStatus;
  department_id?: string;
  designation_id?: string;
  date_of_joining?: string;
  date_of_exit?: string;
  department?: { name: string } | { name: string }[];
  designation?: { name: string } | { name: string }[];
}

function getDeptName(d?: Employee["department"]): string {
  if (!d) return "";
  if (Array.isArray(d)) return d[0]?.name ?? "";
  return d.name ?? "";
}
function getDesigName(d?: Employee["designation"]): string {
  if (!d) return "";
  if (Array.isArray(d)) return d[0]?.name ?? "";
  return d.name ?? "";
}

export default function OnboardingScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [designations, setDesignations] = useState<{ id: string; name: string; department_id?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<LifecycleStatus | "all">("all");

  // Edit modal
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    lifecycle_status: "active" as LifecycleStatus,
    department_id: "",
    designation_id: "",
    date_of_joining: "",
    date_of_exit: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, deptRes, desigRes] = await Promise.all([
        supabase.from("profiles").select(`
          id, name, phone, email, role, employee_number,
          lifecycle_status, department_id, designation_id,
          date_of_joining, date_of_exit,
          department:department_id(name),
          designation:designation_id(name)
        `).order("name"),
        supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
        supabase.from("designations").select("id, name, department_id").eq("is_active", true).order("name"),
      ]);
      setEmployees((empRes.data || []) as unknown as Employee[]);
      setDepartments(deptRes.data || []);
      setDesignations(desigRes.data || []);
    } catch {
      Alert.alert("Error", "Failed to load employee data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openEdit = (emp: Employee) => {
    setSelectedEmp(emp);
    setForm({
      lifecycle_status: emp.lifecycle_status || "active",
      department_id: emp.department_id || "",
      designation_id: emp.designation_id || "",
      date_of_joining: emp.date_of_joining || "",
      date_of_exit: emp.date_of_exit || "",
    });
    setShowModal(true);
  };

  const confirmStatusChange = (newStatus: LifecycleStatus) => {
    if (newStatus === form.lifecycle_status) return;

    const from = STATUS_CFG[form.lifecycle_status];
    const to = STATUS_CFG[newStatus];

    // Require exit date when exiting
    if (newStatus === "exit" && !form.date_of_exit) {
      Alert.alert(
        "Exit Date Required",
        "Please enter the Date of Exit before marking this employee as Exited.",
      );
      return;
    }

    Alert.alert(
      `Change Status: ${from.label} → ${to.label}`,
      `Are you sure you want to move ${selectedEmp?.name} from "${from.label}" to "${to.label}"?\n\nThis action will be logged in the audit trail.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Yes, ${to.label}`,
          style: newStatus === "exit" || newStatus === "suspended" ? "destructive" : "default",
          onPress: () => setForm(f => ({ ...f, lifecycle_status: newStatus })),
        },
      ],
    );
  };

  const handleSave = async () => {
    if (!selectedEmp) return;

    // Validation
    if (form.lifecycle_status === "exit" && !form.date_of_exit) {
      Alert.alert("Required", "Please enter the Date of Exit.");
      return;
    }
    if (form.date_of_joining && !/^\d{4}-\d{2}-\d{2}$/.test(form.date_of_joining)) {
      Alert.alert("Invalid Date", "Date of Joining must be in YYYY-MM-DD format.");
      return;
    }
    if (form.date_of_exit && !/^\d{4}-\d{2}-\d{2}$/.test(form.date_of_exit)) {
      Alert.alert("Invalid Date", "Date of Exit must be in YYYY-MM-DD format.");
      return;
    }

    setSaving(true);
    try {
      const oldStatus = selectedEmp.lifecycle_status;
      const updates: Record<string, any> = {
        lifecycle_status: form.lifecycle_status,
        department_id: form.department_id || null,
        designation_id: form.designation_id || null,
        date_of_joining: form.date_of_joining || null,
        date_of_exit: form.date_of_exit || null,
        // Sync is_active with lifecycle
        is_active: form.lifecycle_status !== "exit" && form.lifecycle_status !== "suspended",
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("profiles").update(updates).eq("id", selectedEmp.id);
      if (error) throw error;

      // Auto-init leave balance when activating
      if (form.lifecycle_status === "active" && oldStatus !== "active") {
        await LeaveBalanceService.getOrCreate(selectedEmp.id).catch(() => {});
      }

      // Write audit log (fire-and-forget)
      void supabase.from("audit_logs").insert({
        action: "UPDATE",
        table_name: "profiles",
        record_id: selectedEmp.id,
        old_values: { lifecycle_status: oldStatus },
        new_values: { lifecycle_status: form.lifecycle_status },
        performed_by: user?.id ?? null,
      });

      // Send notification to employee if status changed
      if (oldStatus !== form.lifecycle_status) {
        void supabase.from("notifications").insert({
          user_id: selectedEmp.id,
          title: "Employment Status Updated",
          message: `Your employment status has been updated to: ${STATUS_CFG[form.lifecycle_status].label}`,
          type: "announcement",
        });
      }

      await load();
      setShowModal(false);
      Alert.alert("✅ Saved", `${selectedEmp.name}'s profile has been updated.`);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const filtered = employees.filter(e => {
    if (filterStatus !== "all" && e.lifecycle_status !== filterStatus) return false;
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) &&
        !(e.employee_number || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = (Object.keys(STATUS_CFG) as LifecycleStatus[]).reduce((acc, k) => {
    acc[k] = employees.filter(e => e.lifecycle_status === k).length;
    return acc;
  }, {} as Record<string, number>);

  // Designations filtered by selected department
  const filteredDesigs = form.department_id
    ? designations.filter(d => d.department_id === form.department_id)
    : designations;

  const allowedStatuses = selectedEmp
    ? [...(ALLOWED_TRANSITIONS[selectedEmp.lifecycle_status] || []), selectedEmp.lifecycle_status]
    : (Object.keys(STATUS_CFG) as LifecycleStatus[]);

  return (
    <ThemedView style={{ flex: 1 }}>
      {/* Search bar */}
      <View style={[st.searchRow, { backgroundColor: theme.backgroundDefault }]}>
        <Feather name="search" size={16} color={theme.textSecondary} />
        <TextInput
          style={[st.searchInput, { color: theme.text }]}
          placeholder="Search by name or employee ID..."
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Feather name="x" size={16} color={theme.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ maxHeight: 52 }}
        contentContainerStyle={st.chipRow}
      >
        {(["all", ...Object.keys(STATUS_CFG)] as (LifecycleStatus | "all")[]).map(status => {
          const cfg = status === "all" ? null : STATUS_CFG[status];
          const isActive = filterStatus === status;
          return (
            <TouchableOpacity
              key={status}
              style={[st.chip, {
                backgroundColor: isActive ? (cfg?.color || theme.primary) : theme.backgroundDefault,
                borderColor: cfg?.color || theme.primary,
              }]}
              onPress={() => setFilterStatus(status)}
            >
              <ThemedText style={[st.chipTxt, { color: isActive ? "#fff" : (cfg?.color || theme.text) }]}>
                {status === "all"
                  ? `All (${employees.length})`
                  : `${cfg!.label} (${counts[status] || 0})`}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={st.list}>
          {filtered.length === 0 ? (
            <View style={st.empty}>
              <Feather name="users" size={40} color={theme.textSecondary} />
              <Spacer height={12} />
              <ThemedText style={{ color: theme.textSecondary }}>No employees found</ThemedText>
            </View>
          ) : filtered.map(emp => {
            const cfg = STATUS_CFG[emp.lifecycle_status] || STATUS_CFG.active;
            const deptName = getDeptName(emp.department);
            const desigName = getDesigName(emp.designation);
            return (
              <TouchableOpacity
                key={emp.id}
                style={[st.card, { backgroundColor: theme.backgroundDefault, borderLeftColor: cfg.color }]}
                onPress={() => openEdit(emp)}
                activeOpacity={0.82}
              >
                <View style={st.cardRow}>
                  <View style={[st.avatar, { backgroundColor: cfg.color + "20" }]}>
                    <ThemedText style={{ fontSize: 17, fontWeight: "800", color: cfg.color }}>
                      {emp.name.charAt(0).toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={st.empName}>{emp.name}</ThemedText>
                    {emp.employee_number ? (
                      <ThemedText style={[st.empMeta, { color: theme.primary, fontWeight: "700" }]}>
                        #{emp.employee_number}
                      </ThemedText>
                    ) : null}
                    <ThemedText style={[st.empMeta, { color: theme.textSecondary }]}>
                      {emp.role?.replace(/_/g, " ")}
                      {deptName ? ` · ${deptName}` : ""}
                    </ThemedText>
                    {desigName ? (
                      <ThemedText style={[st.empMeta, { color: theme.textSecondary }]}>{desigName}</ThemedText>
                    ) : null}
                    {emp.date_of_joining ? (
                      <ThemedText style={[st.empMeta, { color: theme.textSecondary }]}>
                        Joined: {new Date(emp.date_of_joining).toLocaleDateString("en-IN")}
                      </ThemedText>
                    ) : null}
                    {emp.lifecycle_status === "exit" && emp.date_of_exit ? (
                      <ThemedText style={[st.empMeta, { color: Colors.light.error }]}>
                        Exited: {new Date(emp.date_of_exit).toLocaleDateString("en-IN")}
                      </ThemedText>
                    ) : null}
                  </View>
                  <View>
                    <View style={[st.badge, { backgroundColor: cfg.color + "20" }]}>
                      <Feather name={cfg.icon} size={11} color={cfg.color} />
                      <ThemedText style={[st.badgeTxt, { color: cfg.color }]}>{cfg.label}</ThemedText>
                    </View>
                    <ThemedText style={[st.editHint, { color: theme.textSecondary }]}>Tap to edit →</ThemedText>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
          <Spacer height={80} />
        </ScrollView>
      )}

      {/* ── Edit Modal ── */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={st.overlay}>
          <ThemedView style={st.modal}>
            {/* Modal header */}
            <View style={st.modalHeader}>
              <View style={{ flex: 1 }}>
                <ThemedText style={st.modalTitle}>{selectedEmp?.name}</ThemedText>
                {selectedEmp?.employee_number ? (
                  <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
                    #{selectedEmp.employee_number} · {selectedEmp.role?.replace(/_/g, " ")}
                  </ThemedText>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => setShowModal(false)} style={{ padding: 4 }}>
                <Feather name="x" size={22} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding: Spacing.lg }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

              {/* ── Lifecycle Status ── */}
              <ThemedText style={st.sectionTitle}>Lifecycle Status</ThemedText>
              <ThemedText style={[st.hint, { color: theme.textSecondary }]}>
                Only valid transitions are shown. Tap a status to change.
              </ThemedText>
              <View style={st.statusGrid}>
                {allowedStatuses.map(status => {
                  const cfg = STATUS_CFG[status];
                  const isCurrent = form.lifecycle_status === status;
                  const isOriginal = selectedEmp?.lifecycle_status === status;
                  return (
                    <TouchableOpacity
                      key={status}
                      style={[st.statusBtn, {
                        backgroundColor: isCurrent ? cfg.color : cfg.color + "15",
                        borderColor: cfg.color,
                        borderWidth: isCurrent ? 2 : 1.5,
                      }]}
                      onPress={() => confirmStatusChange(status)}
                    >
                      <Feather name={cfg.icon} size={14} color={isCurrent ? "#fff" : cfg.color} />
                      <ThemedText style={[st.statusBtnTxt, { color: isCurrent ? "#fff" : cfg.color }]}>
                        {cfg.label}
                      </ThemedText>
                      {isOriginal && !isCurrent ? (
                        <ThemedText style={{ fontSize: 9, color: cfg.color, opacity: 0.7 }}>(current)</ThemedText>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Spacer height={Spacing.lg} />

              {/* ── Department ── */}
              <ThemedText style={st.sectionTitle}>Department</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity
                    style={[st.selChip, !form.department_id && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                    onPress={() => setForm(f => ({ ...f, department_id: "", designation_id: "" }))}
                  >
                    <ThemedText style={{ color: !form.department_id ? "#fff" : theme.text, fontSize: 12 }}>None</ThemedText>
                  </TouchableOpacity>
                  {departments.map(d => (
                    <TouchableOpacity
                      key={d.id}
                      style={[st.selChip, form.department_id === d.id && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                      onPress={() => setForm(f => ({ ...f, department_id: d.id, designation_id: "" }))}
                    >
                      <ThemedText style={{ color: form.department_id === d.id ? "#fff" : theme.text, fontSize: 12 }}>
                        {d.name}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {/* ── Designation ── */}
              <ThemedText style={st.sectionTitle}>Designation</ThemedText>
              {filteredDesigs.length === 0 ? (
                <ThemedText style={[st.hint, { color: theme.textSecondary }]}>
                  {form.department_id ? "No designations for this department." : "Select a department first to filter designations."}
                </ThemedText>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity
                    style={[st.selChip, !form.designation_id && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                    onPress={() => setForm(f => ({ ...f, designation_id: "" }))}
                  >
                    <ThemedText style={{ color: !form.designation_id ? "#fff" : theme.text, fontSize: 12 }}>None</ThemedText>
                  </TouchableOpacity>
                  {filteredDesigs.map(d => (
                    <TouchableOpacity
                      key={d.id}
                      style={[st.selChip, form.designation_id === d.id && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                      onPress={() => setForm(f => ({ ...f, designation_id: d.id }))}
                    >
                      <ThemedText style={{ color: form.designation_id === d.id ? "#fff" : theme.text, fontSize: 12 }}>
                        {d.name}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {/* ── Date of Joining ── */}
              <ThemedText style={st.sectionTitle}>Date of Joining</ThemedText>
              {Platform.OS === "web" ? (
                // @ts-ignore
                <input
                  type="date"
                  value={form.date_of_joining}
                  onChange={(e: any) => setForm(f => ({ ...f, date_of_joining: e.target.value }))}
                  style={{ padding: "10px 12px", borderRadius: 8, border: "1.5px solid #E5E7EB", fontSize: 14, color: "#111", backgroundColor: "#F9FAFB", width: "100%", marginBottom: 12 }}
                />
              ) : (
                <TextInput
                  style={[st.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                  value={form.date_of_joining}
                  onChangeText={t => setForm(f => ({ ...f, date_of_joining: t }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="numeric"
                  maxLength={10}
                />
              )}

              {/* ── Date of Exit (only when exiting) ── */}
              {(form.lifecycle_status === "exit" || selectedEmp?.lifecycle_status === "exit") ? (
                <>
                  <ThemedText style={[st.sectionTitle, { color: Colors.light.error }]}>
                    Date of Exit *
                  </ThemedText>
                  {Platform.OS === "web" ? (
                    // @ts-ignore
                    <input
                      type="date"
                      value={form.date_of_exit}
                      onChange={(e: any) => setForm(f => ({ ...f, date_of_exit: e.target.value }))}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1.5px solid #EF4444", fontSize: 14, color: "#111", backgroundColor: "#FEF2F2", width: "100%", marginBottom: 12 }}
                    />
                  ) : (
                    <TextInput
                      style={[st.input, { backgroundColor: "#FEF2F2", color: theme.text, borderColor: Colors.light.error, borderWidth: 1.5 }]}
                      value={form.date_of_exit}
                      onChangeText={t => setForm(f => ({ ...f, date_of_exit: t }))}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={Colors.light.error}
                      keyboardType="numeric"
                      maxLength={10}
                    />
                  )}
                </>
              ) : null}

              {/* ── Warning banner for destructive actions ── */}
              {(form.lifecycle_status === "exit" || form.lifecycle_status === "suspended") &&
               form.lifecycle_status !== selectedEmp?.lifecycle_status ? (
                <View style={st.warningBanner}>
                  <Feather name="alert-triangle" size={16} color="#92400E" />
                  <ThemedText style={st.warningTxt}>
                    {form.lifecycle_status === "exit"
                      ? "Marking as Exited will deactivate this employee's account and they will no longer be able to log in."
                      : "Suspending this employee will deactivate their account until reinstated."}
                  </ThemedText>
                </View>
              ) : null}

              <Spacer height={Spacing.xl} />

              <TouchableOpacity
                style={[st.saveBtn, { backgroundColor: theme.primary }, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <ThemedText style={st.saveBtnTxt}>Save Changes</ThemedText>}
              </TouchableOpacity>

              <Spacer height={Spacing.xl} />
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const st = StyleSheet.create({
  searchRow: { flexDirection: "row", alignItems: "center", margin: 12, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  searchInput: { flex: 1, fontSize: 14 },
  chipRow: { paddingHorizontal: 12, gap: 8, alignItems: "center", paddingVertical: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5 },
  chipTxt: { fontSize: 12, fontWeight: "600" },
  list: { padding: 12 },
  card: { borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4 },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  empName: { fontSize: 15, fontWeight: "700", color: "#111", marginBottom: 2 },
  empMeta: { fontSize: 12, marginTop: 1 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, alignSelf: "flex-end" },
  badgeTxt: { fontSize: 11, fontWeight: "700" },
  editHint: { fontSize: 10, textAlign: "right", marginTop: 6 },
  empty: { alignItems: "center", paddingTop: 60 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "92%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  modalTitle: { fontSize: 17, fontWeight: "800" },
  sectionTitle: { fontSize: 13, fontWeight: "700", marginBottom: 8, color: "#374151" },
  hint: { fontSize: 12, marginBottom: 8 },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  statusBtnTxt: { fontSize: 13, fontWeight: "700" },
  selChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  input: { borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 12 },
  warningBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#F59E0B", borderRadius: 10, padding: 12, marginTop: 4 },
  warningTxt: { flex: 1, fontSize: 12, color: "#92400E", lineHeight: 18 },
  saveBtn: { height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  saveBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
