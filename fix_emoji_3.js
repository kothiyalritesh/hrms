const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/â€¹/g, '‹');
content = content.replace(/âš ï¸/g, '⚠️');
content = content.replace(/â€”/g, '—');
content = content.replace(/Ã‚Â·/g, '·');
content = content.replace(/Â·/g, '·');
content = content.replace(/â€¢/g, '·');
content = content.replace(/ðŸ‘¤/g, '👤');
content = content.replace(/ðŸ¤ /g, '🤝');
content = content.replace(/ðŸš—/g, '🚗');
content = content.replace(/â°/g, '⏰');
content = content.replace(/ðŸ–ï¸ /g, '🏖️');
content = content.replace(/ðŸ–ï¸/g, '🏖️');
content = content.replace(/ðŸŽ‰/g, '🎉');
content = content.replace(/âœ…/g, '✅');
content = content.replace(/âŒ/g, '❌');
content = content.replace(/A\?\?\,A\?\?\,/g, '──');
content = content.replace(/A\?\?A\?\?/g, '──');
content = content.replace(/A,A/g, '·');
content = content.replace(/o\./g, '✅');
content = content.replace(/s\,\?/g, '⚠️');
content = content.replace(/\?\?/g, '⏰');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed more mojibake');