const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/⏰/g, '??');
content = content.replace(/label="LATE" color="#ef4444" icon="\?\?"/g, 'label="LATE" color="#ef4444" icon="⏰"');

content = content.replace(/emoji = "âš\s*ï¸\s*"/g, 'emoji = "⚠️"');
content = content.replace(/emoji = "âš\s*ï¸"/g, 'emoji = "⚠️"');
content = content.replace(/emoji = "âš"/g, 'emoji = "⚠️"');

content = content.replace(/emoji: "ðŸ¤ "/g, 'emoji: "🤝"');
content = content.replace(/emoji: "ðŸ¤"/g, 'emoji: "🤝"');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed ?? and emoji');