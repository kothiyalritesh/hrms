const fs = require('fs');
let content = fs.readFileSync('screens/DashboardScreen.tsx', 'utf-8');

// 1. Add "Updated just now" below the role text
const roleTextRegex = /<ThemedText type="caption" style=\{styles\.roleText\}>\s*\{toTitleCase\(user\?\.role\?\.replace\(\/_\/g, " "\)\)\}\s*<\/ThemedText>/s;
if (content.match(roleTextRegex)) {
  const updatedHtml = `<ThemedText type="caption" style={styles.roleText}>
                {toTitleCase(user?.role?.replace(/_/g, " "))}
              </ThemedText>
              <ThemedText type="caption" style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 4 }}>
                Updated just now
              </ThemedText>`;
  content = content.replace(roleTextRegex, updatedHtml);
}

// 2. Add Refresh button next to bell button
const bellRegex = /<Pressable\s*style=\{\(\{ pressed \}\) => \[\s*styles\.bellBtn,\s*\{\s*opacity: pressed \? 0\.7 : 1\s*},\s*\]\}\s*onPress=\{[^}]*\}\s*accessibilityLabel="Notifications"\s*>/;
if (content.match(bellRegex)) {
  const refreshHtml = `<Pressable
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.4)",
                  borderRadius: 20,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  marginRight: 12,
                  opacity: pressed ? 0.7 : 1,
                }
              ]}
              onPress={onRefresh}
            >
              <Feather name="refresh-cw" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
              <ThemedText style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}>Refresh</ThemedText>
            </Pressable>
            
            <Pressable
              style={({ pressed }) => [
                styles.bellBtn,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => navigation.navigate("Notifications")}
              accessibilityLabel="Notifications"
            >`;
  content = content.replace(bellRegex, refreshHtml);
}

// 3. Make the headerTop layout flex to push right items to the end
const headerTopRegex = /headerTop:\s*\{\s*flexDirection:\s*"row",\s*alignItems:\s*"center",\s*marginBottom:\s*24,\s*\}/;
if (content.match(headerTopRegex)) {
  content = content.replace(headerTopRegex, 'headerTop: { flexDirection: "row", alignItems: "center", marginBottom: 24, }');
}

fs.writeFileSync('screens/DashboardScreen.tsx', content, 'utf-8');
console.log("Updated header layout");
