const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add Animated to imports
if (!content.includes('Animated,')) {
  content = content.replace('import { View, Text, StyleSheet, Pressable, ScrollView, Modal, ActivityIndicator, Platform, Image } from "react-native";', 'import { View, Text, StyleSheet, Pressable, ScrollView, Modal, ActivityIndicator, Platform, Image, Animated, Easing } from "react-native";');
}

// 2. Fetch Leaderboard & Forecast
content = content.replace(
  'const [canonicalData, alertResult] = await Promise.all([',
  `const tomorrow = new Date(new Date().getTime() + 5.5 * 3600000);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tmrwStr = tomorrow.toISOString().slice(0, 10);
        
        const [canonicalData, alertResult, fvResult, leaveResult] = await Promise.all([`
);

content = content.replace(
  '.limit(10),\n        ]);',
  `.limit(10),
          supabase.from("field_visits").select("user_id, client_name").eq("visit_date", today).eq("status", "COMPLETED"),
          supabase.from("leave_requests").select("user_id, leave_type").eq("status", "approved").lte("start_date", tmrwStr).gte("end_date", tmrwStr)
        ]);`
);

// 3. Add state variables for leaderboard and forecast
content = content.replace(
  'const [offices,     setOffices]     = useState<OfficeStat[]>([]);',
  `const [offices,     setOffices]     = useState<OfficeStat[]>([]);
    const [leaderboard, setLeaderboard] = useState<{name:string, count:number}[]>([]);
    const [forecast,    setForecast]    = useState<{name:string, type:string}[]>([]);
    const tickerAnim = useRef(new Animated.Value(0)).current;`
);

// 4. Start ticker animation
content = content.replace(
  'const canonicalRows = canonicalData as CanonicalAttendanceDay[];',
  `const canonicalRows = canonicalData as CanonicalAttendanceDay[];
        
        // Compute Leaderboard
        if (fvResult?.data) {
          const counts: Record<string, number> = {};
          fvResult.data.forEach(v => counts[v.user_id] = (counts[v.user_id] || 0) + 1);
          const top = Object.entries(counts)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 3)
            .map(([uid, count]) => {
              const u = canonicalRows.find(r => r.user_id === uid);
              return { name: u ? u.employee_name : "Unknown", count };
            });
          setLeaderboard(top);
        }
        
        // Compute Forecast
        if (leaveResult?.data) {
          const leaves = leaveResult.data.map(l => {
            const u = canonicalRows.find(r => r.user_id === l.user_id);
            return { name: u ? u.employee_name : "Unknown", type: l.leave_type };
          });
          setForecast(leaves);
        }
        
        // Reset Ticker
        tickerAnim.setValue(0);
        Animated.loop(
          Animated.timing(tickerAnim, {
            toValue: 1,
            duration: 15000,
            easing: Easing.linear,
            useNativeDriver: true
          })
        ).start();
        `
);

// 5. Replace text BOP logo with Image
content = content.replace(
  '<Text style={s.brandBop}>\n              bop<Text style={{ color: C.pink }}>.in</Text>\n            </Text>',
  '<Image source={require("@/assets/images/logo.png")} style={{ width: 100, height: 32, resizeMode: "contain" }} />'
);

// 6. Add Leaderboard & Forecast UI to the middle section (under Office Occupancy)
content = content.replace(
  '</ScrollView>\n            </View>\n  \n            <View style={s.panel}>\n              <Text style={s.panelTitle}>NEEDS ATTENTION</Text>',
  `</ScrollView>
            </View>

            <View style={s.panel}>
              <Text style={s.panelTitle}>🏆 TOP AGENTS TODAY</Text>
              <View style={{ marginBottom: 15 }}>
                {leaderboard.length === 0 ? <Text style={s.empty}>No visits yet</Text> : leaderboard.map((l, i) => (
                  <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#333" }}>
                    <Text style={{ color: "#fff", fontWeight: "600" }}>{i+1}. {l.name}</Text>
                    <Text style={{ color: C.teal, fontWeight: "700" }}>{l.count} visits</Text>
                  </View>
                ))}
              </View>
              
              <Text style={s.panelTitle}>📅 TOMORROW'S ROSTER</Text>
              <View>
                {forecast.length === 0 ? <Text style={s.empty}>Everyone is working</Text> : forecast.map((f, i) => (
                  <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#333" }}>
                    <Text style={{ color: "#fff" }}>{f.name}</Text>
                    <Text style={{ color: C.pink, fontSize: 12 }}>{f.type}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={s.panel}>
              <Text style={s.panelTitle}>NEEDS ATTENTION</Text>`
);

// 7. Add Red Flag Ticker Tape at the bottom of the root View
content = content.replace(
  '{/* 🔴 FRAUD MODAL 🔴 */}',
  `{/* Ticker Tape */}
        {alerts.length > 0 && (
          <View style={{ backgroundColor: "#500", overflow: "hidden", height: 30, justifyContent: "center" }}>
            <Animated.View style={{ flexDirection: "row", transform: [{ translateX: tickerAnim.interpolate({ inputRange: [0, 1], outputRange: [800, -800] }) }] }}>
              {alerts.map((a, i) => (
                <Text key={i} style={{ color: "#fff", fontWeight: "700", marginRight: 50 }}>
                  🚨 {a.name} - {a.text}
                </Text>
              ))}
            </Animated.View>
          </View>
        )}
  
        {/* 🔴 FRAUD MODAL 🔴 */}`
);

fs.writeFileSync(file, content, 'utf8');
console.log("Injected TV Dashboard features");