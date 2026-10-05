const fs = require("fs");
let code = fs.readFileSync("screens/ProfileScreen.tsx", "utf-8");

const fetchCode = `
  useEffect(() => {
    if (!user?.id) return;
    const loadTimeline = async () => {
      const { data } = await supabase.from('v_attendance_daily_canonical')
        .select('work_date, effective_status, active_name, active_site_name, latest_tracking_status')
        .eq('user_id', user.id)
        .order('work_date', { ascending: false })
        .limit(5);
      if (data) setHistoryTimeline(data);
    };
    loadTimeline();
  }, [user?.id]);
`;

code = code.replace(/const \[historyTimeline, setHistoryTimeline\] = useState<any\[\]>\(\[\]\);/, `const [historyTimeline, setHistoryTimeline] = useState<any[]>([]);\n${fetchCode}`);

// Now replace the map to show the data correctly
const timelineItem = `
                historyTimeline.map((item, index) => {
                  let color = theme.textSecondary;
                  let icon: any = "minus";
                  let title = "Absent / No Data";
                  if (item.effective_status === 'CHECKED_IN' || item.effective_status === 'CHECKED_OUT') {
                    if (item.latest_tracking_status === 'FIELD_VISIT' || item.active_site_name) {
                      color = Colors.light.primary;
                      icon = "map-pin";
                      title = "Field Visit: " + (item.active_site_name || item.active_name || "Unknown Site");
                    } else {
                      color = Colors.light.success;
                      icon = "check";
                      title = "Present in Office";
                    }
                  } else if (item.effective_status === 'LEAVE') {
                    color = Colors.light.warning;
                    icon = "sun";
                    title = "On Leave";
                  } else if (item.effective_status === 'WEEK_OFF' || item.effective_status === 'HOLIDAY') {
                    color = theme.textSecondary;
                    icon = "coffee";
                    title = item.effective_status === 'WEEK_OFF' ? "Weekly Off" : "Holiday";
                  }

                  return (
                    <View key={item.work_date} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: index === historyTimeline.length - 1 ? 0 : 16 }}>
                      <View style={{ width: 1, backgroundColor: index === historyTimeline.length - 1 ? 'transparent' : theme.border, position: 'absolute', left: 11, top: 24, bottom: -16 }} />
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12, zIndex: 2 }}>
                        <Feather name={icon} size={12} color={color} />
                      </View>
                      <View style={{ flex: 1, paddingTop: 2 }}>
                        <ThemedText type="body" style={{ fontWeight: '600', color: theme.text, lineHeight: 20 }}>{title}</ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>{new Date(item.work_date).toLocaleDateString("en-IN", { weekday: 'short', day: 'numeric', month: 'short' })}</ThemedText>
                      </View>
                    </View>
                  );
                })
`;
code = code.replace(/historyTimeline\.map\(\(item, index\) => \{[\s\S]*?<\/View>\s*\);\s*\}\)/, timelineItem);

fs.writeFileSync("screens/ProfileScreen.tsx", code);
console.log("Updated ProfileScreen.tsx");
