const fs = require('fs');
let content = fs.readFileSync('screens/admin/AdminDeviceSessionsScreen.tsx', 'utf8');

content = content.replace(
  /\{row\.employee_number \? Emp ID: \\ A  : ""\}/g,
  '{row.employee_number ? `Emp ID: ${row.employee_number} - ` : ""}'
);

fs.writeFileSync('screens/admin/AdminDeviceSessionsScreen.tsx', content);
console.log('Fixed syntax in AdminDeviceSessionsScreen');
