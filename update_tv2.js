const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace using regex for the middle section
content = content.replace(
  /<\/ScrollView>\s*<\/View>\s*<View style=\{s\.panel\}>\s*<Text style=\{s\.panelTitle\}>NEEDS ATTENTION<\/Text>/g,
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

fs.writeFileSync(file, content, 'utf8');
console.log("Injected UI properly");