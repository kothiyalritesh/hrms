const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

const toDelete = `// add check-in row
        feedItems.push({
          key:    a.user_id + "_in_" + a.checkin_time,
          name:   prof.name ?? "Unknown",
          office: oName,
          time:   a.checkin_time ? toIST(a.checkin_time) : "?"",
          isIn:   true,
          isNew:  feedItems.length === 0,
        });`;

content = content.replace(toDelete, '');
fs.writeFileSync(file, content, 'utf8');
console.log('Fixed double push');