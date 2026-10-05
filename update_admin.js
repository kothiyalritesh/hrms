const fs = require('fs');
let content = fs.readFileSync('screens/admin/AdminDashboardScreen.tsx', 'utf-8');

const tvBtnRegex = /\{\/\* TV Screen shortcut in hero \*\/\}\s*<Pressable\s*style=\{\(\{ pressed \}\) => \[s\.tvBtn,\s*\{\s*opacity: pressed \? 0\.85 : 1 \}\]\}\s*onPress=\{\(\) => navigation\.navigate\("TVDisplay"\)\}\s*>\s*<Feather name="monitor" size=\{18\} color="#fff" \/>\s*<ThemedText\s*type="caption"\s*style=\{\{\s*color: "#fff",\s*fontWeight: "700",\s*marginTop: 3,\s*fontSize: 10,\s*\}\}\s*>\s*TV Board\s*<\/ThemedText>\s*<\/Pressable>/;

if (content.match(tvBtnRegex)) {
  const replacement = `{/* Right side action buttons */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.4)",
                  borderRadius: 20,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  opacity: pressed ? 0.7 : 1,
                  backgroundColor: "rgba(255,255,255,0.12)",
                }
              ]}
              onPress={onRefresh}
            >
              <Feather name="refresh-ccw" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
              <ThemedText style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}>Refresh</ThemedText>
            </Pressable>
            
            <Pressable
              style={({ pressed }) => [s.tvBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => navigation.navigate("TVDisplay")}
            >
              <Feather name="monitor" size={18} color="#fff" />
              <ThemedText
                type="caption"
                style={{
                  color: "#fff",
                  fontWeight: "700",
                  marginTop: 3,
                  fontSize: 10,
                }}
              >
                TV Board
              </ThemedText>
            </Pressable>
          </View>`;
  content = content.replace(tvBtnRegex, replacement);
  fs.writeFileSync('screens/admin/AdminDashboardScreen.tsx', content, 'utf-8');
  console.log("Added refresh button to AdminDashboardScreen");
} else {
  console.log("Could not match TV Board button regex");
}
