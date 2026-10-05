const fs = require('fs');
let content = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf-8');

const regex = /placeholderTextColor=\{theme\.textSecondary\}\s*\/\>/;

const uiToAdd = `placeholderTextColor={theme.textSecondary}
                />
                <Spacer height={Spacing.md} />
                <ThemedText type="small" style={styles.inputLabel}>Weekly Off Day (Optional)</ThemedText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {[
                    { label: "Sun", value: 0 },
                    { label: "Mon", value: 1 },
                    { label: "Tue", value: 2 },
                    { label: "Wed", value: 3 },
                    { label: "Thu", value: 4 },
                    { label: "Fri", value: 5 },
                    { label: "Sat", value: 6 },
                  ].map((d) => {
                    const isSelected = form.weekly_off_day === d.value;
                    return (
                      <Pressable
                        key={d.value}
                        onPress={() => setForm({ ...form, weekly_off_day: isSelected ? -1 : d.value })}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: isSelected ? theme.primary : theme.border,
                          backgroundColor: isSelected ? theme.primary + "15" : theme.backgroundSecondary,
                        }}
                      >
                        <ThemedText type="caption" style={{ color: isSelected ? theme.primary : theme.textSecondary, fontWeight: "600" }}>
                          {d.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>`;

if (content.match(regex)) {
  content = content.replace(regex, uiToAdd);
  fs.writeFileSync('screens/admin/UserManagementScreen.tsx', content, 'utf-8');
  console.log("Added UI component");
} else {
  console.log("Could not find insertion point");
}
