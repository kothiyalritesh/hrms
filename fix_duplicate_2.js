const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /\/\/\s*add check-in row\s*feedItems\.push\(\{\s*key:\s*a\.user_id \+ "_in_" \+ a\.checkin_time,\s*name:\s*prof\.name \?\? "Unknown",\s*office:\s*oName,\s*time:\s*a\.checkin_time \? toIST\(a\.checkin_time\) : ".*?",\s*isIn:\s*true,\s*isNew:\s*feedItems\.length === 0,\s*\}\);/s;

content = content.replace(regex, '');
fs.writeFileSync(file, content, 'utf8');
console.log('Fixed double push for real');