const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/AttendanceRegisterReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

// Fix: Pa/Pb/Pv should also apply for CHECKED_OUT, FIELD_VISIT (label starts with P or FV)
content = content.replace(
  `if (label === "P") {\n                          if (emp.sources?.[d] === "BIOMETRIC") label = "Pb";\n                          if (emp.sources?.[d] === "APP") label = "Pa";\n                          if (emp.sources?.[d] === "FIELD_VISIT") label = "Pv";\n                        }`,
  `if (label === "P" || label === "FV") {\n                          if (emp.sources?.[d] === "BIOMETRIC") label = label === "FV" ? "FVb" : "Pb";\n                          else if (emp.sources?.[d] === "APP") label = label === "FV" ? "FVa" : "Pa";\n                          else if (emp.sources?.[d] === "FIELD_VISIT") label = label === "FV" ? "FV" : "Pv";\n                          else if (emp.sources?.[d] === "MULTIPLE") label = label === "FV" ? "FV+" : "P+";\n                        }`
);

fs.writeFileSync(file, content, 'utf8');
console.log("Fixed source labels for all present types");