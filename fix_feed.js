const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

const oldCode = `        // add check-in row
        feedItems.push({
          key:    a.user_id + "_in_" + a.checkin_time,
          name:   prof.name ?? "Unknown",
          office: oName,
          time:   a.checkin_time ? toIST(a.checkin_time) : "—",
          isIn:   true,
          isNew:  feedItems.length === 0,
        });
        // also add check-out row if exists
        if (a.checkout_time) {
          feedItems.push({
            key:    a.user_id + "_out_" + a.checkout_time,
            name:   prof.name ?? "Unknown",
            office: oName,
            time:   toIST(a.checkout_time),
            isIn:   false,
            isNew:  false,
          });
        }`;

const newCode = `        // add check-in row ONLY if they actually checked in
        if (a.checkin_time) {
          feedItems.push({
            key:    a.user_id + "_in_" + a.checkin_time,
            name:   prof.name ?? "Unknown",
            office: oName,
            time:   toIST(a.checkin_time),
            isIn:   true,
            isNew:  false,
          });
        }
        // also add check-out row if exists
        if (a.checkout_time) {
          feedItems.push({
            key:    a.user_id + "_out_" + a.checkout_time,
            name:   prof.name ?? "Unknown",
            office: oName,
            time:   toIST(a.checkout_time),
            isIn:   false,
            isNew:  false,
          });
        }`;

content = content.replace(oldCode, newCode);
fs.writeFileSync(file, content, 'utf8');
console.log('Fixed feed generation');