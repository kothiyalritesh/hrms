const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'const today = todayIST();',
  'const today = "2026-09-17"; // hardcoded yesterday for testing'
);
fs.writeFileSync(file, content, 'utf8');