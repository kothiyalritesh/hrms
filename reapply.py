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
                    style={[Platform.OS === 'web' ? { height: 48, borderWidth: 0, backgroundColor: 'transparent', outline: 'none', paddingHorizontal: 12, width: '100%' } as any : {}, { color: theme.text }]}
                    dropdownIconColor={theme.text}
                  >
                    <Picker.Item label="Male" value="MALE" />
                    <Picker.Item label="Female" value="FEMALE" />
                  </Picker>
              </View>
              <Spacer height={Spacing.md} />
"""

# Insert gender picker
content = re.sub(
    r'(<ThemedText type="small" style=\{styles\.inputLabel\}>\s*Role\s*</ThemedText>)',
    picker_code + r'\1',
    content
)

# Fix existing pickers style and icon color
content = re.sub(
    r'style=\{\{\s*color:\s*theme\.text\s*\}\}',
    r"style={[Platform.OS === 'web' ? { height: 48, borderWidth: 0, backgroundColor: 'transparent', outline: 'none', paddingHorizontal: 12, width: '100%' } as any : {}, { color: theme.text }]} dropdownIconColor={theme.text}",
    content
)

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/UserManagementScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
