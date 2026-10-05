const fs = require('fs');
let content = fs.readFileSync('screens/DashboardScreen.tsx', 'utf-8');
content = content.replace(/name="refresh-cw"/g, 'name="refresh-ccw"');
fs.writeFileSync('screens/DashboardScreen.tsx', content, 'utf-8');
