const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/icon=\"dY\` \"/g, 'icon="👤"');
content = content.replace(/icon=\"dY \?\"/g, 'icon="🤝"');
content = content.replace(/icon=\"dYs-\"/g, 'icon="🚗"');
content = content.replace(/icon=\"s,\?\"/g, 'icon="⚠️"');
content = content.replace(/icon=\"\?\"/g, 'icon="⏰"');
content = content.replace(/icon=\"dY\?-,\?\"/g, 'icon="🏖️"');

content = content.replace(/emoji: \"o\.\"/g, 'emoji: "✅"');
content = content.replace(/All systems normal \?\" no issues detected/g, 'All systems normal — no issues detected');

content = content.replace(/title=\"\?  Fraud \/ GPS Anomaly\"/g, 'title="⚠️  Fraud / GPS Anomaly"');
content = content.replace(/o\. No anomalies detected right now/g, '✅ No anomalies detected right now');

content = content.replace(/title=\`o\.  Present Today \(\$\{present\}\)\`/g, 'title={`✅  Present Today (${present})`}');
content = content.replace(/title=\`\?  Absent Today \(\$\{absent\}\)\`/g, 'title={`❌  Absent Today (${absent})`}');
content = content.replace(/Everyone is present! dY\?\"/g, 'Everyone is present! 🎉');
content = content.replace(/title=\`dY \?  Live Meetings \(\$\{meetCount\}\)\`/g, 'title={`🤝  Live Meetings (${meetCount})`}');
content = content.replace(/title=\`dYs-  In Route \(\$\{routeCount\}\)\`/g, 'title={`🚗  In Route (${routeCount})`}');

content = content.replace(/title=\`\?  Late Arrivals \(\$\{lateCount\}\)\`/g, 'title={`⏰  Late Arrivals (${lateCount})`}');
content = content.replace(/title=\`dY\?-,\?  On Leave \(\$\{leaveCount\}\)\`/g, 'title={`🏖️  On Leave (${leaveCount})`}');

content = content.replace(/emoji: \"\?\", bg: \"#1a1a3d\"/g, 'emoji: "📵", bg: "#1a1a3d"');
content = content.replace(/emoji: \"dY \?\"/g, 'emoji: "🤝"');
content = content.replace(/emoji: \"dYs-\"/g, 'emoji: "🚗"');
content = content.replace(/emoji = \"\?\"/g, 'emoji = "⚠️"');
content = content.replace(/emoji = \"\?\"/g, 'emoji = "📵"');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed emojis');