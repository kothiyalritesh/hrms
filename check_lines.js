const fs = require('fs');
const lines = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf-8').split('\n');
const idx = lines.findIndex(l => l.includes('placeholder="e.g. Sector 63, Gurugram"'));
console.log(lines.slice(idx - 2, idx + 3).join('\n'));
