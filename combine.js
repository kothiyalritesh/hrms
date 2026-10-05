const fs = require('fs');
const monthly = fs.readFileSync('fix_monthly_attendance.sql', 'utf-8');
const canonical = fs.readFileSync('fix_canonical.sql', 'utf-8');

const combined = monthly + '\n\n' + canonical;
fs.writeFileSync('weekly_off_part2.sql', combined, 'utf-8');
console.log("Combined fixes");
