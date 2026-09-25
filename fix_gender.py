import re

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/UserManagementScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add gender to state if missing
if 'gender: "MALE"' not in content:
    content = re.sub(
        r'employee_number: "",\s*role_id: ""',
        r'employee_number: "",\n    role_id: "",\n    gender: "MALE"',
        content
    )

# Add UI picker for gender
picker_code = """
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Gender *</ThemedText>
                <View style={[styles.pickerContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Picker
                    selectedValue={form.gender || "MALE"}
                    onValueChange={(itemValue) => setForm({ ...form, gender: itemValue })}
                    style={[styles.picker, { color: theme.text }]}
                    dropdownIconColor={theme.text}
                  >
                    <Picker.Item label="Male" value="MALE" color={isDark ? "#FFF" : "#000"} />
                    <Picker.Item label="Female" value="FEMALE" color={isDark ? "#FFF" : "#000"} />
                  </Picker>
                </View>
              </View>
"""

# Insert before role picker
content = content.replace('<ThemedText style={styles.label}>Role / Designation *</ThemedText>', picker_code.strip() + '\n              <View style={styles.inputGroup}>\n                <ThemedText style={styles.label}>Role / Designation *</ThemedText>')

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/UserManagementScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
