const fs = require('fs');
const file = 'screens/reports/AttendanceRegisterReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace STATUS_COLORS
content = content.replace(
  /PRESENT:\s*"#10B981",\s*CHECKED_OUT:\s*"#10B981",/,
  `PRESENT:      "#10B981",\n  CHECKED_OUT:  "#10B981",\n  CHECKED_IN:   "#10B981",`
);

// Replace STATUS_SHORT
content = content.replace(
  /PRESENT:\s*"P",\s*CHECKED_OUT:\s*"P",/,
  `PRESENT:     "P",\n  CHECKED_OUT: "P",\n  CHECKED_IN:  "P",`
);

// Replace the status logic in load()
content = content.replace(
  /if \(\["PRESENT", "CHECKED_OUT", "LATE", "FIELD_VISIT"\]\.includes\(status\)\) emp\.present\+\+;/,
  `if (["PRESENT", "CHECKED_OUT", "CHECKED_IN", "LATE", "FIELD_VISIT"].includes(status)) emp.present++;`
);

fs.writeFileSync(file, content);
