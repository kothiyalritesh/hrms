const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/AttendanceRegisterReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'emp.days[dayNum] = status;',
  'emp.days[dayNum] = status;\n          emp.sources[dayNum] = row.first_in_source;'
);

fs.writeFileSync(file, content, 'utf8');
console.log("Fixed report script");