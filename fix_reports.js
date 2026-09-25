const fs = require('fs');

function fixFile(file) {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('const data = await CanonicalAttendanceService.list(start, end);')) {
    content = content.replace(
      'const [start, end] = monthRange(year, month);',
      'const [start, endRaw] = monthRange(year, month);\n      const today = new Date().toISOString().slice(0, 10);\n      const end = endRaw > today ? today : endRaw;'
    );
    fs.writeFileSync(file, content, 'utf8');
    console.log("Fixed " + file);
  }
}

fixFile('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/AttendanceRegisterReportScreen.tsx');

let hrFile = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/AdvancedAttendanceReportScreen.tsx';
let hrContent = fs.readFileSync(hrFile, 'utf8');
if (hrContent.includes('const end = nextEnd;')) {
  // wait advanced report screen probably handles this?
}