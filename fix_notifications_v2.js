const fs = require("fs");
let code = fs.readFileSync("notification_screen.txt", "utf-8");

// 1. Add activeTab state and Monitoring states and target team state
const states = `  const [activeTab, setActiveTab] = useState<"broadcast" | "monitoring">("broadcast");
  const [monitorStats, setMonitorStats] = useState<any[]>([]);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorFilterType, setMonitorFilterType] = useState<string>("all");
  const [targetTeam, setTargetTeam] = useState<string>("ALL");
  const [teams, setTeams] = useState<string[]>([]);
`;
code = code.replace(/const \[broadcastTitle, setBroadcastTitle\] = useState\(""\);/, `${states}\n  const [broadcastTitle, setBroadcastTitle] = useState("");`);

// 2. Add loadMonitorStats & teams
const loadMonitorStats = `
  const loadMonitorStats = useCallback(async () => {
    setMonitorLoading(true);
    const { data, error } = await supabase.rpc("rpc_admin_notification_monitoring_summary");
    if (!error && data) {
      setMonitorStats(data);
    }
    setMonitorLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    if (activeTab === "monitoring") {
      loadMonitorStats();
      const sub = supabase.channel("public:notifications")
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => { loadMonitorStats(); })
        .subscribe();
      return () => { supabase.removeChannel(sub); };
    } else {
      // Load teams
      supabase.from("teams").select("name").then(({ data }) => {
        if (data) setTeams(data.map(t => t.name));
      });
    }
  }, [activeTab, loadMonitorStats]));
`;
code = code.replace(/const sendBroadcastNotification = async \(\) => \{/, `${loadMonitorStats}\n  const sendBroadcastNotification = async () => {`);

// Update target audience logic inside sendBroadcastNotification
code = code.replace(/const \{ data: activeEmployees \}.*?\.eq\("is_active", true\);/s, `
      let query = supabase.from("profiles").select("id").eq("is_active", true).not("is_service_account", "is", true);
      if (targetTeam !== "ALL") {
        query = query.eq("team", targetTeam);
      }
      const { data: activeEmployees } = await query;
`);

// 3. Add tabs to UI and Team dropdown
const tabsJsx = `
      {/* Tabs */}
      <View style={[styles.tabs, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
        <Pressable 
          style={[styles.tab, activeTab === "broadcast" && { backgroundColor: theme.primary, borderColor: theme.primary }]}
          onPress={() => setActiveTab("broadcast")}
        >
          <ThemedText style={{ color: activeTab === "broadcast" ? "#fff" : theme.textSecondary, fontWeight: "600" }}>Broadcast</ThemedText>
        </Pressable>
        <Pressable 
          style={[styles.tab, activeTab === "monitoring" && { backgroundColor: theme.primary, borderColor: theme.primary }]}
          onPress={() => setActiveTab("monitoring")}
        >
          <ThemedText style={{ color: activeTab === "monitoring" ? "#fff" : theme.textSecondary, fontWeight: "600" }}>Monitoring</ThemedText>
        </Pressable>
      </View>
`;

code = code.replace(/<View style=\{styles\.container\}>\s*<View style=\{styles\.broadcastSection\}>/, `<View style={styles.container}>\n${tabsJsx}\n\n      {activeTab === "broadcast" ? (\n        <View style={styles.broadcastSection}>`);

// Target Team UI
const teamUI = `
          <Spacer height={Spacing.md} />
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 8 }}>Target Audience</ThemedText>
          <View style={styles.broadcastTypes}>
            <Pressable
              style={[styles.broadcastType, { backgroundColor: targetTeam === "ALL" ? Colors.light.primary : theme.backgroundDefault }]}
              onPress={() => setTargetTeam("ALL")}
            >
              <ThemedText type="caption" style={{ color: targetTeam === "ALL" ? "#fff" : theme.text, fontWeight: "600" }}>All Staff</ThemedText>
            </Pressable>
            {teams.map(t => (
              <Pressable
                key={t}
                style={[styles.broadcastType, { backgroundColor: targetTeam === t ? Colors.light.primary : theme.backgroundDefault }]}
                onPress={() => setTargetTeam(t)}
              >
                <ThemedText type="caption" style={{ color: targetTeam === t ? "#fff" : theme.text, fontWeight: "600" }}>{t}</ThemedText>
              </Pressable>
            ))}
          </View>
`;
code = code.replace(/<ThemedText\s+type="caption"\s+style=\{\{\s*color: broadcastType === value \? "#fff" : theme\.text,\s*fontWeight: "600",\s*\}\}\s*>\s*\{label\}\s*<\/ThemedText>\s*<\/Pressable>\s*\)\)\}\s*<\/View>/, `$&${teamUI}`);

