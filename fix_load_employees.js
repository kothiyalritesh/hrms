const fs = require('fs');
let content = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf8');

content = content.replace(
  /username: emp\.username,/g,
  'username: emp.username,\n            gender: emp.gender,\n            date_of_joining: emp.date_of_joining,'
);

content = content.replace(
  /is_active,\s*username,/g,
  'is_active,\n          username,\n          gender,\n          date_of_joining,'
);

fs.writeFileSync('screens/admin/UserManagementScreen.tsx', content);
console.log('Fixed loadEmployees projection');
