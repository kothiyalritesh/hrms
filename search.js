const fs = require('fs');
const path = require('path');

function search(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === 'node_modules' || f === '.git' || f === 'android' || f === 'ios') continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      search(p);
    } else if (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js')) {
      const content = fs.readFileSync(p, 'utf-8');
      if (content.includes('rpc_admin_attendance_daily_v3')) {
        console.log(`Found in: ${p}`);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('rpc_admin_attendance_daily_v3')) {
            console.log(`Line ${i + 1}: ${lines[i]}`);
          }
        }
      }
    }
  }
}

search('d:/download/RealtyHRM-fixed/RealtyHRM-fixed');
