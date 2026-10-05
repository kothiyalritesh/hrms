const fs = require("fs");
let code = fs.readFileSync("components/DeviceSessionsModal.tsx", "utf-8");

const currentCard = `
          {loading ? <ActivityIndicator color="#6D1B6D" style={{ margin: 24 }} /> : null}
          {!!error ? (
            <TouchableOpacity style={styles.error} onPress={() => void load()}>
              <ThemedText style={styles.errorText}>{error} Tap to retry.</ThemedText>
            </TouchableOpacity>
          ) : null}
          
          {sessions.find(s => s.device_identifier === currentIdentifier) && (
            <View style={[styles.session, { backgroundColor: "#F0FDF4", padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "#BBF7D0", marginBottom: 16, borderTopWidth: 1, borderTopColor: "#BBF7D0" }]}>
              <View style={[styles.deviceIcon, { backgroundColor: "#DCFCE7" }]}><Feather name={sessions.find(s => s.device_identifier === currentIdentifier)?.platform === "web" ? "monitor" : "smartphone"} size={20} color="#16A34A" /></View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.deviceName, { color: "#166534" }]}>{sessions.find(s => s.device_identifier === currentIdentifier)?.device_name || "Current Device"}</ThemedText>
                <ThemedText style={[styles.meta, { color: "#15803D" }]}>ID: {currentIdentifier}</ThemedText>
                <ThemedText style={[styles.meta, { color: "#16A34A", marginTop: 4, fontWeight: "600" }]}>You are checked in from this device</ThemedText>
              </View>
            </View>
          )}

          <ThemedText style={{ fontSize: 16, fontWeight: "700", marginBottom: 12, marginTop: 8 }}>Other Devices</ThemedText>
`;
code = code.replace(/\{loading \? <ActivityIndicator color="#6D1B6D" style=\{\{ margin: 24 \}\} \/> : null\}\s*\{!!error \? \(\s*<TouchableOpacity style=\{styles\.error\} onPress=\{\(\) => void load\(\)\}>\s*<ThemedText style=\{styles\.errorText\}>\{error\} Tap to retry\.<\/ThemedText>\s*<\/TouchableOpacity>\s*\) : null\}/, currentCard);

// filter out current from the list
code = code.replace(/\{sessions\.map\(\(session\) => \{/g, `{sessions.filter(s => s.device_identifier !== currentIdentifier).map((session) => {`);

fs.writeFileSync("components/DeviceSessionsModal.tsx", code);
console.log("Updated DeviceSessionsModal.tsx");
