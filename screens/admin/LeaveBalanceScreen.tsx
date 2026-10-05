import React, { useState, useCallback, useMemo } from "react";
import {
  StyleSheet, View, FlatList, TouchableOpacity, TextInput,
  Modal, Alert, ActivityIndicator, ScrollView, Pressable,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Alert as RNAlert } from "react-native";
import * as Crypto from "expo-crypto";

const ALLOWED_ROLES = ["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"];

interface EmployeeBalance {
  id: string;
  name: string;
  role: string;
  sick: number;
  casual: number;
  earned: number;
  comp_off: number;
  balance_id: string | null;
  opening_balance: number;
  monthly_credited: number;
  manually_adjusted: number;
  used: number;
  reversed: number;
}

const LEAVE_TYPES = ["sick", "casual", "earned", "comp_off"] as const;
type LeaveType = (typeof LEAVE_TYPES)[number];

const LEAVE_REASONS = [
  "Comp Off",
  "Week Off",
  "Holiday Adjustment",
  "Overtime Compensation",
  "Festival Leave",
  "Medical Reimbursement",
  "Custom",
];

export default function LeaveBalanceScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [employees, setEmployees] = useState<EmployeeBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = useState(false);

  // Check if current user has HRD role (or admin role)
  const isHRDUser = useMemo(() => {
    const userRole = user?.role?.toUpperCase();
    return userRole ? ALLOWED_ROLES.includes(userRole) : false;
  }, [user?.role]);

  // Modal state
  const [modal, setModal] = useState<{ visible: boolean; mode: "add" | "remove" }>({ visible: false, mode: "add" });
  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [amount, setAmount] = useState("1");
  const [reasonOption, setReasonOption] = useState(LEAVE_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [resetModal, setResetModal] = useState<{ visible: boolean }>({ visible: false });
  const [resetLeaveType, setResetLeaveType] = useState<LeaveType>("sick");
  const [resetFemaleDays, setResetFemaleDays] = useState("2");
  const [resetMaleDays, setResetMaleDays] = useState("1");
  const [resetReason, setResetReason] = useState("Monthly Allocation");

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: summaries, error } = await supabase.rpc(
      "rpc_admin_leave_balance_summary",
    );
    if (error) {
      setLoading(false);
      RNAlert.alert("Unable to load leave balances", error.message);
      return;
    }

    setEmployees(
      (summaries || []).map((p: any) => ({
        id: p.user_id,
        name: p.employee_name || "Unknown",
        role: p.role || "",
        sick: Number(p.sick) || 0,
        casual: Number(p.casual) || 0,
        earned: Number(p.earned) || 0,
        comp_off: Number(p.comp_off) || 0,
        balance_id: p.balance_id ?? null,
        opening_balance: Number(p.opening_balance) || 0,
        monthly_credited: Number(p.monthly_credited) || 0,
        manually_adjusted: Number(p.manually_adjusted) || 0,
        used: Number(p.used) || 0,
        reversed: Number(p.reversed) || 0,
      }))
    );
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const filtered = useMemo(() =>
    search.trim()
      ? employees.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
      : employees,
    [employees, search]
  );

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openModal = (mode: "add" | "remove") => {
    if (selected.size === 0) { RNAlert.alert("Select employees", "Select at least one employee first."); return; }
    
    // Check if current user has permission
    if (!isHRDUser) {
      RNAlert.alert("Access Denied", "Only HRD users can modify leave balances.");
      return;
    }
    
    setLeaveType("casual");
    setAmount("1");
    setReasonOption(LEAVE_REASONS[0]);
    setCustomReason("");
    setModal({ visible: true, mode });
  };

  const handleConfirm = async () => {
    // Check if current user has permission
    if (!isHRDUser) {
      RNAlert.alert("Access Denied", "Only HRD users can modify leave balances.");
      return;
    }

    const n = parseInt(amount, 10);
    if (!n || n <= 0) { RNAlert.alert("Invalid", "Enter a valid number."); return; }
    const reason = reasonOption === "Custom" ? customReason.trim() : reasonOption;
    if (!reason) { RNAlert.alert("Required", "Enter a reason."); return; }

    setActionLoading(true);
    try {
      const targets = employees.filter(e => selected.has(e.id));
      for (const emp of targets) {
        const delta = modal.mode === "add" ? n : -n;
        const { data, error } = await supabase.rpc(
          "rpc_admin_adjust_leave_balance",
          {
            p_user_id: emp.id,
            p_leave_type: leaveType.toUpperCase(),
            p_quantity: delta,
            p_reason: reason,
            p_idempotency_key: Crypto.randomUUID(),
          },
        );
        const response = Array.isArray(data) ? data[0] : data;
        if (error || response?.success !== true) {
          throw error ?? new Error(response?.message || response?.error || "Adjustment was not confirmed");
        }
      }
      Alert.alert("Done", `${modal.mode === "add" ? "Added" : "Removed"} ${n} ${leaveType} day(s) for ${targets.length} employee(s).\nReason: ${reason}`);
      setModal({ visible: false, mode: "add" });
      setSelected(new Set());
      setMultiSelect(false);
      await loadData();
    } catch (e: any) {
      RNAlert.alert("Error", e.message);
    } finally {
      setActionLoading(false);
    }
  };

  
  const handleResetAll = async () => {
    if (!isHRDUser) {
      RNAlert.alert("Access Denied", "Only HRD users can modify leave balances.");
      return;
    }
    const fDays = parseFloat(resetFemaleDays);
    const mDays = parseFloat(resetMaleDays);
    if (isNaN(fDays) || isNaN(mDays) || !resetReason.trim()) {
      RNAlert.alert("Invalid", "Please enter valid days and a reason.");
      return;
    }

    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc("rpc_admin_reset_all_leave_balances", {
        p_leave_type: resetLeaveType.toUpperCase(),
        p_female_days: fDays,
        p_male_days: mDays,
        p_reason: resetReason.trim(),
      });
      if (error) throw error;
      RNAlert.alert("Success", `Reset applied for ${data?.employees_updated || 0} employees.`);
      setResetModal({ visible: false });
      await loadData();
    } catch (e: any) {
      RNAlert.alert("Error", e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const removeSingle = (emp: EmployeeBalance) => {
    // Check if current user has permission
    if (!isHRDUser) {
      RNAlert.alert("Access Denied", "Only HRD users can modify leave balances.");
      return;
    }
    
    setSelected(new Set([emp.id]));
    setLeaveType("casual");
    setAmount("1");
    setReasonOption(LEAVE_REASONS[0]);
    setCustomReason("");
    setModal({ visible: true, mode: "remove" });
  };

  const renderEmployee = ({ item }: { item: EmployeeBalance }) => {
    const isSelected = selected.has(item.id);
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: isSelected ? theme.primary : "transparent", borderWidth: 2 }]}
        onPress={() => multiSelect ? toggleSelect(item.id) : null}
        onLongPress={() => { setMultiSelect(true); toggleSelect(item.id); }}
        activeOpacity={0.8}
      >
        <View style={styles.cardTop}>
          <View style={styles.nameRow}>
            {multiSelect && (
              <View style={[styles.checkbox, { borderColor: theme.primary, backgroundColor: isSelected ? theme.primary : "transparent" }]}>
                {isSelected && <Feather name="check" size={12} color="#fff" />}
              </View>
            )}
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: "600", color: theme.text }}>{item.name}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>{item.role}</ThemedText>
            </View>
          </View>
          {!multiSelect && (
            <TouchableOpacity onPress={() => removeSingle(item)} style={[styles.removeBtn, { backgroundColor: Colors.light.error + "18" }]}>
              <Feather name="minus" size={14} color={Colors.light.error} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.balanceRow}>
          {LEAVE_TYPES.map(t => (
            <View key={t} style={[styles.balChip, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText type="caption" style={{ color: theme.textSecondary, textTransform: "capitalize" }}>{t.replace("_", " ")}</ThemedText>
              <ThemedText style={{ fontWeight: "700", color: theme.text, fontSize: 16 }}>{item[t]}</ThemedText>
            </View>
          ))}
        </View>
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 8 }}>
          Casual ledger: opening {item.opening_balance} · monthly +{item.monthly_credited} · manual {item.manually_adjusted} · used {item.used} · reversed {item.reversed}
        </ThemedText>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
        <Feather name="search" size={16} color={theme.textSecondary} />
        <TextInput
          style={{ flex: 1, color: theme.text, fontSize: 14, marginLeft: Spacing.sm }}
          placeholder="Search employee..."
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")}><Feather name="x" size={16} color={theme.textSecondary} /></Pressable>
        )}
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.toolBtn, { backgroundColor: multiSelect ? theme.primary + "18" : theme.backgroundDefault, borderColor: multiSelect ? theme.primary : theme.border }]}
          onPress={() => { setMultiSelect(!multiSelect); setSelected(new Set()); }}
        >
          <Feather name="check-square" size={14} color={multiSelect ? theme.primary : theme.textSecondary} />
          <ThemedText type="caption" style={{ color: multiSelect ? theme.primary : theme.textSecondary, fontWeight: "600" }}>
            {multiSelect ? `${selected.size} selected` : "Multi-select"}
          </ThemedText>
        </TouchableOpacity>

        <View style={styles.actionBtns}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: Colors.light.success }]}
            onPress={() => openModal("add")}
          >
            <Feather name="plus" size={14} color="#fff" />
            <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700" }}>Add</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: Colors.light.error }]}
            onPress={() => openModal("remove")}
          >
            <Feather name="minus" size={14} color="#fff" />
            <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700" }}>Remove</ThemedText>
          </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#6366F1", marginLeft: 4 }]}
              onPress={() => {
                if (!isHRDUser) { RNAlert.alert("Access Denied"); return; }
                setResetModal({ visible: true });
              }}
            >
              <Feather name="refresh-cw" size={14} color="#fff" />
              <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700" }}>Reset All</ThemedText>
            </TouchableOpacity>

        </View>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={theme.primary} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={e => e.id}
          renderItem={renderEmployee}
          contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Feather name="users" size={36} color={theme.textSecondary} />
              <Spacer height={Spacing.md} />
              <ThemedText style={{ color: theme.textSecondary }}>No employees found</ThemedText>
            </View>
          }
        />
      )}

      {/* Add / Remove Modal */}
      <Modal visible={modal.visible} transparent animationType="slide" onRequestClose={() => setModal({ ...modal, visible: false })}>
        <View style={styles.overlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="h3">{modal.mode === "add" ? "Add Leave Balance" : "Remove Leave Balance"}</ThemedText>
              <Pressable onPress={() => setModal({ ...modal, visible: false })}><Feather name="x" size={22} color={theme.text} /></Pressable>
            </View>

            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
              {selected.size} employee{selected.size > 1 ? "s" : ""} selected
            </ThemedText>

            {/* Leave Type */}
            <ThemedText type="small" style={styles.label}>Leave Type</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md }}>
              <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                {LEAVE_TYPES.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, { backgroundColor: leaveType === t ? theme.primary : theme.backgroundSecondary, borderColor: leaveType === t ? theme.primary : theme.border }]}
                    onPress={() => setLeaveType(t)}
                  >
                    <ThemedText type="caption" style={{ color: leaveType === t ? "#fff" : theme.text, fontWeight: "600", textTransform: "capitalize" }}>
                      {t.replace("_", " ")}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Amount */}
            <ThemedText type="small" style={styles.label}>Days *</ThemedText>
            <TextInput
              style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text, borderColor: theme.border }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="1"
              placeholderTextColor={theme.textSecondary}
            />

            {/* Reason */}
            <ThemedText type="small" style={styles.label}>Reason *</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.sm }}>
              <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                {LEAVE_REASONS.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.chip, { backgroundColor: reasonOption === r ? theme.primary : theme.backgroundSecondary, borderColor: reasonOption === r ? theme.primary : theme.border }]}
                    onPress={() => setReasonOption(r)}
                  >
                    <ThemedText type="caption" style={{ color: reasonOption === r ? "#fff" : theme.text, fontWeight: "600" }}>{r}</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            {reasonOption === "Custom" && (
              <TextInput
                style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text, borderColor: theme.border, marginTop: Spacing.sm }]}
                value={customReason}
                onChangeText={setCustomReason}
                placeholder="Enter custom reason..."
                placeholderTextColor={theme.textSecondary}
                autoFocus
              />
            )}

            <Spacer height={Spacing.lg} />
            <View style={styles.modalFooter}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.backgroundSecondary }]} onPress={() => setModal({ ...modal, visible: false })}>
                <ThemedText type="small" style={{ fontWeight: "600" }}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: modal.mode === "add" ? Colors.light.success : Colors.light.error }]}
                onPress={handleConfirm}
                disabled={actionLoading}
              >
                {actionLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <ThemedText type="small" style={{ color: "#fff", fontWeight: "700" }}>{modal.mode === "add" ? "Add Days" : "Remove Days"}</ThemedText>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reset All Modal */}
      <Modal visible={resetModal.visible} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={[styles.modalBox, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Reset All Balances</ThemedText>
              <Pressable onPress={() => setResetModal({ visible: false })}><Feather name="x" size={24} color={theme.textSecondary} /></Pressable>
            </View>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
              This will overwrite the current balance for ALL employees (based on gender).
            </ThemedText>
            
            <ThemedText style={styles.label}>Leave Type</ThemedText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs, marginBottom: Spacing.md }}>
              {LEAVE_TYPES.map(lt => (
                <Pressable
                  key={lt}
                  style={[styles.chip, { backgroundColor: resetLeaveType === lt ? theme.primary : "transparent", borderColor: theme.border }]}
                  onPress={() => setResetLeaveType(lt)}
                >
                  <ThemedText style={{ color: resetLeaveType === lt ? "#fff" : theme.text }}>{lt.replace("_", " ").toUpperCase()}</ThemedText>
                </Pressable>
              ))}
            </View>

            <View style={{ flexDirection: "row", gap: Spacing.md, marginBottom: Spacing.md }}>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.label}>Female Days</ThemedText>
                <TextInput
                  style={[styles.input, { borderColor: theme.border, color: theme.text }]}
                  keyboardType="numeric"
                  value={resetFemaleDays}
                  onChangeText={setResetFemaleDays}
                />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.label}>Male Days</ThemedText>
                <TextInput
                  style={[styles.input, { borderColor: theme.border, color: theme.text }]}
                  keyboardType="numeric"
                  value={resetMaleDays}
                  onChangeText={setResetMaleDays}
                />
              </View>
            </View>

            <ThemedText style={styles.label}>Reason</ThemedText>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, marginBottom: Spacing.xl }]}
              value={resetReason}
              onChangeText={setResetReason}
            />

            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: actionLoading ? theme.textSecondary : theme.primary }]}
              onPress={handleResetAll}
              disabled={actionLoading}
            >
              {actionLoading ? <ActivityIndicator color="#fff" /> : <ThemedText style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>Confirm Reset All</ThemedText>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: { flexDirection: "row", alignItems: "center", margin: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, borderWidth: 1 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  toolBtn: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, borderWidth: 1 },
  actionBtns: { flexDirection: "row", gap: Spacing.sm },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing["2xl"] },
  card: { borderRadius: BorderRadius.lg, padding: Spacing.md, gap: Spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, flex: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  removeBtn: { padding: Spacing.sm, borderRadius: BorderRadius.full },
  balanceRow: { flexDirection: "row", gap: Spacing.xs, flexWrap: "wrap" },
  balChip: { flex: 1, minWidth: 60, alignItems: "center", padding: Spacing.sm, borderRadius: BorderRadius.sm, gap: 2 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { borderTopLeftRadius: BorderRadius["2xl"], borderTopRightRadius: BorderRadius["2xl"], padding: Spacing.xl, paddingBottom: Spacing["2xl"] },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: Spacing.sm },
  label: { fontWeight: "600", marginBottom: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, borderWidth: 1 },
  input: { borderWidth: 1.5, borderRadius: BorderRadius.sm, padding: Spacing.md, fontSize: 14, marginBottom: 0 },
  modalFooter: { flexDirection: "row", gap: Spacing.md },
  modalBtn: { flex: 1, paddingVertical: 13, borderRadius: BorderRadius.sm, alignItems: "center" },
});
