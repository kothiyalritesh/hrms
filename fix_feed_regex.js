const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /\/\/\s+add check-in row\s+feedItems\.push\(\{\s+key:[^\}]+?time:\s+a\.checkin_time \? toIST\(a\.checkin_time\) : "[^"]+",\s+isIn:\s+true,\s+isNew:\s+feedItems\.length === 0,\s+\}\);/s;

const newCode = `// add check-in row ONLY if they actually checked in
        if (a.checkin_time) {
          feedItems.push({
            key:    a.user_id + "_in_" + a.checkin_time,
            name:   prof.name ?? "Unknown",
            office: oName,
            time:   toIST(a.checkin_time),
            isIn:   true,
            isNew:  false,
          });
        }`;

if (regex.test(content)) {
  content = content.replace(regex, newCode);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Fixed feed generation with regex');
} else {
  console.log('Regex did not match!');
}