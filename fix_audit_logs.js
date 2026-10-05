const fs = require("fs");
let code = fs.readFileSync("screens/admin/AuditLogsScreen.tsx", "utf-8");

// Inject summary state and fetch
const stateInjection = `  const [summary, setSummary] = useState<any>(null);
  const loadSummary = useCallback(async () => {
    const { data } = await supabase.rpc("rpc_admin_audit_logs_summary");
    if (data) setSummary(data);
  }, []);
`;
code = code.replace(/const loadAuditLogs = useCallback\(async \(\) => \{/, stateInjection + `\n  const loadAuditLogs = useCallback(async () => {`);

code = code.replace(/useFocusEffect\(useCallback\(\(\) => \{/, `useFocusEffect(useCallback(() => {\n    loadSummary();`);

// Add CSV Export Button to header
if (!code.includes("downloadCSV")) {
  code = code.replace(/import \{ StyleSheet, View, FlatList, Pressable \} from "react-native";/, `import { StyleSheet, View, FlatList, Pressable, Platform, ScrollView } from "react-native";`);
  
  const csvInjection = `
  const downloadCSV = () => {
    if (Platform.OS !== "web") {
      alert("Export is only supported on Web.");
      return;
    }
    const header = "Action,Table,Record ID,Performed By,Date\\n";
    const rows = logs.map(l => \`"\${l.action}","\${l.table_name}","\${l.record_id}","\${l.user_name || l.performed_by}","\${new Date(l.performed_at).toLocaleString()}"\`).join("\\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Audit_Logs.csv";
    a.click();
  };
`;
  code = code.replace(/return \(/, csvInjection + `\n  return (`);

  // Add the export button and summary cards in the JSX
  const summaryJSX = `
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: Spacing.md }}>
        <ThemedText type="h3">System Audit Logs</ThemedText>
        <Pressable onPress={downloadCSV} style={{ backgroundColor: Colors.light.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }}>
          <ThemedText style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Export CSV</ThemedText>
        </Pressable>
      </View>

      {summary && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md, flexGrow: 0 }}>
          <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>TODAY</ThemedText>
            <ThemedText type="h2">{summary.total_today || 0}</ThemedText>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>THIS WEEK</ThemedText>
            <ThemedText type="h2">{summary.total_week || 0}</ThemedText>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>MOST ACTIVE</ThemedText>
            <ThemedText type="defaultSemiBold">{summary.most_active_admin || "N/A"}</ThemedText>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>TOP TABLE</ThemedText>
            <ThemedText type="defaultSemiBold">{summary.most_modified_table || "N/A"}</ThemedText>
          </View>
        </ScrollView>
      )}
`;
  code = code.replace(/<ThemedText type="h3" style=\{styles\.title\}>Audit Logs<\/ThemedText>/, summaryJSX);

  // Add styles
  code = code.replace(/list: \{/, `summaryCard: { padding: 16, borderRadius: 12, borderWidth: 1, minWidth: 140, marginRight: 12 },\n  list: {`);
}

fs.writeFileSync("screens/admin/AuditLogsScreen.tsx", code);
console.log("Enhanced AuditLogsScreen");
