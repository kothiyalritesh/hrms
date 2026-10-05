const fs = require('fs');
const file = 'services/canonical-attendance.service.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /attendance_source: c\.attendance_source \?\? \(c\.biometric_first_in \? 'BIOMETRIC' : 'APP'\)/,
  `attendance_source: c.attendance_source ?? (c.biometric_first_in ? 'BIOMETRIC' : 'APP'),
        first_in_source: c.app_first_in && c.biometric_first_in ? 'COMBINED' : (c.biometric_first_in ? 'BIOMETRIC' : (c.app_first_in ? 'APP' : (c.field_visit_first_in ? 'FIELD_VISIT' : 'NONE')))`
);

fs.writeFileSync(file, content);
