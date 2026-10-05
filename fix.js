const fs = require('fs');
let src = fs.readFileSync('screens/admin/AttendanceControlScreenNew.tsx', 'utf8');

src = src.replace(/            const expanded = expandedDates\.has\(date\);[\s\S]*?\}\)\.length;/g, '');

fs.writeFileSync('screens/admin/AttendanceControlScreenNew.tsx', src);
console.log('Fixed variable shadowing');

