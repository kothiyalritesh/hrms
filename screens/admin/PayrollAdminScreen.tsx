import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollService, PayrollRun, Payslip, computeSalaryComponents } from "@/services/payroll.service";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function PayrollAdminScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [tab, setTab] = useState<"runs" | "salary">("runs");
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [showRunModal, setShowRunModal] = useState(false);
  const [showSalaryModal, setShowSalaryModal] = useState(false);
  const [showPayslipsModal, setShowPayslipsModal] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [ctcInput, setCtcInput] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split("T")[0]);
  const [preview, setPreview] = useState<ReturnType<typeof computeSalaryComponents> | null>(null);
  const [runMonth, setRunMonth] = useState(new Date().getMonth() + 1);
  const [runYear, setRunYear] = useState(new Date().getFullYear());

  const load = useCallback(async () => {
    setLoading(true);
    const [runsData, empData] = await Promise.all([
      PayrollService.getPayrollRuns(),
      supabase.from("profiles").select("id, name, employee_number").eq("is_active", true).order("name"),
    ]);
    setRuns(runsData);
    setEmployees(empData.data || []);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRunPayroll = async () => {
    Alert.alert(
      "Run Payroll",
      `Process payroll for ${MONTHS[runMonth - 1]} ${runYear}?\n\nThis will generate payslips for all active employees.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Run Now",
          onPress: async () => {
            setRunning(true);
            setShowRunModal(false);
            try {
              const result = await PayrollService.runPayroll(runMonth, runYear, user!.id);
              await load();
              Alert.alert("✅ Payroll Complete", `Processed ${result.employeesProcessed} employees.\nTotal Net: ${fmt(result.totalNet)}`);
            } catch (e: any) {
              Alert.alert("Error", e.message || "Payroll run failed.");
            } finally {
              setRunning(false);
            }
          },
        },
      ]
    );
  };

  const handleMarkPaid = async (run: PayrollRun) => {
    Alert.alert("Mark as Paid", `Mark ${MONTHS[run.month - 1]} ${run.year} payroll as paid?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Mark Paid",
        onPress: async () => {
          await PayrollService.markAsPaid(run.id);
          await load();
          Alert.alert("✅ Marked as Paid");
        },
      },
    ]);
  };

  const openPayslips = async (run: PayrollRun) => {
    setSelectedRun(run);
    const data = await PayrollService.getPayslipsForRun(run.id);
    setPayslips(data);
    setShowPayslipsModal(true);
  };

  const handlePreviewSalary = () => {
    const ctc = parseFloat(ctcInput);
    if (!ctc || ctc <= 0) { Alert.alert("Error", "Enter a valid CTC amount."); return; }
    setPreview(computeSalaryComponents(ctc));
  };

  const handleSaveSalary = async () => {
    if (!selectedEmpId) { Alert.alert("Error", "Select an employee."); return; }
    const ctc = parseFloat(ctcInput);
    if (!ctc || ctc <= 0) { Alert.alert("Error", "Enter a valid CTC."); return; }
    try {
      const { error } = await PayrollService.saveSalaryStructure(selectedEmpId, ctc, effectiveFrom, user!.id);
      if (error) throw error;
      setShowSalaryModal(false);
      setCtcInput(""); setPreview(null); setSelectedEmpId("");
      Alert.alert("✅ Salary structure saved.");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const statusColor = (s: string) => ({ draft: "#9CA3AF", processing: "#F59E0B", completed: "#3B82F6", paid: "#10B981" }[s] || "#9CA3AF");

  return (
    <ThemedView style={{ flex: 1 }}>
      {/* Tabs */}
      <View style={[s.tabRow, { backgroundColor: theme.backgroundDefault }]}>
        {(["runs", "salary"] as const).map((t) => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]} onPress={() => setTab(t)}>
            <ThemedText style={[s.tabTxt, { color: tab === t ? theme.primary : theme.textSecondary }]}>
              {t === "runs" ? "Payroll Runs" : "Salary Structures"}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
          {tab === "runs" ? (
            <>
              <TouchableOpacity style={[s.runBtn, { backgroundColor: theme.primary }]} onPress={() => setShowRunModal(true)} disabled={running}>
                {running ? <ActivityIndicator color="#fff" /> : (
                  <><Feather name="play" size={16} color="#fff" /><ThemedText style={s.runBtnTxt}>Run Payroll</ThemedText></>
                )}
              </TouchableOpacity>
              <Spacer height={16} />
              {runs.length === 0 ? (
                <View style={s.empty}><Feather name="dollar-sign" size={40} color={theme.textSecondary} /><Spacer height={12} /><ThemedText style={{ color: theme.textSecondary }}>No payroll runs yet</ThemedText></View>
              ) : runs.map((run) => (
                <View key={run.id} style={[s.card, { backgroundColor: theme.backgroundDefault }]}>
                  <View style={s.cardRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={s.cardTitle}>{MONTHS[run.month - 1]} {run.year}</ThemedText>
                      <ThemedText style={[s.cardMeta, { color: theme.textSecondary }]}>{run.total_employees} employees · Net: {fmt(run.total_net)}</ThemedText>
                    </View>
                    <View style={[s.badge, { backgroundColor: statusColor(run.status) + "20" }]}>
                      <ThemedText style={[s.badgeTxt, { color: statusColor(run.status) }]}>{run.status.toUpperCase()}</ThemedText>
                    </View>
                  </View>
                  <View style={s.cardActions}>
                    <TouchableOpacity style={s.actionBtn} onPress={() => openPayslips(run)}>
                      <Feather name="list" size={14} color={theme.primary} />
                      <ThemedText style={[s.actionTxt, { color: theme.primary }]}>View Payslips</ThemedText>
                    </TouchableOpacity>
                    {run.status === "completed" && (
                      <TouchableOpacity style={s.actionBtn} onPress={() => handleMarkPaid(run)}>
                        <Feather name="check-circle" size={14} color={Colors.light.success} />
                        <ThemedText style={[s.actionTxt, { color: Colors.light.success }]}>Mark Paid</ThemedText>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </>
          ) : (
            <>
              <TouchableOpacity style={[s.runBtn, { backgroundColor: theme.primary }]} onPress={() => setShowSalaryModal(true)}>
                <Feather name="plus" size={16} color="#fff" />
                <ThemedText style={s.runBtnTxt}>Set Salary Structure</ThemedText>
              </TouchableOpacity>
              <Spacer height={16} />
              <ThemedText style={{ color: theme.textSecondary, textAlign: "center", fontSize: 13 }}>
                Select an employee and enter their annual CTC to auto-compute all salary components.
              </ThemedText>
            </>
          )}
        </ScrollView>
      )}

      {/* Run Payroll Modal */}
      <Modal visible={showRunModal} transparent animationType="fade" onRequestClose={() => setShowRunModal(false)}>
        <View style={s.overlay}>
          <ThemedView style={s.smallModal}>
            <ThemedText style={s.modalTitle}>Run Payroll</ThemedText>
            <Spacer height={16} />
            <ThemedText style={s.label}>Month</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {MONTHS.map((m, i) => (
                  <TouchableOpacity key={m} style={[s.selChip, runMonth === i + 1 && { backgroundColor: theme.primary }]} onPress={() => setRunMonth(i + 1)}>
                    <ThemedText style={{ color: runMonth === i + 1 ? "#fff" : theme.text, fontSize: 12 }}>{m.slice(0, 3)}</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <ThemedText style={s.label}>Year</ThemedText>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
              {[new Date().getFullYear() - 1, new Date().getFullYear()].map((y) => (
                <TouchableOpacity key={y} style={[s.selChip, runYear === y && { backgroundColor: theme.primary }]} onPress={() => setRunYear(y)}>
                  <ThemedText style={{ color: runYear === y ? "#fff" : theme.text, fontSize: 13 }}>{y}</ThemedText>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: "#F3F4F6" }]} onPress={() => setShowRunModal(false)}>
                <ThemedText style={{ color: "#374151", fontWeight: "600" }}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: theme.primary }]} onPress={handleRunPayroll}>
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>Run</ThemedText>
              </TouchableOpacity>
            </View>
          </ThemedView>
        </View>
      </Modal>

      {/* Salary Structure Modal */}
      <Modal visible={showSalaryModal} transparent animationType="slide" onRequestClose={() => setShowSalaryModal(false)}>
        <View style={s.overlay}>
          <ThemedView style={[s.modal, { maxHeight: "90%" }]}>
            <View style={s.modalHeader}>
              <ThemedText style={s.modalTitle}>Set Salary Structure</ThemedText>
              <TouchableOpacity onPress={() => setShowSalaryModal(false)}><Feather name="x" size={22} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} keyboardShouldPersistTaps="handled">
              <ThemedText style={s.label}>Employee</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {employees.map((e) => (
                    <TouchableOpacity key={e.id} style={[s.selChip, selectedEmpId === e.id && { backgroundColor: theme.primary }]} onPress={() => setSelectedEmpId(e.id)}>
                      <ThemedText style={{ color: selectedEmpId === e.id ? "#fff" : theme.text, fontSize: 12 }}>{e.name}</ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <ThemedText style={s.label}>Annual CTC (₹)</ThemedText>
              <TextInput
                style={[s.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                value={ctcInput}
                onChangeText={setCtcInput}
                placeholder="e.g. 600000"
                placeholderTextColor={theme.textSecondary}
                keyboardType="numeric"
              />

              <ThemedText style={s.label}>Effective From</ThemedText>
              <TextInput
                style={[s.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                value={effectiveFrom}
                onChangeText={setEffectiveFrom}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textSecondary}
              />

              <TouchableOpacity style={[s.previewBtn, { borderColor: theme.primary }]} onPress={handlePreviewSalary}>
                <ThemedText style={{ color: theme.primary, fontWeight: "700" }}>Preview Components</ThemedText>
              </TouchableOpacity>

              {preview && (
                <View style={[s.previewBox, { backgroundColor: theme.backgroundSecondary }]}>
                  <ThemedText style={s.previewTitle}>Monthly Breakdown</ThemedText>
                  {[
                    ["Basic", preview.basic], ["HRA", preview.hra],
                    ["Special Allowance", preview.special_allowance],
                    ["Transport", preview.transport_allowance],
                    ["Medical", preview.medical_allowance],
                    ["Gross Salary", preview.gross_salary],
                    ["PF (Employee)", preview.pf_employee],
                    ["ESI (Employee)", preview.esi_employee],
                    ["Professional Tax", preview.professional_tax],
                    ["Net Salary", preview.net_salary],
                  ].map(([label, val]) => (
                    <View key={label as string} style={s.previewRow}>
                      <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>{label}</ThemedText>
                      <ThemedText style={{ fontSize: 13, fontWeight: "700", color: label === "Net Salary" ? Colors.light.success : theme.text }}>{fmt(val as number)}</ThemedText>
                    </View>
                  ))}
                </View>
              )}

              <Spacer height={16} />
              <TouchableOpacity style={[s.saveBtn, { backgroundColor: theme.primary }]} onPress={handleSaveSalary}>
                <ThemedText style={s.saveBtnTxt}>Save Salary Structure</ThemedText>
              </TouchableOpacity>
              <Spacer height={24} />
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>

      {/* Payslips Modal */}
      <Modal visible={showPayslipsModal} transparent animationType="slide" onRequestClose={() => setShowPayslipsModal(false)}>
        <View style={s.overlay}>
          <ThemedView style={[s.modal, { maxHeight: "90%" }]}>
            <View style={s.modalHeader}>
              <ThemedText style={s.modalTitle}>{selectedRun ? `${MONTHS[selectedRun.month - 1]} ${selectedRun.year} Payslips` : "Payslips"}</ThemedText>
              <TouchableOpacity onPress={() => setShowPayslipsModal(false)}><Feather name="x" size={22} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }}>
              {payslips.map((p) => (
                <View key={p.id} style={[s.card, { backgroundColor: theme.backgroundSecondary }]}>
                  <ThemedText style={s.cardTitle}>{(p.employee as any)?.name || "Employee"}</ThemedText>
                  <View style={s.cardRow}>
                    <ThemedText style={[s.cardMeta, { color: theme.textSecondary }]}>Gross: {fmt(p.gross_salary)}</ThemedText>
                    <ThemedText style={[s.cardMeta, { color: theme.textSecondary }]}>Ded: {fmt(p.total_deductions)}</ThemedText>
                    <ThemedText style={{ fontSize: 14, fontWeight: "700", color: Colors.light.success }}>Net: {fmt(p.net_salary)}</ThemedText>
                  </View>
                  <ThemedText style={[s.cardMeta, { color: theme.textSecondary }]}>
                    Present: {p.present_days}/{p.working_days} days · LOP: {p.lop_days}
                  </ThemedText>
                </View>
              ))}
              {payslips.length === 0 && <ThemedText style={{ color: theme.textSecondary, textAlign: "center" }}>No payslips generated yet.</ThemedText>}
              <Spacer height={40} />
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const s = StyleSheet.create({
  tabRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabTxt: { fontSize: 14, fontWeight: "600" },
  runBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 10 },
  runBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },
  card: { borderRadius: 12, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#111", marginBottom: 4 },
  cardMeta: { fontSize: 12 },
  cardActions: { flexDirection: "row", gap: 16, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionTxt: { fontSize: 13, fontWeight: "600" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeTxt: { fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", paddingTop: 60 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  smallModal: { margin: 20, borderRadius: 16, padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 8, color: "#374151" },
  input: { borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 12 },
  selChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  previewBtn: { borderWidth: 1.5, borderRadius: 8, paddingVertical: 10, alignItems: "center", marginBottom: 12 },
  previewBox: { borderRadius: 10, padding: 14, marginBottom: 8 },
  previewTitle: { fontSize: 14, fontWeight: "700", marginBottom: 10, color: "#374151" },
  previewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  saveBtn: { height: 50, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  saveBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },
  modalBtn: { flex: 1, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
