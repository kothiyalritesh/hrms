const fs = require("fs");
let code = fs.readFileSync("screens/admin/AttendanceControlScreenNew.tsx", "utf-8");

const badgeCode = `
                                <View style={[s.statusBadge, { backgroundColor: '#2563EB20' }]}>
                                  <ThemedText style={[s.statusText, { color: '#2563EB' }]}>{attendanceStatusLabel(item, today)}</ThemedText>
                                </View>
                              </View>
                              {(item.active_site_name || item.active_field_visit_name) && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                                  <View style={[s.statusBadge, { backgroundColor: '#8B5CF620', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                                    <Feather name="map-pin" size={10} color="#8B5CF6" />
                                    <ThemedText style={[s.statusText, { color: '#8B5CF6' }]}>Site: {item.active_site_name || item.active_field_visit_name}</ThemedText>
                                  </View>
                                </View>
                              )}
`;

code = code.replace(/<View style=\{\[s\.statusBadge, \{ backgroundColor: '#2563EB20' \}\]\}>\s*<ThemedText style=\{\[s\.statusText, \{ color: '#2563EB' \}\]\}>\{attendanceStatusLabel\(item, today\)\}<\/ThemedText>\s*<\/View>\s*<\/View>/, badgeCode);

fs.writeFileSync("screens/admin/AttendanceControlScreenNew.tsx", code);
console.log("Updated AttendanceControlScreenNew.tsx");
