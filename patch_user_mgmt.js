const fs = require('fs');
let file = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf8');

// 1. Add date_of_joining to the update RPC payload
file = file.replace(
  'office_id: form.office_id || null,\n              team: form.team || null,\n            },\n          });',
  'office_id: form.office_id || null,\n              team: form.team || null,\n              date_of_joining: form.date_of_joining || null,\n            },\n          });'
);

// 2. Add date_of_joining to the insert RPC payload
file = file.replace(
  'office_id: form.office_id || null,\n              team: form.team || null,\n              is_active: true,\n              },\n            },\n          );',
  'office_id: form.office_id || null,\n              team: form.team || null,\n              is_active: true,\n              date_of_joining: form.date_of_joining || null,\n              },\n            },\n          );'
);

// 3. Inject the UI Text Input in the modal, right under 'Gender' block (which ends with a closing View and then the "The employee can now log in" text).
const oldUi = '                <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: \nSpacing.md, lineHeight: 18 }}>';
const newUi = '                <Spacer height={Spacing.md} />\n\n                <ThemedText type="small" style={styles.inputLabel}>\n                  Date of Joining\n                </ThemedText>\n                <TextInput\n                  style={[\n                    styles.modalInput,\n                    {\n                      backgroundColor: theme.backgroundSecondary,\n                      color: theme.text,\n                    },\n                  ]}\n                  value={form.date_of_joining}\n                  onChangeText={(t) => setForm({ ...form, date_of_joining: t })}\n                  placeholder="YYYY-MM-DD"\n                  placeholderTextColor={theme.textSecondary}\n                />\n                <Spacer height={Spacing.md} />\n' + oldUi;

file = file.replace(oldUi, newUi);

// Actually, wait, let me just find a simpler anchor for the UI injection. 
// "team: t })}" is where the Team input is. Let's insert it after the Team input.
const teamAnchor = 'onChangeText={(t) => setForm({ ...form, team: t })}\n                />';
const dateUi = 'onChangeText={(t) => setForm({ ...form, team: t })}\n                />\n                <Spacer height={Spacing.md} />\n                <ThemedText type="small" style={styles.inputLabel}>Date of Joining</ThemedText>\n                <TextInput style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]} value={form.date_of_joining} onChangeText={(t) => setForm({ ...form, date_of_joining: t })} placeholder="YYYY-MM-DD" placeholderTextColor={theme.textSecondary} />';
file = file.replace(teamAnchor, dateUi);

fs.writeFileSync('screens/admin/UserManagementScreen.tsx', file);
console.log("Updated UserManagementScreen.tsx");
