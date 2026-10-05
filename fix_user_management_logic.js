const fs = require('fs');
let content = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf8');

// 1. Add gender and date_of_joining to Employee interface
content = content.replace(
  /office_name: string;/g,
  'office_name: string;\n  gender?: string;\n  date_of_joining?: string;'
);

// 2. Add gender and date_of_joining to EMPTY_FORM
content = content.replace(
  /office_id: "",/g,
  'office_id: "",\n  gender: "MALE",\n  date_of_joining: "",'
);

// 3. Add them to openEditModal
content = content.replace(
  /office_id: matchedOffice\?\.id \|\| "",/g,
  'office_id: matchedOffice?.id || "",\n      gender: emp.gender || "MALE",\n      date_of_joining: emp.date_of_joining || "",'
);

// 4. Add them to handleSave
content = content.replace(
  /team: form\.team \|\| null,/g,
  'team: form.team || null,\n              gender: form.gender,\n              date_of_joining: form.date_of_joining || null,'
);

// 5. Update Picker styling to include backgroundColor and dropdownIconColor
content = content.replace(
  /style=\{\{ color: theme\.text \}\}/g,
  'style={{ color: theme.text, backgroundColor: Platform.OS === "web" ? theme.backgroundSecondary : "transparent" }} dropdownIconColor={theme.text}'
);

fs.writeFileSync('screens/admin/UserManagementScreen.tsx', content);
console.log('Fixed UserManagementScreen logic');
