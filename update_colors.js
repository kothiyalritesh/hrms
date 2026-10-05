const fs = require('fs');
const path = require('path');
const p = path.resolve('screens/admin/SmartOfficeImportedData.tsx');
let content = fs.readFileSync(p, 'utf-8');

// Replace Colors.light.backgroundSecondary with theme.backgroundSecondary
content = content.replace(/backgroundColor:\s*Colors\.light\.backgroundSecondary/g, 'backgroundColor: theme.backgroundSecondary');

fs.writeFileSync(p, content, 'utf-8');
console.log("Updated colors in SmartOfficeImportedData.tsx");
