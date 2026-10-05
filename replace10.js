const fs = require('fs');
const file = 'services/canonical-attendance.service.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /export type AttendanceSource =\s*\| "APP"\s*\| "BIOMETRIC"/,
  `export type AttendanceSource =\n  | "APP"\n  | "BIOMETRIC"\n  | "COMBINED"`
);

fs.writeFileSync(file, content);
