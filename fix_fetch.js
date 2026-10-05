const fs = require('fs');
let content = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf8');

// Add weekly_off_day to the select query
content = content.replace(
  /date_of_joining,\s*roles\(name\)/,
  'date_of_joining,\n          weekly_off_day,\n          roles(name)'
);

// Add weekly_off_day to formattedData
content = content.replace(
  /date_of_joining: emp\.date_of_joining,\s*\}\)\)/,
  'date_of_joining: emp.date_of_joining,\n            weekly_off_day: emp.weekly_off_day,\n          }))'
);

fs.writeFileSync('screens/admin/UserManagementScreen.tsx', content, 'utf8');
console.log("Added weekly_off_day to fetch");
