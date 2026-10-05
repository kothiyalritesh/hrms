const fs = require('fs');

let code = fs.readFileSync('screens/admin/LeaveBalanceScreen.tsx', 'utf8');

// 1. Add state for Reset All
const stateInjection = `  const [resetModal, setResetModal] = useState<{ visible: boolean }>({ visible: false });
  const [resetLeaveType, setResetLeaveType] = useState<LeaveType>("sick");
  const [resetFemaleDays, setResetFemaleDays] = useState("2");
  const [resetMaleDays, setResetMaleDays] = useState("1");
  const [resetReason, setResetReason] = useState("Monthly Allocation");`;

code = code.replace(/const \[actionLoading, setActionLoading\] = useState\(false\);/, `const [actionLoading, setActionLoading] = useState(false);\n${stateInjection}`);

// 2. Add handleResetAll function
const handleResetInjection = `
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
      RNAlert.alert("Success", \`Reset applied for \${data?.employees_updated || 0} employees.\`);
      setResetModal({ visible: false });
      await loadData();
    } catch (e: any) {
      RNAlert.alert("Error", e.message);
    } finally {
      setActionLoading(false);
    }
  };
`;
code = code.replace(/const removeSingle = \(emp: EmployeeBalance\) => \{/, `${handleResetInjection}\n  const removeSingle = (emp: EmployeeBalance) => {`);

// 3. Add Reset All button to toolbar
const resetButtonInjection = `
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
`;
code = code.replace(/<TouchableOpacity\s+style=\{\[styles\.actionBtn, \{ backgroundColor: Colors\.light\.error \}\]\}\s+onPress=\{\(\) => openModal\("remove"\)\}\s+>\s+<Feather name="minus" size=\{14\} color="#fff" \/>\s+<ThemedText type="caption" style=\{\{ color: "#fff", fontWeight: "700" \}\}>Remove<\/ThemedText>\s+<\/TouchableOpacity>/, `$&${resetButtonInjection}`);

// 4. Add Reset Modal JSX
const resetModalJsx = `
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
`;
code = code.replace(/(<Modal visible=\{modal\.visible\}.*?<\/Modal>)/s, `$1\n${resetModalJsx}`);

fs.writeFileSync('screens/admin/LeaveBalanceScreen.tsx', code);
console.log("Updated LeaveBalanceScreen.tsx");
