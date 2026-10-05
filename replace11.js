const fs = require('fs');
const file = 'screens/reports/AttendanceRegisterReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /if \(emp\.sources\?\.\[d\] === "FIELD_VISIT"\) label = "Pv";/,
  `if (emp.sources?.[d] === "FIELD_VISIT") label = "Pv";
                        if (emp.sources?.[d] === "COMBINED") label = "P(a+b)";`
);

fs.writeFileSync(file, content);
