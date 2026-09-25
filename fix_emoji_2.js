const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/label="PRESENT"\s+color=\{C\.green\}\s+icon=".*?"/, 'label="PRESENT"  color={C.green}  icon="👤"');
content = content.replace(/label="ABSENT"\s+color=\{C\.pink\}\s+icon=".*?"/, 'label="ABSENT"   color={C.pink}   icon="👤"');
content = content.replace(/label="FIELD VISITS"\s+color=\{C\.amber\}\s+icon=".*?"/, 'label="FIELD VISITS" color={C.amber}  icon="🤝"');
content = content.replace(/label="CHECKED OUT"\s+color=\{C\.teal\}\s+icon=".*?"/, 'label="CHECKED OUT" color={C.teal}   icon="🚗"');
content = content.replace(/label="FRAUD"\s+color=\{C\.purple\}\s+icon=".*?"/, 'label="FRAUD"    color={C.purple} icon="⚠️"');
content = content.replace(/label="LATE"\s+color="#ef4444"\s+icon=".*?"/, 'label="LATE" color="#ef4444" icon="⏰"');
content = content.replace(/label="ON LEAVE"\s+color="#6366f1"\s+icon=".*?"/, 'label="ON LEAVE" color="#6366f1" icon="🏖️"');

content = content.replace(/emoji: ".*?",\n\s*text: "All systems normal .*? no issues detected"/, 'emoji: "✅",\n          text: "All systems normal — no issues detected"');
content = content.replace(/emoji = ".*?"; bg = "#1a1a3d"/, 'emoji = "📵"; bg = "#1a1a3d"');

content = content.replace(/title={?`?.*? Fraud \/ GPS Anomaly.*?`?}?/, 'title="⚠️  Fraud / GPS Anomaly"');
content = content.replace(/title={`.*? Present Today/, 'title={`✅  Present Today');
content = content.replace(/title={`.*? Absent Today/, 'title={`❌  Absent Today');
content = content.replace(/title={`.*? Live Meetings/, 'title={`🤝  Live Meetings');
content = content.replace(/title={`.*? In Route/, 'title={`🚗  In Route');
content = content.replace(/title={`.*? Late Arrivals/, 'title={`⏰  Late Arrivals');
content = content.replace(/title={`.*? On Leave/, 'title={`🏖️  On Leave');

content = content.replace(/Everyone is present! .*?</, 'Everyone is present! 🎉<');
content = content.replace(/>.*? No anomalies detected right now/, '>✅ No anomalies detected right now');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed emojis with regex');