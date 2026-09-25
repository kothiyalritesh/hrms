const fs = require("fs");
let code = fs.readFileSync("screens/admin/UserManagementScreen.tsx", "utf8");

const uiTarget = /<TextInput\s*style=\{\[styles\.modalInput, \{ backgroundColor: theme\.backgroundSecondary, color: theme\.text \}\]\}\s*value=\{form\.team\}\s*onChangeText=\{\(t\) => setForm\(\{ \.\.\.form, team: t \}\)\}\s*placeholder="e.g. Sector 63, Gurugram"\s*placeholderTextColor=\{theme\.textSecondary\}\s*\/>/;

const newUi = `<TextInput
                  style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                  value={form.team}
                  onChangeText={(t) => setForm({ ...form, team: t })}
                  placeholder="e.g. Sector 63, Gurugram"
                  placeholderTextColor={theme.textSecondary}
                />
                <Spacer height={Spacing.md} />
                <ThemedText type="small" style={styles.inputLabel}>Date of Joining</ThemedText>
                <TextInput
                  style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                  value={form.date_of_joining}
                  onChangeText={(t) => setForm({ ...form, date_of_joining: t })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textSecondary}
                />`;

code = code.replace(uiTarget, newUi);
fs.writeFileSync("screens/admin/UserManagementScreen.tsx", code);
console.log("Successfully replaced UI!");
