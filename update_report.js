const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/AttendanceRegisterReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

// Update EmployeeSummary interface to store source
content = content.replace(
  'days: Record<number, string>;',
  'days: Record<number, string>; sources: Record<number, string>;'
);

// When initializing employee in map
content = content.replace(
  'days: {},',
  'days: {}, sources: {},'
);

// When saving the day's data
content = content.replace(
  'emp.days[dayNum] = row.canonical_status;',
  'emp.days[dayNum] = row.canonical_status;\n          emp.sources[dayNum] = row.first_in_source;'
);

// When rendering the label
content = content.replace(
  'const label = STATUS_SHORT[status || ""] || "—";',
  'let label = STATUS_SHORT[status || ""] || "—";\n                      if (label === "P") {\n                        if (emp.sources[d] === "BIOMETRIC") label = "Pb";\n                        if (emp.sources[d] === "APP") label = "Pa";\n                        if (emp.sources[d] === "FIELD_VISIT") label = "Pv";\n                      }'
);

fs.writeFileSync(file, content, 'utf8');
console.log("Updated AttendanceRegisterReportScreen to show Pa/Pb/Pv");