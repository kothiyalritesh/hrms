const fs = require("fs");
let code = fs.readFileSync("screens/admin/UserManagementScreen.tsx", "utf8");

code = code.replace(
  /office_id: form\.office_id \|\| null,\s*team: form\.team \|\| null,\s*\},/g,
  "office_id: form.office_id || null,\n              team: form.team || null,\n              date_of_joining: form.date_of_joining || null,\n            },"
);

code = code.replace(
  /office_id: form\.office_id \|\| null,\s*team: form\.team \|\| null,\s*is_active: true,\s*\},/g,
  "office_id: form.office_id || null,\n              team: form.team || null,\n              is_active: true,\n              date_of_joining: form.date_of_joining || null,\n              },"
);

const uiTarget = /<ThemedText type="small" style=\{styles\.inputLabel\}>Team<\/ThemedText>\s*<TextInput\s*style=\{\[styles\.modalInput, \{ backgroundColor: theme\.backgroundSecondary, color: theme\.text \}\]\}\s*value=\{form\.team\}\s*onChangeText=\{\(t\) => setForm\(\{ \.\.\.form, team: t \}\)\}\s*\/>/;

const newUi = `<ThemedText type="small" style={styles.inputLabel}>Team</ThemedText>
                <TextInput
                  style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                  value={form.team}
                  onChangeText={(t) => setForm({ ...form, team: t })}
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
console.log("Successfully replaced!");
