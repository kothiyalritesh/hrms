const fs = require('fs');
let content = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf8');

// 1. Add weekly_off_day to EMPTY_FORM
content = content.replace(
  /team: "",\s*\};/,
  'team: "",\n  weekly_off_day: -1 as number | null,\n};'
);

// 2. Add weekly_off_day to openEditModal
content = content.replace(
  /team: emp.team \|\| "",\s*\}\);/,
  'team: emp.team || "",\n      weekly_off_day: emp.weekly_off_day ?? -1,\n    });'
);

// 3. Add weekly_off_day to rpc_admin_save_profile calls (both edit and create)
content = content.replace(
  /date_of_joining: form\.date_of_joining \|\| null,\s*\},/g,
  'date_of_joining: form.date_of_joining || null,\n            weekly_off_day: form.weekly_off_day !== -1 ? form.weekly_off_day : null,\n          },'
);

fs.writeFileSync('screens/admin/UserManagementScreen.tsx', content, 'utf8');
console.log("Fixes applied successfully");
