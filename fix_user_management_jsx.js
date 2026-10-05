const fs = require('fs');
let content = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf8');

const injection = `
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Gender
              </ThemedText>
              <View
                style={[
                  styles.pickerContainer,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <Picker
                  selectedValue={form.gender}
                  onValueChange={(value) =>
                    setForm({ ...form, gender: value })
                  }
                  style={{ color: theme.text, backgroundColor: Platform.OS === "web" ? theme.backgroundSecondary : "transparent" }} dropdownIconColor={theme.text}
                >
                  <Picker.Item label="Male" value="MALE" />
                  <Picker.Item label="Female" value="FEMALE" />
                </Picker>
              </View>

              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Date of Joining
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={form.date_of_joining}
                onChangeText={(t) => setForm({ ...form, date_of_joining: t })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textSecondary}
              />
`;

content = content.replace(
  /placeholder="e\.g\., 001, 002 \(used for username\)"\s*placeholderTextColor=\{theme\.textSecondary\}\s*\/>/,
  `placeholder="e.g., 001, 002 (used for username)"\n                placeholderTextColor={theme.textSecondary}\n              />` + injection
);

fs.writeFileSync('screens/admin/UserManagementScreen.tsx', content);
console.log('Injected gender and joining date');
