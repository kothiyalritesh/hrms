const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(
  'const [canonicalData, alertResult] = await Promise.all([',
  'console.log("TV DISPLAY FETCHING DATA for today=", today); const [canonicalData, alertResult] = await Promise.all(['
);
fs.writeFileSync(file, content, 'utf8');