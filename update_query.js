const fs = require('fs');
let content = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf-8');
content = content.replace('office_id,\n            team,\n            reports_to,', 'office_id,\n            team,\n            weekly_off_day,\n            reports_to,');
fs.writeFileSync('screens/admin/UserManagementScreen.tsx', content, 'utf-8');
console.log("Replaced query");
