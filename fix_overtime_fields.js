const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/OvertimeReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/item\.units_earned/g, 'item.units');
content = content.replace(/item\.work_description/g, 'item.reason');
content = content.replace(/item\.profiles\?\.name/g, 'item.employee?.name');
content = content.replace(/item\.profiles\?\.employee_number/g, "''");
content = content.replace(/item\.approved_by\?\.name/g, 'item.approver?.name');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed field usage');