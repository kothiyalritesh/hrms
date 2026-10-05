const fs = require("fs");
let code = fs.readFileSync("screens/admin/OfficeSettingsScreen.tsx", "utf-8");

const states = `  const [teamSchedules, setTeamSchedules] = useState<any[]>([]);\n`;
code = code.replace(/const \[offices, setOffices\] = useState<Office\[\]>\(\[\]\);/, `$&${states}`);

const loadCall = `
    const [{ data, error }, { data: issues, error: issuesError }, { data: schedules }] = await Promise.all([
      supabase.from("offices").select("*").order("name"),
      supabase.rpc("rpc_admin_attendance_configuration_issues"),
      supabase.from("work_schedule_configs").select("*").order("team")
    ]);
    if (schedules) setTeamSchedules(schedules);
`;
code = code.replace(/const \[\{ data, error \}, \{ data: issues, error: issuesError \}\] = await Promise\.all\(\[\s*supabase\.from\("offices"\)\.select\("\*"\)\.order\("name"\),\s*supabase\.rpc\("rpc_admin_attendance_configuration_issues"\),\s*\]\);/, loadCall);

const listFooter = `
          ListFooterComponent={() => (
            <View style={{ marginTop: Spacing.xl, marginBottom: Spacing['2xl'] }}>
              <ThemedText type="h3">Team Schedules & Policies</ThemedText>
              <Spacer height={Spacing.md} />
              {teamSchedules.length === 0 ? <ThemedText>No team schedules configured.</ThemedText> : null}
              {teamSchedules.map(t => (
                <View key={t.id} style={[styles.officeCard, { backgroundColor: theme.backgroundDefault }]}>
                  <ThemedText type="body" style={{ fontWeight: '700', color: theme.text, marginBottom: 4 }}>{t.team} Team</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>Saturday: {t.saturday_policy}</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>Sunday: {t.sunday_policy}</ThemedText>
                  {t.monday_credit_bonus && <ThemedText type="caption" style={{ color: Colors.light.success, marginTop: 4 }}>ś +1 Monday Biometric Compliance Credit</ThemedText>}
                </View>
              ))}
            </View>
          )}
`;
code = code.replace(/showsVerticalScrollIndicator=\{false\}\s*\/>/, `showsVerticalScrollIndicator={false}\n${listFooter}\n        />`);

fs.writeFileSync("screens/admin/OfficeSettingsScreen.tsx", code);
console.log("Updated OfficeSettingsScreen.tsx");
