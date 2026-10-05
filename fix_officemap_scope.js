const fs = require('fs');
let content = fs.readFileSync('screens/admin/AttendanceControlScreenNew.tsx', 'utf8');

// Fix officeMap scoping
content = content.replace(
  /const officeMap = new Map<string, string>\(\);/g,
  ''
);

content = content.replace(
  /const punchMap:/,
  'const officeMap = new Map<string, string>();\n      const punchMap:'
);

fs.writeFileSync('screens/admin/AttendanceControlScreenNew.tsx', content);
console.log('Fixed officeMap scope');