// 4. Close broadcast and add monitoring
const monitorJsx = `
      ) : (
        <View style={[styles.broadcastSection, { flex: 1 }]}>
          <ThemedText type="h3">Notification Delivery Analytics</ThemedText>
          <Spacer height={Spacing.md} />
          
          <View style={styles.broadcastTypes}>
            {([["all", "All"], ["hr_announcement", "Announcement"], ["policy", "Policy"], ["emergency", "Emergency"]] as const).map(([value, label]) => (
              <Pressable
                key={value}
                style={[styles.broadcastType, { backgroundColor: monitorFilterType === value ? Colors.light.primary : theme.backgroundDefault }]}
                onPress={() => setMonitorFilterType(value)}
              >
                <ThemedText type="caption" style={{ color: monitorFilterType === value ? "#fff" : theme.text, fontWeight: "600" }}>{label}</ThemedText>
              </Pressable>
            ))}
          </View>
          
          <Spacer height={Spacing.md} />
          {monitorLoading ? <ThemedText>Loading analytics...</ThemedText> : (
            <FlatList
              data={monitorStats.filter(s => monitorFilterType === "all" || s.type === monitorFilterType)}
              keyExtractor={(item) => item.type}
              renderItem={({ item }) => (
                <View style={[styles.notificationCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border, borderWidth: 1, padding: Spacing.lg }]}>
                  <ThemedText type="body" style={{ fontWeight: "700", marginBottom: Spacing.sm, color: theme.text }}>
                    {item.type.toUpperCase().replace("_", " ")}
                  </ThemedText>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                    <View style={{ flex: 1 }}><ThemedText type="caption" style={{ color: theme.textSecondary }}>Total Sent</ThemedText><ThemedText style={{ color: theme.text, fontWeight: "700" }}>{item.total_sent}</ThemedText></View>
                    <View style={{ flex: 1 }}><ThemedText type="caption" style={{ color: theme.textSecondary }}>Read Count</ThemedText><ThemedText style={{ color: Colors.light.success, fontWeight: "700" }}>{item.read_count}</ThemedText></View>
                    <View style={{ flex: 1 }}><ThemedText type="caption" style={{ color: theme.textSecondary }}>Unread Count</ThemedText><ThemedText style={{ color: Colors.light.error, fontWeight: "700" }}>{item.unread_count}</ThemedText></View>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <ThemedText type="small" style={{ color: theme.text }}>Delivery Rate: <ThemedText style={{ fontWeight: "700", color: theme.primary }}>{item.delivery_rate}%</ThemedText></ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>Last sent: {item.last_sent ? new Date(item.last_sent).toLocaleDateString() : "Never"}</ThemedText>
                  </View>
                </View>
              )}
              ItemSeparatorComponent={() => <Spacer height={Spacing.md} />}
              ListEmptyComponent={<ThemedText style={{ textAlign: "center", color: theme.textSecondary }}>No data found</ThemedText>}
            />
          )}
        </View>
      )}
`;

code = code.replace(/<PaginationControls\s+page=\{page\}\s+totalPages=\{Math\.ceil\(total \/ PAGE_SIZE\)\}\s+onPageChange=\{setPage\}\s+\/>\s*<\/View>/, `<PaginationControls\n          page={page}\n          totalPages={Math.ceil(total / PAGE_SIZE)}\n          onPageChange={setPage}\n        />\n      </View>\n      ${monitorJsx}`);

// 5. Add styles for Tabs
code = code.replace(/broadcastSection: \{/, `tabs: { flexDirection: "row", margin: Spacing.md, padding: 4, borderRadius: BorderRadius.md, borderWidth: 1 },\n  tab: { flex: 1, paddingVertical: Spacing.sm, alignItems: "center", borderRadius: BorderRadius.sm },\n  broadcastSection: {`);
code = code.replace(/broadcastTypes: \{\s*flexDirection: "row",\s*gap: Spacing.sm,\s*flexWrap: "wrap",/, `broadcastTypes: { flexDirection: "row", gap: Spacing.sm, flexWrap: "wrap", marginBottom: Spacing.sm,`);

fs.writeFileSync("screens/admin/NotificationManagementScreen.tsx", code);
console.log("Fixed NotificationManagementScreen.tsx completely!");
