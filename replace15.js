const fs = require('fs');
const file = 'screens/reports/AttendanceRegisterReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /if \(\["PRESENT","CHECKED_OUT","LATE","FIELD_VISIT"\]\.includes\(status\)\) emp\.present\+\+;/,
  `if (["PRESENT", "CHECKED_OUT", "CHECKED_IN", "LATE", "FIELD_VISIT"].includes(status)) emp.present++;`
);

fs.writeFileSync(file, content);
