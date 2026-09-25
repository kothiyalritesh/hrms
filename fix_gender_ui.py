import re

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/UserManagementScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

picker_code = """
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
                    selectedValue={form.gender || "MALE"}
                    onValueChange={(value) =>
                      setForm({ ...form, gender: value })
                    }
                    style={{ color: theme.text }}
                  >
                    <Picker.Item label="Male" value="MALE" />
                    <Picker.Item label="Female" value="FEMALE" />
                  </Picker>
              </View>
              <Spacer height={Spacing.md} />
"""

content = re.sub(
    r'(<ThemedText type="small" style=\{styles\.inputLabel\}>\s*Role\s*</ThemedText>)',
    picker_code + r'\1',
    content
)

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/UserManagementScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
