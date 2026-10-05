const fs = require("fs");
let code = fs.readFileSync("screens/MyActivityLogsScreen.tsx", "utf-8");

const states = `  const [logs,       setLogs]       = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("all");
`;
code = code.replace(/const \[logs,.*?setTotal\(0\);/s, states);

const loadLogs = `
  const loadLogs = async (requestedPage = page, currentFilter = filter) => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase.rpc("rpc_my_unified_activity_log", {
        p_category: currentFilter,
        p_offset: requestedPage * PAGE_SIZE,
        p_limit: PAGE_SIZE
      });
      if (error) throw error;
      setLogs(data || []);
      // Pagination hack, if we get PAGE_SIZE, assume more
      setTotal((requestedPage * PAGE_SIZE) + (data?.length === PAGE_SIZE ? PAGE_SIZE + 1 : data?.length || 0));
      setPage(requestedPage);
      setFilter(currentFilter);
    } catch (err: any) {
      console.warn("Error fetching logs", err);
    } finally {
      setLoading(false);
    }
  };
`;
code = code.replace(/const loadLogs = async.*?finally \{\s*setLoading\(false\);\s*\}\s*\};/s, loadLogs);

// Fix hook
code = code.replace(/useFocusEffect\(useCallback\(\(\) => \{ setLoading\(true\); void loadLogs\(0\); \}, \[user\?\.id\]\)\);/, `useFocusEffect(useCallback(() => { setLoading(true); void loadLogs(0, filter); }, [user?.id, filter]));`);

// Fix UI
const headerCode = `
      <PageHeader title="Activity Logs" onBack={() => navigation.goBack()} />
      
      <View style={{ padding: Spacing.md, backgroundColor: theme.backgroundSecondary, margin: Spacing.md, borderRadius: BorderRadius.md }}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Showing: Check-ins, Check-outs, Field Visits, Leave Applications, System Actions
        </ThemedText>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: Spacing.md, marginBottom: Spacing.md }}>
        {[
          { id: "all", label: "All" },
          { id: "attendance", label: "Attendance" },
          { id: "leave", label: "Leave" },
          { id: "field_visit", label: "Field Visit" },
          { id: "system", label: "System" }
        ].map(cat => (
          <TouchableOpacity
            key={cat.id}
            style={{
              paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8,
              backgroundColor: filter === cat.id ? theme.primary : theme.backgroundSecondary
            }}
            onPress={() => loadLogs(0, cat.id)}
          >
            <ThemedText style={{ color: filter === cat.id ? "#fff" : theme.text }}>{cat.label}</ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>
`;
code = code.replace(/<PageHeader title="Activity Logs" onBack=\{.*?\} \/>/, headerCode);

// Fix map to use new RPC fields
code = code.replace(/const d = item\.timestamp \|\| item\.created_at;/g, `const d = item.timestamp;`);
code = code.replace(/let badgeColor = ACTIVITY_COLORS.*?;/s, `
            let badgeColor = PRIMARY;
            if (item.category === 'attendance') badgeColor = "#10B981";
            if (item.category === 'leave') badgeColor = "#F59E0B";
            if (item.category === 'system') badgeColor = "#6B7280";
`);

code = code.replace(/\{item\.activity_type\?.replace\(\/_\/g, " "\) \|\| "ACTIVITY"\}/g, `{item.title || item.category}`);
code = code.replace(/\{item\.summary \|\| item\.meeting_purpose \|\| "No details"}/g, `{item.description}`);
code = code.replace(/\{item\.client_name \|\| item\.company_name\}/g, `{""}`); // hide if undefined

fs.writeFileSync("screens/MyActivityLogsScreen.tsx", code);
console.log("Updated MyActivityLogsScreen.tsx");
