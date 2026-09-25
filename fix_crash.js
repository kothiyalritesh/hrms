const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/AttendanceRegisterReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'if (emp.sources[d] === "BIOMETRIC") label = "Pb";',
  'if (emp.sources?.[d] === "BIOMETRIC") label = "Pb";'
);
content = content.replace(
  'if (emp.sources[d] === "APP") label = "Pa";',
  'if (emp.sources?.[d] === "APP") label = "Pa";'
);
content = content.replace(
  'if (emp.sources[d] === "FIELD_VISIT") label = "Pv";',
  'if (emp.sources?.[d] === "FIELD_VISIT") label = "Pv";'
);

fs.writeFileSync(file, content, 'utf8');
console.log("Added safe optional chaining to sources!");