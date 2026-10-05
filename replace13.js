const fs = require('fs');
const file = 'screens/reports/AttendanceRegisterReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /            \)\)\}\n          <\/View>\n        <\/ScrollView>/,
  `            ))}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 8, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: theme.border }}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Pa = App, Pb = Bio, P(a+b) = Both</ThemedText>
              </View>
          </View>
        </ScrollView>`
);

fs.writeFileSync(file, content);
