const fs = require('fs');
let content = fs.readFileSync('screens/ProfileScreen.tsx', 'utf8');

if (!content.includes('Recent History')) {
  // 1. Add state for timeline history
  content = content.replace(
    'const [dateOfJoining, setDateOfJoining] = useState<string | null>(null);',
    'const [dateOfJoining, setDateOfJoining] = useState<string | null>(null);\n  const [historyTimeline, setHistoryTimeline] = useState<any[]>([]);'
  );

  // 2. Add fetch logic to useEffect
  const fetchTimeline = `
      // Fetch timeline
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];
      supabase.rpc("rpc_my_attendance_daily_v3", { p_start: thirtyDaysAgo, p_end: todayStr })
        .then(({ data, error }) => {
          if (!error && data) {
            setHistoryTimeline(data.slice(0, 5));
          }
        });
  `;

  content = content.replace(
    /setDateOfJoining\(data\?\.joining_date \|\| null\);\n        \}\);\n    \}, \[user\?\.id\]\);/,
    `setDateOfJoining(data?.joining_date || null);\n        });\n${fetchTimeline}\n    }, [user?.id]);`
  );

  // 3. Add Timeline UI
  const timelineUI = `
          {/* Recent History Timeline */}
          <View style={{ marginTop: Spacing.xl, marginBottom: Spacing.xl }}>
            <ThemedText type="h4" style={{ marginBottom: Spacing.md, paddingHorizontal: Spacing.xs }}>Recent History</ThemedText>
            <View style={{ backgroundColor: theme.backgroundDefault, borderRadius: 14, padding: Spacing.lg, ...(Platform.OS === 'web' ? { boxShadow: "0 2px 8px rgba(0,0,0,0.05)" } : { shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2}) }}>
              {historyTimeline.length === 0 ? (
                <ThemedText style={{ color: theme.textSecondary, textAlign: 'center' }}>No recent history found.</ThemedText>
              ) : (
                historyTimeline.map((item, index) => {
                  let color = theme.textSecondary;
                  let icon = "minus";
                  if (item.day_status === 'PRESENT' || item.day_status === 'PRESENT_LATE' || item.day_status === 'HALF_DAY_PRESENT') { color = '#10B981'; icon = 'check-circle'; }
                  else if (item.day_status === 'ABSENT' || item.day_status === 'UNAUTHORIZED_ABSENT') { color = '#EF4444'; icon = 'x-circle'; }
                  else if (item.day_status === 'ON_LEAVE') { color = '#8B5CF6'; icon = 'umbrella'; }
                  else if (item.day_status === 'WEEKOFF' || item.day_status === 'HOLIDAY') { color = '#3B82F6'; icon = 'calendar'; }
                  
                  return (
                    <View key={item.work_date} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: index === historyTimeline.length - 1 ? 0 : 16 }}>
                      <View style={{ width: 1, backgroundColor: index === historyTimeline.length - 1 ? 'transparent' : theme.border, position: 'absolute', left: 11, top: 24, bottom: -16 }} />
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12, zIndex: 2 }}>
                        <Feather name={icon} size={12} color={color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontWeight: '600', fontSize: 14 }}>{new Date(item.work_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</ThemedText>
                        <ThemedText style={{ color: theme.textSecondary, fontSize: 13, marginTop: 2 }}>{item.day_status ? item.day_status.replace(/_/g, ' ') : 'UNKNOWN'} {item.latest_tracking_status === 'OFFICE' ? 'at ' + (item.office_name || 'Office') : (item.latest_tracking_status === 'FIELD_VISIT' ? 'on Field Visit' : '')}</ThemedText>
                      </View>
                    </View>
                  );
                })
              )}
              <Pressable 
                style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.border, alignItems: 'center' }}
                onPress={() => navigation.navigate("Attendance")}
              >
                <ThemedText style={{ color: theme.primary, fontWeight: '600' }}>View Full Calendar</ThemedText>
              </Pressable>
            </View>
          </View>
  `;

  content = content.replace(
    /<\/ScreenScrollView>/,
    `${timelineUI}\n        </ScreenScrollView>`
  );

  fs.writeFileSync('screens/ProfileScreen.tsx', content);
  console.log('Added Timeline UI to ProfileScreen');
}
